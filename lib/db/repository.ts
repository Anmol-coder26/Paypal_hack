import type {
  AIAnalysisSource,
  AIProviderType,
  AIReviewRecord,
  AIStructuredFindings,
  AIRecommendation,
  DecisionAction,
  DecisionRecord,
  EvidenceRecord,
  EvidenceType,
  PaymentEvent,
  PaymentMode,
  PaymentRecord,
  PaymentStatus,
  Profile,
  Project,
  ProjectBundle,
  RepairTask,
  ServerCredentialRecord,
  TaskBundle,
  UserRole,
  WorkStatus,
} from "../types";

export interface ProfileWithSecret extends Profile {
  password_hash: string;
}

export interface CreateProjectInput {
  homeowner_id: string;
  contractor_id: string;
  title: string;
  description: string;
  location: string;
  due_date: string | null;
  is_guided_demo?: boolean;
  payment_mode?: PaymentMode;
  tasks: Array<{
    title: string;
    description: string;
    acceptance_criteria: string[];
    amount_minor_units: number;
    contractor_notes?: string;
  }>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  acceptance_criteria?: string[];
  amount_minor_units?: number;
  contractor_notes?: string;
}

export interface SaveEvidenceInput {
  task_id: string;
  uploaded_by: string;
  evidence_type: EvidenceType;
  mime_type: string;
  byte_size: number;
  width: number;
  height: number;
  notes: string;
  bytes: Buffer;
  ext: string;
}

export interface IdempotencyRow {
  id: string;
  operation_key: string;
  payment_record_id: string;
  operation_type: "create_order" | "authorize" | "capture" | "void";
  status: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  response_json: Record<string, unknown> | null;
  created_at: string;
}

export interface PunchPayRepository {
  readonly driver: "sqlite" | "supabase";

  // Auth & Profiles
  ensureSeedProfiles(): Promise<void>;
  getProfileById(id: string): Promise<Profile | null>;
  getProfileByEmail(email: string): Promise<ProfileWithSecret | null>;
  listProfilesByRole(role: UserRole): Promise<Profile[]>;
  createProfile(input: {
    name: string;
    email: string;
    role: UserRole;
    password_hash: string;
  }): Promise<Profile>;

  createSession(input: {
    user_id: string;
    token_hash: string;
    expires_at: string;
  }): Promise<void>;
  getSessionUser(tokenHash: string): Promise<Profile | null>;
  deleteSession(tokenHash: string): Promise<void>;

  // Projects & Tasks
  listProjectsForUser(user: Profile): Promise<ProjectBundle[]>;
  getProjectBundle(projectId: string): Promise<ProjectBundle | null>;
  createProject(input: CreateProjectInput): Promise<ProjectBundle>;
  updateProjectStatus(projectId: string, status: Project["status"]): Promise<void>;
  addTask(
    projectId: string,
    input: CreateProjectInput["tasks"][number],
    paymentMode?: PaymentMode
  ): Promise<TaskBundle>;
  updateTask(taskId: string, input: UpdateTaskInput): Promise<TaskBundle>;
  deleteTask(taskId: string): Promise<void>;
  getTaskBundle(taskId: string): Promise<TaskBundle | null>;
  getTaskProject(taskId: string): Promise<Project | null>;
  updateTaskWorkStatus(
    taskId: string,
    workStatus: WorkStatus,
    patch?: { contractor_notes?: string; homeowner_feedback?: string }
  ): Promise<void>;

  // Evidence & Storage
  saveEvidence(input: SaveEvidenceInput): Promise<EvidenceRecord>;
  getEvidenceById(id: string): Promise<EvidenceRecord | null>;
  readEvidenceBytes(storagePath: string): Promise<{ bytes: Buffer; mimeType: string } | null>;
  deleteEvidence(id: string): Promise<void>;
  addAnnotation(input: {
    task_id: string;
    evidence_id: string;
    author_id: string;
    author_name: string;
    author_role: UserRole;
    x_pct: number;
    y_pct: number;
    label: string;
    severity: "info" | "concern" | "verified";
  }): Promise<import("../types").EvidenceAnnotation>;
  getAnnotationById(
    annotationId: string,
    taskId: string
  ): Promise<import("../types").EvidenceAnnotation | null>;
  deleteAnnotation(annotationId: string, taskId: string): Promise<void>;

  // AI Reviews
  saveAIReview(input: {
    task_id: string;
    model: string;
    provider: AIProviderType;
    analysis_source: AIAnalysisSource;
    is_genuine_ai: boolean;
    analyzed_evidence_ids: string[];
    image_hashes: string[];
    input_fingerprint: string | null;
    structured_findings: AIStructuredFindings;
    recommendation: AIRecommendation;
  }): Promise<AIReviewRecord>;

  // Encrypted Server Credentials (Admin-managed, never plaintext)
  getServerCredential(provider: "gemini"): Promise<ServerCredentialRecord | null>;
  saveServerCredential(input: {
    provider: "gemini";
    encrypted_payload: string;
    model: string | null;
    updated_by: string;
  }): Promise<ServerCredentialRecord>;
  deleteServerCredential(provider: "gemini"): Promise<void>;

  // Payments, Decisions, Events & Idempotency
  claimPaymentState(
    taskId: string,
    allowedPriors: PaymentStatus[],
    nextStatus: PaymentStatus,
    patch?: Partial<
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
    >
  ): Promise<PaymentRecord>;

  findPaymentByPayPalIds(ids: {
    orderId?: string | null;
    authorizationId?: string | null;
    captureId?: string | null;
  }): Promise<PaymentRecord | null>;

  recordPaymentEvent(input: {
    payment_record_id: string;
    task_id: string;
    actor: PaymentEvent["actor"];
    event_type: string;
    paypal_event_id?: string | null;
    safe_metadata?: Record<string, unknown>;
  }): Promise<PaymentEvent | null>;

  recordDecision(input: {
    task_id: string;
    homeowner_id: string;
    decision: DecisionAction;
    reason: string;
  }): Promise<DecisionRecord>;

  beginIdempotency(input: {
    operation_key: string;
    payment_record_id: string;
    operation_type: IdempotencyRow["operation_type"];
  }): Promise<{ acquired: boolean; existing?: IdempotencyRow }>;

  finishIdempotency(
    operationKey: string,
    status: "SUCCEEDED" | "FAILED",
    responseJson?: Record<string, unknown>
  ): Promise<void>;

  listAllEventsForUser(user: Profile): Promise<
    Array<
      PaymentEvent & {
        project_id: string;
        project_title: string;
        task_title: string;
        amount_minor_units: number;
      }
    >
  >;

  listLedgerForUser(user: Profile): Promise<
    Array<{
      payment: PaymentRecord;
      task: RepairTask;
      project: Project;
      homeowner_name: string;
      contractor_name: string;
      events: PaymentEvent[];
    }>
  >;
}
