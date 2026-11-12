"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FolderPlus,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { AllocationBar } from "@/components/payments/AllocationBar";
import { AppShell } from "@/components/shell/AppShell";
import {
  Button,
  Card,
  Modal,
  PaymentStatusBadge,
  Skeleton,
} from "@/components/ui/primitives";
import type { PaymentEvent, Profile, ProjectBundle, SystemConfigStatus } from "@/lib/types";
import { formatDateTime, formatMoney } from "@/lib/utils";

type DashboardEvent = PaymentEvent & {
  project_id: string;
  project_title: string;
  task_title: string;
  amount_minor_units: number;
};

export default function HomeownerDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<Profile | null>(null);
  const [config, setConfig] = useState<SystemConfigStatus | null>(null);
  const [projects, setProjects] = useState<ProjectBundle[]>([]);
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resettingDemo, setResettingDemo] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "COMPLETED">("ALL");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load workspace");
      if (json.user?.role === "contractor") {
        router.push("/contractor");
        return;
      }
      setUser(json.user);
      setConfig(json.config);
      setProjects(json.projects || []);
      setEvents(json.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function launchGuidedDemo() {
    setCreatingDemo(true);
    setError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guided_demo: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not create guided demo");
      router.push(`/projects/${json.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create demo project");
    } finally {
      setCreatingDemo(false);
    }
  }

  async function resetGuidedDemo() {
    setResettingDemo(true);
    setError("");
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not reset guided demo");
      setResetConfirmOpen(false);
      await loadData();
      if (json.project?.id) {
        router.push(`/projects/${json.project.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset guided demo");
    } finally {
      setResettingDemo(false);
    }
  }

  const metrics = useMemo(() => {
    const allTasks = projects.flatMap((p) => p.tasks);
    const totalRepairMinor = allTasks.reduce((sum, t) => sum + t.amount_minor_units, 0);
    const authorizedMinor = allTasks
      .filter((t) =>
        [
          "AUTHORIZED",
          "SETTLEMENT_PENDING",
          "CAPTURE_PENDING",
          "VOID_PENDING",
          "RECONCILIATION_REQUIRED",
        ].includes(t.payment_status)
      )
      .reduce((sum, t) => sum + t.amount_minor_units, 0);
    const capturedMinor = allTasks
      .filter((t) => t.payment_status === "CAPTURED")
      .reduce((sum, t) => sum + t.amount_minor_units, 0);
    const voidedMinor = allTasks
      .filter((t) => t.payment_status === "VOIDED")
      .reduce((sum, t) => sum + t.amount_minor_units, 0);
    const paypalCapturedMinor = allTasks
      .filter((t) => t.payment_status === "CAPTURED" && t.payment.payment_mode === "paypal_sandbox")
      .reduce((sum, t) => sum + t.amount_minor_units, 0);
    const simCapturedMinor = allTasks
      .filter((t) => t.payment_status === "CAPTURED" && t.payment.payment_mode === "simulation")
      .reduce((sum, t) => sum + t.amount_minor_units, 0);
    const awaitingDecisionCount = allTasks.filter(
      (t) =>
        ["EVIDENCE_SUBMITTED", "AI_REVIEWED"].includes(t.work_status) &&
        t.payment_status === "AUTHORIZED"
    ).length;
    const correctionsCount = allTasks.filter(
      (t) => t.work_status === "CORRECTIONS_REQUESTED"
    ).length;

    return {
      totalRepairMinor,
      authorizedMinor,
      capturedMinor,
      voidedMinor,
      paypalCapturedMinor,
      simCapturedMinor,
      awaitingDecisionCount,
      correctionsCount,
      allTasks,
    };
  }, [projects]);

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (statusFilter !== "ALL" && p.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchProject =
          p.title.toLowerCase().includes(q) ||
          p.location.toLowerCase().includes(q) ||
          p.tasks.some((t) => t.title.toLowerCase().includes(q));
        if (!matchProject) return false;
      }
      return true;
    });
  }, [projects, statusFilter, search]);

  const pendingDecisions = useMemo(
    () =>
      projects.flatMap((p) =>
        p.tasks
          .filter(
            (t) =>
              ["EVIDENCE_SUBMITTED", "AI_REVIEWED"].includes(t.work_status) &&
              ["AUTHORIZED", "RECONCILIATION_REQUIRED", "PAYMENT_FAILED"].includes(
                t.payment_status
              )
          )
          .map((t) => ({ project: p, task: t }))
      ),
    [projects]
  );

  if (loading || !user || !config) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] p-8 space-y-6 max-w-7xl mx-auto">
        <Skeleton className="h-12 w-72" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <AppShell
      user={user}
      config={config}
      projects={projects}
      searchValue={search}
      onSearchChange={setSearch}
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#17243A]">
              Overview
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Every fix has its own payment. Review the work and decide what gets paid.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="outline"
              onClick={() => {
                setRefreshing(true);
                loadData();
              }}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {projects.some((p) => p.is_guided_demo) && (
              <Button variant="outline" onClick={() => setResetConfirmOpen(true)}>
                <RotateCcw className="h-4 w-4 text-slate-600" />
                Reset Demo
              </Button>
            )}
            <Button variant="secondary" onClick={launchGuidedDemo} disabled={creatingDemo}>
              <Sparkles className="h-4 w-4 text-blue-300" />
              {creatingDemo ? "Creating Demo..." : "Continue Guided Demo ($50)"}
            </Button>
            <Link href="/projects/new">
              <Button variant="primary">
                <FolderPlus className="h-4 w-4" />
                New Project
              </Button>
            </Link>
          </div>
        </div>

        {/* Compact nonintrusive rehearsal bar */}
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-[#17243A]">
              Rehearsal Flow
            </span>
            <span>1. Open project &amp; authorize holds</span>
            <span className="text-slate-300">→</span>
            <span>2. Switch to Demo Contractor &amp; upload photos</span>
            <span className="text-slate-300">→</span>
            <span>3. Switch back, inspect &amp; Capture $30 / Void $20</span>
            <span className="text-slate-300">→</span>
            <span>4. Verify Ledger &amp; reload</span>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Financial Overview Row (separates PayPal vs Simulation sources cleanly) */}
        <section
          aria-label="Financial overview"
          className="grid grid-cols-2 gap-4 lg:grid-cols-5"
        >
          {[
            {
              label: "Total Agreed",
              value: formatMoney(metrics.totalRepairMinor),
              sub: `${metrics.allTasks.length} repair item(s)`,
              tone: "text-[#17243A]",
            },
            {
              label: "Authorized Holds",
              value: formatMoney(metrics.authorizedMinor),
              sub: "Uncaptured task holds",
              tone: "text-[#2563EB]",
            },
            {
              label: "Captured Value",
              value: formatMoney(metrics.capturedMinor),
              sub:
                metrics.paypalCapturedMinor > 0 && metrics.simCapturedMinor > 0
                  ? `${formatMoney(metrics.paypalCapturedMinor)} PayPal · ${formatMoney(metrics.simCapturedMinor)} Sim`
                  : metrics.paypalCapturedMinor > 0
                  ? "PayPal Sandbox verified"
                  : metrics.simCapturedMinor > 0
                  ? "Simulation (no funds moved)"
                  : "No captures yet",
              tone: "text-[#047857]",
            },
            {
              label: "Voided Holds",
              value: formatMoney(metrics.voidedMinor),
              sub: "Released (never charged)",
              tone: "text-slate-700",
            },
            {
              label: "Pending & Corrections",
              value: `${metrics.awaitingDecisionCount} / ${metrics.correctionsCount}`,
              sub: `${metrics.awaitingDecisionCount} review · ${metrics.correctionsCount} corrections req.`,
              tone:
                metrics.awaitingDecisionCount > 0 || metrics.correctionsCount > 0
                  ? "text-[#B45309]"
                  : "text-[#17243A]",
            },
          ].map((kpi) => (
            <Card key={kpi.label} className="p-4">
              <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
              <p className={`mt-1.5 text-xl font-bold tabular-nums ${kpi.tone}`}>
                {kpi.value}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{kpi.sub}</p>
            </Card>
          ))}
        </section>

        <AllocationBar tasks={metrics.allTasks} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Structured Projects Table */}
          <div className="lg:col-span-8 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[#17243A]">
                Repair Projects ({filteredProjects.length})
              </h2>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                {(["ALL", "ACTIVE", "COMPLETED"] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`rounded-md px-3 py-1 text-xs font-medium cursor-pointer ${
                      statusFilter === status
                        ? "bg-[#17243A] text-white"
                        : "text-slate-600 hover:text-[#17243A]"
                    }`}
                  >
                    {status === "ALL" ? "All" : status.charAt(0) + status.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            {filteredProjects.length === 0 ? (
              <Card className="p-8 text-center space-y-3">
                <p className="text-sm font-semibold text-[#17243A]">
                  No repair projects yet
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Start the Guided Demo (Kitchen Renovation Closeout · $30 Painting + $20 Tile
                  Repair) or create a custom repair project.
                </p>
                <div className="flex justify-center gap-3 pt-2">
                  <Button variant="primary" onClick={() => router.push("/projects/new")}>
                    New Project
                  </Button>
                  <Button variant="outline" onClick={launchGuidedDemo} disabled={creatingDemo}>
                    Continue Guided Demo
                  </Button>
                </div>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-[#F7F8FA] text-slate-500">
                        <th className="py-3 px-4 font-semibold">Project</th>
                        <th className="py-3 px-3 font-semibold">Contractor</th>
                        <th className="py-3 px-3 font-semibold text-right">Agreed</th>
                        <th className="py-3 px-3 font-semibold">Tasks</th>
                        <th className="py-3 px-3 font-semibold">Payment State</th>
                        <th className="py-3 px-4 font-semibold text-right">Next Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredProjects.map((project) => {
                        const total = project.tasks.reduce(
                          (sum, t) => sum + t.amount_minor_units,
                          0
                        );
                        const settledCount = project.tasks.filter((t) =>
                          ["CAPTURED", "VOIDED", "AUTHORIZATION_EXPIRED"].includes(
                            t.payment_status
                          )
                        ).length;
                        const hasIssue = project.tasks.some((t) =>
                          ["RECONCILIATION_REQUIRED", "PAYMENT_FAILED"].includes(
                            t.payment_status
                          )
                        );
                        const hasAuth = project.tasks.some(
                          (t) => t.payment_status === "AUTHORIZED"
                        );
                        const summaryStatus = hasIssue
                          ? "RECONCILIATION_REQUIRED"
                          : settledCount === project.tasks.length && project.tasks.length > 0
                          ? project.tasks.some((t) => t.payment_status === "CAPTURED")
                            ? "CAPTURED"
                            : "VOIDED"
                          : hasAuth
                          ? "AUTHORIZED"
                          : project.tasks[0]?.payment_status || "DRAFT";

                        const nextLabel =
                          settledCount === project.tasks.length && project.tasks.length > 0
                            ? "View Summary"
                            : project.tasks.some(
                                (t) =>
                                  t.payment_status === "AUTHORIZED" &&
                                  ["EVIDENCE_SUBMITTED", "AI_REVIEWED"].includes(t.work_status)
                              )
                            ? "Inspect & Decide"
                            : "Open Workspace";

                        return (
                          <tr
                            key={project.id}
                            className="hover:bg-slate-50/70 transition-colors"
                          >
                            <td className="py-3.5 px-4">
                              <Link
                                href={`/projects/${project.id}`}
                                className="font-semibold text-[#17243A] hover:text-[#2563EB]"
                              >
                                {project.title}
                              </Link>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {project.location}
                                {project.is_guided_demo ? " · Guided Demo" : ""}
                              </p>
                            </td>
                            <td className="py-3.5 px-3 text-slate-700 whitespace-nowrap">
                              {project.contractor_name}
                            </td>
                            <td className="py-3.5 px-3 text-right font-mono-code font-semibold text-[#17243A] tabular-nums">
                              {formatMoney(total)}
                            </td>
                            <td className="py-3.5 px-3 text-slate-600 whitespace-nowrap tabular-nums">
                              {settledCount}/{project.tasks.length} settled
                            </td>
                            <td className="py-3.5 px-3">
                              <PaymentStatusBadge status={summaryStatus} />
                            </td>
                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <Link
                                href={`/projects/${project.id}`}
                                className="inline-flex items-center gap-1 font-semibold text-[#2563EB] hover:underline"
                              >
                                {nextLabel}
                                <ArrowRight className="h-3.5 w-3.5" />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>

          {/* Right Rail: Pending Decisions & Activity */}
          <div className="lg:col-span-4 space-y-5">
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-[#17243A]">
                Pending Reviews ({pendingDecisions.length})
              </h2>
              {pendingDecisions.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">
                  No authorized tasks awaiting homeowner review right now.
                </p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {pendingDecisions.map(({ project, task }) => {
                    const assessment = task.latest_review?.structured_findings.overall_assessment;
                    return (
                      <li
                        key={task.id}
                        className="rounded-xl border border-slate-200 bg-[#F7F8FA] p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-[#17243A]">
                              {task.title}
                            </p>
                            <p className="text-[11px] text-slate-500">{project.title}</p>
                          </div>
                          <span className="font-mono-code text-xs font-semibold text-[#17243A] tabular-nums">
                            {formatMoney(task.amount_minor_units)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px]">
                          {assessment === "concerns_identified" ? (
                            <AlertTriangle className="h-3.5 w-3.5 text-[#B91C1C]" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-[#047857]" />
                          )}
                          <span className="text-slate-700">
                            {assessment
                              ? `Inspection: ${assessment.replaceAll("_", " ")}`
                              : "Evidence ready for inspection"}
                          </span>
                        </div>
                        <Link href={`/tasks/${task.id}`} className="block">
                          <Button size="sm" variant="primary" className="w-full">
                            Review &amp; Decide
                          </Button>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#17243A]">
                  Recent Activity
                </h2>
                <Link
                  href="/ledger"
                  className="text-xs font-medium text-[#2563EB] hover:underline"
                >
                  Full Ledger
                </Link>
              </div>
              {events.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">
                  Authorizations, inspections, and settlements appear here.
                </p>
              ) : (
                <ol className="mt-4 space-y-3 border-l border-slate-200 pl-4">
                  {events.slice(0, 7).map((ev) => (
                    <li key={ev.id} className="relative text-xs">
                      <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-[#2563EB]" />
                      <p className="font-medium text-[#17243A]">
                        {ev.event_type.replaceAll("_", " ")} ·{" "}
                        <span className="text-slate-500">{ev.task_title}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        <span className="capitalize">{ev.actor}</span> ·{" "}
                        {formatDateTime(ev.created_at)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </div>
      </div>
      <Modal
        open={resetConfirmOpen}
        onClose={() => !resettingDemo && setResetConfirmOpen(false)}
        title="Reset Guided Demo?"
        description="Restores only the seeded Kitchen Renovation Closeout ($50) demonstration project to its starting state. Any custom projects or unrelated financial records will remain intact."
      >
        <div className="space-y-4 text-xs text-slate-600">
          <p>
            This clears only guided demo tasks, uploaded sample photos, and simulated demo
            transactions for <strong>Kitchen Renovation Closeout</strong>, then recreates a fresh
            project with <strong>Painting ($30.00)</strong> and <strong>Tile Repair ($20.00)</strong>.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={resettingDemo}
              onClick={() => setResetConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="primary" disabled={resettingDemo} onClick={resetGuidedDemo}>
              {resettingDemo ? "Resetting Demo..." : "Confirm Reset Demo"}
            </Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
