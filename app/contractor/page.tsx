"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  Hammer,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { BeforeAfterCompare } from "@/components/evidence/BeforeAfterCompare";
import { AppShell } from "@/components/shell/AppShell";
import {
  Button,
  Card,
  PaymentStatusBadge,
  Skeleton,
  Textarea,
  WorkStatusBadge,
} from "@/components/ui/primitives";
import type { Profile, ProjectBundle, SystemConfigStatus, TaskBundle } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

type QueueTab = "needs_evidence" | "awaiting_review" | "corrections" | "settled" | "all";

export default function ContractorWorkspacePage() {
  const router = useRouter();
  const [user, setUser] = useState<Profile | null>(null);
  const [config, setConfig] = useState<SystemConfigStatus | null>(null);
  const [projects, setProjects] = useState<ProjectBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<QueueTab>("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ text: string; ok: boolean } | null>(null);

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
      const list = (json.projects || []) as ProjectBundle[];
      setProjects(list);
      if (!selectedTaskId) {
        const firstTask = list.flatMap((p) => p.tasks)[0];
        if (firstTask) {
          setSelectedTaskId(firstTask.id);
          setNotesDraft(firstTask.contractor_notes || "");
        }
      }
    } finally {
      setLoading(false);
    }
  }, [router, selectedTaskId]);

  useEffect(() => {
    load();
  }, [load]);

  const allEntries = useMemo(
    () => projects.flatMap((p) => p.tasks.map((t) => ({ project: p, task: t }))),
    [projects]
  );

  const filtered = useMemo(() => {
    return allEntries.filter(({ task }) => {
      if (tab === "needs_evidence") {
        return ["PENDING_EVIDENCE", "BEFORE_SUBMITTED"].includes(task.work_status);
      }
      if (tab === "awaiting_review") {
        return ["EVIDENCE_SUBMITTED", "AI_REVIEWED"].includes(task.work_status);
      }
      if (tab === "corrections") {
        return task.work_status === "CORRECTIONS_REQUESTED";
      }
      if (tab === "settled") {
        return ["CAPTURED", "VOIDED", "AUTHORIZATION_EXPIRED"].includes(
          task.payment_status
        );
      }
      return true;
    });
  }, [allEntries, tab]);

  const activeEntry =
    allEntries.find((e) => e.task.id === selectedTaskId) || filtered[0] || allEntries[0];

  function selectTask(task: TaskBundle) {
    setSelectedTaskId(task.id);
    setNotesDraft(task.contractor_notes || "");
    setBanner(null);
  }

  function uploadFileWithProgress(taskId: string, stage: "before" | "after", file: File) {
    if (file.size > 4 * 1024 * 1024) {
      setBanner({ text: "Image must be 4 MB or smaller.", ok: false });
      return;
    }
    setBusyAction(`upload-${stage}`);
    setUploadProgress(5);
    setBanner(null);

    const form = new FormData();
    form.append("stage", stage);
    form.append("file", file);
    form.append("notes", notesDraft);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/tasks/${taskId}/upload`);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };
    xhr.onload = async () => {
      setUploadProgress(null);
      setBusyAction(null);
      const data = (() => {
        try {
          return JSON.parse(xhr.responseText);
        } catch {
          return {};
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300) {
        setBanner({
          text: `${stage.toUpperCase()} photo uploaded & sanitized (${data.evidence?.width}×${data.evidence?.height}).`,
          ok: true,
        });
        await load();
      } else {
        setBanner({ text: data.error || `Upload failed (${xhr.status})`, ok: false });
      }
    };
    xhr.onerror = () => {
      setUploadProgress(null);
      setBusyAction(null);
      setBanner({ text: "Network error during image upload.", ok: false });
    };
    xhr.send(form);
  }

  async function saveNotes(taskId: string) {
    setBusyAction("notes");
    setBanner(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractor_notes: notesDraft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save work notes");
      setBanner({ text: "Contractor work notes saved.", ok: true });
      await load();
    } catch (err) {
      setBanner({
        text: err instanceof Error ? err.message : "Failed to save notes",
        ok: false,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function runAIInspection(taskId: string) {
    setBusyAction("ai");
    setBanner(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/review`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "AI inspection failed");
      setBanner({
        text: `AI inspection v${json.review.review_version} recorded (${json.review.structured_findings.overall_assessment.replaceAll("_", " ")}).`,
        ok: true,
      });
      await load();
    } catch (err) {
      setBanner({
        text: err instanceof Error ? err.message : "AI inspection failed",
        ok: false,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteEvidence(evidenceId: string) {
    const res = await fetch(`/api/evidence/${evidenceId}`, { method: "DELETE" });
    if (res.ok) {
      setBanner({ text: "Evidence photo removed.", ok: true });
      await load();
    }
  }

  async function uploadDemoSample(
    taskId: string,
    stage: "before" | "after",
    publicPath: string
  ) {
    setBusyAction(`demo-${stage}`);
    setBanner(null);
    try {
      const resp = await fetch(publicPath);
      const blob = await resp.blob();
      const file = new File([blob], publicPath.split("/").pop() || `${stage}.png`, {
        type: "image/png",
      });
      uploadFileWithProgress(taskId, stage, file);
    } catch {
      setBusyAction(null);
      setBanner({ text: "Could not load sample test photo.", ok: false });
    }
  }

  if (loading || !user || !config) {
    return (
      <div className="min-h-screen bg-slate-50 p-8 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <AppShell user={user} config={config} projects={projects}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Contractor Workspace</h1>
            <p className="mt-1 text-sm text-slate-500">
              Submit before &amp; after repair photographs, attach completion notes, run
              advisory AI inspections, and track PayPal settlement statuses.
            </p>
          </div>
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {(
              [
                ["all", "All Tasks"],
                ["needs_evidence", "Ready for Evidence"],
                ["awaiting_review", "Awaiting Homeowner"],
                ["corrections", "Corrections Requested"],
                ["settled", "Settled"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-md px-3 py-1 text-xs font-medium cursor-pointer ${
                  tab === key
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {banner && (
          <div
            className={`rounded-xl border px-4 py-3 text-xs ${
              banner.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {banner.text}
          </div>
        )}

        {allEntries.length === 0 ? (
          <Card className="p-8 text-center space-y-2">
            <Hammer className="h-8 w-8 text-slate-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-900">
              No assigned repair tasks yet
            </p>
            <p className="text-xs text-slate-500">
              Switch to the Demo Homeowner account to create a project or Guided Demo assigned
              to you.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left Task Queue */}
            <div className="lg:col-span-4 space-y-2.5">
              {filtered.map(({ project, task }) => {
                const selected = activeEntry?.task.id === task.id;
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => selectTask(task)}
                    className={`w-full text-left rounded-xl border p-4 transition-colors cursor-pointer ${
                      selected
                        ? "border-blue-600 bg-blue-50/60"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                        <p className="text-xs text-slate-500">{project.title}</p>
                      </div>
                      <span className="font-mono-code text-xs font-bold text-slate-900">
                        {formatMoney(task.amount_minor_units)}
                      </span>
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <WorkStatusBadge status={task.work_status} />
                      <PaymentStatusBadge status={task.payment_status} />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Right Active Task Workspace */}
            {activeEntry && (
              <div className="lg:col-span-8 space-y-5">
                <Card className="p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-100 pb-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-500">
                        {activeEntry.project.title} · {activeEntry.project.location}
                      </p>
                      <h2 className="text-xl font-bold text-slate-900 mt-0.5">
                        {activeEntry.task.title}
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        {activeEntry.task.description}
                      </p>
                    </div>
                    <div className="shrink-0 sm:text-right">
                      <p className="font-mono-code text-xl font-bold text-slate-900 tabular-nums">
                        {formatMoney(activeEntry.task.amount_minor_units)}
                      </p>
                      <div className="mt-1">
                        <PaymentStatusBadge status={activeEntry.task.payment_status} />
                      </div>
                    </div>
                  </div>

                  {activeEntry.task.homeowner_feedback && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <strong>Homeowner Feedback:</strong>{" "}
                      {activeEntry.task.homeowner_feedback}
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                      Agreed Acceptance Criteria
                    </p>
                    <ul className="list-disc pl-5 text-xs text-slate-700 space-y-1">
                      {activeEntry.task.acceptance_criteria.map((c, idx) => (
                        <li key={idx}>{c}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Drag-and-Drop / File Upload Controls */}
                  {!["CAPTURED", "VOIDED", "AUTHORIZATION_EXPIRED"].includes(
                    activeEntry.task.payment_status
                  ) && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {(["before", "after"] as const).map((stage) => (
                        <label
                          key={stage}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const dropped = e.dataTransfer.files?.[0];
                            if (dropped) {
                              uploadFileWithProgress(activeEntry.task.id, stage, dropped);
                            }
                          }}
                          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/70 p-5 text-center hover:border-blue-500 hover:bg-blue-50/30 transition-colors cursor-pointer"
                        >
                          <UploadCloud className="h-6 w-6 text-blue-600" />
                          <span className="mt-2 text-xs font-semibold text-slate-900 capitalize">
                            Upload {stage} Photo
                          </span>
                          <span className="mt-0.5 text-[11px] text-slate-500">
                            Drag &amp; drop or click (JPG, PNG, WebP · max 4 MB)
                          </span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              const picked = e.target.files?.[0];
                              if (picked) {
                                uploadFileWithProgress(activeEntry.task.id, stage, picked);
                              }
                              e.target.value = "";
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  )}

                  {uploadProgress !== null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-slate-600">
                        <span>Uploading &amp; sanitizing photo...</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full bg-blue-600 transition-all"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {!["CAPTURED", "VOIDED", "AUTHORIZATION_EXPIRED"].includes(
                    activeEntry.task.payment_status
                  ) && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-slate-700">
                        Demo Photo Kit (Real 800×600 PNGs → uploads through Sharp pipeline):
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={Boolean(busyAction)}
                          onClick={() =>
                            uploadDemoSample(
                              activeEntry.task.id,
                              "before",
                              activeEntry.task.title.toLowerCase().includes("tile")
                                ? "/demo-kit/tile-before.png"
                                : "/demo-kit/painting-before.png"
                            )
                          }
                        >
                          Load Sample Before
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={Boolean(busyAction)}
                          onClick={() =>
                            uploadDemoSample(
                              activeEntry.task.id,
                              "after",
                              activeEntry.task.title.toLowerCase().includes("tile")
                                ? "/demo-kit/tile-after-issue.png"
                                : "/demo-kit/painting-after.png"
                            )
                          }
                        >
                          Load Sample After
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Uploaded Previews */}
                  <BeforeAfterCompare
                    taskId={activeEntry.task.id}
                    before={
                      activeEntry.task.evidence.find((e) => e.evidence_type === "before") ||
                      null
                    }
                    after={
                      activeEntry.task.evidence.find((e) => e.evidence_type === "after") ||
                      null
                    }
                    allEvidence={activeEntry.task.evidence}
                    annotations={activeEntry.task.annotations}
                    canAnnotate={
                      !["CAPTURED", "VOIDED", "AUTHORIZATION_EXPIRED"].includes(
                        activeEntry.task.payment_status
                      )
                    }
                    canDelete={
                      !["CAPTURED", "VOIDED", "AUTHORIZATION_EXPIRED"].includes(
                        activeEntry.task.payment_status
                      )
                    }
                    onDelete={deleteEvidence}
                    onAnnotationChange={load}
                  />

                  {/* Work Notes */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      Contractor Completion Notes
                    </label>
                    <Textarea
                      rows={2}
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      placeholder="Explain materials used, drying times, or camera angle details..."
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyAction === "notes"}
                        onClick={() => saveNotes(activeEntry.task.id)}
                      >
                        {busyAction === "notes" ? "Saving..." : "Save Work Notes"}
                      </Button>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={
                            busyAction === "ai" ||
                            !activeEntry.task.evidence.some(
                              (e) => e.evidence_type === "before"
                            ) ||
                            !activeEntry.task.evidence.some(
                              (e) => e.evidence_type === "after"
                            )
                          }
                          onClick={() => runAIInspection(activeEntry.task.id)}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          {busyAction === "ai"
                            ? "Running AI Inspection..."
                            : activeEntry.task.latest_review
                            ? "Re-run AI Inspection"
                            : "Run AI Inspection"}
                        </Button>
                        <Link href={`/tasks/${activeEntry.task.id}`}>
                          <Button size="sm" variant="outline">
                            Full Inspection View
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>

                  {activeEntry.task.latest_review && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                          <CheckCircle2 className="h-4 w-4 text-blue-600" />
                          Latest AI Report (v{activeEntry.task.latest_review.review_version})
                        </span>
                        <span className="font-mono-code text-slate-500">
                          {activeEntry.task.latest_review.model}
                        </span>
                      </div>
                      <p className="text-slate-700">
                        {activeEntry.task.latest_review.structured_findings.summary}
                      </p>
                    </div>
                  )}
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
