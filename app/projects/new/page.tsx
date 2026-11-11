"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, Input, Skeleton, Textarea } from "@/components/ui/primitives";
import type { Profile, SystemConfigStatus } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

interface DraftTask {
  localId: string;
  title: string;
  description: string;
  amountUsd: string;
  criteriaText: string;
  contractorNotes: string;
  aiSuggestion?: {
    improved_description: string;
    suggested_criteria: string[];
    evidence_photo_guidance: string;
  };
}

function CreateProjectWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const guidedParam = params.get("guided") === "1";

  const [user, setUser] = useState<Profile | null>(null);
  const [config, setConfig] = useState<SystemConfigStatus | null>(null);
  const [contractors, setContractors] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [contractorId, setContractorId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [tasks, setTasks] = useState<DraftTask[]>([
    {
      localId: "task-1",
      title: "",
      description: "",
      amountUsd: "30.00",
      criteriaText: "",
      contractorNotes: "",
    },
  ]);

  const [aiBusyId, setAiBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!json.user) {
          router.push("/login");
          return;
        }
        if (json.user.role !== "homeowner") {
          router.push("/contractor");
          return;
        }
        setUser(json.user);
        setConfig(json.config);
        setContractors(json.contractors || []);
        if (json.contractors?.[0]) setContractorId(json.contractors[0].id);
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function launchGuidedDemo() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guided_demo: true, contractor_id: contractorId || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to launch guided demo");
      router.push(`/projects/${json.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
      setSubmitting(false);
    }
  }

  async function runAiScopeAssistant(task: DraftTask) {
    setAiBusyId(task.localId);
    setError("");
    try {
      const res = await fetch("/api/ai/scope-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: task.title, description: task.description }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "AI Scope Assistant failed");
      setTasks((prev) =>
        prev.map((t) =>
          t.localId === task.localId ? { ...t, aiSuggestion: json.suggestion } : t
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI Scope Assistant error");
    } finally {
      setAiBusyId(null);
    }
  }

  function acceptSuggestion(taskId: string) {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.localId !== taskId || !t.aiSuggestion) return t;
        return {
          ...t,
          description: t.aiSuggestion.improved_description,
          criteriaText: t.aiSuggestion.suggested_criteria.join("\n"),
          contractorNotes: t.contractorNotes || t.aiSuggestion.evidence_photo_guidance,
          aiSuggestion: undefined,
        };
      })
    );
  }

  function addTaskRow() {
    setTasks((prev) => [
      ...prev,
      {
        localId: `task-${Date.now()}`,
        title: "",
        description: "",
        amountUsd: "20.00",
        criteriaText: "",
        contractorNotes: "",
      },
    ]);
  }

  function removeTaskRow(localId: string) {
    if (tasks.length <= 1) return;
    setTasks((prev) => prev.filter((t) => t.localId !== localId));
  }

  const parsedTasks = tasks.map((t) => {
    const cents = Math.round(Number(t.amountUsd || 0) * 100);
    const criteria = t.criteriaText
      .split(/\n|;/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      title: t.title.trim(),
      description: t.description.trim(),
      acceptance_criteria: criteria,
      amount_minor_units: cents,
      contractor_notes: t.contractorNotes.trim(),
    };
  });

  const totalMinor = parsedTasks.reduce(
    (sum, t) => sum + (Number.isFinite(t.amount_minor_units) ? t.amount_minor_units : 0),
    0
  );

  function validateStep(current: number): string | null {
    if (current === 1) {
      if (title.trim().length < 3) return "Enter a project name (at least 3 characters).";
      if (location.trim().length < 2) return "Enter a property location or project label.";
      if (!contractorId) return "Select an assigned contractor.";
    }
    if (current === 2) {
      for (let i = 0; i < parsedTasks.length; i++) {
        const t = parsedTasks[i];
        if (t.title.length < 2) return `Task #${i + 1}: enter a task title.`;
        if (t.description.length < 4) return `Task #${i + 1}: enter a repair description.`;
        if (!Number.isInteger(t.amount_minor_units) || t.amount_minor_units < 100) {
          return `Task #${i + 1}: amount must be at least $1.00 USD.`;
        }
        if (t.acceptance_criteria.length < 1) {
          return `Task #${i + 1}: enter at least one acceptance criterion (one per line).`;
        }
      }
    }
    return null;
  }

  async function handleSubmit() {
    const err = validateStep(1) || validateStep(2);
    if (err) {
      setError(err);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          location,
          contractor_id: contractorId,
          due_date: dueDate || null,
          tasks: parsedTasks,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create project");
      router.push(`/projects/${json.project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save project");
      setSubmitting(false);
    }
  }

  if (loading || !user || !config) {
    return (
      <div className="min-h-screen bg-slate-50 p-8 max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <AppShell user={user} config={config}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Create Repair Project</h1>
            <p className="mt-1 text-sm text-slate-500">
              Define each repair task, price, and visual acceptance criteria before
              authorizing PayPal holds.
            </p>
          </div>
          <Button
            variant={guidedParam ? "primary" : "secondary"}
            onClick={launchGuidedDemo}
            disabled={submitting}
          >
            <Sparkles className="h-4 w-4" />
            {submitting ? "Creating..." : "1-Click Guided Demo ($30 + $20)"}
          </Button>
        </div>

        {/* Stepper */}
        <ol className="grid grid-cols-4 gap-2">
          {["1. Basics", "2. Repair Tasks", "3. AI Scope Helper", "4. Review"].map(
            (label, idx) => {
              const sNum = idx + 1;
              const active = step === sNum;
              const done = step > sNum;
              return (
                <li
                  key={label}
                  className={`rounded-xl border px-3 py-2.5 text-xs font-semibold ${
                    active
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : done
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-500"
                  }`}
                >
                  {label}
                </li>
              );
            }
          )}
        </ol>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <Card className="p-6 space-y-6">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Project Name
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Oak Street Closeout Repairs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description
                </label>
                <Textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Summary of punch-list items before final closeout"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Property Location / Label
                  </label>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g., Austin, TX · Unit 4B"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Expected Completion Date
                  </label>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assigned Contractor
                </label>
                <select
                  value={contractorId}
                  onChange={(e) => setContractorId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                >
                  {contractors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              {tasks.map((task, idx) => (
                <div
                  key={task.localId}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                      Repair Task #{idx + 1}
                    </span>
                    {tasks.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTaskRow(task.localId)}
                        className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Task Title
                      </label>
                      <Input
                        value={task.title}
                        onChange={(e) =>
                          setTasks((prev) =>
                            prev.map((t) =>
                              t.localId === task.localId
                                ? { ...t, title: e.target.value }
                                : t
                            )
                          )
                        }
                        placeholder="e.g., Living room wall painting"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Agreed Amount (USD)
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        min="1"
                        max="10000"
                        value={task.amountUsd}
                        onChange={(e) =>
                          setTasks((prev) =>
                            prev.map((t) =>
                              t.localId === task.localId
                                ? { ...t, amountUsd: e.target.value }
                                : t
                            )
                          )
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Work Description
                    </label>
                    <Textarea
                      rows={2}
                      value={task.description}
                      onChange={(e) =>
                        setTasks((prev) =>
                          prev.map((t) =>
                            t.localId === task.localId
                              ? { ...t, description: e.target.value }
                              : t
                          )
                        )
                      }
                      placeholder="Describe the repair clearly..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Acceptance Criteria (one per line)
                    </label>
                    <Textarea
                      rows={3}
                      value={task.criteriaText}
                      onChange={(e) =>
                        setTasks((prev) =>
                          prev.map((t) =>
                            t.localId === task.localId
                              ? { ...t, criteriaText: e.target.value }
                              : t
                          )
                        )
                      }
                      placeholder={
                        "Coverage looks uniform\nNo obvious unpainted patches\nEdges appear clean"
                      }
                    />
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={addTaskRow}>
                <Plus className="h-4 w-4" />
                Add Another Repair Task
              </Button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-xs text-blue-900">
                <p className="font-semibold">AI Scope Assistant (Advisory)</p>
                <p className="mt-1">
                  Uses the configured multimodal LLM ({config.ai.provider || "not configured"})
                  to refine vague descriptions into specific visual criteria. Suggestions are
                  never applied unless you accept them.
                </p>
              </div>
              {tasks.map((task) => (
                <div
                  key={task.localId}
                  className="rounded-xl border border-slate-200 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                      <p className="text-xs text-slate-500">{task.description}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={aiBusyId === task.localId}
                      onClick={() => runAiScopeAssistant(task)}
                    >
                      <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                      {aiBusyId === task.localId
                        ? "Analyzing scope..."
                        : "Suggest Clear Criteria"}
                    </Button>
                  </div>
                  {task.aiSuggestion && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 space-y-2 text-xs">
                      <p className="font-semibold text-emerald-900">
                        Suggested Scope: {task.aiSuggestion.improved_description}
                      </p>
                      <ul className="list-disc pl-5 space-y-0.5 text-emerald-900">
                        {task.aiSuggestion.suggested_criteria.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                      <p className="text-emerald-800">
                        Photo guidance: {task.aiSuggestion.evidence_photo_guidance}
                      </p>
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="success"
                          onClick={() => acceptSuggestion(task.localId)}
                        >
                          <Check className="h-3.5 w-3.5" />
                          Accept Suggestions
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setTasks((prev) =>
                              prev.map((t) =>
                                t.localId === task.localId
                                  ? { ...t, aiSuggestion: undefined }
                                  : t
                              )
                            )
                          }
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{title}</h3>
                    <p className="text-xs text-slate-500">{location}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Total Agreed Value</p>
                    <p className="text-xl font-bold text-slate-900 tabular-nums">
                      {formatMoney(totalMinor)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-2.5">
                {parsedTasks.map((t, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-slate-200 p-4 flex items-start justify-between gap-4"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{t.title}</p>
                      <p className="text-xs text-slate-600 mt-0.5">{t.description}</p>
                      <ul className="mt-2 list-disc pl-4 text-xs text-slate-600 space-y-0.5">
                        {t.acceptance_criteria.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                    <span className="font-mono-code text-sm font-semibold text-slate-900">
                      {formatMoney(t.amount_minor_units)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                Each repair task creates an independent PayPal Orders v2{" "}
                <code>AUTHORIZE</code> order after you save the project. Authorizations are
                temporary holds (not escrow).
              </p>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={step === 1 || submitting}
              onClick={() => {
                setError("");
                setStep((s) => Math.max(1, s - 1));
              }}
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            {step < 4 ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  const err = validateStep(step);
                  if (err) {
                    setError(err);
                    return;
                  }
                  setError("");
                  setStep((s) => s + 1);
                }}
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                disabled={submitting}
                onClick={handleSubmit}
              >
                {submitting ? "Saving Project..." : "Create Project & Open Dossier"}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

export default function NewProjectPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <CreateProjectWizard />
    </Suspense>
  );
}
