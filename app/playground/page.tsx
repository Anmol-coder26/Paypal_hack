"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  XCircle,
  Zap,
} from "lucide-react";
import { Button, Card, PaymentStatusBadge } from "@/components/ui/primitives";
import {
  assertPaymentTransition,
  formatMinorUnits,
} from "@/lib/payments/state-machine";
import type { PaymentStatus } from "@/lib/types";

interface SimTask {
  id: string;
  title: string;
  amountCents: number;
  status: PaymentStatus;
  orderId: string | null;
  authId: string | null;
  captureId: string | null;
  payee: string | null;
  evidenceUploaded: boolean;
  aiVerdict: string | null;
}

interface HttpTrace {
  id: string;
  ts: string;
  method: "POST" | "GET";
  path: string;
  requestId?: string;
  httpStatus: number | "TIMEOUT";
  summary: string;
  payload: unknown;
}

const INITIAL_TASKS: SimTask[] = [
  {
    id: "sim-paint",
    title: "Painting (North Wall)",
    amountCents: 3000,
    status: "DRAFT",
    orderId: null,
    authId: null,
    captureId: null,
    payee: null,
    evidenceUploaded: false,
    aiVerdict: null,
  },
  {
    id: "sim-tile",
    title: "Tile Repair (Kitchen Backsplash)",
    amountCents: 2000,
    status: "DRAFT",
    orderId: null,
    authId: null,
    captureId: null,
    payee: null,
    evidenceUploaded: false,
    aiVerdict: null,
  },
];

export default function PayPalFaultLabPage() {
  const [tasks, setTasks] = useState<SimTask[]>(INITIAL_TASKS);
  const [traces, setTraces] = useState<HttpTrace[]>([]);
  const [injectTimeout, setInjectTimeout] = useState(false);
  const [injectWrongPayee, setInjectWrongPayee] = useState(false);
  const [idempotencySeen, setIdempotencySeen] = useState<Record<string, boolean>>({});
  const [paypalLedger, setPaypalLedger] = useState<
    Array<{ kind: string; amount: string; id: string; status: string }>
  >([]);
  const [notice, setNotice] = useState<string>("");

  function logTrace(trace: Omit<HttpTrace, "id" | "ts">) {
    setTraces((prev) => [
      {
        ...trace,
        id: `${Date.now()}-${Math.random()}`,
        ts: new Date().toLocaleTimeString(),
      },
      ...prev,
    ]);
  }

  function resetLab() {
    setTasks(INITIAL_TASKS);
    setTraces([]);
    setIdempotencySeen({});
    setPaypalLedger([]);
    setNotice("Lab reset. Ready to test a fresh payment & failure sequence.");
  }

  function stepAuthorize(taskId: string) {
    setNotice("");
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const orderId = `SIM-ORD-${t.id.toUpperCase()}-1`;
        if (injectWrongPayee) {
          logTrace({
            method: "POST",
            path: "/v2/checkout/orders",
            requestId: `punchpay-order-${t.id}-1`,
            httpStatus: 201,
            summary: "VerificationError: Payee merchant mismatch halted before approval",
            payload: {
              id: orderId,
              intent: "AUTHORIZE",
              purchase_units: [
                {
                  amount: { currency_code: "USD", value: (t.amountCents / 100).toFixed(2) },
                  payee: { merchant_id: "UNKNOWN_ROGUE_MERCHANT" },
                },
              ],
            },
          });
          setNotice(
            `Blocked ${t.title}: PayPal returned payee UNKNOWN_ROGUE_MERCHANT instead of CONTRACTOR_MERCHANT_ID.`
          );
          return t;
        }

        assertPaymentTransition(t.status, "BUYER_APPROVAL_PENDING");
        assertPaymentTransition("BUYER_APPROVAL_PENDING", "AUTHORIZED");
        const authId = `SIM-AUTH-${t.id === "sim-paint" ? "PAINT30" : "TILE20"}`;
        logTrace({
          method: "POST",
          path: `/v2/checkout/orders/${orderId}/authorize`,
          requestId: `punchpay-authorize-${orderId}`,
          httpStatus: 201,
          summary: `Authorized ${formatMinorUnits(t.amountCents)} hold for contractor merchant`,
          payload: {
            order_id: orderId,
            authorization: {
              id: authId,
              status: "CREATED",
              amount: { currency_code: "USD", value: (t.amountCents / 100).toFixed(2) },
              payee: { merchant_id: "CONTRACTOR_MERCHANT_ID" },
            },
          },
        });
        return {
          ...t,
          status: "AUTHORIZED",
          orderId,
          authId,
          payee: "CONTRACTOR_MERCHANT_ID",
        };
      })
    );
  }

  function stepEvidenceAndAI(taskId: string) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              evidenceUploaded: true,
              aiVerdict:
                t.id === "sim-paint"
                  ? "appears_satisfied (3/3 criteria visible)"
                  : "concerns_identified (tile misaligned + grout gap)",
            }
          : t
      )
    );
    setNotice("Simulated evidence attached and advisory report loaded for lab walkthrough.");
  }

  function stepCaptureOrVoid(taskId: string, action: "capture" | "void") {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !task.authId) return;

    const reqId = `punchpay-${action}-${task.authId}`;
    if (task.status === "CAPTURED" || task.status === "VOIDED") {
      setNotice(
        `Idempotency guard blocked duplicate ${action.toUpperCase()} for ${task.title} (${reqId}). Zero extra PayPal calls sent.`
      );
      return;
    }

    if (action === "capture" && injectTimeout) {
      assertPaymentTransition(task.status, "CAPTURE_PENDING");
      assertPaymentTransition("CAPTURE_PENDING", "RECONCILIATION_REQUIRED");
      const capId = `SIM-CAP-${task.id.toUpperCase()}`;
      setPaypalLedger((l) => [
        ...l,
        {
          kind: "CAPTURE",
          amount: formatMinorUnits(task.amountCents),
          id: capId,
          status: "COMPLETED (response lost in transit)",
        },
      ]);
      setIdempotencySeen((m) => ({ ...m, [reqId]: true }));
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: "RECONCILIATION_REQUIRED", captureId: null }
            : t
        )
      );
      logTrace({
        method: "POST",
        path: `/v2/payments/authorizations/${task.authId}/capture`,
        requestId: reqId,
        httpStatus: "TIMEOUT",
        summary:
          "Response lost after PayPal processed capture -> parked in RECONCILIATION_REQUIRED",
        payload: {
          error: "AbortError: HTTP timeout after 15000ms",
          idempotency_key: reqId,
        },
      });
      setInjectTimeout(false);
      setNotice(
        "Fault triggered: PayPal actually captured the $30, but the response dropped. PunchPay parked it in RECONCILIATION_REQUIRED instead of retrying blindly. Click 'GET Reconcile' next!"
      );
      return;
    }

    if (action === "capture") {
      assertPaymentTransition(task.status, "CAPTURE_PENDING");
      assertPaymentTransition("CAPTURE_PENDING", "CAPTURED");
      const capId = `SIM-CAP-${task.id.toUpperCase()}`;
      if (!idempotencySeen[reqId]) {
        setPaypalLedger((l) => [
          ...l,
          {
            kind: "CAPTURE",
            amount: formatMinorUnits(task.amountCents),
            id: capId,
            status: "COMPLETED",
          },
        ]);
      }
      setIdempotencySeen((m) => ({ ...m, [reqId]: true }));
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: "CAPTURED", captureId: capId } : t
        )
      );
      logTrace({
        method: "POST",
        path: `/v2/payments/authorizations/${task.authId}/capture`,
        requestId: reqId,
        httpStatus: 201,
        summary: `Captured ${formatMinorUnits(task.amountCents)} -> Verified via GET`,
        payload: { id: capId, status: "COMPLETED", final_capture: true },
      });
    } else {
      assertPaymentTransition(task.status, "VOID_PENDING");
      assertPaymentTransition("VOID_PENDING", "VOIDED");
      setPaypalLedger((l) => [
        ...l,
        {
          kind: "VOID",
          amount: formatMinorUnits(task.amountCents),
          id: task.authId!,
          status: "VOIDED",
        },
      ]);
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: "VOIDED" } : t))
      );
      logTrace({
        method: "POST",
        path: `/v2/payments/authorizations/${task.authId}/void`,
        requestId: reqId,
        httpStatus: 204,
        summary: `Voided ${formatMinorUnits(task.amountCents)} hold -> Verified VOIDED`,
        payload: { authorization_id: task.authId, status: "VOIDED" },
      });
    }
  }

  function stepReconcile(taskId: string) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !task.authId) return;
    const capId = `SIM-CAP-${task.id.toUpperCase()}`;
    assertPaymentTransition(task.status, "CAPTURED");
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, status: "CAPTURED", captureId: capId } : t
      )
    );
    logTrace({
      method: "GET",
      path: `/v2/checkout/orders/${task.orderId}`,
      httpStatus: 200,
      summary: "GET-only Reconcile discovered existing COMPLETED capture; zero money moved",
      payload: {
        order_id: task.orderId,
        discovered_capture: { id: capId, status: "COMPLETED", amount: "30.00" },
      },
    });
    setNotice(
      `Reconcile recovered existing capture ${capId} via GET without sending another capture request. PayPal ledger remains at 1 capture!`
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-center text-xs font-medium text-amber-950">
        <span className="inline-flex items-center gap-1.5 font-bold">
          <FlaskConical className="h-3.5 w-3.5" />
          SIMULATED PAYPAL FAULT-INJECTION &amp; IDEMPOTENCY LAB · NOT LIVE MONEY
        </span>{" "}
        — Separate interactive simulator demonstrating PunchPay&apos;s real state machine,
        payee checks, network-drop reconciliation, and idempotency guards.
      </div>

      <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Live PunchPay App
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">
              PayPal Settlement &amp; Fault-Recovery Lab
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Inject real fintech failure modes (dropped responses, double-clicks, wrong payee
              merchant) and inspect the resulting PayPal v2 wire log.
            </p>
          </div>

          <Button variant="outline" onClick={resetLab}>
            <RotateCcw className="h-4 w-4" />
            Reset Simulation
          </Button>
        </div>

        {/* Fault Injection Controls */}
        <Card className="p-4 flex flex-wrap items-center justify-between gap-4 bg-slate-900 text-white border-slate-800">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-amber-300">
              <Zap className="h-4 w-4" />
              Fault Toggles:
            </span>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={injectTimeout}
                onChange={(e) => setInjectTimeout(e.target.checked)}
                className="accent-amber-400"
              />
              Drop HTTP response after next Capture
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={injectWrongPayee}
                onChange={(e) => setInjectWrongPayee(e.target.checked)}
                className="accent-red-400"
              />
              Inject Rogue Payee Merchant ID on Create Order
            </label>
          </div>
          <span className="font-mono-code text-[11px] text-slate-400">
            Engine: lib/payments/state-machine.ts
          </span>
        </Card>

        {notice && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-950 flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <span>{notice}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Task Interactive Stepper */}
          <div className="lg:col-span-7 space-y-4">
            {tasks.map((t) => (
              <Card key={t.id} className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">{t.title}</h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <PaymentStatusBadge status={t.status} />
                      {t.aiVerdict && (
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                          {t.aiVerdict}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="font-mono-code text-lg font-bold text-slate-900">
                    {formatMinorUnits(t.amountCents)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 font-mono-code text-[11px] text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <div>Order: {t.orderId || "—"}</div>
                  <div>Auth: {t.authId || "—"}</div>
                  <div>Capture: {t.captureId || "—"}</div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={t.status !== "DRAFT"}
                    onClick={() => stepAuthorize(t.id)}
                  >
                    <Play className="h-3.5 w-3.5" />
                    1. Authorize Hold
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={t.status === "DRAFT" || t.evidenceUploaded}
                    onClick={() => stepEvidenceAndAI(t.id)}
                  >
                    2. Submit Photos + AI
                  </Button>
                  {t.status === "RECONCILIATION_REQUIRED" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => stepReconcile(t.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      GET Reconcile Status
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="success"
                        disabled={
                          !t.evidenceUploaded ||
                          (t.status !== "AUTHORIZED" && t.status !== "CAPTURED")
                        }
                        onClick={() => stepCaptureOrVoid(t.id, "capture")}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t.status === "CAPTURED" ? "Test Double-Click Accept" : "3a. Capture"}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={!t.evidenceUploaded || t.status !== "AUTHORIZED"}
                        onClick={() => stepCaptureOrVoid(t.id, "void")}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        3b. Void Hold
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            ))}

            {/* Simulated PayPal Ground-Truth Ledger */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Simulated PayPal Ground-Truth Ledger
                </h3>
                <span className="text-xs text-slate-500">
                  {paypalLedger.filter((x) => x.kind === "CAPTURE").length} capture(s) ·{" "}
                  {paypalLedger.filter((x) => x.kind === "VOID").length} void(s)
                </span>
              </div>
              {paypalLedger.length === 0 ? (
                <p className="text-xs text-slate-500">No simulated money movements yet.</p>
              ) : (
                <ul className="space-y-1.5 text-xs font-mono-code">
                  {paypalLedger.map((row, idx) => (
                    <li
                      key={idx}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <span>
                        <strong>{row.kind}</strong> {row.amount} ({row.id})
                      </span>
                      <span className="text-emerald-700">{row.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Wire Inspector */}
          <div className="lg:col-span-5">
            <Card className="bg-slate-950 text-slate-100 border-slate-800 p-5 space-y-4 h-full">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-blue-300">
                  <Terminal className="h-4 w-4" />
                  PayPal Sandbox Wire Trace
                </span>
                <span className="text-[11px] text-slate-400">{traces.length} call(s)</span>
              </div>
              {traces.length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center">
                  Click &ldquo;1. Authorize Hold&rdquo; on a repair task to watch PayPal
                  Orders v2 and Payments v2 payloads in real time.
                </p>
              ) : (
                <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                  {traces.map((tr) => (
                    <div
                      key={tr.id}
                      className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 font-mono-code">
                        <span className="text-blue-300 font-semibold">
                          {tr.method} {tr.path}
                        </span>
                        <span
                          className={
                            tr.httpStatus === "TIMEOUT"
                              ? "text-amber-400 font-bold"
                              : "text-emerald-400"
                          }
                        >
                          {tr.httpStatus}
                        </span>
                      </div>
                      {tr.requestId && (
                        <p className="font-mono-code text-[10px] text-slate-400">
                          PayPal-Request-Id: {tr.requestId}
                        </p>
                      )}
                      <p className="text-slate-200">{tr.summary}</p>
                      <pre className="overflow-x-auto rounded bg-black/40 p-2 font-mono-code text-[10px] text-slate-300">
                        {JSON.stringify(tr.payload, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
