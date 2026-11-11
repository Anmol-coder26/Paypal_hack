"use client";

import React from "react";
import { motion } from "framer-motion";
import type { TaskBundle } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

export function AllocationBar({ tasks }: { tasks: TaskBundle[] }) {
  const total = tasks.reduce((s, t) => s + t.amount_minor_units, 0);
  if (total === 0) return null;

  const captured = tasks
    .filter((t) => t.payment_status === "CAPTURED")
    .reduce((s, t) => s + t.amount_minor_units, 0);
  const authorized = tasks
    .filter((t) =>
      [
        "AUTHORIZED",
        "SETTLEMENT_PENDING",
        "CAPTURE_PENDING",
        "VOID_PENDING",
        "RECONCILIATION_REQUIRED",
      ].includes(t.payment_status)
    )
    .reduce((s, t) => s + t.amount_minor_units, 0);
  const voided = tasks
    .filter((t) => t.payment_status === "VOIDED")
    .reduce((s, t) => s + t.amount_minor_units, 0);
  const draft = Math.max(0, total - captured - authorized - voided);

  const segments = [
    { label: "Captured", amount: captured, color: "bg-emerald-500", dot: "bg-emerald-500" },
    { label: "Authorized Hold", amount: authorized, color: "bg-blue-600", dot: "bg-blue-600" },
    { label: "Voided", amount: voided, color: "bg-slate-400", dot: "bg-slate-400" },
    { label: "Draft / Unfunded", amount: draft, color: "bg-slate-200", dot: "bg-slate-300" },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-900">
          Capital Allocation Breakdown ({formatMoney(total)})
        </span>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
          {segments.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${s.dot}`} />
              {s.label}: <strong className="tabular-nums">{formatMoney(s.amount)}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        {segments.map((s) => {
          const pct = (s.amount / total) * 100;
          if (pct <= 0) return null;
          return (
            <motion.div
              key={s.label}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.45 }}
              className={`${s.color} h-full`}
              title={`${s.label}: ${formatMoney(s.amount)}`}
            />
          );
        })}
      </div>
    </div>
  );
}
