"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Database, Sparkles } from "lucide-react";
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
      <div className="min-h-screen bg-slate-50 p-8 max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <AppShell user={user} config={config}>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Settings &amp; Sandbox Diagnostics
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Live status of database persistence, PayPal Sandbox API credentials, webhooks,
            and AI Vision provider configuration.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Database</span>
              <Database className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="text-sm font-bold text-slate-900 uppercase">
              {config.database.driver}
            </p>
            <p className="text-xs text-slate-500">
              {config.database.driver === "supabase"
                ? "Connected to Supabase PostgreSQL + private Storage"
                : "Active local SQLite (.data/punchpay.db) + private local image storage"}
            </p>
          </Card>

          <Card className="p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">PayPal Sandbox</span>
              {config.paypal.configured ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
            </div>
            <p className="text-sm font-bold text-slate-900">
              {config.paypal.configured ? "Configured" : "Not Configured"}
            </p>
            <p className="text-xs text-slate-500">
              Webhook: {config.paypal.webhookConfigured ? "Configured" : "Pending"} · Host:{" "}
              <code>api-m.sandbox.paypal.com</code>
            </p>
          </Card>

          <Card className="p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">AI Vision</span>
              {config.ai.configured ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
            </div>
            <p className="text-sm font-bold text-slate-900">
              {config.ai.configured
                ? `${config.ai.provider} (${config.ai.model})`
                : "Not Configured"}
            </p>
            <p className="text-xs text-slate-500">
              Supports Google Gemini or Anthropic Claude multimodal JSON inspection.
            </p>
          </Card>
        </div>

        <Card className="p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">
            Environment Variables (<code>.env.local</code>)
          </h2>
          <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 font-mono-code text-xs text-slate-200 leading-relaxed">
{`# PayPal Sandbox (Business Merchant + Personal Payer)
PAYPAL_CLIENT_ID=your_sandbox_rest_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_rest_secret
NEXT_PUBLIC_PAYPAL_CLIENT_ID=your_sandbox_rest_client_id
PAYPAL_MERCHANT_ID=contractor_sandbox_merchant_id
PAYPAL_WEBHOOK_ID=sandbox_webhook_id   # Endpoint: /api/webhooks/paypal

# App Origin & Session Security
NEXT_PUBLIC_APP_URL=http://localhost:3000
SESSION_SECRET=replace_with_32_byte_random_hex

# Multimodal AI Vision (set either Gemini OR Anthropic)
GEMINI_API_KEY=your_gemini_api_key
# ANTHROPIC_API_KEY=your_anthropic_api_key

# Optional Supabase (omit locally for SQLite; required for Vercel deploy)
# NEXT_PUBLIC_SUPABASE_URL=
# NEXT_PUBLIC_SUPABASE_ANON_KEY=
# SUPABASE_URL=
# SUPABASE_SERVICE_ROLE_KEY=`}
          </pre>

          {user.role === "homeowner" && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-600">
                Create the 3-minute hackathon Guided Demo project ($30 Painting + $20 Tile
                Repair).
              </p>
              <Button variant="primary" onClick={launchDemo} disabled={creatingDemo}>
                <Sparkles className="h-4 w-4" />
                {creatingDemo ? "Creating..." : "Create Guided Demo Project"}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
