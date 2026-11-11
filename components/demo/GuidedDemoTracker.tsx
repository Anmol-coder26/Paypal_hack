"use client";

import React from "react";
import { motion } from "framer-motion";
import { Check, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import type { ProjectBundle } from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";

const STEPS = [
  "Project Created",
  "Payments Authorized",
  "Evidence Submitted",
  "AI Reviews Complete",
  "Homeowner Decision",
  "PayPal Settlement Verified",
];

export function GuidedDemoTracker({ project }: { project: ProjectBundle }) {
  const tasks = project.tasks;
  const allAuthorizedOrSettled =
    tasks.length > 0 && tasks.every((t) => Boolean(t.payment.paypal_authorization_id));
  const allEvidence =
    tasks.length > 0 &&
    tasks.every(
      (t) =>
        t.evidence.some((e) => e.evidence_type === "before") &&
        t.evidence.some((e) => e.evidence_type === "after")
    );
  const allReviewed = tasks.length > 0 && tasks.every((t) => Boolean(t.latest_review));
  const allDecided = tasks.length > 0 && tasks.every((t) => t.decisions.length > 0);
  const allSettled =
    tasks.length > 0 &&
    tasks.every((t) =>
      ["CAPTURED", "VOIDED", "AUTHORIZATION_EXPIRED"].includes(t.payment_status)
    );

  const completedFlags = [
    true,
    allAuthorizedOrSettled,
    allEvidence,
    allReviewed,
    allDecided,
    allSettled,
  ];
  const currentStepIdx = completedFlags.findIndex((done) => !done);

  const totalMinor = tasks.reduce((s, t) => s + t.amount_minor_units, 0);
  const capturedMinor = tasks
    .filter((t) => t.payment_status === "CAPTURED")
    .reduce((s, t) => s + t.amount_minor_units, 0);
  const voidedMinor = tasks
    .filter((t) => t.payment_status === "VOIDED")
    .reduce((s, t) => s + t.amount_minor_units, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 border border-blue-200">
              Live Progress Tracker
            </span>
            <h3 className="text-sm font-semibold text-slate-900">
              End-to-End Settlement Pipeline
            </h3>
          </div>
          <span className="text-xs text-slate-500">
            {completedFlags.filter(Boolean).length} of 6 milestones verified
          </span>
        </div>

        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {STEPS.map((label, idx) => {
            const done = completedFlags[idx];
            const active = idx === currentStepIdx;
            return (
              <li
                key={label}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-xs transition-colors",
                  done
                    ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
                    : active
                    ? "border-blue-300 bg-blue-50 text-blue-900"
                    : "border-slate-200 bg-slate-50/60 text-slate-500"
                )}
              >
                <div className="flex items-start gap-1.5 font-semibold leading-tight">
                  <span
                    className={cn(
                      "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[10px]",
                      done
                        ? "bg-emerald-600 text-white"
                        : active
                        ? "bg-blue-600 text-white"
                        : "bg-slate-200 text-slate-600"
                    )}
                  >
                    {done ? <Check className="h-2.5 w-2.5" /> : idx + 1}
                  </span>
                  <span>{label}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {allSettled && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-slate-900 to-[#0f1f3d] p-6 text-white shadow-lg"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  PayPal Settlement Verified
                </p>
                <h3 className="text-lg font-semibold">
                  Project Total: {formatMoney(totalMinor)}
                </h3>
              </div>
            </div>
            <div className="flex gap-6 text-right">
              <div>
                <p className="text-[11px] text-slate-400">Captured</p>
                <p className="text-base font-semibold text-emerald-400 tabular-nums">
                  {formatMoney(capturedMinor)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-400">Voided</p>
                <p className="text-base font-semibold text-slate-200 tabular-nums">
                  {formatMoney(voidedMinor)}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {tasks.map((t) => {
              const captured = t.payment_status === "CAPTURED";
              return (
                <div
                  key={t.id}
                  className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{t.title}</span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        captured
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-slate-500/20 text-slate-300"
                      )}
                    >
                      {captured ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      {formatMoney(t.amount_minor_units)}{" "}
                      {captured ? "captured" : "authorization voided"}
                    </span>
                  </div>
                  <div className="space-y-1 font-mono-code text-[11px] text-slate-300">
                    <p>Order: {t.payment.paypal_order_id || "—"}</p>
                    <p>Auth: {t.payment.paypal_authorization_id || "—"}</p>
                    {t.payment.paypal_capture_id && (
                      <p>Capture: {t.payment.paypal_capture_id}</p>
                    )}
                    <p>PayPal Status: {t.payment.paypal_status || t.payment_status}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-slate-300">
            Every figure above is derived from persisted PayPal Sandbox API records in the
            PunchPay database — refreshing this page displays the same verified outcome.
          </p>
        </motion.div>
      )}
    </div>
  );
}
