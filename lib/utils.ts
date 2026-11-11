import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { PaymentStatus, WorkStatus } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(minorUnits: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minorUnits / 100);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const PAYMENT_STATUS_META: Record<
  PaymentStatus,
  { label: string; tone: "neutral" | "blue" | "amber" | "green" | "red" }
> = {
  DRAFT: { label: "Draft · Unfunded", tone: "neutral" },
  ORDER_CREATED: { label: "Order Created", tone: "blue" },
  BUYER_APPROVAL_PENDING: { label: "Awaiting Buyer Approval", tone: "amber" },
  AUTHORIZED: { label: "Funds Authorized (Hold)", tone: "blue" },
  SETTLEMENT_PENDING: { label: "Settlement Pending", tone: "amber" },
  CAPTURE_PENDING: { label: "Capture Pending", tone: "amber" },
  CAPTURED: { label: "Captured · Paid", tone: "green" },
  VOID_PENDING: { label: "Void Pending", tone: "amber" },
  VOIDED: { label: "Voided · Released", tone: "neutral" },
  AUTHORIZATION_EXPIRED: { label: "Authorization Expired", tone: "red" },
  PAYMENT_FAILED: { label: "Payment Failed", tone: "red" },
  RECONCILIATION_REQUIRED: { label: "Needs Reconciliation", tone: "red" },
};

export const WORK_STATUS_META: Record<
  WorkStatus,
  { label: string; tone: "neutral" | "blue" | "amber" | "green" | "red" }
> = {
  PENDING_EVIDENCE: { label: "Pending Evidence", tone: "neutral" },
  BEFORE_SUBMITTED: { label: "Before Photo In", tone: "blue" },
  EVIDENCE_SUBMITTED: { label: "Evidence Submitted", tone: "blue" },
  AI_REVIEWED: { label: "AI Inspected", tone: "amber" },
  CORRECTIONS_REQUESTED: { label: "Corrections Requested", tone: "red" },
  ACCEPTED: { label: "Work Accepted", tone: "green" },
  REJECTED: { label: "Work Rejected", tone: "red" },
};
