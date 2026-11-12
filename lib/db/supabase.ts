import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
import { DEMO_ACCOUNTS, hashPassword } from "./sqlite";

const EVIDENCE_BUCKET = "punchpay-evidence";

export class SupabaseRepository implements PunchPayRepository {
  readonly driver = "supabase" as const;
  private readonly client: SupabaseClient;
  private seeded = false;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async ensureSeedProfiles(): Promise<void> {
    if (this.seeded) return;
    for (const acct of [DEMO_ACCOUNTS.homeowner, DEMO_ACCOUNTS.contractor]) {
      await this.client.from("profiles").upsert(
        {
          id: acct.id,
          name: acct.name,
          email: acct.email,
          role: acct.role,
          password_hash: hashPassword(acct.password),
        },
        { onConflict: "email", ignoreDuplicates: true }
      );
    }
    this.seeded = true;
  }

  async getProfileById(id: string): Promise<Profile | null> {
    await this.ensureSeedProfiles();
    const { data } = await this.client
      .from("profiles")
      .select("id, name, email, role, created_at")
      .eq("id", id)
      .maybeSingle();
    return (data as Profile) ?? null;
  }

  async getProfileByEmail(email: string): Promise<ProfileWithSecret | null> {
    await this.ensureSeedProfiles();
    const { data } = await this.client
      .from("profiles")
      .select("id, name, email, role, password_hash, created_at")
      .ilike("email", email.trim())
      .maybeSingle();
    return (data as ProfileWithSecret) ?? null;
  }

  async listProfilesByRole(role: UserRole): Promise<Profile[]> {
    await this.ensureSeedProfiles();
    const { data } = await this.client
      .from("profiles")
      .select("id, name, email, role, created_at")
      .eq("role", role)
      .order("created_at", { ascending: true });
    return (data as Profile[]) ?? [];
  }

  async createProfile(input: {
    name: string;
    email: string;
    role: UserRole;
    password_hash: string;
  }): Promise<Profile> {
    await this.ensureSeedProfiles();
    const { data, error } = await this.client
      .from("profiles")
      .insert({
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role: input.role,
        password_hash: input.password_hash,
      })
      .select("id, name, email, role, created_at")
      .single();
    if (error || !data) {
      throw new HttpError(409, "An account with this email already exists.");
    }
    return data as Profile;
  }

  async createSession(input: {
    user_id: string;
    token_hash: string;
    expires_at: string;
  }): Promise<void> {
    const { error } = await this.client.from("sessions").insert(input);
    if (error) throw new HttpError(500, "Failed to create session");
  }

  async getSessionUser(tokenHash: string): Promise<Profile | null> {
    await this.ensureSeedProfiles();
    const { data: session } = await this.client
      .from("sessions")
      .select("user_id, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (!session) return null;
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await this.deleteSession(tokenHash);
      return null;
    }
    return this.getProfileById(session.user_id);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.client.from("sessions").delete().eq("token_hash", tokenHash);
  }

  private async hydrateTask(task: Record<string, unknown>): Promise<TaskBundle> {
    const taskId = String(task.id);
    const [
      { data: payment },
      { data: evRows },
      { data: annRows },
      { data: reviews },
      { data: decisions },
      { data: events },
    ] = await Promise.all([
      this.client.from("payment_records").select("*").eq("task_id", taskId).single(),
      this.client
        .from("evidence")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false }),
      this.client
        .from("evidence_annotations")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true }),
      this.client
        .from("ai_reviews")
        .select("*")
        .eq("task_id", taskId)
        .order("review_version", { ascending: false }),
      this.client
        .from("decisions")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false }),
      this.client
        .from("payment_events")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false }),
    ]);

    const evidence = ((evRows as EvidenceRecord[]) ?? []).map((e) => ({
      ...e,
      url: `/api/evidence/${e.id}`,
    }));

    const parsedReviews = ((reviews as AIReviewRecord[]) ?? []);
    const criteriaRaw = task.acceptance_criteria;
    const acceptance_criteria = Array.isArray(criteriaRaw)
      ? (criteriaRaw as string[])
      : JSON.parse(String(criteriaRaw || "[]"));

    return {
      id: taskId,
      project_id: String(task.project_id),
      title: String(task.title),
      description: String(task.description),
      acceptance_criteria,
      amount_minor_units: Number(task.amount_minor_units),
      currency: "USD",
      work_status: task.work_status as WorkStatus,
      payment_status: task.payment_status as PaymentStatus,
      contractor_notes: String(task.contractor_notes || ""),
      homeowner_feedback: String(task.homeowner_feedback || ""),
      created_at: String(task.created_at),
      updated_at: String(task.updated_at),
      payment: payment as PaymentRecord,
      evidence,
      annotations: (annRows as EvidenceAnnotation[]) ?? [],
      latest_review: parsedReviews[0] ?? null,
      reviews: parsedReviews,
      decisions: (decisions as DecisionRecord[]) ?? [],
      events: (events as PaymentEvent[]) ?? [],
    };
  }

  async listProjectsForUser(user: Profile): Promise<ProjectBundle[]> {
    await this.ensureSeedProfiles();
    const col = user.role === "homeowner" ? "homeowner_id" : "contractor_id";
    const { data: projects } = await this.client
      .from("projects")
      .select("*")
      .eq(col, user.id)
      .order("created_at", { ascending: false });
    if (!projects?.length) return [];
    const bundles = await Promise.all(
      projects.map((p) => this.getProjectBundle(String(p.id)))
    );
    return bundles.filter((b): b is ProjectBundle => b !== null);
  }

  async getProjectBundle(projectId: string): Promise<ProjectBundle | null> {
    await this.ensureSeedProfiles();
    const { data: p } = await this.client
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .maybeSingle();
    if (!p) return null;
    const [homeowner, contractor, { data: taskRows }] = await Promise.all([
      this.getProfileById(p.homeowner_id),
      this.getProfileById(p.contractor_id),
      this.client
        .from("repair_tasks")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
    ]);
    const tasks = await Promise.all(
      (taskRows ?? []).map((t) => this.hydrateTask(t as Record<string, unknown>))
    );
    return {
      ...(p as Project),
      homeowner_name: homeowner?.name ?? "Homeowner",
      contractor_name: contractor?.name ?? "Contractor",
      contractor_email: contractor?.email ?? "",
      tasks,
    };
  }

  async createProject(input: CreateProjectInput): Promise<ProjectBundle> {
    await this.ensureSeedProfiles();
    const { data: project, error } = await this.client
      .from("projects")
      .insert({
        homeowner_id: input.homeowner_id,
        contractor_id: input.contractor_id,
        title: input.title.trim(),
        description: input.description.trim(),
        location: input.location.trim(),
        due_date: input.due_date || null,
        is_guided_demo: Boolean(input.is_guided_demo),
      })
      .select("*")
      .single();
    if (error || !project) throw new HttpError(500, "Failed to create project in Supabase");

    for (const task of input.tasks) {
      await this.addTask(project.id, task, input.payment_mode);
    }
    const bundle = await this.getProjectBundle(project.id);
    if (!bundle) throw new HttpError(500, "Failed to load created project");
    return bundle;
  }

  async updateProjectStatus(projectId: string, status: Project["status"]): Promise<void> {
    await this.client
      .from("projects")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", projectId);
  }

  async addTask(
    projectId: string,
    input: CreateProjectInput["tasks"][number],
    paymentMode: PaymentMode = "paypal_sandbox"
  ): Promise<TaskBundle> {
    const { data: task, error } = await this.client
      .from("repair_tasks")
      .insert({
        project_id: projectId,
        title: input.title.trim(),
        description: input.description.trim(),
        acceptance_criteria: JSON.stringify(input.acceptance_criteria),
        amount_minor_units: input.amount_minor_units,
        contractor_notes: input.contractor_notes?.trim() || "",
      })
      .select("*")
      .single();
    if (error || !task) throw new HttpError(500, "Failed to create repair task");

    const nonce = crypto.randomBytes(6).toString("hex");
    const { data: payment, error: pErr } = await this.client
      .from("payment_records")
      .insert({
        task_id: task.id,
        payment_mode: paymentMode,
        amount_minor_units: input.amount_minor_units,
        request_nonce: nonce,
      })
      .select("*")
      .single();
    if (pErr || !payment) throw new HttpError(500, "Failed to initialize payment record");

    await this.recordPaymentEvent({
      payment_record_id: payment.id,
      task_id: task.id,
      actor: "homeowner",
      event_type: "task_created",
      safe_metadata: { title: task.title, amount_minor_units: input.amount_minor_units },
    });

    const bundle = await this.getTaskBundle(task.id);
    if (!bundle) throw new HttpError(500, "Failed to load repair task");
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
    const nextAmount = input.amount_minor_units ?? existing.amount_minor_units;
    await this.client
      .from("repair_tasks")
      .update({
        title: input.title?.trim() ?? existing.title,
        description: input.description?.trim() ?? existing.description,
        acceptance_criteria: JSON.stringify(
          input.acceptance_criteria ?? existing.acceptance_criteria
        ),
        amount_minor_units: nextAmount,
        contractor_notes: input.contractor_notes?.trim() ?? existing.contractor_notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);
    await this.client
      .from("payment_records")
      .update({ amount_minor_units: nextAmount, updated_at: new Date().toISOString() })
      .eq("task_id", taskId);
    const updated = await this.getTaskBundle(taskId);
    if (!updated) throw new HttpError(404, "Task not found");
    return updated;
  }

  async deleteTask(taskId: string): Promise<void> {
    const existing = await this.getTaskBundle(taskId);
    if (!existing) throw new HttpError(404, "Task not found");
    if (existing.payment_status !== "DRAFT") {
      throw new HttpError(409, "Cannot delete task after PayPal order creation");
    }
    await this.client.from("repair_tasks").delete().eq("id", taskId);
  }

  async getTaskBundle(taskId: string): Promise<TaskBundle | null> {
    const { data } = await this.client
      .from("repair_tasks")
      .select("*")
      .eq("id", taskId)
      .maybeSingle();
    if (!data) return null;
    return this.hydrateTask(data as Record<string, unknown>);
  }

  async getTaskProject(taskId: string): Promise<Project | null> {
    const { data: task } = await this.client
      .from("repair_tasks")
      .select("project_id")
      .eq("id", taskId)
      .maybeSingle();
    if (!task) return null;
    const { data: proj } = await this.client
      .from("projects")
      .select("*")
      .eq("id", task.project_id)
      .maybeSingle();
    return (proj as Project) ?? null;
  }

  async updateTaskWorkStatus(
    taskId: string,
    workStatus: WorkStatus,
    patch?: { contractor_notes?: string; homeowner_feedback?: string }
  ): Promise<void> {
    const { data: current } = await this.client
      .from("repair_tasks")
      .select("work_status, contractor_notes, homeowner_feedback")
      .eq("id", taskId)
      .maybeSingle();
    if (!current) throw new HttpError(404, "Task not found");
    assertWorkTransition(current.work_status as WorkStatus, workStatus);
    await this.client
      .from("repair_tasks")
      .update({
        work_status: workStatus,
        contractor_notes: patch?.contractor_notes ?? current.contractor_notes,
        homeowner_feedback: patch?.homeowner_feedback ?? current.homeowner_feedback,
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);
  }

  async saveEvidence(input: SaveEvidenceInput): Promise<EvidenceRecord> {
    const id = crypto.randomUUID();
    const storagePath = `tasks/${input.task_id}/${input.evidence_type}-${id}.${input.ext}`;
    const { error: uploadErr } = await this.client.storage
      .from(EVIDENCE_BUCKET)
      .upload(storagePath, input.bytes, { contentType: input.mime_type, upsert: false });
    if (uploadErr) throw new HttpError(500, "Failed to upload evidence to storage");
    const { data, error } = await this.client
      .from("evidence")
      .insert({
        id,
        task_id: input.task_id,
        uploaded_by: input.uploaded_by,
        image_storage_path: storagePath,
        evidence_type: input.evidence_type,
        mime_type: input.mime_type,
        byte_size: input.byte_size,
        width: input.width,
        height: input.height,
        notes: input.notes,
      })
      .select("*")
      .single();
    if (error || !data) throw new HttpError(500, "Failed to record evidence metadata");
    return { ...(data as EvidenceRecord), url: `/api/evidence/${id}` };
  }

  async getEvidenceById(id: string): Promise<EvidenceRecord | null> {
    const { data } = await this.client
      .from("evidence")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return data ? { ...(data as EvidenceRecord), url: `/api/evidence/${id}` } : null;
  }

  async readEvidenceBytes(
    storagePath: string
  ): Promise<{ bytes: Buffer; mimeType: string } | null> {
    const { data, error } = await this.client.storage
      .from(EVIDENCE_BUCKET)
      .download(storagePath);
    if (error || !data) return null;
    const bytes = Buffer.from(await data.arrayBuffer());
    const mimeType = storagePath.endsWith(".png")
      ? "image/png"
      : storagePath.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
    return { bytes, mimeType };
  }

  async deleteEvidence(id: string): Promise<void> {
    const ev = await this.getEvidenceById(id);
    if (!ev) return;
    await this.client.storage.from(EVIDENCE_BUCKET).remove([ev.image_storage_path]);
    await this.client.from("evidence").delete().eq("id", id);
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
    const { data, error } = await this.client
      .from("evidence_annotations")
      .insert(input)
      .select("*")
      .single();
    if (error || !data) throw new HttpError(500, "Failed to save annotation");
    return data as EvidenceAnnotation;
  }

  async getAnnotationById(
    annotationId: string,
    taskId: string
  ): Promise<EvidenceAnnotation | null> {
    const { data } = await this.client
      .from("evidence_annotations")
      .select("*")
      .eq("id", annotationId)
      .eq("task_id", taskId)
      .maybeSingle();
    return (data as EvidenceAnnotation) ?? null;
  }

  async deleteAnnotation(annotationId: string, taskId: string): Promise<void> {
    await this.client
      .from("evidence_annotations")
      .delete()
      .eq("id", annotationId)
      .eq("task_id", taskId);
  }

  async saveAIReview(input: {
    task_id: string;
    model: string;
    provider: AIProviderType;
    structured_findings: AIReviewRecord["structured_findings"];
    recommendation: AIReviewRecord["recommendation"];
  }): Promise<AIReviewRecord> {
    const { data: latest } = await this.client
      .from("ai_reviews")
      .select("review_version")
      .eq("task_id", input.task_id)
      .order("review_version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (latest?.review_version ?? 0) + 1;
    const { data, error } = await this.client
      .from("ai_reviews")
      .insert({
        task_id: input.task_id,
        model: input.model,
        provider: input.provider,
        structured_findings: input.structured_findings,
        recommendation: input.recommendation,
        review_version: nextVersion,
      })
      .select("*")
      .single();
    if (error || !data) throw new HttpError(500, "Failed to save AI inspection report");
    return data as AIReviewRecord;
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
    const { data: current } = await this.client
      .from("payment_records")
      .select("*")
      .eq("task_id", taskId)
      .maybeSingle();
    if (!current) throw new HttpError(404, "Payment record not found");
    if (!allowedPriors.includes(current.payment_status as PaymentStatus)) {
      throw new HttpError(
        409,
        `Payment state is currently ${current.payment_status}; refresh before retrying.`
      );
    }
    assertPaymentTransition(current.payment_status as PaymentStatus, nextStatus);
    const ts = new Date().toISOString();
    const { data: updated, error } = await this.client
      .from("payment_records")
      .update({ ...patch, payment_status: nextStatus, updated_at: ts })
      .eq("task_id", taskId)
      .in("payment_status", allowedPriors)
      .select("*")
      .maybeSingle();
    if (error || !updated) {
      throw new HttpError(409, "Payment state changed concurrently; refresh and check status.");
    }
    await this.client
      .from("repair_tasks")
      .update({ payment_status: nextStatus, updated_at: ts })
      .eq("id", taskId);
    return updated as PaymentRecord;
  }

  async findPaymentByPayPalIds(ids: {
    orderId?: string | null;
    authorizationId?: string | null;
    captureId?: string | null;
  }): Promise<PaymentRecord | null> {
    if (ids.captureId) {
      const { data } = await this.client
        .from("payment_records")
        .select("*")
        .eq("paypal_capture_id", ids.captureId)
        .maybeSingle();
      if (data) return data as PaymentRecord;
    }
    if (ids.authorizationId) {
      const { data } = await this.client
        .from("payment_records")
        .select("*")
        .eq("paypal_authorization_id", ids.authorizationId)
        .maybeSingle();
      if (data) return data as PaymentRecord;
    }
    if (ids.orderId) {
      const { data } = await this.client
        .from("payment_records")
        .select("*")
        .eq("paypal_order_id", ids.orderId)
        .maybeSingle();
      if (data) return data as PaymentRecord;
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
    const { data, error } = await this.client
      .from("payment_events")
      .insert({
        payment_record_id: input.payment_record_id,
        task_id: input.task_id,
        actor: input.actor,
        event_type: input.event_type,
        paypal_event_id: input.paypal_event_id ?? null,
        safe_metadata: input.safe_metadata ?? {},
      })
      .select("*")
      .maybeSingle();
    if (error || !data) return null;
    return data as PaymentEvent;
  }

  async recordDecision(input: {
    task_id: string;
    homeowner_id: string;
    decision: DecisionRecord["decision"];
    reason: string;
  }): Promise<DecisionRecord> {
    const { data, error } = await this.client
      .from("decisions")
      .insert(input)
      .select("*")
      .single();
    if (error || !data) throw new HttpError(500, "Failed to record decision");
    return data as DecisionRecord;
  }

  async beginIdempotency(input: {
    operation_key: string;
    payment_record_id: string;
    operation_type: IdempotencyRow["operation_type"];
  }): Promise<{ acquired: boolean; existing?: IdempotencyRow }> {
    const { data: existing } = await this.client
      .from("idempotency_operations")
      .select("*")
      .eq("operation_key", input.operation_key)
      .maybeSingle();
    if (existing) {
      return { acquired: false, existing: existing as IdempotencyRow };
    }
    const { error } = await this.client.from("idempotency_operations").insert({
      operation_key: input.operation_key,
      payment_record_id: input.payment_record_id,
      operation_type: input.operation_type,
      status: "IN_PROGRESS",
    });
    if (error) {
      const { data: race } = await this.client
        .from("idempotency_operations")
        .select("*")
        .eq("operation_key", input.operation_key)
        .maybeSingle();
      return { acquired: false, existing: (race as IdempotencyRow) ?? undefined };
    }
    return { acquired: true };
  }

  async finishIdempotency(
    operationKey: string,
    status: "SUCCEEDED" | "FAILED",
    responseJson?: Record<string, unknown>
  ): Promise<void> {
    if (status === "FAILED") {
      await this.client
        .from("idempotency_operations")
        .delete()
        .eq("operation_key", operationKey)
        .eq("status", "IN_PROGRESS");
      return;
    }
    await this.client
      .from("idempotency_operations")
      .update({ status, response_json: responseJson ?? null })
      .eq("operation_key", operationKey);
  }

  async listAllEventsForUser(user: Profile) {
    const projects = await this.listProjectsForUser(user);
    const all: Array<
      PaymentEvent & {
        project_id: string;
        project_title: string;
        task_title: string;
        amount_minor_units: number;
      }
    > = [];
    for (const p of projects) {
      for (const t of p.tasks) {
        for (const e of t.events) {
          all.push({
            ...e,
            project_id: p.id,
            project_title: p.title,
            task_title: t.title,
            amount_minor_units: t.amount_minor_units,
          });
        }
      }
    }
    return all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100);
  }

  async listLedgerForUser(user: Profile) {
    const projects = await this.listProjectsForUser(user);
    const out: Array<{
      payment: PaymentRecord;
      task: RepairTask;
      project: Project;
      homeowner_name: string;
      contractor_name: string;
      events: PaymentEvent[];
    }> = [];
    for (const p of projects) {
      for (const t of p.tasks) {
        out.push({
          payment: t.payment,
          task: t,
          project: p,
          homeowner_name: p.homeowner_name,
          contractor_name: p.contractor_name,
          events: t.events,
        });
      }
    }
    return out;
  }
}
