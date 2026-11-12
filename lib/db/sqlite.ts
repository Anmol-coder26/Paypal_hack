import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HttpError } from "../errors";
import { assertPaymentTransition, assertWorkTransition } from "../payments/state-machine";
import type {
  AIProviderType,
  AIReviewRecord,
  DecisionRecord,
  EvidenceAnnotation,
  EvidenceRecord,
  PaymentEvent,
  PaymentMode,
  PaymentRecord,
  PaymentStatus,
  Profile,
  Project,
  ProjectBundle,
  RepairTask,
  TaskBundle,
  UserRole,
  WorkStatus,
} from "../types";
import type {
  CreateProjectInput,
  IdempotencyRow,
  ProfileWithSecret,
  PunchPayRepository,
  SaveEvidenceInput,
  UpdateTaskInput,
} from "./repository";

export const DEMO_ACCOUNTS = {
  homeowner: {
    id: "11111111-1111-4111-8111-111111111101",
    name: "Elena Vance",
    email: "homeowner@punchpay.demo",
    role: "homeowner" as const,
    password: "punchpay-demo-homeowner",
  },
  contractor: {
    id: "22222222-2222-4222-8222-222222222202",
    name: "Marcus Rivera",
    email: "contractor@punchpay.demo",
    role: "contractor" as const,
    password: "punchpay-demo-contractor",
  },
};

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(":");
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, "hex");
  const derived = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

const nowIso = () => new Date().toISOString();

export class SqliteRepository implements PunchPayRepository {
  readonly driver = "sqlite" as const;
  private readonly db: DatabaseSync;
  private readonly evidenceDir: string;
  private seeded = false;

  constructor(dbFilePath?: string) {
    const resolvedDb =
      dbFilePath ||
      process.env.PUNCHPAY_DB_PATH ||
      path.join(process.cwd(), ".data", "punchpay.db");
    const dir = path.dirname(resolvedDb);
    fs.mkdirSync(dir, { recursive: true });
    this.evidenceDir = path.join(dir, "evidence");
    fs.mkdirSync(this.evidenceDir, { recursive: true });
    this.db = new DatabaseSync(resolvedDb);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.initSchema();
  }

  close() {
    this.db.close();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('homeowner', 'contractor')),
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        homeowner_id TEXT NOT NULL REFERENCES profiles(id),
        contractor_id TEXT NOT NULL REFERENCES profiles(id),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        location TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
        currency TEXT NOT NULL DEFAULT 'USD',
        due_date TEXT,
        is_guided_demo INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS repair_tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        acceptance_criteria TEXT NOT NULL,
        amount_minor_units INTEGER NOT NULL CHECK (amount_minor_units > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        work_status TEXT NOT NULL,
        payment_status TEXT NOT NULL,
        contractor_notes TEXT NOT NULL DEFAULT '',
        homeowner_feedback TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES repair_tasks(id) ON DELETE CASCADE,
        uploaded_by TEXT NOT NULL REFERENCES profiles(id),
        image_storage_path TEXT NOT NULL,
        evidence_type TEXT NOT NULL CHECK (evidence_type IN ('before', 'after', 'reference')),
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_reviews (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES repair_tasks(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        structured_findings TEXT NOT NULL,
        recommendation TEXT NOT NULL,
        review_version INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payment_records (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE REFERENCES repair_tasks(id) ON DELETE CASCADE,
        payment_mode TEXT NOT NULL DEFAULT 'paypal_sandbox' CHECK (payment_mode IN ('paypal_sandbox', 'simulation')),
        paypal_order_id TEXT UNIQUE,
        paypal_authorization_id TEXT UNIQUE,
        paypal_capture_id TEXT UNIQUE,
        paypal_status TEXT,
        sim_intent_id TEXT UNIQUE,
        sim_authorization_id TEXT UNIQUE,
        sim_capture_id TEXT UNIQUE,
        sim_status TEXT,
        payee_merchant_id TEXT,
        amount_minor_units INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        payment_status TEXT NOT NULL,
        order_attempt INTEGER NOT NULL DEFAULT 1,
        request_nonce TEXT NOT NULL,
        authorization_created_at TEXT,
        authorization_expires_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payment_events (
        id TEXT PRIMARY KEY,
        payment_record_id TEXT NOT NULL REFERENCES payment_records(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES repair_tasks(id) ON DELETE CASCADE,
        actor TEXT NOT NULL,
        event_type TEXT NOT NULL,
        paypal_event_id TEXT UNIQUE,
        safe_metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES repair_tasks(id) ON DELETE CASCADE,
        homeowner_id TEXT NOT NULL REFERENCES profiles(id),
        decision TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS idempotency_operations (
        id TEXT PRIMARY KEY,
        operation_key TEXT NOT NULL UNIQUE,
        payment_record_id TEXT NOT NULL REFERENCES payment_records(id) ON DELETE CASCADE,
        operation_type TEXT NOT NULL,
        status TEXT NOT NULL,
        response_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evidence_annotations (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES repair_tasks(id) ON DELETE CASCADE,
        evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES profiles(id),
        author_name TEXT NOT NULL,
        author_role TEXT NOT NULL,
        x_pct REAL NOT NULL,
        y_pct REAL NOT NULL,
        label TEXT NOT NULL,
        severity TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // Migrate existing local SQLite databases cleanly without dropping user data
    const cols = this.db.prepare("PRAGMA table_info(payment_records)").all() as Array<{ name: string }>;
    const existing = new Set(cols.map((c) => c.name));
    if (!existing.has("payment_mode")) {
      this.db.exec("ALTER TABLE payment_records ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'paypal_sandbox'");
    }
    if (!existing.has("sim_intent_id")) {
      this.db.exec("ALTER TABLE payment_records ADD COLUMN sim_intent_id TEXT");
      this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS payment_records_sim_intent_idx ON payment_records (sim_intent_id)");
    }
    if (!existing.has("sim_authorization_id")) {
      this.db.exec("ALTER TABLE payment_records ADD COLUMN sim_authorization_id TEXT");
      this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS payment_records_sim_auth_idx ON payment_records (sim_authorization_id)");
    }
    if (!existing.has("sim_capture_id")) {
      this.db.exec("ALTER TABLE payment_records ADD COLUMN sim_capture_id TEXT");
      this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS payment_records_sim_cap_idx ON payment_records (sim_capture_id)");
    }
    if (!existing.has("sim_status")) {
      this.db.exec("ALTER TABLE payment_records ADD COLUMN sim_status TEXT");
    }
  }

  async ensureSeedProfiles(): Promise<void> {
    if (this.seeded) return;
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO profiles (id, name, email, role, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const ts = nowIso();
    stmt.run(
      DEMO_ACCOUNTS.homeowner.id,
      DEMO_ACCOUNTS.homeowner.name,
      DEMO_ACCOUNTS.homeowner.email,
      DEMO_ACCOUNTS.homeowner.role,
      hashPassword(DEMO_ACCOUNTS.homeowner.password),
      ts
    );
    stmt.run(
      DEMO_ACCOUNTS.contractor.id,
      DEMO_ACCOUNTS.contractor.name,
      DEMO_ACCOUNTS.contractor.email,
      DEMO_ACCOUNTS.contractor.role,
      hashPassword(DEMO_ACCOUNTS.contractor.password),
      ts
    );
    this.seeded = true;
  }

  async getProfileById(id: string): Promise<Profile | null> {
    await this.ensureSeedProfiles();
    const row = this.db
      .prepare("SELECT id, name, email, role, created_at FROM profiles WHERE id = ?")
      .get(id) as Profile | undefined;
    return row ?? null;
  }

  async getProfileByEmail(email: string): Promise<ProfileWithSecret | null> {
    await this.ensureSeedProfiles();
    const row = this.db
      .prepare(
        "SELECT id, name, email, role, password_hash, created_at FROM profiles WHERE lower(email) = lower(?)"
      )
      .get(email.trim()) as ProfileWithSecret | undefined;
    return row ?? null;
  }

  async listProfilesByRole(role: UserRole): Promise<Profile[]> {
    await this.ensureSeedProfiles();
    return this.db
      .prepare(
        "SELECT id, name, email, role, created_at FROM profiles WHERE role = ? ORDER BY created_at ASC"
      )
      .all(role) as unknown as Profile[];
  }

  async createProfile(input: {
    name: string;
    email: string;
    role: UserRole;
    password_hash: string;
  }): Promise<Profile> {
    await this.ensureSeedProfiles();
    const id = crypto.randomUUID();
    const created_at = nowIso();
    try {
      this.db
        .prepare(
          "INSERT INTO profiles (id, name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(
          id,
          input.name.trim(),
          input.email.trim().toLowerCase(),
          input.role,
          input.password_hash,
          created_at
        );
    } catch {
      throw new HttpError(409, "An account with this email already exists.");
    }
    return {
      id,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      role: input.role,
      created_at,
    };
  }

  async createSession(input: {
    user_id: string;
    token_hash: string;
    expires_at: string;
  }): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(crypto.randomUUID(), input.user_id, input.token_hash, input.expires_at, nowIso());
  }

  async getSessionUser(tokenHash: string): Promise<Profile | null> {
    await this.ensureSeedProfiles();
    const row = this.db
      .prepare(
        `SELECT p.id, p.name, p.email, p.role, p.created_at, s.expires_at
         FROM sessions s
         JOIN profiles p ON p.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash) as (Profile & { expires_at: string }) | undefined;
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      created_at: row.created_at,
    };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  private hydrateTask(taskRow: Record<string, unknown>): TaskBundle {
    const taskId = String(taskRow.id);
    const payment = this.db
      .prepare("SELECT * FROM payment_records WHERE task_id = ?")
      .get(taskId) as unknown as PaymentRecord;

    const evidenceRows = this.db
      .prepare("SELECT * FROM evidence WHERE task_id = ? ORDER BY created_at DESC")
      .all(taskId) as unknown as EvidenceRecord[];

    const evidence = evidenceRows.map((ev) => ({
      ...ev,
      url: `/api/evidence/${ev.id}`,
    }));

    const rawReviews = this.db
      .prepare(
        "SELECT * FROM ai_reviews WHERE task_id = ? ORDER BY review_version DESC"
      )
      .all(taskId) as Array<Record<string, unknown>>;

    const reviews: AIReviewRecord[] = rawReviews.map((r) => ({
      id: String(r.id),
      task_id: String(r.task_id),
      model: String(r.model),
      provider: r.provider as AIProviderType,
      structured_findings: JSON.parse(String(r.structured_findings)),
      recommendation: r.recommendation as AIReviewRecord["recommendation"],
      review_version: Number(r.review_version),
      created_at: String(r.created_at),
    }));

    const decisions = this.db
      .prepare("SELECT * FROM decisions WHERE task_id = ? ORDER BY created_at DESC")
      .all(taskId) as unknown as DecisionRecord[];

    const rawEvents = this.db
      .prepare("SELECT * FROM payment_events WHERE task_id = ? ORDER BY created_at DESC")
      .all(taskId) as Array<Record<string, unknown>>;

    const events: PaymentEvent[] = rawEvents.map((e) => ({
      id: String(e.id),
      payment_record_id: String(e.payment_record_id),
      task_id: String(e.task_id),
      actor: e.actor as PaymentEvent["actor"],
      event_type: String(e.event_type),
      paypal_event_id: e.paypal_event_id ? String(e.paypal_event_id) : null,
      safe_metadata: JSON.parse(String(e.safe_metadata || "{}")),
      created_at: String(e.created_at),
    }));

    const annotations = this.db
      .prepare("SELECT * FROM evidence_annotations WHERE task_id = ? ORDER BY created_at ASC")
      .all(taskId) as unknown as EvidenceAnnotation[];

    return {
      id: taskId,
      project_id: String(taskRow.project_id),
      title: String(taskRow.title),
      description: String(taskRow.description),
      acceptance_criteria: JSON.parse(String(taskRow.acceptance_criteria || "[]")),
      amount_minor_units: Number(taskRow.amount_minor_units),
      currency: "USD",
      work_status: taskRow.work_status as WorkStatus,
      payment_status: taskRow.payment_status as PaymentStatus,
      contractor_notes: String(taskRow.contractor_notes || ""),
      homeowner_feedback: String(taskRow.homeowner_feedback || ""),
      created_at: String(taskRow.created_at),
      updated_at: String(taskRow.updated_at),
      payment,
      evidence,
      annotations,
      latest_review: reviews[0] ?? null,
      reviews,
      decisions,
      events,
    };
  }

  private hydrateProject(row: Record<string, unknown>): ProjectBundle {
    const projectId = String(row.id);
    const taskRows = this.db
      .prepare("SELECT * FROM repair_tasks WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as Array<Record<string, unknown>>;
    return {
      id: projectId,
      homeowner_id: String(row.homeowner_id),
      contractor_id: String(row.contractor_id),
      title: String(row.title),
      description: String(row.description || ""),
      location: String(row.location || ""),
      status: row.status as Project["status"],
      currency: "USD",
      due_date: row.due_date ? String(row.due_date) : null,
      is_guided_demo: Boolean(row.is_guided_demo),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      homeowner_name: String(row.homeowner_name),
      contractor_name: String(row.contractor_name),
      contractor_email: String(row.contractor_email),
      tasks: taskRows.map((t) => this.hydrateTask(t)),
    };
  }

  async listProjectsForUser(user: Profile): Promise<ProjectBundle[]> {
    await this.ensureSeedProfiles();
    const col = user.role === "homeowner" ? "p.homeowner_id" : "p.contractor_id";
    const rows = this.db
      .prepare(
        `SELECT p.*, h.name AS homeowner_name, c.name AS contractor_name, c.email AS contractor_email
         FROM projects p
         JOIN profiles h ON h.id = p.homeowner_id
         JOIN profiles c ON c.id = p.contractor_id
         WHERE ${col} = ?
         ORDER BY p.created_at DESC`
      )
      .all(user.id) as Array<Record<string, unknown>>;
    return rows.map((r) => this.hydrateProject(r));
  }

  async getProjectBundle(projectId: string): Promise<ProjectBundle | null> {
    await this.ensureSeedProfiles();
    const row = this.db
      .prepare(
        `SELECT p.*, h.name AS homeowner_name, c.name AS contractor_name, c.email AS contractor_email
         FROM projects p
         JOIN profiles h ON h.id = p.homeowner_id
         JOIN profiles c ON c.id = p.contractor_id
         WHERE p.id = ?`
      )
      .get(projectId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.hydrateProject(row);
  }

  async createProject(input: CreateProjectInput): Promise<ProjectBundle> {
    await this.ensureSeedProfiles();
    const projectId = crypto.randomUUID();
    const ts = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO projects (id, homeowner_id, contractor_id, title, description, location, status, currency, due_date, is_guided_demo, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 'USD', ?, ?, ?, ?)`
        )
        .run(
          projectId,
          input.homeowner_id,
          input.contractor_id,
          input.title.trim(),
          input.description.trim(),
          input.location.trim(),
          input.due_date || null,
          input.is_guided_demo ? 1 : 0,
          ts,
          ts
        );

      const insertTask = this.db.prepare(
        `INSERT INTO repair_tasks (id, project_id, title, description, acceptance_criteria, amount_minor_units, currency, work_status, payment_status, contractor_notes, homeowner_feedback, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'USD', 'PENDING_EVIDENCE', 'DRAFT', ?, '', ?, ?)`
      );
      const insertPayment = this.db.prepare(
        `INSERT INTO payment_records (id, task_id, payment_mode, amount_minor_units, currency, payment_status, order_attempt, request_nonce, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'USD', 'DRAFT', 1, ?, ?, ?)`
      );
      const insertEvent = this.db.prepare(
        `INSERT INTO payment_events (id, payment_record_id, task_id, actor, event_type, safe_metadata, created_at)
         VALUES (?, ?, ?, 'homeowner', 'task_created', ?, ?)`
      );
      const initialMode: PaymentMode = input.payment_mode || "paypal_sandbox";

      for (const task of input.tasks) {
        const taskId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        const nonce = crypto.randomBytes(6).toString("hex");
        insertTask.run(
          taskId,
          projectId,
          task.title.trim(),
          task.description.trim(),
          JSON.stringify(task.acceptance_criteria),
          task.amount_minor_units,
          task.contractor_notes?.trim() || "",
          ts,
          ts
        );
        insertPayment.run(paymentId, taskId, initialMode, task.amount_minor_units, nonce, ts, ts);
        insertEvent.run(
          crypto.randomUUID(),
          paymentId,
          taskId,
          JSON.stringify({ title: task.title, amount_minor_units: task.amount_minor_units, payment_mode: initialMode }),
          ts
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }

    const bundle = await this.getProjectBundle(projectId);
    if (!bundle) throw new HttpError(500, "Failed to load newly created project");
    return bundle;
  }

  async updateProjectStatus(projectId: string, status: Project["status"]): Promise<void> {
    this.db
      .prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, nowIso(), projectId);
  }

  async addTask(
    projectId: string,
    input: CreateProjectInput["tasks"][number],
    paymentMode: PaymentMode = "paypal_sandbox"
  ): Promise<TaskBundle> {
    const taskId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    const ts = nowIso();
    const nonce = crypto.randomBytes(6).toString("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO repair_tasks (id, project_id, title, description, acceptance_criteria, amount_minor_units, currency, work_status, payment_status, contractor_notes, homeowner_feedback, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'USD', 'PENDING_EVIDENCE', 'DRAFT', ?, '', ?, ?)`
        )
        .run(
          taskId,
          projectId,
          input.title.trim(),
          input.description.trim(),
          JSON.stringify(input.acceptance_criteria),
          input.amount_minor_units,
          input.contractor_notes?.trim() || "",
          ts,
          ts
        );
      this.db
        .prepare(
          `INSERT INTO payment_records (id, task_id, payment_mode, amount_minor_units, currency, payment_status, order_attempt, request_nonce, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'USD', 'DRAFT', 1, ?, ?, ?)`
        )
        .run(paymentId, taskId, paymentMode, input.amount_minor_units, nonce, ts, ts);
      this.db
        .prepare(
          `INSERT INTO payment_events (id, payment_record_id, task_id, actor, event_type, safe_metadata, created_at)
           VALUES (?, ?, ?, 'homeowner', 'task_created', ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          paymentId,
          taskId,
          JSON.stringify({ title: input.title, amount_minor_units: input.amount_minor_units }),
          ts
        );
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    const bundle = await this.getTaskBundle(taskId);
    if (!bundle) throw new HttpError(500, "Failed to load task");
    return bundle;
  }

  async updateTask(taskId: string, input: UpdateTaskInput): Promise<TaskBundle> {
    const existing = await this.getTaskBundle(taskId);
    if (!existing) throw new HttpError(404, "Task not found");
    if (existing.payment_status !== "DRAFT") {
      throw new HttpError(
        409,
        "Task terms and amount cannot be edited after a PayPal order has been created."
      );
    }
    const ts = nowIso();
    const nextAmount = input.amount_minor_units ?? existing.amount_minor_units;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `UPDATE repair_tasks
           SET title = ?, description = ?, acceptance_criteria = ?, amount_minor_units = ?, contractor_notes = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.title?.trim() ?? existing.title,
          input.description?.trim() ?? existing.description,
          JSON.stringify(input.acceptance_criteria ?? existing.acceptance_criteria),
          nextAmount,
          input.contractor_notes?.trim() ?? existing.contractor_notes,
          ts,
          taskId
        );
      this.db
        .prepare("UPDATE payment_records SET amount_minor_units = ?, updated_at = ? WHERE task_id = ?")
        .run(nextAmount, ts, taskId);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    const updated = await this.getTaskBundle(taskId);
    if (!updated) throw new HttpError(404, "Task not found");
    return updated;
  }

  async deleteTask(taskId: string): Promise<void> {
    const existing = await this.getTaskBundle(taskId);
    if (!existing) throw new HttpError(404, "Task not found");
    if (existing.payment_status !== "DRAFT") {
      throw new HttpError(
        409,
        "Cannot delete a task after a PayPal order or authorization exists."
      );
    }
    this.db.prepare("DELETE FROM repair_tasks WHERE id = ?").run(taskId);
  }

  async getTaskBundle(taskId: string): Promise<TaskBundle | null> {
    const row = this.db
      .prepare("SELECT * FROM repair_tasks WHERE id = ?")
      .get(taskId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.hydrateTask(row);
  }

  async getTaskProject(taskId: string): Promise<Project | null> {
    const row = this.db
      .prepare(
        `SELECT p.* FROM projects p
         JOIN repair_tasks t ON t.project_id = p.id
         WHERE t.id = ?`
      )
      .get(taskId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      homeowner_id: String(row.homeowner_id),
      contractor_id: String(row.contractor_id),
      title: String(row.title),
      description: String(row.description || ""),
      location: String(row.location || ""),
      status: row.status as Project["status"],
      currency: "USD",
      due_date: row.due_date ? String(row.due_date) : null,
      is_guided_demo: Boolean(row.is_guided_demo),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  async updateTaskWorkStatus(
    taskId: string,
    workStatus: WorkStatus,
    patch?: { contractor_notes?: string; homeowner_feedback?: string }
  ): Promise<void> {
    const current = this.db
      .prepare("SELECT work_status, contractor_notes, homeowner_feedback FROM repair_tasks WHERE id = ?")
      .get(taskId) as
      | { work_status: WorkStatus; contractor_notes: string; homeowner_feedback: string }
      | undefined;
    if (!current) throw new HttpError(404, "Task not found");
    assertWorkTransition(current.work_status, workStatus);
    this.db
      .prepare(
        `UPDATE repair_tasks
         SET work_status = ?, contractor_notes = ?, homeowner_feedback = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        workStatus,
        patch?.contractor_notes ?? current.contractor_notes,
        patch?.homeowner_feedback ?? current.homeowner_feedback,
        nowIso(),
        taskId
      );
  }

  async saveEvidence(input: SaveEvidenceInput): Promise<EvidenceRecord> {
    const id = crypto.randomUUID();
    const filename = `${input.task_id}_${input.evidence_type}_${id}.${input.ext}`;
    const fullPath = path.join(this.evidenceDir, filename);
    fs.writeFileSync(fullPath, input.bytes);
    const created_at = nowIso();
    this.db
      .prepare(
        `INSERT INTO evidence (id, task_id, uploaded_by, image_storage_path, evidence_type, mime_type, byte_size, width, height, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.task_id,
        input.uploaded_by,
        filename,
        input.evidence_type,
        input.mime_type,
        input.byte_size,
        input.width,
        input.height,
        input.notes,
        created_at
      );
    return {
      id,
      task_id: input.task_id,
      uploaded_by: input.uploaded_by,
      image_storage_path: filename,
      evidence_type: input.evidence_type,
      mime_type: input.mime_type,
      byte_size: input.byte_size,
      width: input.width,
      height: input.height,
      notes: input.notes,
      created_at,
      url: `/api/evidence/${id}`,
    };
  }

  async getEvidenceById(id: string): Promise<EvidenceRecord | null> {
    const row = this.db
      .prepare("SELECT * FROM evidence WHERE id = ?")
      .get(id) as EvidenceRecord | undefined;
    return row ? { ...row, url: `/api/evidence/${row.id}` } : null;
  }

  async readEvidenceBytes(
    storagePath: string
  ): Promise<{ bytes: Buffer; mimeType: string } | null> {
    const safeName = path.basename(storagePath);
    const fullPath = path.join(this.evidenceDir, safeName);
    if (!fs.existsSync(fullPath)) return null;
    const ext = path.extname(safeName).toLowerCase();
    const mimeType =
      ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return { bytes: fs.readFileSync(fullPath), mimeType };
  }

  async deleteEvidence(id: string): Promise<void> {
    const ev = await this.getEvidenceById(id);
    if (!ev) return;
    this.db.prepare("DELETE FROM evidence WHERE id = ?").run(id);
    const fullPath = path.join(this.evidenceDir, path.basename(ev.image_storage_path));
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }

  async addAnnotation(input: {
    task_id: string;
    evidence_id: string;
    author_id: string;
    author_name: string;
    author_role: UserRole;
    x_pct: number;
    y_pct: number;
    label: string;
    severity: "info" | "concern" | "verified";
  }): Promise<EvidenceAnnotation> {
    const id = crypto.randomUUID();
    const created_at = nowIso();
    this.db
      .prepare(
        `INSERT INTO evidence_annotations (id, task_id, evidence_id, author_id, author_name, author_role, x_pct, y_pct, label, severity, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.task_id,
        input.evidence_id,
        input.author_id,
        input.author_name,
        input.author_role,
        input.x_pct,
        input.y_pct,
        input.label,
        input.severity,
        created_at
      );
    return { id, ...input, created_at };
  }

  async getAnnotationById(
    annotationId: string,
    taskId: string
  ): Promise<EvidenceAnnotation | null> {
    const row = this.db
      .prepare("SELECT * FROM evidence_annotations WHERE id = ? AND task_id = ?")
      .get(annotationId, taskId) as EvidenceAnnotation | undefined;
    return row ?? null;
  }

  async deleteAnnotation(annotationId: string, taskId: string): Promise<void> {
    this.db
      .prepare("DELETE FROM evidence_annotations WHERE id = ? AND task_id = ?")
      .run(annotationId, taskId);
  }

  async saveAIReview(input: {
    task_id: string;
    model: string;
    provider: AIProviderType;
    structured_findings: AIReviewRecord["structured_findings"];
    recommendation: AIReviewRecord["recommendation"];
  }): Promise<AIReviewRecord> {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(review_version), 0) AS max_ver FROM ai_reviews WHERE task_id = ?")
      .get(input.task_id) as { max_ver: number };
    const nextVersion = Number(row.max_ver) + 1;
    const id = crypto.randomUUID();
    const created_at = nowIso();
    this.db
      .prepare(
        `INSERT INTO ai_reviews (id, task_id, model, provider, structured_findings, recommendation, review_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.task_id,
        input.model,
        input.provider,
        JSON.stringify(input.structured_findings),
        input.recommendation,
        nextVersion,
        created_at
      );
    return {
      id,
      task_id: input.task_id,
      model: input.model,
      provider: input.provider,
      structured_findings: input.structured_findings,
      recommendation: input.recommendation,
      review_version: nextVersion,
      created_at,
    };
  }

  async claimPaymentState(
    taskId: string,
    allowedPriors: PaymentStatus[],
    nextStatus: PaymentStatus,
    patch: Partial<
      Pick<
        PaymentRecord,
        | "payment_mode"
        | "paypal_order_id"
        | "paypal_authorization_id"
        | "paypal_capture_id"
        | "paypal_status"
        | "sim_intent_id"
        | "sim_authorization_id"
        | "sim_capture_id"
        | "sim_status"
        | "payee_merchant_id"
        | "order_attempt"
        | "authorization_created_at"
        | "authorization_expires_at"
        | "last_error"
      >
    > = {}
  ): Promise<PaymentRecord> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.db
        .prepare("SELECT * FROM payment_records WHERE task_id = ?")
        .get(taskId) as unknown as PaymentRecord | undefined;
      if (!current) throw new HttpError(404, "Payment record not found");
      if (!allowedPriors.includes(current.payment_status)) {
        throw new HttpError(
          409,
          `Payment state is currently ${current.payment_status}; refresh before retrying.`
        );
      }
      assertPaymentTransition(current.payment_status, nextStatus);

      if (
        patch.payment_mode &&
        patch.payment_mode !== current.payment_mode &&
        (current.paypal_order_id || current.sim_intent_id)
      ) {
        throw new HttpError(
          409,
          "Cannot switch payment mode after an order or simulated intent has already started."
        );
      }
      if (
        current.paypal_authorization_id &&
        patch.paypal_authorization_id !== undefined &&
        patch.paypal_authorization_id !== current.paypal_authorization_id
      ) {
        throw new HttpError(409, "PayPal authorization ID is immutable once recorded");
      }
      if (
        current.paypal_capture_id &&
        patch.paypal_capture_id !== undefined &&
        patch.paypal_capture_id !== current.paypal_capture_id
      ) {
        throw new HttpError(409, "PayPal capture ID is immutable once recorded");
      }
      if (
        current.sim_authorization_id &&
        patch.sim_authorization_id !== undefined &&
        patch.sim_authorization_id !== current.sim_authorization_id
      ) {
        throw new HttpError(409, "Simulated authorization ID is immutable once recorded");
      }
      if (
        current.sim_capture_id &&
        patch.sim_capture_id !== undefined &&
        patch.sim_capture_id !== current.sim_capture_id
      ) {
        throw new HttpError(409, "Simulated capture ID is immutable once recorded");
      }

      const merged = {
        payment_mode: patch.payment_mode !== undefined ? patch.payment_mode : current.payment_mode,
        paypal_order_id:
          patch.paypal_order_id !== undefined
            ? patch.paypal_order_id
            : current.paypal_order_id,
        paypal_authorization_id:
          patch.paypal_authorization_id !== undefined
            ? patch.paypal_authorization_id
            : current.paypal_authorization_id,
        paypal_capture_id:
          patch.paypal_capture_id !== undefined
            ? patch.paypal_capture_id
            : current.paypal_capture_id,
        paypal_status:
          patch.paypal_status !== undefined ? patch.paypal_status : current.paypal_status,
        sim_intent_id:
          patch.sim_intent_id !== undefined ? patch.sim_intent_id : current.sim_intent_id,
        sim_authorization_id:
          patch.sim_authorization_id !== undefined
            ? patch.sim_authorization_id
            : current.sim_authorization_id,
        sim_capture_id:
          patch.sim_capture_id !== undefined ? patch.sim_capture_id : current.sim_capture_id,
        sim_status: patch.sim_status !== undefined ? patch.sim_status : current.sim_status,
        payee_merchant_id:
          patch.payee_merchant_id !== undefined
            ? patch.payee_merchant_id
            : current.payee_merchant_id,
        order_attempt:
          patch.order_attempt !== undefined ? patch.order_attempt : current.order_attempt,
        authorization_created_at:
          patch.authorization_created_at !== undefined
            ? patch.authorization_created_at
            : current.authorization_created_at,
        authorization_expires_at:
          patch.authorization_expires_at !== undefined
            ? patch.authorization_expires_at
            : current.authorization_expires_at,
        last_error: patch.last_error !== undefined ? patch.last_error : current.last_error,
      };
      const ts = nowIso();
      this.db
        .prepare(
          `UPDATE payment_records SET
             payment_status = ?,
             payment_mode = ?,
             paypal_order_id = ?,
             paypal_authorization_id = ?,
             paypal_capture_id = ?,
             paypal_status = ?,
             sim_intent_id = ?,
             sim_authorization_id = ?,
             sim_capture_id = ?,
             sim_status = ?,
             payee_merchant_id = ?,
             order_attempt = ?,
             authorization_created_at = ?,
             authorization_expires_at = ?,
             last_error = ?,
             updated_at = ?
           WHERE task_id = ?`
        )
        .run(
          nextStatus,
          merged.payment_mode,
          merged.paypal_order_id,
          merged.paypal_authorization_id,
          merged.paypal_capture_id,
          merged.paypal_status,
          merged.sim_intent_id,
          merged.sim_authorization_id,
          merged.sim_capture_id,
          merged.sim_status,
          merged.payee_merchant_id,
          merged.order_attempt,
          merged.authorization_created_at,
          merged.authorization_expires_at,
          merged.last_error,
          ts,
          taskId
        );
      this.db
        .prepare("UPDATE repair_tasks SET payment_status = ?, updated_at = ? WHERE id = ?")
        .run(nextStatus, ts, taskId);
      const updated = this.db
        .prepare("SELECT * FROM payment_records WHERE task_id = ?")
        .get(taskId) as unknown as PaymentRecord;
      this.db.exec("COMMIT");
      return updated;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async findPaymentByPayPalIds(ids: {
    orderId?: string | null;
    authorizationId?: string | null;
    captureId?: string | null;
  }): Promise<PaymentRecord | null> {
    if (ids.captureId) {
      const row = this.db
        .prepare("SELECT * FROM payment_records WHERE paypal_capture_id = ?")
        .get(ids.captureId) as unknown as PaymentRecord | undefined;
      if (row) return row;
    }
    if (ids.authorizationId) {
      const row = this.db
        .prepare("SELECT * FROM payment_records WHERE paypal_authorization_id = ?")
        .get(ids.authorizationId) as unknown as PaymentRecord | undefined;
      if (row) return row;
    }
    if (ids.orderId) {
      const row = this.db
        .prepare("SELECT * FROM payment_records WHERE paypal_order_id = ?")
        .get(ids.orderId) as unknown as PaymentRecord | undefined;
      if (row) return row;
    }
    return null;
  }

  async recordPaymentEvent(input: {
    payment_record_id: string;
    task_id: string;
    actor: PaymentEvent["actor"];
    event_type: string;
    paypal_event_id?: string | null;
    safe_metadata?: Record<string, unknown>;
  }): Promise<PaymentEvent | null> {
    const id = crypto.randomUUID();
    const created_at = nowIso();
    try {
      this.db
        .prepare(
          `INSERT INTO payment_events (id, payment_record_id, task_id, actor, event_type, paypal_event_id, safe_metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.payment_record_id,
          input.task_id,
          input.actor,
          input.event_type,
          input.paypal_event_id ?? null,
          JSON.stringify(input.safe_metadata ?? {}),
          created_at
        );
    } catch {
      // Duplicate paypal_event_id means webhook was already processed.
      return null;
    }
    return {
      id,
      payment_record_id: input.payment_record_id,
      task_id: input.task_id,
      actor: input.actor,
      event_type: input.event_type,
      paypal_event_id: input.paypal_event_id ?? null,
      safe_metadata: input.safe_metadata ?? {},
      created_at,
    };
  }

  async recordDecision(input: {
    task_id: string;
    homeowner_id: string;
    decision: DecisionRecord["decision"];
    reason: string;
  }): Promise<DecisionRecord> {
    const id = crypto.randomUUID();
    const created_at = nowIso();
    this.db
      .prepare(
        `INSERT INTO decisions (id, task_id, homeowner_id, decision, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.task_id, input.homeowner_id, input.decision, input.reason, created_at);
    return { id, ...input, created_at };
  }

  async beginIdempotency(input: {
    operation_key: string;
    payment_record_id: string;
    operation_type: IdempotencyRow["operation_type"];
  }): Promise<{ acquired: boolean; existing?: IdempotencyRow }> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db
        .prepare("SELECT * FROM idempotency_operations WHERE operation_key = ?")
        .get(input.operation_key) as Record<string, unknown> | undefined;
      if (existing) {
        this.db.exec("COMMIT");
        return {
          acquired: false,
          existing: {
            id: String(existing.id),
            operation_key: String(existing.operation_key),
            payment_record_id: String(existing.payment_record_id),
            operation_type: existing.operation_type as IdempotencyRow["operation_type"],
            status: existing.status as IdempotencyRow["status"],
            response_json: existing.response_json
              ? JSON.parse(String(existing.response_json))
              : null,
            created_at: String(existing.created_at),
          },
        };
      }
      this.db
        .prepare(
          `INSERT INTO idempotency_operations (id, operation_key, payment_record_id, operation_type, status, created_at)
           VALUES (?, ?, ?, ?, 'IN_PROGRESS', ?)`
        )
        .run(
          crypto.randomUUID(),
          input.operation_key,
          input.payment_record_id,
          input.operation_type,
          nowIso()
        );
      this.db.exec("COMMIT");
      return { acquired: true };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async finishIdempotency(
    operationKey: string,
    status: "SUCCEEDED" | "FAILED",
    responseJson?: Record<string, unknown>
  ): Promise<void> {
    if (status === "FAILED") {
      // Failed pre-flight checks allow clean retry with same key or fresh record.
      this.db
        .prepare("DELETE FROM idempotency_operations WHERE operation_key = ? AND status = 'IN_PROGRESS'")
        .run(operationKey);
      return;
    }
    this.db
      .prepare(
        "UPDATE idempotency_operations SET status = ?, response_json = ? WHERE operation_key = ?"
      )
      .run(status, responseJson ? JSON.stringify(responseJson) : null, operationKey);
  }

  async listAllEventsForUser(user: Profile) {
    await this.ensureSeedProfiles();
    const col = user.role === "homeowner" ? "p.homeowner_id" : "p.contractor_id";
    const rows = this.db
      .prepare(
        `SELECT e.*, p.id AS project_id, p.title AS project_title, t.title AS task_title, t.amount_minor_units
         FROM payment_events e
         JOIN repair_tasks t ON t.id = e.task_id
         JOIN projects p ON p.id = t.project_id
         WHERE ${col} = ?
         ORDER BY e.created_at DESC
         LIMIT 100`
      )
      .all(user.id) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      payment_record_id: String(r.payment_record_id),
      task_id: String(r.task_id),
      actor: r.actor as PaymentEvent["actor"],
      event_type: String(r.event_type),
      paypal_event_id: r.paypal_event_id ? String(r.paypal_event_id) : null,
      safe_metadata: JSON.parse(String(r.safe_metadata || "{}")),
      created_at: String(r.created_at),
      project_id: String(r.project_id),
      project_title: String(r.project_title),
      task_title: String(r.task_title),
      amount_minor_units: Number(r.amount_minor_units),
    }));
  }

  async listLedgerForUser(user: Profile) {
    const projects = await this.listProjectsForUser(user);
    const entries: Array<{
      payment: PaymentRecord;
      task: RepairTask;
      project: Project;
      homeowner_name: string;
      contractor_name: string;
      events: PaymentEvent[];
    }> = [];
    for (const p of projects) {
      for (const t of p.tasks) {
        entries.push({
          payment: t.payment,
          task: t,
          project: p,
          homeowner_name: p.homeowner_name,
          contractor_name: p.contractor_name,
          events: t.events,
        });
      }
    }
    return entries;
  }
}
