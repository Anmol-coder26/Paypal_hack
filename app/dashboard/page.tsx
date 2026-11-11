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
  Sparkles,
} from "lucide-react";
import { AllocationBar } from "@/components/payments/AllocationBar";
import { AppShell } from "@/components/shell/AppShell";
import {
  Button,
  Card,
  PaymentStatusBadge,
  Skeleton,
  WorkStatusBadge,
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
    const awaitingDecisionCount = allTasks.filter(
      (t) =>
        ["EVIDENCE_SUBMITTED", "AI_REVIEWED"].includes(t.work_status) &&
        t.payment_status === "AUTHORIZED"
    ).length;

    return {
      totalRepairMinor,
      authorizedMinor,
      capturedMinor,
      voidedMinor,
      awaitingDecisionCount,
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
      <div className="min-h-screen bg-slate-50 p-8 space-y-6 max-w-7xl mx-auto">
        <Skeleton className="h-12 w-72" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28" />
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
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Homeowner Command Center
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Real-time project totals, PayPal authorizations, AI evidence alerts, and
              settlement history.
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
            <Button variant="secondary" onClick={launchGuidedDemo} disabled={creatingDemo}>
              <Sparkles className="h-4 w-4 text-blue-400" />
              {creatingDemo ? "Creating Demo..." : "Guided Demo ($50 · 2 Tasks)"}
            </Button>
            <Link href="/projects/new">
              <Button variant="primary">
                <FolderPlus className="h-4 w-4" />
                Create Project
              </Button>
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* 5 Live Financial Overview Cards */}
        <section
          aria-label="Financial overview"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          {[
            {
              label: "Total Repair Value",
              value: formatMoney(metrics.totalRepairMinor),
              sub: `${metrics.allTasks.length} repair task(s)`,
              tone: "text-slate-900",
            },
            {
              label: "Currently Authorized",
              value: formatMoney(metrics.authorizedMinor),
              sub: "Active PayPal holds",
              tone: "text-blue-600",
            },
            {
              label: "Successfully Captured",
              value: formatMoney(metrics.capturedMinor),
              sub: "Verified PayPal captures",
              tone: "text-emerald-600",
            },
            {
              label: "Voided Amount",
              value: formatMoney(metrics.voidedMinor),
              sub: "Released (never charged)",
              tone: "text-slate-600",
            },
            {
              label: "Awaiting Review",
              value: String(metrics.awaitingDecisionCount),
              sub: "Tasks ready for decision",
              tone: metrics.awaitingDecisionCount > 0 ? "text-amber-600" : "text-slate-900",
            },
          ].map((kpi) => (
            <Card key={kpi.label} className="p-4">
              <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
              <p className={`mt-2 text-2xl font-bold tabular-nums ${kpi.tone}`}>
                {kpi.value}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">{kpi.sub}</p>
            </Card>
          ))}
        </section>

        <AllocationBar tasks={metrics.allTasks} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Active Projects */}
          <div className="lg:col-span-8 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">
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
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {status === "ALL" ? "All" : status.charAt(0) + status.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            {filteredProjects.length === 0 ? (
              <Card className="p-8 text-center space-y-3">
                <p className="text-sm font-semibold text-slate-900">
                  No repair projects match your view
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Create a custom punch-list project or launch the Guided Demo ($30 Painting +
                  $20 Tile Repair) to start authorizing PayPal holds.
                </p>
                <div className="flex justify-center gap-3 pt-2">
                  <Button variant="primary" onClick={() => router.push("/projects/new")}>
                    Create Custom Project
                  </Button>
                  <Button variant="outline" onClick={launchGuidedDemo} disabled={creatingDemo}>
                    Launch Guided Demo
                  </Button>
                </div>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredProjects.map((project) => {
                  const total = project.tasks.reduce(
                    (sum, t) => sum + t.amount_minor_units,
                    0
                  );
                  return (
                    <Card key={project.id} className="p-5 hover:border-slate-300 transition-colors">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/projects/${project.id}`}
                              className="text-base font-semibold text-slate-900 hover:text-blue-600"
                            >
                              {project.title}
                            </Link>
                            {project.is_guided_demo && (
                              <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                Guided Demo
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {project.location} · Contractor: {project.contractor_name}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-base font-bold text-slate-900 tabular-nums">
                            {formatMoney(total)}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {project.tasks.length} task(s) · {project.status}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/70">
                        {project.tasks.map((task) => (
                          <Link
                            key={task.id}
                            href={`/tasks/${task.id}`}
                            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-100/70 transition-colors"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900 truncate">
                                {task.title}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <PaymentStatusBadge status={task.payment_status} />
                                <WorkStatusBadge status={task.work_status} />
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-mono-code text-sm font-semibold text-slate-900 tabular-nums">
                                {formatMoney(task.amount_minor_units)}
                              </span>
                              <ArrowRight className="h-4 w-4 text-slate-400" />
                            </div>
                          </Link>
                        ))}
                      </div>

                      <div className="mt-3 flex justify-end">
                        <Link
                          href={`/projects/${project.id}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
                        >
                          Open Project Dossier
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Rail: Pending Decisions & Financial Event Feed */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Pending Decisions &amp; AI Alerts
              </h2>
              {pendingDecisions.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">
                  No tasks currently awaiting your capture/void decision.
                </p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {pendingDecisions.map(({ project, task }) => {
                    const assessment = task.latest_review?.structured_findings.overall_assessment;
                    return (
                      <li
                        key={task.id}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-slate-900">
                              {task.title}
                            </p>
                            <p className="text-[11px] text-slate-500">{project.title}</p>
                          </div>
                          <span className="font-mono-code text-xs font-semibold text-slate-900">
                            {formatMoney(task.amount_minor_units)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px]">
                          {assessment === "concerns_identified" ? (
                            <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          )}
                          <span className="text-slate-700">
                            {assessment
                              ? `AI: ${assessment.replaceAll("_", " ")}`
                              : "Evidence ready for inspection"}
                          </span>
                        </div>
                        <Link href={`/tasks/${task.id}`} className="block">
                          <Button size="sm" variant="primary" className="w-full">
                            Inspect &amp; Decide
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
                <h2 className="text-sm font-semibold text-slate-900">
                  Financial Event Timeline
                </h2>
                <Link
                  href="/ledger"
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  Full Ledger
                </Link>
              </div>
              {events.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">
                  Events will appear here as tasks, authorizations, reviews, and settlements
                  occur.
                </p>
              ) : (
                <ol className="mt-4 space-y-3 border-l border-slate-200 pl-4">
                  {events.slice(0, 8).map((ev) => (
                    <li key={ev.id} className="relative text-xs">
                      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-blue-600" />
                      <p className="font-medium text-slate-900">
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
    </AppShell>
  );
}
