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
      setToast({ text: json.message || "Reconciled with PayPal", ok: true });
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
      <div className="min-h-screen bg-slate-50 p-8 max-w-6xl mx-auto space-y-4">
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
            <h1 className="text-2xl font-bold text-slate-900">
              PayPal Payment Control Center
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Manage individual PayPal Orders v2 authorizations, expiration windows, and
              GET-verified status reconciliation.
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
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {toast.text}
          </div>
        )}

        {allItems.length === 0 ? (
          <Card className="p-8 text-center space-y-3">
            <CreditCard className="h-8 w-8 text-slate-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-900">No repair tasks yet</p>
            <p className="text-xs text-slate-500">
              Create a project to generate individual PayPal authorization holds per repair.
            </p>
          </Card>
        ) : (
          <div className="space-y-5">
            {allItems.map(({ project, task }) => {
              const p = task.payment;
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
                      <h2 className="text-lg font-bold text-slate-900 mt-0.5">
                        {task.title}
                      </h2>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <PaymentStatusBadge status={p.payment_status} />
                        {p.paypal_status && (
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono-code text-[11px] text-slate-700">
                            PayPal: {p.paypal_status}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="font-mono-code text-2xl font-bold text-slate-900 tabular-nums">
                        {formatMoney(p.amount_minor_units, p.currency)}
                      </p>
                      <p className="text-xs text-slate-500">{p.currency} · Sandbox</p>
                    </div>
                  </div>

                  <PaymentLifecycleTimeline payment={p} />

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-slate-500">PayPal Order ID</p>
                      <p className="mt-1 font-mono-code font-medium text-slate-900 break-all">
                        {p.paypal_order_id || "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-slate-500">Authorization ID</p>
                      <p className="mt-1 font-mono-code font-medium text-slate-900 break-all">
                        {p.paypal_authorization_id || "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-slate-500">Capture ID</p>
                      <p className="mt-1 font-mono-code font-medium text-slate-900 break-all">
                        {p.paypal_capture_id || "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-slate-500">Authorization Created</p>
                      <p className="mt-1 font-medium text-slate-900">
                        {formatDateTime(p.authorization_created_at)}
                      </p>
                    </div>
                  </div>

                  {canFund && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
                      <p className="text-xs font-semibold text-slate-800">
                        Approve PayPal Sandbox Authorization ({formatMoney(p.amount_minor_units)})
                      </p>
                      <PayPalButtonSlot
                        clientId={config.paypal.clientId}
                        configured={config.paypal.configured}
                        taskId={task.id}
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
                      disabled={busyId === task.id || (!p.paypal_order_id && !p.paypal_authorization_id)}
                      onClick={() => reconcile(task.id)}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${busyId === task.id ? "animate-spin" : ""}`}
                      />
                      Reconcile PayPal Status (GET)
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
