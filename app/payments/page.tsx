"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CreditCard, RefreshCw } from "lucide-react";
import { PayPalButtonSlot } from "@/components/payments/PayPalButtonSlot";
import { PaymentLifecycleTimeline } from "@/components/payments/PaymentLifecycleTimeline";
import { AppShell } from "@/components/shell/AppShell";
import {
  Button,
  Card,
  PaymentStatusBadge,
  Skeleton,
} from "@/components/ui/primitives";
import type { Profile, ProjectBundle, SystemConfigStatus } from "@/lib/types";
import { formatDateTime, formatMoney } from "@/lib/utils";

export default function PaymentControlPage() {
  const router = useRouter();
  const [user, setUser] = useState<Profile | null>(null);
  const [config, setConfig] = useState<SystemConfigStatus | null>(null);
  const [projects, setProjects] = useState<ProjectBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const json = await res.json();
      setUser(json.user);
      setConfig(json.config);
      setProjects(json.projects || []);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function reconcile(taskId: string) {
    setBusyId(taskId);
    setToast(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/reconcile`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Reconcile failed");
      setToast({ text: json.message || "Reconciled status", ok: true });
      await load();
    } catch (err) {
      setToast({
        text: err instanceof Error ? err.message : "Reconcile failed",
        ok: false,
      });
    } finally {
      setBusyId(null);
    }
  }

  if (loading || !user || !config) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] p-8 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const allItems = projects.flatMap((p) =>
    p.tasks.map((t) => ({ project: p, task: t }))
  );

  return (
    <AppShell user={user} config={config} projects={projects}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#17243A]">
              Payment Control
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Task-scoped authorization holds, settlement provenance, and status reconciliation.
            </p>
          </div>
          <Button variant="outline" onClick={load}>
            <RefreshCw className="h-4 w-4" />
            Refresh All
          </Button>
        </div>

        {toast && (
          <div
            className={`rounded-xl border px-4 py-3 text-xs ${
              toast.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {toast.text}
          </div>
        )}

        {allItems.length === 0 ? (
          <Card className="p-8 text-center space-y-3">
            <CreditCard className="h-8 w-8 text-slate-400 mx-auto" />
            <p className="text-sm font-semibold text-[#17243A]">No repair tasks yet</p>
            <p className="text-xs text-slate-500">
              Create a project to generate individual task authorization holds.
            </p>
          </Card>
        ) : (
          <div className="space-y-5">
            {allItems.map(({ project, task }) => {
              const p = task.payment;
              const isSim = p.payment_mode === "simulation";
              const orderRef = isSim ? p.sim_intent_id : p.paypal_order_id;
              const authRef = isSim ? p.sim_authorization_id : p.paypal_authorization_id;
              const capRef = isSim ? p.sim_capture_id : p.paypal_capture_id;
              const providerStatus = isSim ? p.sim_status : p.paypal_status;
              const canFund =
                user.role === "homeowner" &&
                ["DRAFT", "ORDER_CREATED", "BUYER_APPROVAL_PENDING", "PAYMENT_FAILED"].includes(
                  p.payment_status
                );
              return (
                <Card key={task.id} className="p-6 space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium text-slate-500">
                        {project.title} · {project.location}
                      </p>
                      <h2 className="text-lg font-bold text-[#17243A] mt-0.5">
                        {task.title}
                      </h2>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <PaymentStatusBadge status={p.payment_status} />
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                            isSim
                              ? "border-slate-300 bg-[#F7F8FA] text-slate-700"
                              : "border-blue-200 bg-blue-50 text-blue-800"
                          }`}
                        >
                          {isSim ? "Demo environment · Payments simulated" : "PayPal Sandbox"}
                        </span>
                        {providerStatus && (
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono-code text-[11px] text-slate-700">
                            Status: {providerStatus}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="font-mono-code text-2xl font-bold text-[#17243A] tabular-nums">
                        {formatMoney(p.amount_minor_units, p.currency)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {p.currency} · {isSim ? "Local Simulation (No funds moved)" : "PayPal Sandbox"}
                      </p>
                    </div>
                  </div>

                  <PaymentLifecycleTimeline payment={p} />

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                    <div className="rounded-lg border border-slate-200 bg-[#F7F8FA] p-3">
                      <p className="text-slate-500">{isSim ? "Demo Order ID" : "PayPal Order ID"}</p>
                      <p className="mt-1 font-mono-code font-medium text-[#17243A] break-all">
                        {orderRef || "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-[#F7F8FA] p-3">
                      <p className="text-slate-500">{isSim ? "Demo Auth ID" : "Authorization ID"}</p>
                      <p className="mt-1 font-mono-code font-medium text-[#17243A] break-all">
                        {authRef || "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-[#F7F8FA] p-3">
                      <p className="text-slate-500">
                        {p.payment_status === "VOIDED" && isSim
                          ? "Demo Void ID"
                          : isSim
                          ? "Demo Capture ID"
                          : "Capture ID"}
                      </p>
                      <p className="mt-1 font-mono-code font-medium text-[#17243A] break-all">
                        {(p.payment_status === "VOIDED" && isSim ? p.sim_void_id : capRef) || "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-[#F7F8FA] p-3">
                      <p className="text-slate-500">Authorization Created</p>
                      <p className="mt-1 font-medium text-[#17243A]">
                        {formatDateTime(p.authorization_created_at)}
                      </p>
                    </div>
                  </div>

                  {canFund && (
                    <div className="rounded-xl border border-slate-200 bg-[#F7F8FA] p-4 space-y-2">
                      <p className="text-xs font-semibold text-[#17243A]">
                        {isSim
                          ? `Simulated Hold Authorization (${formatMoney(p.amount_minor_units)})`
                          : `Approve PayPal Sandbox Authorization (${formatMoney(p.amount_minor_units)})`}
                      </p>
                      <PayPalButtonSlot
                        paymentMode={p.payment_mode || config.payment.mode}
                        existingOrderId={orderRef}
                        clientId={config.paypal.clientId}
                        configured={config.paypal.configured}
                        taskId={task.id}
                        taskTitle={task.title}
                        contractorName={project.contractor_name}
                        amountFormatted={formatMoney(p.amount_minor_units)}
                        onStatusMessage={(text, ok) => setToast({ text, ok })}
                        onSuccess={load}
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === task.id || (!orderRef && !authRef)}
                      onClick={() => reconcile(task.id)}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${busyId === task.id ? "animate-spin" : ""}`}
                      />
                      Reconcile Status
                    </Button>
                    <Link href={`/tasks/${task.id}`}>
                      <Button size="sm" variant="primary">
                        Open Inspection &amp; Settlement
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
