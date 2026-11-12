"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import type { PaymentMode } from "@/lib/types";

declare global {
  interface Window {
    paypal?: {
      Buttons: (opts: {
        style?: Record<string, unknown>;
        createOrder: () => Promise<string>;
        onApprove: () => Promise<void>;
        onCancel?: () => void;
        onError?: (err: unknown) => void;
      }) => {
        render: (el: HTMLElement) => Promise<void>;
        close?: () => Promise<void>;
      };
    };
  }
}

let sdkLoader: Promise<NonNullable<Window["paypal"]>> | null = null;
let loadedClientId = "";

function loadPayPalSdk(clientId: string): Promise<NonNullable<Window["paypal"]>> {
  if (sdkLoader && loadedClientId === clientId) return sdkLoader;
  loadedClientId = clientId;
  sdkLoader = new Promise((resolve, reject) => {
    document.getElementById("punchpay-paypal-sdk")?.remove();
    const script = document.createElement("script");
    script.id = "punchpay-paypal-sdk";
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId
    )}&currency=USD&intent=authorize&components=buttons&disable-funding=card,credit,paylater,venmo`;
    script.async = true;
    script.onload = () =>
      window.paypal ? resolve(window.paypal) : reject(new Error("PayPal SDK failed to initialize"));
    script.onerror = () => {
      sdkLoader = null;
      reject(new Error("Could not load PayPal Sandbox SDK script"));
    };
    document.head.appendChild(script);
  });
  return sdkLoader;
}

export function PayPalButtonSlot({
  paymentMode = "paypal_sandbox",
  clientId,
  configured,
  taskId,
  taskTitle,
  contractorName,
  amountFormatted,
  existingOrderId,
  onSuccess,
  onCancel,
  onStatusMessage,
}: {
  paymentMode?: PaymentMode;
  clientId: string | null;
  configured: boolean;
  taskId: string;
  taskTitle?: string;
  contractorName?: string;
  amountFormatted: string;
  existingOrderId?: string | null;
  onSuccess: () => void;
  onCancel?: () => void;
  onStatusMessage?: (msg: string, ok: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "authorizing" | "error">("loading");
  const [message, setMessage] = useState("");
  const [simIntentId, setSimIntentId] = useState<string | null>(existingOrderId || null);
  const [simBusy, setSimBusy] = useState(false);

  useEffect(() => {
    setSimIntentId(existingOrderId || null);
  }, [existingOrderId]);

  useEffect(() => {
    if (paymentMode === "simulation" || !configured || !clientId) return;
    let active = true;
    let buttonsInstance: { close?: () => Promise<void> } | null = null;

    loadPayPalSdk(clientId)
      .then(async (pp) => {
        if (!active || !hostRef.current) return;
        const buttons = pp.Buttons({
          style: {
            layout: "vertical",
            color: "gold",
            shape: "rect",
            label: "paypal",
            height: 44,
            tagline: false,
          },
          createOrder: async () => {
            setMessage("");
            const res = await fetch(`/api/tasks/${taskId}/create-order`, {
              method: "POST",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.orderId) {
              throw new Error(json.error || `Create order failed (${res.status})`);
            }
            return String(json.orderId);
          },
          onApprove: async () => {
            setPhase("authorizing");
            setMessage("Buyer approved in PayPal. Authorizing hold on server...");
            try {
              const res = await fetch(`/api/tasks/${taskId}/authorize`, {
                method: "POST",
              });
              const json = await res.json().catch(() => ({}));
              if (!res.ok) {
                throw new Error(json.error || `Authorization failed (${res.status})`);
              }
              const msg = `Authorized ${amountFormatted} · PayPal Auth ID ${json.authorizationId}`;
              setMessage(msg);
              setPhase("ready");
              onStatusMessage?.(msg, true);
              onSuccess();
            } catch (err) {
              const msg = err instanceof Error ? err.message : "PayPal authorization failed";
              setPhase("error");
              setMessage(msg);
              onStatusMessage?.(msg, false);
            }
          },
          onCancel: () => {
            setMessage("PayPal checkout closed before approval. No funds were held.");
          },
          onError: (err) => {
            const msg =
              err instanceof Error ? err.message : "PayPal checkout encountered an error";
            setPhase("error");
            setMessage(msg);
            onStatusMessage?.(msg, false);
          },
        });
        buttonsInstance = buttons;
        await buttons.render(hostRef.current);
        if (active) setPhase("ready");
      })
      .catch((err) => {
        if (active) {
          setPhase("error");
          setMessage(err instanceof Error ? err.message : "Could not load PayPal SDK");
        }
      });

    return () => {
      active = false;
      buttonsInstance?.close?.().catch(() => null);
    };
  }, [paymentMode, configured, clientId, taskId, amountFormatted, onSuccess, onStatusMessage]);

  async function handleSimCreateIntent() {
    setSimBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/tasks/${taskId}/create-order`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.orderId) {
        throw new Error(json.error || "Could not create simulated payment intent.");
      }
      setSimIntentId(String(json.orderId));
      setMessage(`Simulated intent ${json.orderId} ready for buyer approval below.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Simulation intent failed";
      setMessage(msg);
      onStatusMessage?.(msg, false);
    } finally {
      setSimBusy(false);
    }
  }

  async function handleSimApprove(simulateTimeout = false) {
    setSimBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/tasks/${taskId}/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulateTimeout }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || "Simulated authorization failed");
      }
      const msg = `Simulated hold authorized (${amountFormatted} · ${json.authorizationId} · No money moved)`;
      setMessage(msg);
      onStatusMessage?.(msg, true);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Simulated authorization error";
      setMessage(msg);
      onStatusMessage?.(msg, false);
      onSuccess();
    } finally {
      setSimBusy(false);
    }
  }

  if (paymentMode === "simulation") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#17243A]">
            <ShieldCheck className="h-4 w-4 text-blue-600" />
            Demo environment · Payments simulated
          </span>
          <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            No funds moved
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-[#F7F8FA] p-3 text-[11px]">
          {taskTitle && (
            <div>
              <span className="text-slate-500">Repair Task:</span>{" "}
              <span className="font-semibold text-[#17243A]">{taskTitle}</span>
            </div>
          )}
          {contractorName && (
            <div>
              <span className="text-slate-500">Contractor:</span>{" "}
              <span className="font-semibold text-[#17243A]">{contractorName}</span>
            </div>
          )}
          <div>
            <span className="text-slate-500">Hold Amount:</span>{" "}
            <span className="font-mono-code font-semibold text-[#17243A]">{amountFormatted} USD</span>
          </div>
          <div>
            <span className="text-slate-500">Environment:</span>{" "}
            <span className="font-medium text-slate-700">Local Simulation</span>
          </div>
        </div>

        <p className="text-[11px] text-slate-600 leading-relaxed">
          <strong>What authorization means:</strong> Creates an isolated task-level hold without
          charging immediately. Funds remain uncaptured until you inspect the repair evidence and
          explicitly confirm Capture or Void.
        </p>

        {!simIntentId ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="primary"
              size="md"
              disabled={simBusy}
              onClick={handleSimCreateIntent}
            >
              {simBusy ? "Creating Demo Order..." : `Create ${amountFormatted} Demo Order`}
            </Button>
            {onCancel && (
              <Button variant="outline" size="md" disabled={simBusy} onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-[#F7F8FA] p-3 font-mono-code text-[11px] text-slate-700 space-y-1">
              <p>Demo Order: {simIntentId}</p>
              <p>Amount: {amountFormatted} USD · Status: BUYER_APPROVAL_PENDING</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="md"
                disabled={simBusy}
                onClick={() => handleSimApprove(false)}
              >
                {simBusy ? "Authorizing Hold..." : `Confirm Buyer Approval (${amountFormatted} Hold)`}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={simBusy}
                onClick={() => handleSimApprove(true)}
              >
                Simulate Timeout (Test Reconcile)
              </Button>
              {onCancel && (
                <Button variant="ghost" size="sm" disabled={simBusy} onClick={onCancel}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}

        {message && (
          <div className="rounded-lg border border-slate-200 bg-[#F7F8FA] px-3 py-2 text-xs text-slate-700">
            {message}
          </div>
        )}
      </div>
    );
  }

  if (!configured || !clientId) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-2">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
          <div>
            <p className="font-semibold">PayPal Sandbox Credentials Required</p>
            <p className="mt-1 text-amber-800">
              <code>PAYMENT_MODE=paypal_sandbox</code> is selected, so add{" "}
              <code>PAYPAL_CLIENT_ID</code>, <code>PAYPAL_CLIENT_SECRET</code>, and{" "}
              <code>PAYPAL_MERCHANT_ID</code> to <code>.env.local</code> (or unset{" "}
              <code>PAYMENT_MODE</code> / set <code>PAYMENT_MODE=simulation</code> for offline testing).
            </p>
          </div>
        </div>
        <Link href="/settings">
          <Button size="sm" variant="outline" className="mt-1">
            View Setup Guide
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {phase === "loading" && (
        <div className="h-11 w-full animate-pulse rounded-lg bg-slate-200" />
      )}
      <div ref={hostRef} className="min-h-[44px]" />
      {phase === "authorizing" && (
        <div className="flex items-center gap-2 text-xs text-blue-700">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          <span>{message}</span>
        </div>
      )}
      {message && phase !== "authorizing" && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            phase === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {phase === "error" ? (
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}
