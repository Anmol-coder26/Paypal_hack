"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/primitives";

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
  clientId,
  configured,
  taskId,
  amountFormatted,
  onSuccess,
  onStatusMessage,
}: {
  clientId: string | null;
  configured: boolean;
  taskId: string;
  amountFormatted: string;
  onSuccess: () => void;
  onStatusMessage?: (msg: string, ok: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "authorizing" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!configured || !clientId) return;
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
  }, [configured, clientId, taskId, amountFormatted, onSuccess, onStatusMessage]);

  if (!configured || !clientId) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-2">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
          <div>
            <p className="font-semibold">PayPal Sandbox Credentials Required</p>
            <p className="mt-1 text-amber-800">
              Add <code>PAYPAL_CLIENT_ID</code>, <code>PAYPAL_CLIENT_SECRET</code>, and{" "}
              <code>PAYPAL_MERCHANT_ID</code> to <code>.env.local</code> to render the live
              PayPal Sandbox authorization flow for {amountFormatted}. PunchPay never
              fabricates authorizations.
            </p>
          </div>
        </div>
        <Link href="/settings">
          <Button size="sm" variant="outline" className="mt-1">
            View PayPal Setup Guide
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
