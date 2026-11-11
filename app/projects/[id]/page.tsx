"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Edit3,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { GuidedDemoTracker } from "@/components/demo/GuidedDemoTracker";
import { AllocationBar } from "@/components/payments/AllocationBar";
import { PayPalButtonSlot } from "@/components/payments/PayPalButtonSlot";
import { AppShell } from "@/components/shell/AppShell";
import {
  Button,
  Card,
  Input,
  Modal,
  PaymentStatusBadge,
  Skeleton,
  Textarea,
  WorkStatusBadge,
} from "@/components/ui/primitives";
import type { Profile, ProjectBundle, SystemConfigStatus, TaskBundle } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [user, setUser] = useState<Profile | null>(null);
  const [config, setConfig] = useState<SystemConfigStatus | null>(null);
  const [project, setProject] = useState<ProjectBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  // Add / Edit DRAFT task modal
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskBundle | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskAmountUsd, setTaskAmountUsd] = useState("25.00");
  const [taskCriteriaText, setTaskCriteriaText] = useState("");
  const [savingTask, setSavingTask] = useState(false);

  // PayPal modal for funding a specific task
  const [fundingTask, setFundingTask] = useState<TaskBundle | null>(null);

  const load = useCallback(async () => {
    try {
      const [meRes, projRes] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }),
        fetch(`/api/projects/${id}`, { cache: "no-store" }),
      ]);
      if (meRes.status === 401 || projRes.status === 401) {
        router.push("/login");
        return;
      }
      const meJson = await meRes.json();
      const projJson = await projRes.json();
      if (!projRes.ok) throw new Error(projJson.error || "Failed to load project");
      setUser(meJson.user);
      setConfig(meJson.config);
      setProject(projJson.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading project");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  function openNewTaskModal() {
    setEditingTask(null);
    setTaskTitle("");
    setTaskDesc("");
    setTaskAmountUsd("25.00");
    setTaskCriteriaText("");
    setTaskModalOpen(true);
  }

  function openEditTaskModal(task: TaskBundle) {
    setEditingTask(task);
    setTaskTitle(task.title);
    setTaskDesc(task.description);
    setTaskAmountUsd((task.amount_minor_units / 100).toFixed(2));
    setTaskCriteriaText(task.acceptance_criteria.join("\n"));
    setTaskModalOpen(true);
  }

  async function saveTaskForm(e: React.FormEvent) {
    e.preventDefault();
    setSavingTask(true);
    setError("");
    try {
      const cents = Math.round(Number(taskAmountUsd) * 100);
      const criteria = taskCriteriaText
        .split(/\n|;/)
        .map((s) => s.trim())
        .filter(Boolean);
      const url = editingTask ? `/api/tasks/${editingTask.id}` : `/api/projects/${id}`;
      const method = editingTask ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: taskTitle,
          description: taskDesc,
          amount_minor_units: cents,
          acceptance_criteria: criteria,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save task");
      setTaskModalOpen(false);
      setToast(editingTask ? "Task updated." : "Task added to project.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save task");
    } finally {
      setSavingTask(false);
    }
  }

  async function deleteDraftTask(taskId: string) {
    setError("");
    const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Could not delete task");
      return;
    }
    setToast("Draft task removed.");
    await load();
  }

  async function reconcileTask(taskId: string) {
    setError("");
    const res = await fetch(`/api/tasks/${taskId}/reconcile`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Reconcile failed");
      return;
    }
    setToast(json.message || "Payment status reconciled with PayPal.");
    await load();
  }

  if (loading || !user || !config) {
    return (
      <div className="min-h-screen bg-slate-50 p-8 max-w-6xl mx-auto space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <AppShell user={user} config={config}>
        <Card className="p-8 text-center">
          <p className="text-sm font-semibold text-slate-900">
            {error || "Project not found"}
          </p>
          <Link href={user.role === "contractor" ? "/contractor" : "/dashboard"}>
            <Button variant="outline" className="mt-4">
              Return to Console
            </Button>
          </Link>
        </Card>
      </AppShell>
    );
  }

  const totalMinor = project.tasks.reduce((s, t) => s + t.amount_minor_units, 0);
  const authorizedMinor = project.tasks
    .filter((t) =>
      ["AUTHORIZED", "SETTLEMENT_PENDING", "CAPTURE_PENDING", "VOID_PENDING"].includes(
        t.payment_status
      )
    )
    .reduce((s, t) => s + t.amount_minor_units, 0);
  const capturedMinor = project.tasks
    .filter((t) => t.payment_status === "CAPTURED")
    .reduce((s, t) => s + t.amount_minor_units, 0);
  const voidedMinor = project.tasks
    .filter((t) => t.payment_status === "VOIDED")
    .reduce((s, t) => s + t.amount_minor_units, 0);

  return (
    <AppShell user={user} config={config} projects={[project]}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={user.role === "contractor" ? "/contractor" : "/dashboard"}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to {user.role === "contractor" ? "Contractor Desk" : "Overview"}
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            {user.role === "homeowner" && (
              <Button variant="primary" size="sm" onClick={openNewTaskModal}>
                <Plus className="h-3.5 w-3.5" />
                Add Repair Task
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            {error}
          </div>
        )}
        {toast && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
            {toast}
          </div>
        )}

        {/* Project Header */}
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">{project.title}</h1>
                <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                  {project.status}
                </span>
              </div>
              <p className="text-sm text-slate-600 max-w-2xl">{project.description}</p>
              <p className="text-xs text-slate-500 pt-1">
                Location: <strong>{project.location}</strong> · Homeowner:{" "}
                <strong>{project.homeowner_name}</strong> · Contractor:{" "}
                <strong>{project.contractor_name}</strong>
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-right">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] text-slate-500">Total Agreed</p>
                <p className="text-sm font-bold text-slate-900 tabular-nums">
                  {formatMoney(totalMinor)}
                </p>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2">
                <p className="text-[11px] text-blue-700">Authorized</p>
                <p className="text-sm font-bold text-blue-700 tabular-nums">
                  {formatMoney(authorizedMinor)}
                </p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2">
                <p className="text-[11px] text-emerald-700">Captured</p>
                <p className="text-sm font-bold text-emerald-700 tabular-nums">
                  {formatMoney(capturedMinor)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] text-slate-500">Voided</p>
                <p className="text-sm font-bold text-slate-700 tabular-nums">
                  {formatMoney(voidedMinor)}
                </p>
              </div>
            </div>
          </div>
        </Card>

        <AllocationBar tasks={project.tasks} />

        {/* 6-step pipeline tracker & verified closing summary */}
        <GuidedDemoTracker project={project} />

        {/* Repair Task Cards */}
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-slate-900">
            Independent Repair Tasks ({project.tasks.length})
          </h2>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {project.tasks.map((task) => {
              const needsFunding =
                user.role === "homeowner" &&
                ["DRAFT", "ORDER_CREATED", "BUYER_APPROVAL_PENDING", "PAYMENT_FAILED"].includes(
                  task.payment_status
                );
              const assessment =
                task.latest_review?.structured_findings.overall_assessment;
              return (
                <Card
                  key={task.id}
                  className="p-5 flex flex-col justify-between gap-4 hover:border-slate-300 transition-colors"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`/tasks/${task.id}`}
                          className="text-base font-semibold text-slate-900 hover:text-blue-600"
                        >
                          {task.title}
                        </Link>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Contractor: {project.contractor_name}
                        </p>
                      </div>
                      <span className="font-mono-code text-base font-bold text-slate-900 tabular-nums">
                        {formatMoney(task.amount_minor_units)}
                      </span>
                    </div>

                    <p className="text-xs leading-relaxed text-slate-600">
                      {task.description}
                    </p>

                    <div className="flex flex-wrap gap-1.5">
                      <PaymentStatusBadge status={task.payment_status} />
                      <WorkStatusBadge status={task.work_status} />
                    </div>

                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Acceptance Criteria
                      </p>
                      <ul className="list-disc pl-4 text-xs text-slate-700 space-y-0.5">
                        {task.acceptance_criteria.map((c, idx) => (
                          <li key={idx}>{c}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Evidence: <strong>{task.evidence.length} photo(s)</strong>
                      </span>
                      <span>
                        AI:{" "}
                        <strong>
                          {assessment
                            ? assessment.replaceAll("_", " ")
                            : "Not run yet"}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <div className="flex items-center gap-2">
                      {user.role === "homeowner" && task.payment_status === "DRAFT" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditTaskModal(task)}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          {project.tasks.length > 1 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => deleteDraftTask(task.id)}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </>
                      )}
                      {task.payment.paypal_order_id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => reconcileTask(task.id)}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Sync PayPal
                        </Button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {needsFunding && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => setFundingTask(task)}
                        >
                          Authorize {formatMoney(task.amount_minor_units)}
                        </Button>
                      )}
                      <Link href={`/tasks/${task.id}`}>
                        <Button
                          size="sm"
                          variant={needsFunding ? "outline" : "primary"}
                        >
                          {user.role === "contractor"
                            ? "Upload Evidence"
                            : task.work_status === "AI_REVIEWED" ||
                              task.work_status === "EVIDENCE_SUBMITTED"
                            ? "Inspect & Decide"
                            : "Open Task Details"}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      </div>

      {/* Add / Edit Task Modal */}
      <Modal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        title={editingTask ? "Edit Draft Repair Task" : "Add Repair Task"}
        description="Task terms and amount can be edited before creating a PayPal order."
      >
        <form onSubmit={saveTaskForm} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Task Title
            </label>
            <Input
              required
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Agreed Amount (USD)
            </label>
            <Input
              required
              type="number"
              step="0.01"
              min="1"
              max="10000"
              value={taskAmountUsd}
              onChange={(e) => setTaskAmountUsd(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Description
            </label>
            <Textarea
              required
              rows={2}
              value={taskDesc}
              onChange={(e) => setTaskDesc(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Acceptance Criteria (one per line)
            </label>
            <Textarea
              required
              rows={3}
              value={taskCriteriaText}
              onChange={(e) => setTaskCriteriaText(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setTaskModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={savingTask}>
              {savingTask ? "Saving..." : "Save Task"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* PayPal Authorization Modal */}
      <Modal
        open={Boolean(fundingTask)}
        onClose={() => setFundingTask(null)}
        title={
          fundingTask
            ? `Authorize ${formatMoney(fundingTask.amount_minor_units)} for ${fundingTask.title}`
            : ""
        }
        description="Creates an independent PayPal Orders v2 AUTHORIZE hold. Funds are not captured until you accept the repair."
      >
        {fundingTask && (
          <PayPalButtonSlot
            clientId={config.paypal.clientId}
            configured={config.paypal.configured}
            taskId={fundingTask.id}
            amountFormatted={formatMoney(fundingTask.amount_minor_units)}
            onStatusMessage={(msg) => setToast(msg)}
            onSuccess={() => {
              setFundingTask(null);
              load();
            }}
          />
        )}
      </Modal>
    </AppShell>
  );
}
