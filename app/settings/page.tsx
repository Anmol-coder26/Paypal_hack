"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Cpu, CreditCard, Database, Sparkles } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, Skeleton } from "@/components/ui/primitives";
import type { Profile, SystemConfigStatus } from "@/lib/types";

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<Profile | null>(null);
  const [config, setConfig] = useState<SystemConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!json.user) {
          router.push("/login");
          return;
        }
        setUser(json.user);
        setConfig(json.config);
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function launchDemo() {
    setCreatingDemo(true);
    setError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guided_demo: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not create Guided Demo project");
      router.push(`/projects/${json.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create Guided Demo project");
      setCreatingDemo(false);
    }
  }

  if (loading || !user || !config) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] p-8 max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const ollama = config.ai.ollama;

  return (
    <AppShell user={user} config={config}>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#17243A]">
            Settings &amp; Environment Diagnostics
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Active payment mode, local Ollama / cloud AI vision readiness, and database driver.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Payment Mode</span>
              <CreditCard className="h-4 w-4 text-blue-600" />
            </div>
            <p className="text-sm font-bold text-[#17243A]">
              {config.payment.mode === "simulation" ? "Simulation Mode" : "PayPal Sandbox"}
            </p>
            <p className="text-xs text-slate-500">{config.payment.label}</p>
          </Card>

          <Card className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">PayPal API Keys</span>
              {config.paypal.configured ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
            </div>
            <p className="text-sm font-bold text-[#17243A]">
              {config.paypal.configured ? "Configured" : "Not Configured"}
            </p>
            <p className="text-xs text-slate-500">
              Webhook: {config.paypal.webhookConfigured ? "Configured" : "Pending"}
            </p>
          </Card>

          <Card className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">AI Vision</span>
              {config.ai.configured ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              ) : (
                <Cpu className="h-4 w-4 text-amber-600" />
              )}
            </div>
            <p className="text-sm font-bold text-[#17243A]">
              {config.ai.configured
                ? `${config.ai.provider} (${config.ai.model})`
                : "Manual Checklist"}
            </p>
            <p className="text-xs text-slate-500">
              {ollama?.error
                ? ollama.error
                : config.ai.configured
                ? "Active vision model ready for image inspection."
                : "Start Ollama (qwen2.5vl:3b) or set Gemini/Claude key."}
            </p>
          </Card>

          <Card className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Database</span>
              <Database className="h-4 w-4 text-emerald-700" />
            </div>
            <p className="text-sm font-bold text-[#17243A] uppercase">
              {config.database.driver}
            </p>
            <p className="text-xs text-slate-500">
              {config.database.driver === "supabase"
                ? "Supabase Postgres + Private Storage"
                : "Local SQLite (.data/punchpay.db)"}
            </p>
          </Card>
        </div>

        <Card className="p-6 space-y-4">
          <h2 className="text-base font-semibold text-[#17243A]">
            Local Configuration (<code>.env.local</code>)
          </h2>
          <pre className="overflow-x-auto rounded-xl bg-[#17243A] p-4 font-mono-code text-xs text-slate-100 leading-relaxed">
{`# Payment Mode: 'simulation' (no money moved) or 'paypal_sandbox'
PAYMENT_MODE=simulation

# Local Ollama Vision AI (requires >= 6-8 GB free RAM & ~3.2 GB disk for qwen2.5vl:3b)
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5vl:3b

# Optional Real PayPal Sandbox Credentials
PAYPAL_CLIENT_ID=your_sandbox_rest_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_rest_secret
NEXT_PUBLIC_PAYPAL_CLIENT_ID=your_sandbox_rest_client_id
PAYPAL_MERCHANT_ID=your_sandbox_business_merchant_id
PAYPAL_WEBHOOK_ID=optional_sandbox_webhook_id

# Application Session
NEXT_PUBLIC_APP_URL=http://localhost:3000
SESSION_SECRET=64_hex_char_random_secret`}
          </pre>
          {user.role === "homeowner" && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <p className="text-xs text-slate-600">
                Launch the guided Kitchen Renovation Closeout project ($30 Painting + $20 Tile Repair).
              </p>
              <Button variant="primary" onClick={launchDemo} disabled={creatingDemo}>
                <Sparkles className="h-4 w-4" />
                {creatingDemo ? "Launching..." : "Continue Guided Demo ($50)"}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
