import type { PaymentStatus, WorkStatus } from "../types";
import { HttpError } from "../errors";

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  DRAFT: ["DRAFT", "ORDER_CREATED", "BUYER_APPROVAL_PENDING", "PAYMENT_FAILED"],
  ORDER_CREATED: [
    "ORDER_CREATED",
    "BUYER_APPROVAL_PENDING",
    "DRAFT",
    "AUTHORIZED",
    "PAYMENT_FAILED",
    "RECONCILIATION_REQUIRED",
  ],
  BUYER_APPROVAL_PENDING: [
    "BUYER_APPROVAL_PENDING",
    "DRAFT",
    "AUTHORIZED",
    "PAYMENT_FAILED",
    "RECONCILIATION_REQUIRED",
  ],
  AUTHORIZED: [
    "AUTHORIZED",
    "SETTLEMENT_PENDING",
    "CAPTURE_PENDING",
    "VOID_PENDING",
    "CAPTURED",
    "VOIDED",
    "AUTHORIZATION_EXPIRED",
    "RECONCILIATION_REQUIRED",
  ],
  SETTLEMENT_PENDING: [
    "SETTLEMENT_PENDING",
    "CAPTURE_PENDING",
    "VOID_PENDING",
    "AUTHORIZED",
    "CAPTURED",
    "VOIDED",
    "AUTHORIZATION_EXPIRED",
    "PAYMENT_FAILED",
    "RECONCILIATION_REQUIRED",
  ],
  CAPTURE_PENDING: [
    "CAPTURE_PENDING",
    "CAPTURED",
    "AUTHORIZED",
    "PAYMENT_FAILED",
    "AUTHORIZATION_EXPIRED",
    "RECONCILIATION_REQUIRED",
  ],
  VOID_PENDING: [
    "VOID_PENDING",
    "VOIDED",
    "AUTHORIZED",
    "PAYMENT_FAILED",
    "AUTHORIZATION_EXPIRED",
    "RECONCILIATION_REQUIRED",
  ],
  RECONCILIATION_REQUIRED: [
    "RECONCILIATION_REQUIRED",
    "AUTHORIZED",
    "CAPTURE_PENDING",
    "VOID_PENDING",
    "CAPTURED",
    "VOIDED",
    "AUTHORIZATION_EXPIRED",
    "PAYMENT_FAILED",
  ],
  PAYMENT_FAILED: [
    "PAYMENT_FAILED",
    "DRAFT",
    "ORDER_CREATED",
    "BUYER_APPROVAL_PENDING",
    "AUTHORIZED",
    "CAPTURED",
    "VOIDED",
    "AUTHORIZATION_EXPIRED",
    "RECONCILIATION_REQUIRED",
  ],
  CAPTURED: ["CAPTURED"],
  VOIDED: ["VOIDED"],
  AUTHORIZATION_EXPIRED: ["AUTHORIZATION_EXPIRED"],
};

export const WORK_TRANSITIONS: Record<WorkStatus, WorkStatus[]> = {
  PENDING_EVIDENCE: ["PENDING_EVIDENCE", "BEFORE_SUBMITTED", "EVIDENCE_SUBMITTED"],
  BEFORE_SUBMITTED: ["BEFORE_SUBMITTED", "EVIDENCE_SUBMITTED"],
  EVIDENCE_SUBMITTED: [
    "EVIDENCE_SUBMITTED",
    "AI_REVIEWED",
    "CORRECTIONS_REQUESTED",
    "ACCEPTED",
    "REJECTED",
  ],
  AI_REVIEWED: [
    "AI_REVIEWED",
    "EVIDENCE_SUBMITTED",
    "CORRECTIONS_REQUESTED",
    "ACCEPTED",
    "REJECTED",
  ],
  CORRECTIONS_REQUESTED: [
    "CORRECTIONS_REQUESTED",
    "BEFORE_SUBMITTED",
    "EVIDENCE_SUBMITTED",
    "AI_REVIEWED",
    "ACCEPTED",
    "REJECTED",
  ],
  ACCEPTED: ["ACCEPTED"],
  REJECTED: ["REJECTED"],
};

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  const allowed = PAYMENT_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new HttpError(
      409,
      `Illegal payment state transition from ${from} to ${to}. Refresh and reconcile before retrying.`
    );
  }
}

export function assertWorkTransition(from: WorkStatus, to: WorkStatus): void {
  const allowed = WORK_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new HttpError(409, `Illegal work status transition from ${from} to ${to}.`);
  }
}

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return status === "CAPTURED" || status === "VOIDED" || status === "AUTHORIZATION_EXPIRED";
}

export function isHoldActive(status: PaymentStatus): boolean {
  return (
    status === "AUTHORIZED" ||
    status === "SETTLEMENT_PENDING" ||
    status === "CAPTURE_PENDING" ||
    status === "VOID_PENDING" ||
    status === "RECONCILIATION_REQUIRED"
  );
}

export function formatMinorUnits(minorUnits: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minorUnits / 100);
}

export function mapCaptureStatusToPaymentStatus(status: string | undefined): PaymentStatus {
  if (status === "COMPLETED" || status === "PARTIALLY_REFUNDED" || status === "REFUNDED") {
    return "CAPTURED";
  }
  if (status === "PENDING") {
    return "CAPTURE_PENDING";
  }
  if (status === "DECLINED" || status === "FAILED") {
    return "PAYMENT_FAILED";
  }
  return "RECONCILIATION_REQUIRED";
}
