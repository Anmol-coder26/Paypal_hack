"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  HelpCircle,
  MessageSquare,
  MessageSquareWarning,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { BeforeAfterCompare } from "@/components/evidence/BeforeAfterCompare";
import { PayPalButtonSlot } from "@/components/payments/PayPalButtonSlot";
import { PaymentLifecycleTimeline } from "@/components/payments/PaymentLifecycleTimeline";
import { AppShell } from "@/components/shell/AppShell";
import {
  Button,
  Card,
  Modal,
  PaymentStatusBadge,
  Skeleton,
  Textarea,
  WorkStatusBadge,
} from "@/components/ui/primitives";
import type {
  DecisionAction,
  Profile,
  Project,
  SystemConfigStatus,
  TaskBundle,
} from "@/lib/types";
import { formatDateTime, formatMoney } from "@/lib/utils";

const SUGGESTED_QUESTIONS = [
  "What issue did you notice?",
  "Which acceptance criteria are still unmet?",
  "What should the contractor photograph next?",
  "What happens if I reject this repair?",
];

export default function TaskInspectionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [user, setUser] = useState<Profile | null>(null);
  const [config, setConfig] = useState<SystemConfigStatus | null>(null);
  const [task, setTask] = useState<TaskBundle | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [banner, setBanner] = useState<{ text: string; ok: boolean } | null>(null);

  // Confirmation modal for homeowner decisions
  const [confirmDecision, setConfirmDecision] = useState<DecisionAction | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [simulateDecisionTimeout, setSimulateDecisionTimeout] = useState(false);
  const [selectedReviewVersion, setSelectedReviewVersion] = useState<number | null>(null);

  // Restrained Contextual AI Assistant ("Ask about this inspection")
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [qaHistory, setQaHistory] = useState<
    Array<{ q: string; answer: string; source: string; model: string | null }>
  >([]);

  const load = useCallback(async () => {
    try {
      const [meRes, taskRes] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }),
        fetch(`/api/tasks/${id}`, { cache: "no-store" }),
      ]);
      if (meRes.status === 401 || taskRes.status === 401) {
        router.push("/login");
        return;
      }
      const meJson = await meRes.json();
      const taskJson = await taskRes.json();
      if (!taskRes.ok) throw new Error(taskJson.error || "Failed to load task");
      setUser(meJson.user);
      setConfig(meJson.config);
      setTask(taskJson.task);
      setProject(taskJson.project);
    } catch (err) {
      setBanner({
        text: err instanceof Error ? err.message : "Failed to load task",
        ok: false,
      });
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  function handleUpload(stage: "before" | "after", file: File) {
    if (!task) return;
    setBusy(`upload-${stage}`);
    setUploadPct(5);
    setBanner(null);
    const form = new FormData();
    form.append("stage", stage);
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/tasks/${task.id}/upload`);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setUploadPct(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = async () => {
      setUploadPct(null);
      setBusy(null);
      const data = (() => {
        try {
          return JSON.parse(xhr.responseText);
        } catch {
          return {};
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300) {
        setBanner({ text: `${stage.toUpperCase()} photograph uploaded.`, ok: true });
        await load();
      } else {
        setBanner({ text: data.error || "Upload failed", ok: false });
      }
    };
    xhr.onerror = () => {
      setUploadPct(null);
      setBusy(null);
      setBanner({ text: "Network error uploading file", ok: false });
    };
    xhr.send(form);
  }

  async function runAIReview() {
    if (!task) return;
    setBusy("ai");
    setBanner(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/review`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "AI inspection failed");
      setBanner({
        text: `AI Inspection v${json.review.review_version} completed via ${json.review.provider} (${json.review.model}).`,
        ok: true,
      });
      await load();
    } catch (err) {
      setBanner({
        text: err instanceof Error ? err.message : "AI inspection failed",
        ok: false,
      });
    } finally {
      setBusy(null);
    }
  }

  async function askQuestion(qText: string) {
    if (!task || !qText.trim()) return;
    setAsking(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: qText.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not answer question");
      setQaHistory((prev) => [
        ...prev,
        { q: qText.trim(), answer: json.answer, source: json.source, model: json.model },
      ]);
      setQuestion("");
    } catch (err) {
      setBanner({
        text: err instanceof Error ? err.message : "Question failed",
        ok: false,
      });
    } finally {
      setAsking(false);
    }
  }

  async function submitDecision() {
    if (!task || !confirmDecision) return;
    setBusy("decision");
    setBanner(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: confirmDecision,
          reason: decisionReason,
          ...(isSimMode && simulateDecisionTimeout ? { simulateTimeout: true } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Settlement decision failed");
      setConfirmDecision(null);
      setDecisionReason("");
      setSimulateDecisionTimeout(false);
      const msg =
        confirmDecision === "accept"
          ? isSimMode
            ? `Simulated capture recorded (${json.captureId} · No money moved).`
            : `PayPal Capture verified (${json.captureId || json.paypalStatus}).`
          : confirmDecision === "reject"
          ? isSimMode
            ? `Simulated authorization voided (${json.authorizationId} · No money moved).`
            : `PayPal Authorization voided (${json.paypalStatus || "VOIDED"}).`
          : json.message || "Feedback sent to contractor.";
      setBanner({ text: msg, ok: true });
      await load();
    } catch (err) {
      setConfirmDecision(null);
      setSimulateDecisionTimeout(false);
      setBanner({
        text: err instanceof Error ? err.message : "Decision failed",
        ok: false,
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function reconcilePayment() {
    if (!task) return;
    setBusy("reconcile");
    setBanner(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/reconcile`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Reconcile failed");
      setBanner({ text: json.message || "Payment status reconciled.", ok: true });
      await load();
    } catch (err) {
      setBanner({
        text: err instanceof Error ? err.message : "Reconcile failed",
        ok: false,
      });
    } finally {
      setBusy(null);
    }
  }

  if (loading || !user || !config) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] p-8 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!task || !project) {
    return (
      <AppShell user={user} config={config}>
        <Card className="p-8 text-center">
          <p className="text-sm font-semibold text-[#17243A]">Task not found</p>
        </Card>
      </AppShell>
    );
  }

  const isSimMode = (task.payment.payment_mode || config.payment.mode) === "simulation";
  const orderRef = isSimMode ? task.payment.sim_intent_id : task.payment.paypal_order_id;
  const authRef = isSimMode
    ? task.payment.sim_authorization_id
    : task.payment.paypal_authorization_id;
  const captureRef = isSimMode ? task.payment.sim_capture_id : task.payment.paypal_capture_id;

  const before = task.evidence.find((e) => e.evidence_type === "before") || null;
  const after = task.evidence.find((e) => e.evidence_type === "after") || null;
  const activeReview =
    (selectedReviewVersion !== null
      ? task.reviews.find((r) => r.review_version === selectedReviewVersion)
      : null) ?? task.latest_review;
  const findings = activeReview?.structured_findings;
  const isSettled = ["CAPTURED", "VOIDED", "AUTHORIZATION_EXPIRED"].includes(
    task.payment_status
  );
  const canHomeownerDecide =
    user.role === "homeowner" &&
    ["EVIDENCE_SUBMITTED", "AI_REVIEWED", "CORRECTIONS_REQUESTED"].includes(
      task.work_status
    ) &&
    ["AUTHORIZED", "SETTLEMENT_PENDING", "PAYMENT_FAILED"].includes(task.payment_status);

  const canAuthorize =
    user.role === "homeowner" &&
    ["DRAFT", "ORDER_CREATED", "BUYER_APPROVAL_PENDING", "PAYMENT_FAILED"].includes(
      task.payment_status
    );

  const needsReconciliation = [
    "RECONCILIATION_REQUIRED",
    "CAPTURE_PENDING",
    "VOID_PENDING",
    "PAYMENT_FAILED",
  ].includes(task.payment_status);

  return (
    <AppShell user={user} config={config}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/projects/${project.id}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#17243A]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to {project.title}
          </Link>
          <div className="flex items-center gap-2">
            {(orderRef || authRef) && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy === "reconcile"}
                onClick={reconcilePayment}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${busy === "reconcile" ? "animate-spin" : ""}`}
                />
                {isSimMode ? "Reconcile Simulated Status" : "Reconcile with PayPal"}
              </Button>
            )}
          </div>
        </div>

        {banner && (
          <div
            role="status"
            className={`rounded-xl border px-4 py-3 text-xs ${
              banner.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {banner.text}
          </div>
        )}

        {/* Header & Payment Lifecycle */}
        <Card className="p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-slate-500">
                {project.title} · {project.location}
              </p>
              <h1 className="text-2xl font-bold text-[#17243A] mt-0.5">{task.title}</h1>
              <p className="mt-1 text-sm text-slate-600 max-w-2xl">{task.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <PaymentStatusBadge status={task.payment_status} />
                <WorkStatusBadge status={task.work_status} />
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                    isSimMode
                      ? "border-slate-300 bg-[#F7F8FA] text-slate-700"
                      : "border-blue-200 bg-blue-50 text-blue-800"
                  }`}
                >
                  {isSimMode ? "Simulation · No money moved" : "PayPal Sandbox"}
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="font-mono-code text-2xl font-bold text-[#17243A] tabular-nums">
                {formatMoney(task.amount_minor_units)}
              </p>
              <p className="text-xs text-slate-500">
                {isSimMode ? "Independent Simulated Hold" : "Independent PayPal Hold"}
              </p>
            </div>
          </div>

          <PaymentLifecycleTimeline payment={task.payment} />

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div className="rounded-lg border border-slate-200 bg-[#F7F8FA] p-3">
              <p className="text-slate-500">{isSimMode ? "Sim Intent ID" : "PayPal Order ID"}</p>
              <p className="mt-0.5 font-mono-code font-medium text-[#17243A] break-all">
                {orderRef || "—"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-[#F7F8FA] p-3">
              <p className="text-slate-500">{isSimMode ? "Sim Auth ID" : "Authorization ID"}</p>
              <p className="mt-0.5 font-mono-code font-medium text-[#17243A] break-all">
                {authRef || "—"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-[#F7F8FA] p-3">
              <p className="text-slate-500">{isSimMode ? "Sim Capture ID" : "Capture ID"}</p>
              <p className="mt-0.5 font-mono-code font-medium text-[#17243A] break-all">
                {captureRef || "—"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-[#F7F8FA] p-3">
              <p className="text-slate-500">Payee Merchant</p>
              <p className="mt-0.5 font-mono-code font-medium text-[#17243A] break-all">
                {task.payment.payee_merchant_id || "Pending order"}
              </p>
            </div>
          </div>

          {needsReconciliation && (orderRef || authRef) && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-950">
              <div className="flex items-start gap-2 max-w-xl">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    Payment Outcome Pending Verification ({task.payment_status})
                  </p>
                  <p className="mt-0.5 text-amber-900">
                    PunchPay parked this request instead of blindly retrying a payment mutation.
                    Reconcile state cleanly below.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy === "reconcile"}
                onClick={reconcilePayment}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${busy === "reconcile" ? "animate-spin" : ""}`}
                />
                Run Safe Reconcile
              </Button>
            </div>
          )}

          {canAuthorize && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-2">
              <p className="text-xs font-semibold text-[#17243A]">
                Step 1 · Authorize {formatMoney(task.amount_minor_units)} Hold (
                {isSimMode ? "Simulation" : "PayPal Sandbox"})
              </p>
              <PayPalButtonSlot
                paymentMode={task.payment.payment_mode || config.payment.mode}
                existingOrderId={orderRef}
                clientId={config.paypal.clientId}
                configured={config.paypal.configured}
                taskId={task.id}
                amountFormatted={formatMoney(task.amount_minor_units)}
                onStatusMessage={(text, ok) => setBanner({ text, ok })}
                onSuccess={load}
              />
            </div>
          )}
        </Card>

        {/* Two-Column Evidence Review Workspace */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Evidence & Comparison */}
          <div className="lg:col-span-6 space-y-5">
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-[#17243A]">
                  Submitted Photographic Evidence
                </h2>
                <span className="text-xs text-slate-500">
                  {task.evidence.length} file(s)
                </span>
              </div>

              <BeforeAfterCompare
                taskId={task.id}
                before={before}
                after={after}
                allEvidence={task.evidence}
                annotations={task.annotations}
                currentUserId={user.id}
                canAnnotate={!isSettled}
                onAnnotationChange={load}
              />

              {user.role === "contractor" && !isSettled && (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  {(["before", "after"] as const).map((stage) => (
                    <label
                      key={stage}
                      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-[#F7F8FA] p-3 text-center hover:border-[#2563EB] cursor-pointer"
                    >
                      <UploadCloud className="h-4 w-4 text-[#2563EB]" />
                      <span className="mt-1 text-xs font-medium capitalize text-slate-800">
                        Upload {stage}
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUpload(stage, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}

              {uploadPct !== null && (
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-[#2563EB] transition-all"
                    style={{ width: `${uploadPct}%` }}
                  />
                </div>
              )}

              {task.contractor_notes && (
                <div className="rounded-xl border border-slate-200 bg-[#F7F8FA] p-3 text-xs text-slate-700">
                  <strong>Contractor Notes:</strong> {task.contractor_notes}
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-[#F7F8FA] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Agreed Acceptance Criteria
                </p>
                <ul className="list-disc pl-4 text-xs text-slate-700 space-y-1">
                  {task.acceptance_criteria.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            </Card>
          </div>

          {/* Right: Structured Inspection, Ask Assistant & Homeowner Decision */}
          <div className="lg:col-span-6 space-y-5">
            <Card className="p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-[#17243A]">
                    Evidence Inspection
                  </h2>
                  <p className="text-xs text-slate-500">
                    AI assists review — homeowner holds final payment authority.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === "ai" || !before || !after || !config.ai.configured}
                  onClick={runAIReview}
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#2563EB]" />
                  {busy === "ai"
                    ? `Reviewing ${task.acceptance_criteria.length} criteria…`
                    : findings
                    ? "Re-run AI Inspection"
                    : "Run AI Inspection"}
                </Button>
              </div>

              {task.reviews.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-slate-500 font-medium">Version:</span>
                  {task.reviews.map((rev) => {
                    const active = activeReview?.review_version === rev.review_version;
                    return (
                      <button
                        key={rev.id}
                        type="button"
                        onClick={() => setSelectedReviewVersion(rev.review_version)}
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-mono-code cursor-pointer ${
                          active
                            ? "border-[#2563EB] bg-blue-50 text-blue-700 font-semibold"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        v{rev.review_version}
                      </button>
                    );
                  })}
                </div>
              )}

              {!config.ai.configured && (
                <div className="rounded-xl border border-slate-300 bg-[#F7F8FA] p-3 text-xs text-slate-700 space-y-1">
                  <p className="font-semibold text-[#17243A]">
                    Manual Checklist Inspection Mode (No AI Model Active)
                  </p>
                  <p>
                    {config.ai.ollama?.error
                      ? `${config.ai.ollama.error} — `
                      : "No local Ollama model or Gemini/Claude key connected — "}
                    inspect the Before and After photographs manually against each criterion below.
                    PunchPay never presents manual evaluation or canned text as AI inference.
                  </p>
                </div>
              )}

              {findings ? (
                <div className="space-y-4 text-xs">
                  {/* Section 6: Assessment */}
                  <div
                    className={`rounded-xl border p-4 space-y-1.5 ${
                      findings.overall_assessment === "appears_satisfied"
                        ? "border-emerald-200 bg-emerald-50/70 text-emerald-950"
                        : findings.overall_assessment === "concerns_identified"
                        ? "border-red-200 bg-red-50/70 text-red-950"
                        : "border-amber-200 bg-amber-50/70 text-amber-950"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wide">
                        {findings.overall_assessment === "appears_satisfied" ? (
                          <CheckCircle2 className="h-4 w-4 text-[#047857]" />
                        ) : findings.overall_assessment === "concerns_identified" ? (
                          <AlertTriangle className="h-4 w-4 text-[#B91C1C]" />
                        ) : (
                          <HelpCircle className="h-4 w-4 text-[#B45309]" />
                        )}
                        Assessment:{" "}
                        {findings.overall_assessment === "appears_satisfied"
                          ? "Appears satisfied"
                          : findings.overall_assessment === "concerns_identified"
                          ? "Visible concerns remain"
                          : "Insufficient evidence"}
                      </span>
                      <span className="font-mono-code text-[11px] opacity-80">
                        {activeReview?.provider} · {activeReview?.model} · v{activeReview?.review_version}
                      </span>
                    </div>
                    <p className="leading-relaxed">{findings.summary}</p>
                    <p className="text-[11px] font-medium">
                      Views comparable: <strong>{findings.views_comparable}</strong>
                    </p>
                  </div>

                  {/* What the photos show */}
                  <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                    <h3 className="font-semibold text-[#17243A] mb-1.5">
                      What the photos show
                    </h3>
                    <ul className="list-disc pl-4 space-y-1 text-slate-600">
                      {findings.visible_observations.map((o, i) => (
                        <li key={i}>{o}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Acceptance criteria */}
                  <div>
                    <h3 className="font-semibold text-[#17243A] mb-2">
                      Acceptance criteria
                    </h3>
                    <ul className="space-y-2">
                      {findings.criteria_checks.map((c, idx) => (
                        <li
                          key={idx}
                          className="rounded-lg border border-slate-200 bg-[#F7F8FA] p-3 flex items-start gap-2.5"
                        >
                          {c.status === "satisfied" ? (
                            <Check className="h-4 w-4 text-[#047857] shrink-0 mt-0.5" />
                          ) : c.status === "unmet" ? (
                            <XCircle className="h-4 w-4 text-[#B91C1C] shrink-0 mt-0.5" />
                          ) : (
                            <HelpCircle className="h-4 w-4 text-[#B45309] shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-semibold text-[#17243A]">{c.criterion}</p>
                              <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                {c.status === "satisfied"
                                  ? "Appears satisfied"
                                  : c.status === "unmet"
                                  ? "Visible concern"
                                  : "Cannot determine"}
                              </span>
                            </div>
                            <p className="text-slate-600 mt-1">{c.observation}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Limitations & Missing Evidence */}
                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3.5 space-y-1.5">
                    <h3 className="font-semibold text-amber-950">Limitations</h3>
                    <ul className="list-disc pl-4 space-y-0.5 text-amber-900">
                      {findings.limitations_and_uncertainty.map((u, i) => (
                        <li key={i}>{u}</li>
                      ))}
                      {findings.missing_evidence.map((m, i) => (
                        <li key={`m-${i}`}>Missing photo context: {m}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Suggested next step */}
                  <div className="rounded-lg border border-slate-200 bg-[#F7F8FA] p-3.5">
                    <h3 className="font-semibold text-[#17243A] mb-1">
                      Suggested next step
                    </h3>
                    <ul className="list-disc pl-4 text-slate-700 space-y-0.5">
                      {findings.recommended_next_steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-4 text-center border border-dashed border-slate-200 rounded-xl">
                  {before && after
                    ? config.ai.configured
                      ? "Before and after photographs are ready. Click 'Run AI Inspection' to evaluate criteria."
                      : "Before and after photographs are uploaded. Review them side-by-side / wipe on the left against each agreed criterion."
                    : "Waiting for contractor to upload both BEFORE and AFTER photographs."}
                </p>
              )}

              {/* Contextual Scoped Assistant: Ask about this inspection */}
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#17243A]">
                    <MessageSquare className="h-3.5 w-3.5 text-[#2563EB]" />
                    Ask about this inspection
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Scoped to this repair &amp; payment state
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED_QUESTIONS.map((qLabel) => (
                    <button
                      key={qLabel}
                      type="button"
                      disabled={asking}
                      onClick={() => askQuestion(qLabel)}
                      className="rounded-full border border-slate-200 bg-[#F7F8FA] px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50/60 cursor-pointer"
                    >
                      {qLabel}
                    </button>
                  ))}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    askQuestion(question);
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask about criteria, visible issues, next photo, or reject outcome..."
                    className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs text-[#17243A] placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
                  />
                  <Button type="submit" size="sm" variant="outline" disabled={asking || !question.trim()}>
                    <Send className="h-3.5 w-3.5" />
                    {asking ? "Checking..." : "Ask"}
                  </Button>
                </form>

                {qaHistory.length > 0 && (
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {qaHistory.map((item, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-slate-200 bg-[#F7F8FA] p-3 text-xs space-y-1"
                      >
                        <p className="font-semibold text-[#17243A]">Q: {item.q}</p>
                        <p className="text-slate-700 leading-relaxed">{item.answer}</p>
                        <p className="text-[11px] font-mono-code text-slate-500">
                          Source: {item.source.replaceAll("_", " ")}
                          {item.model ? ` (${item.model})` : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {/* Homeowner Settlement Decision */}
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-[#17243A]">
                  Homeowner Settlement Decision
                </h2>
                <ShieldCheck className="h-4 w-4 text-[#2563EB]" />
              </div>

              {task.payment_status === "CAPTURED" ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-1">
                  <p className="text-sm font-bold text-emerald-900">
                    Accepted · {formatMoney(task.amount_minor_units)} Captured{" "}
                    {isSimMode ? "(Simulation · No money moved)" : "via PayPal"}
                  </p>
                  <p className="font-mono-code text-xs text-emerald-800">
                    Capture Ref: {captureRef} · Status:{" "}
                    {task.payment.paypal_status || task.payment.sim_status}
                  </p>
                </div>
              ) : task.payment_status === "VOIDED" ? (
                <div className="rounded-xl border border-slate-300 bg-slate-100 p-4 space-y-1">
                  <p className="text-sm font-bold text-[#17243A]">
                    Rejected · {formatMoney(task.amount_minor_units)} Authorization Voided{" "}
                    {isSimMode ? "(Simulation · No money moved)" : ""}
                  </p>
                  <p className="font-mono-code text-xs text-slate-600">
                    Auth Ref: {authRef} · Status:{" "}
                    {task.payment.paypal_status || task.payment.sim_status} (Uncaptured hold
                    released)
                  </p>
                </div>
              ) : canHomeownerDecide ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <Button
                      variant="success"
                      size="lg"
                      onClick={() => setConfirmDecision("accept")}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Accept &amp; Capture {formatMoney(task.amount_minor_units)}
                    </Button>
                    <Button
                      variant="danger"
                      size="lg"
                      onClick={() => setConfirmDecision("reject")}
                    >
                      <XCircle className="h-4 w-4" />
                      Reject &amp; Void Hold
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmDecision("request_corrections")}
                    >
                      <MessageSquareWarning className="h-3.5 w-3.5" />
                      Request Corrections
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmDecision("request_evidence")}
                    >
                      Request Additional Evidence
                    </Button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Requesting corrections keeps the hold intact. Accepting executes{" "}
                    {isSimMode ? "simulated capture" : "PayPal capture"}; rejecting executes{" "}
                    {isSimMode ? "simulated authorization void" : "PayPal authorization void"}.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  {user.role === "contractor"
                    ? "Only the homeowner can accept, capture, reject, or void this payment."
                    : !authRef
                    ? "Authorize the hold first before settling."
                    : "Decision controls unlock once contractor uploads both before and after photos."}
                </p>
              )}

              {/* Audit Timeline */}
              <div className="border-t border-slate-100 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                  Audit &amp; Payment Events
                </h3>
                <ol className="space-y-2.5 border-l border-slate-200 pl-4">
                  {task.events.map((ev) => (
                    <li key={ev.id} className="relative text-xs">
                      <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-slate-400" />
                      <p className="font-medium text-slate-800">
                        {ev.event_type.replaceAll("_", " ")}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {ev.actor} · {formatDateTime(ev.created_at)}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <Modal
        open={Boolean(confirmDecision)}
        onClose={() => !busy && setConfirmDecision(null)}
        title={
          confirmDecision === "accept"
            ? isSimMode
              ? "Confirm Simulated Capture (No Money Moved)"
              : "Confirm PayPal Payment Capture"
            : confirmDecision === "reject"
            ? isSimMode
              ? "Confirm Simulated Authorization Void"
              : "Confirm PayPal Authorization Void"
            : "Send Feedback to Contractor"
        }
        description={
          confirmDecision === "accept"
            ? isSimMode
              ? `Records simulated capture of ${formatMoney(task.amount_minor_units)} against ${authRef} in SQLite. No real money moves.`
              : `You're about to capture ${formatMoney(task.amount_minor_units)} for ${task.title} using existing PayPal authorization ${authRef}.`
            : confirmDecision === "reject"
            ? isSimMode
              ? `Voids simulated authorization ${authRef} (${formatMoney(task.amount_minor_units)}) in SQLite. No charge occurred.`
              : `You're about to void the ${formatMoney(task.amount_minor_units)} authorization (${authRef}) for ${task.title}. Voiding cancels the uncaptured hold and does not claim a refund.`
            : "Your feedback will be recorded and visible to the contractor. The authorization stays open."
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Decision Note / Reason (optional)
            </label>
            <Textarea
              rows={3}
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
              placeholder={
                confirmDecision === "accept"
                  ? "Work satisfies all agreed criteria."
                  : "Describe what remains unresolved or needs correction..."
              }
            />
          </div>

          {isSimMode &&
            (confirmDecision === "accept" || confirmDecision === "reject") && (
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-[#F7F8FA] p-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={simulateDecisionTimeout}
                  onChange={(e) => setSimulateDecisionTimeout(e.target.checked)}
                />
                <span>
                  Simulate network timeout during settlement (parks into{" "}
                  <code>RECONCILIATION_REQUIRED</code> to test recovery)
                </span>
              </label>
            )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy === "decision"}
              onClick={() => setConfirmDecision(null)}
            >
              Cancel
            </Button>
            <Button
              variant={
                confirmDecision === "accept"
                  ? "success"
                  : confirmDecision === "reject"
                  ? "danger"
                  : "primary"
              }
              disabled={busy === "decision"}
              onClick={submitDecision}
            >
              {busy === "decision"
                ? isSimMode
                  ? "Recording Simulation..."
                  : "Verifying with PayPal..."
                : confirmDecision === "accept"
                ? `Capture ${formatMoney(task.amount_minor_units)}`
                : confirmDecision === "reject"
                ? "Void Authorization"
                : "Send to Contractor"}
            </Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
