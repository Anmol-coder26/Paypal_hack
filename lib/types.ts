export type UserRole = "homeowner" | "contractor";

export type ProjectStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

export type WorkStatus =
  | "PENDING_EVIDENCE"
  | "BEFORE_SUBMITTED"
  | "EVIDENCE_SUBMITTED"
  | "AI_REVIEWED"
  | "CORRECTIONS_REQUESTED"
  | "ACCEPTED"
  | "REJECTED";

export type PaymentStatus =
  | "DRAFT"
  | "ORDER_CREATED"
  | "BUYER_APPROVAL_PENDING"
  | "AUTHORIZED"
  | "SETTLEMENT_PENDING"
  | "CAPTURE_PENDING"
  | "CAPTURED"
  | "VOID_PENDING"
  | "VOIDED"
  | "AUTHORIZATION_EXPIRED"
  | "PAYMENT_FAILED"
  | "RECONCILIATION_REQUIRED";

export type EvidenceType = "before" | "after" | "reference";

export type DecisionAction =
  | "accept"
  | "reject"
  | "request_corrections"
  | "request_evidence";

export type AIRecommendation =
  | "accept"
  | "request_more_evidence"
  | "review_concerns";

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export interface Project {
  id: string;
  homeowner_id: string;
  contractor_id: string;
  title: string;
  description: string;
  location: string;
  status: ProjectStatus;
  currency: "USD";
  due_date: string | null;
  is_guided_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface RepairTask {
  id: string;
  project_id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  amount_minor_units: number;
  currency: "USD";
  work_status: WorkStatus;
  payment_status: PaymentStatus;
  contractor_notes: string;
  homeowner_feedback: string;
  created_at: string;
  updated_at: string;
}

export interface EvidenceRecord {
  id: string;
  task_id: string;
  uploaded_by: string;
  image_storage_path: string;
  evidence_type: EvidenceType;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  notes: string;
  created_at: string;
  url?: string | null;
}

export interface AICriterionCheck {
  criterion: string;
  status: "satisfied" | "unmet" | "unverifiable";
  observation: string;
}

export interface AIStructuredFindings {
  overall_assessment: "appears_satisfied" | "concerns_identified" | "insufficient_evidence";
  summary: string;
  views_comparable: "yes" | "partly" | "no";
  visible_observations: string[];
  criteria_checks: AICriterionCheck[];
  criteria_satisfied: string[];
  criteria_unmet: string[];
  criteria_unverifiable: string[];
  missing_evidence: string[];
  recommended_next_steps: string[];
  suggested_outcome: AIRecommendation;
  limitations_and_uncertainty: string[];
}

export interface AIReviewRecord {
  id: string;
  task_id: string;
  model: string;
  provider: "gemini" | "anthropic";
  structured_findings: AIStructuredFindings;
  recommendation: AIRecommendation;
  review_version: number;
  created_at: string;
}

export interface PaymentRecord {
  id: string;
  task_id: string;
  paypal_order_id: string | null;
  paypal_authorization_id: string | null;
  paypal_capture_id: string | null;
  paypal_status: string | null;
  payee_merchant_id: string | null;
  amount_minor_units: number;
  currency: "USD";
  payment_status: PaymentStatus;
  order_attempt: number;
  request_nonce: string;
  authorization_created_at: string | null;
  authorization_expires_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentEvent {
  id: string;
  payment_record_id: string;
  task_id: string;
  actor: "homeowner" | "contractor" | "ai" | "paypal" | "webhook" | "system";
  event_type: string;
  paypal_event_id: string | null;
  safe_metadata: Record<string, unknown>;
  created_at: string;
}

export interface DecisionRecord {
  id: string;
  task_id: string;
  homeowner_id: string;
  decision: DecisionAction;
  reason: string;
  created_at: string;
}

export interface TaskBundle extends RepairTask {
  payment: PaymentRecord;
  evidence: EvidenceRecord[];
  latest_review: AIReviewRecord | null;
  reviews: AIReviewRecord[];
  decisions: DecisionRecord[];
  events: PaymentEvent[];
}

export interface ProjectBundle extends Project {
  homeowner_name: string;
  contractor_name: string;
  contractor_email: string;
  tasks: TaskBundle[];
}

export interface SystemConfigStatus {
  paypal: {
    configured: boolean;
    environment: "sandbox";
    clientId: string | null;
    merchantConfigured: boolean;
    webhookConfigured: boolean;
  };
  ai: {
    configured: boolean;
    provider: "gemini" | "anthropic" | null;
    model: string | null;
  };
  database: {
    driver: "supabase" | "sqlite";
    configured: boolean;
  };
}
