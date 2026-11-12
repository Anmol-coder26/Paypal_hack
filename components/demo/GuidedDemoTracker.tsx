"use client";

import React from "react";
import Link from "next/link";
import { Check, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import type { ProjectBundle } from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";

const STEPS = [
  "Project Created",
  "Payments Authorized",
  "Evidence Submitted",
  "AI / Inspection Review",
  "Homeowner Decision",
  "Settlement Complete",
];

export function GuidedDemoTracker({ project }: { project: ProjectBundle }) {
  const tasks = project.tasks;
  const allAuthorizedOrSettled =
    tasks.length > 0 &&
    tasks.every((t) =>
      Boolean(t.payment.paypal_authorization_id || t.payment.sim_authorization_id)
    );
  const allEvidence =
    tasks.length > 0 &&
    tasks.every(
      (t) =>
        t.evidence.some((e) => e.evidence_type === "before") &&
        t.evidence.some((e) => e.evidence_type === "after")
    );
  const allReviewed =
    tasks.length > 0 &&
    tasks.every(
      (t) => Boolean(t.latest_review) || ["ACCEPTED", "REJECTED"].includes(t.work_status)
    );
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
  const hasSimulation = tasks.some((t) => t.payment.payment_mode === "simulation");
  const hasPayPal = tasks.some(
    (t) => t.payment.payment_mode === "paypal_sandbox" && Boolean(t.payment.paypal_order_id)
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 border border-blue-200">
              Workflow Progress
            </span>
            <h3 className="text-sm font-semibold text-[#17243A]">
              Independent Task Settlement Pipeline
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
                    ? "border-emerald-200 bg-emerald-50/70 text-emerald-950"
                    : active
                    ? "border-blue-300 bg-blue-50 text-blue-950"
                    : "border-slate-200 bg-[#F7F8FA] text-slate-500"
                )}
              >
                <div className="flex items-start gap-1.5 font-semibold leading-tight">
                  <span
                    className={cn(
                      "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[10px]",
                      done
                        ? "bg-emerald-700 text-white"
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
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="bg-[#17243A] px-6 py-4 text-white flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-emerald-300">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                  {hasSimulation && !hasPayPal
                    ? "Simulated Settlement Summary · No Money Moved"
                    : hasPayPal && !hasSimulation
                    ? "PayPal Sandbox Settlement Verified"
                    : "Mixed Settlement Summary"}
                </p>
                <h3 className="text-base font-semibold text-white">
                  {project.title} · Final Settlement Statement
                </h3>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-right">
              <div>
                <p className="text-[11px] text-slate-300">Agreed Value</p>
                <p className="text-base font-bold text-white tabular-nums">
                  {formatMoney(totalMinor)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-300">Captured</p>
                <p className="text-base font-bold text-emerald-300 tabular-nums">
                  {formatMoney(capturedMinor)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-300">Voided</p>
                <p className="text-base font-bold text-slate-200 tabular-nums">
                  {formatMoney(voidedMinor)}
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {tasks.map((t) => {
              const captured = t.payment_status === "CAPTURED";
              const expired = t.payment_status === "AUTHORIZATION_EXPIRED";
              const isSim = t.payment.payment_mode === "simulation";
              const orderRef = isSim ? t.payment.sim_intent_id : t.payment.paypal_order_id;
              const authRef = isSim
                ? t.payment.sim_authorization_id
                : t.payment.paypal_authorization_id;
              const capRef = isSim ? t.payment.sim_capture_id : t.payment.paypal_capture_id;

              return (
                <div
                  key={t.id}
                  className="rounded-xl border border-slate-200 bg-[#F7F8FA] p-4 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[#17243A]">{t.title}</span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                        captured
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : expired
                          ? "border-red-200 bg-red-50 text-red-800"
                          : "border-slate-300 bg-slate-100 text-slate-800"
                      )}
                    >
                      {captured ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      {formatMoney(t.amount_minor_units)} —{" "}
                      {captured
                        ? "Captured"
                        : expired
                        ? "Authorization Expired"
                        : "Authorization Voided"}
                    </span>
                  </div>
                  <div className="space-y-0.5 font-mono-code text-[11px] text-slate-600">
                    <p>
                      Source:{" "}
                      {isSim ? "Simulation · No money moved" : "PayPal Sandbox API"}
                    </p>
                    <p>{isSim ? "Sim Intent" : "PayPal Order"}: {orderRef || "—"}</p>
                    <p>{isSim ? "Sim Auth" : "PayPal Auth"}: {authRef || "—"}</p>
                    {capRef && (
                      <p className="text-emerald-800 font-semibold">
                        {isSim ? "Sim Capture" : "PayPal Capture"}: {capRef}
                      </p>
                    )}
                    <p>Payee: {t.payment.payee_merchant_id || "—"}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-600">
              {hasSimulation && !hasPayPal
                ? "Simulated transaction IDs (SIM-*) are recorded in SQLite locally and explicitly separated from PayPal records."
                : "Derived directly from persisted database records."}
            </p>
            <Link
              href="/ledger"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#17243A] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
            >
              Open Settlement Ledger
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
