"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, RefreshCw, Search } from "lucide-react";
import { PaymentLifecycleTimeline } from "@/components/payments/PaymentLifecycleTimeline";
import { AppShell } from "@/components/shell/AppShell";
import {
  Button,
  Card,
  Drawer,
  PaymentStatusBadge,
  Skeleton,
  WorkStatusBadge,
} from "@/components/ui/primitives";
import type {
  PaymentEvent,
  PaymentRecord,
  Profile,
  Project,
  RepairTask,
  SystemConfigStatus,
} from "@/lib/types";
import { formatDateTime, formatMoney } from "@/lib/utils";

interface LedgerEntry {
  payment: PaymentRecord;
  task: RepairTask;
  project: Project;
  homeowner_name: string;
  contractor_name: string;
  events: PaymentEvent[];
}

export default function SettlementLedgerPage() {
  const router = useRouter();
  const [user, setUser] = useState<Profile | null>(null);
  const [config, setConfig] = useState<SystemConfigStatus | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "CAPTURED" | "VOIDED" | "AUTHORIZED" | "ISSUE">(
    "ALL"
  );
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LedgerEntry | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [toast, setToast] = useState("");

  const load = useCallback(async (): Promise<LedgerEntry[]> => {
    try {
      const [meRes, ledRes] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }),
        fetch("/api/ledger", { cache: "no-store" }),
      ]);
      if (meRes.status === 401 || ledRes.status === 401) {
        router.push("/login");
        return [];
      }
      const meJson = await meRes.json();
      const ledJson = await ledRes.json();
      const nextEntries = (ledJson.entries || []) as LedgerEntry[];
      setUser(meJson.user);
      setConfig(meJson.config);
      setEntries(nextEntries);
      return nextEntries;
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    const authorized = entries
      .filter((e) =>
        Boolean(e.payment.paypal_authorization_id || e.payment.sim_authorization_id) ||
        ["AUTHORIZED", "CAPTURED", "VOIDED"].includes(e.payment.payment_status)
      )
      .reduce((s, e) => s + e.payment.amount_minor_units, 0);
    const captured = entries
      .filter((e) => e.payment.payment_status === "CAPTURED")
      .reduce((s, e) => s + e.payment.amount_minor_units, 0);
    const voided = entries
      .filter((e) => e.payment.payment_status === "VOIDED")
      .reduce((s, e) => s + e.payment.amount_minor_units, 0);
    const paypalCaptured = entries
      .filter((e) => e.payment.payment_status === "CAPTURED" && e.payment.payment_mode === "paypal_sandbox")
      .reduce((s, e) => s + e.payment.amount_minor_units, 0);
    const simCaptured = entries
      .filter((e) => e.payment.payment_status === "CAPTURED" && e.payment.payment_mode === "simulation")
      .reduce((s, e) => s + e.payment.amount_minor_units, 0);
    const outstanding = entries
      .filter((e) =>
        [
          "AUTHORIZED",
          "SETTLEMENT_PENDING",
          "CAPTURE_PENDING",
          "VOID_PENDING",
          "RECONCILIATION_REQUIRED",
        ].includes(e.payment.payment_status)
      )
      .reduce((s, e) => s + e.payment.amount_minor_units, 0);
    return { authorized, captured, voided, paypalCaptured, simCaptured, outstanding };
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filter === "CAPTURED" && e.payment.payment_status !== "CAPTURED") return false;
      if (filter === "VOIDED" && e.payment.payment_status !== "VOIDED") return false;
      if (filter === "AUTHORIZED" && e.payment.payment_status !== "AUTHORIZED") return false;
      if (
        filter === "ISSUE" &&
        !["PAYMENT_FAILED", "RECONCILIATION_REQUIRED", "AUTHORIZATION_EXPIRED"].includes(
          e.payment.payment_status
        )
      ) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = [
          e.project.title,
          e.task.title,
          e.payment.payment_mode,
          e.payment.paypal_order_id,
          e.payment.paypal_authorization_id,
          e.payment.paypal_capture_id,
          e.payment.sim_intent_id,
          e.payment.sim_authorization_id,
          e.payment.sim_capture_id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, filter, search]);

  async function reconcileEntry(entry: LedgerEntry) {
    setReconciling(true);
    setToast("");
    try {
      const res = await fetch(`/api/tasks/${entry.task.id}/reconcile`, { method: "POST" });
      const json = await res.json();
      setToast(json.message || json.error || "Reconciled");
      const updated = await load();
      const refreshed = updated.find((item) => item.task.id === entry.task.id);
      if (refreshed) setSelected(refreshed);
    } finally {
      setReconciling(false);
    }
  }

  if (loading || !user || !config) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] p-8 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <AppShell user={user} config={config}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#17243A]">Settlement Ledger</h1>
            <p className="mt-1 text-sm text-slate-600">
              Persisted transaction records, source separation (PayPal Sandbox vs Simulation),
              and CSV export.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={load}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <a href="/api/ledger?format=csv">
              <Button variant="primary">
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </a>
          </div>
        </div>

        {toast && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900">
            {toast}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs text-slate-500">Total Authorized</p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-[#2563EB]">
              {formatMoney(totals.authorized)}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">PayPal + Simulated holds</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-slate-500">Total Captured</p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-[#047857]">
              {formatMoney(totals.captured)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              {totals.paypalCaptured > 0 ? `PayPal ${formatMoney(totals.paypalCaptured)}` : "PayPal $0.00"} ·{" "}
              {totals.simCaptured > 0 ? `Sim ${formatMoney(totals.simCaptured)}` : "Sim $0.00"}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-slate-500">Total Voided</p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-[#17243A]">
              {formatMoney(totals.voided)}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">Uncaptured holds cancelled</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-slate-500">Outstanding Holds</p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-[#B45309]">
              {formatMoney(totals.outstanding)}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">Open or pending review</p>
          </Card>
        </div>

        <Card className="p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-[#F7F8FA] p-1">
              {(
                [
                  ["ALL", "All"],
                  ["CAPTURED", "Captured"],
                  ["VOIDED", "Voided"],
                  ["AUTHORIZED", "Authorized"],
                  ["ISSUE", "Needs Attention"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  className={`rounded-md px-3 py-1 text-xs font-medium cursor-pointer ${
                    filter === k
                      ? "bg-white text-[#17243A] shadow-xs"
                      : "text-slate-600 hover:text-[#17243A]"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search project, repair, or ID..."
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs focus:border-[#2563EB] focus:outline-none"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 pr-4 font-semibold">Date</th>
                  <th className="py-2.5 pr-4 font-semibold">Project</th>
                  <th className="py-2.5 pr-4 font-semibold">Repair</th>
                  <th className="py-2.5 pr-4 font-semibold">Amount</th>
                  <th className="py-2.5 pr-4 font-semibold">Source</th>
                  <th className="py-2.5 pr-4 font-semibold">Transaction Reference</th>
                  <th className="py-2.5 pr-4 font-semibold">Payment Status</th>
                  <th className="py-2.5 font-semibold">Work Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      No ledger records match your filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((entry) => {
                    const isSim = entry.payment.payment_mode === "simulation";
                    const ref = isSim
                      ? entry.payment.sim_capture_id ||
                        entry.payment.sim_authorization_id ||
                        entry.payment.sim_intent_id ||
                        "Not initialized"
                      : entry.payment.paypal_capture_id ||
                        entry.payment.paypal_authorization_id ||
                        entry.payment.paypal_order_id ||
                        "Not initialized";
                    return (
                      <tr
                        key={entry.task.id}
                        onClick={() => setSelected(entry)}
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="py-3 pr-4 whitespace-nowrap text-slate-500">
                          {formatDateTime(entry.payment.updated_at)}
                        </td>
                        <td className="py-3 pr-4 font-medium text-[#17243A]">
                          {entry.project.title}
                        </td>
                        <td className="py-3 pr-4 text-slate-700">{entry.task.title}</td>
                        <td className="py-3 pr-4 font-mono-code font-semibold text-[#17243A] tabular-nums">
                          {formatMoney(entry.payment.amount_minor_units)}
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                              isSim
                                ? "border-slate-300 bg-[#F7F8FA] text-slate-700"
                                : "border-blue-200 bg-blue-50 text-blue-800"
                            }`}
                          >
                            {isSim ? "Simulation" : "PayPal Sandbox"}
                          </span>
                        </td>
                        <td className="py-3 pr-4 font-mono-code text-slate-600">{ref}</td>
                        <td className="py-3 pr-4">
                          <PaymentStatusBadge status={entry.payment.payment_status} />
                        </td>
                        <td className="py-3">
                          <WorkStatusBadge status={entry.task.work_status} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.task.title} · Transaction Record` : ""}
        subtitle={selected?.project.title}
      >
        {selected && (() => {
          const isSim = selected.payment.payment_mode === "simulation";
          const orderRef = isSim
            ? selected.payment.sim_intent_id
            : selected.payment.paypal_order_id;
          const authRef = isSim
            ? selected.payment.sim_authorization_id
            : selected.payment.paypal_authorization_id;
          const capRef = isSim
            ? selected.payment.sim_capture_id
            : selected.payment.paypal_capture_id;
          const provStatus = isSim
            ? selected.payment.sim_status
            : selected.payment.paypal_status;

          return (
            <div className="space-y-5 text-xs">
              <div className="flex items-center justify-between">
                <PaymentStatusBadge status={selected.payment.payment_status} />
                <span className="font-mono-code text-lg font-bold text-[#17243A]">
                  {formatMoney(selected.payment.amount_minor_units)}
                </span>
              </div>

              <PaymentLifecycleTimeline payment={selected.payment} compact />

              <div className="space-y-2 rounded-xl border border-slate-200 bg-[#F7F8FA] p-4 font-mono-code">
                <p>
                  Source:{" "}
                  {isSim
                    ? "Simulation · No money moved"
                    : "PayPal Sandbox API"}
                </p>
                <p>{isSim ? "Sim Intent ID" : "Order ID"}: {orderRef || "—"}</p>
                <p>{isSim ? "Sim Auth ID" : "Auth ID"}: {authRef || "—"}</p>
                <p>{isSim ? "Sim Capture ID" : "Capture ID"}: {capRef || "—"}</p>
                <p>Payee Merchant: {selected.payment.payee_merchant_id || "—"}</p>
                <p>Provider Status: {provStatus || "—"}</p>
                <p>Auth Expires: {formatDateTime(selected.payment.authorization_expires_at)}</p>
              </div>

              {(orderRef || authRef) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={reconciling}
                  onClick={() => reconcileEntry(selected)}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${reconciling ? "animate-spin" : ""}`} />
                  {isSim ? "Reconcile Simulated Status" : "Reconcile Status from PayPal"}
                </Button>
              )}

              <div>
                <h3 className="font-semibold text-[#17243A] mb-2">Payment Event Timeline</h3>
                <ol className="space-y-2.5 border-l border-slate-200 pl-4">
                  {selected.events.map((ev) => (
                    <li key={ev.id} className="relative">
                      <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-[#2563EB]" />
                      <p className="font-medium text-[#17243A]">
                        {ev.event_type.replaceAll("_", " ")}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {ev.actor} · {formatDateTime(ev.created_at)}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          );
        })()}
      </Drawer>
    </AppShell>
  );
}
