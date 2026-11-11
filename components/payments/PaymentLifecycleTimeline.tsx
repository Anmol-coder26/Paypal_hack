"use client";

import React from "react";
import { Check, Clock, ShieldAlert } from "lucide-react";
import type { PaymentRecord } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

export function PaymentLifecycleTimeline({
  payment,
  compact = false,
}: {
  payment: PaymentRecord;
  compact?: boolean;
}) {
  const status = payment.payment_status;
  const isVoidPath = status === "VOID_PENDING" || status === "VOIDED";

  const step1Done = Boolean(payment.paypal_order_id);
  const step2Done =
    Boolean(payment.paypal_authorization_id) ||
    ["AUTHORIZED", "CAPTURE_PENDING", "CAPTURED", "VOID_PENDING", "VOIDED"].includes(status);
  const step3Done = Boolean(payment.paypal_authorization_id);
  const step4Done = status === "CAPTURED" || status === "VOIDED";
  const step4Pending = status === "CAPTURE_PENDING" || status === "VOID_PENDING";

  const steps = [
    {
      label: "Order Created",
      sub: payment.paypal_order_id ? `Order ${payment.paypal_order_id}` : "Not started",
      done: step1Done,
      active: status === "ORDER_CREATED",
    },
    {
      label: "Buyer Approved",
      sub: step2Done
        ? "Approved in PayPal Sandbox"
        : status === "BUYER_APPROVAL_PENDING"
        ? "Waiting for buyer popup"
        : "Pending",
      done: step2Done,
      active: status === "BUYER_APPROVAL_PENDING",
    },
    {
      label: "Authorized Hold",
      sub: payment.paypal_authorization_id
        ? `Auth ${payment.paypal_authorization_id}`
        : "No hold yet",
      done: step3Done,
      active: status === "AUTHORIZED",
    },
    {
      label: isVoidPath ? "Voided" : "Captured",
      sub:
        status === "CAPTURED"
          ? `Capture ${payment.paypal_capture_id || "COMPLETED"}`
          : status === "VOIDED"
          ? "Hold released (VOIDED)"
          : step4Pending
          ? "Waiting for PayPal confirmation"
          : "Awaiting homeowner decision",
      done: step4Done,
      active: step4Pending,
      tone: status === "VOIDED" ? "neutral" : status === "CAPTURED" ? "green" : "default",
    },
  ];

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((s, idx) => (
          <div
            key={s.label}
            className={cn(
              compact ? "rounded-lg border px-2.5 py-2 transition-colors" : "rounded-xl border p-3 transition-colors",
              s.done
                ? s.tone === "neutral"
                  ? "border-slate-300 bg-slate-100"
                  : "border-emerald-200 bg-emerald-50/70"
                : s.active
                ? "border-blue-300 bg-blue-50/70"
                : "border-slate-200 bg-slate-50/50"
            )}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                  s.done
                    ? s.tone === "neutral"
                      ? "bg-slate-700 text-white"
                      : "bg-emerald-600 text-white"
                    : s.active
                    ? "bg-blue-600 text-white"
                    : "bg-slate-200 text-slate-600"
                )}
              >
                {s.done ? <Check className="h-2.5 w-2.5" /> : idx + 1}
              </span>
              <span className="text-[11px] font-semibold text-slate-900 leading-tight">{s.label}</span>
            </div>
            {!compact && (
              <p className="mt-1.5 truncate font-mono-code text-[11px] text-slate-600" title={s.sub}>
                {s.sub}
              </p>
            )}
          </div>
        ))}
      </div>

      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            PayPal authorizations are temporary holds (up to 29 days, 3-day honor period) — not
            escrow or guaranteed future funds.
          </span>
          {payment.authorization_expires_at && (
            <span className="font-mono-code text-slate-700">
              Expires: {formatDateTime(payment.authorization_expires_at)}
            </span>
          )}
        </div>
      )}

      {payment.last_error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{payment.last_error}</span>
        </div>
      )}
    </div>
  );
}
