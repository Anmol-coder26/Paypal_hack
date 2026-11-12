"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  CreditCard,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, Skeleton } from "@/components/ui/primitives";
import type { GeminiConfigMetadata, Profile, SystemConfigStatus } from "@/lib/types";

type StatusKind = "success" | "invalid_key" | "quota" | "error";

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<Profile | null>(null);
  const [config, setConfig] = useState<SystemConfigStatus | null>(null);
  const [geminiMeta, setGeminiMeta] = useState<GeminiConfigMetadata | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);

  // Admin credential form state (kept strictly in transient component state; never persisted in localStorage)
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gemini-3.5-flash");
  const [replaceMode, setReplaceMode] = useState(false);

  const [aiBusy, setAiBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [aiBanner, setAiBanner] = useState<{ kind: StatusKind; text: string } | null>(null);

  const [creatingDemo, setCreatingDemo] = useState(false);
  const [error, setError] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      const [meRes, aiRes] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }),
        fetch("/api/settings/ai", { cache: "no-store" }),
      ]);
      const meJson = await meRes.json();
      if (!meJson.user) {
        router.push("/login");
        return;
      }
      setUser(meJson.user);
      setConfig(meJson.config);
      if (aiRes.ok) {
        const aiJson = await aiRes.json();
        setCanManage(Boolean(aiJson.canManage));
        setGeminiMeta(aiJson.gemini);
        if (aiJson.gemini?.model) {
          const supported = aiJson.gemini.supportedModels || ["gemini-3.5-flash"];
          setSelectedModel(
            supported.includes(aiJson.gemini.model) ? aiJson.gemini.model : supported[0]
          );
        }
        if (aiJson.config) setConfig(aiJson.config);
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function saveApiKey() {
    setAiBusy("save");
    setAiBanner(null);
    try {
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {}),
          model: selectedModel,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAiBanner({
          kind: res.status === 403 ? "error" : "invalid_key",
          text: json.error || "Could not save Gemini API key.",
        });
        return;
      }
      setApiKeyInput("");
      setShowKey(false);
      setReplaceMode(false);
      setGeminiMeta(json.gemini);
      if (json.config) setConfig(json.config);
      setAiBanner({
        kind: "success",
        text: json.message || "Gemini API key encrypted and saved server-side.",
      });
    } catch {
      setAiBanner({
        kind: "error",
        text: "Network error communicating with backend settings endpoint.",
      });
    } finally {
      setAiBusy(null);
    }
  }

  async function testConnection() {
    setAiBusy("test");
    setAiBanner(null);
    try {
      const res = await fetch("/api/settings/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {}),
          model: selectedModel,
        }),
      });
      const json = await res.json();
      if (json.config) setConfig(json.config);
      if (json.ok) {
        setAiBanner({
          kind: "success",
          text: `${json.message} (${json.latencyMs}ms)`,
        });
      } else if (json.code === "daily_quota_exhausted" || json.code === "rate_limited") {
        setAiBanner({
          kind: "quota",
          text: json.message || "Gemini free-tier quota exceeded or rate-limited.",
        });
      } else if (json.code === "invalid_api_key" || json.code === "permission_denied") {
        setAiBanner({
          kind: "invalid_key",
          text: json.message || "Invalid or unauthorized Gemini API key.",
        });
      } else {
        setAiBanner({
          kind: "error",
          text: json.message || "Connection test failed.",
        });
      }
    } catch {
      setAiBanner({
        kind: "error",
        text: "Connection error testing Gemini API.",
      });
    } finally {
      setAiBusy(null);
    }
  }

  async function removeStoredKey() {
    setAiBusy("remove");
    setAiBanner(null);
    try {
      const res = await fetch("/api/settings/ai", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        setAiBanner({ kind: "error", text: json.error || "Could not remove stored key." });
        return;
      }
      setApiKeyInput("");
      setReplaceMode(false);
      setGeminiMeta(json.gemini);
      if (json.config) setConfig(json.config);
      setAiBanner({ kind: "success", text: json.message || "Removed stored API key." });
    } catch {
      setAiBanner({ kind: "error", text: "Network error removing stored key." });
    } finally {
      setAiBusy(null);
    }
  }

  async function switchDemoToAdmin() {
    setAiBusy("save");
    try {
      await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "demo", role: "admin" }),
      });
      await loadSettings();
      router.refresh();
    } finally {
      setAiBusy(null);
    }
  }

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
  const g = geminiMeta ?? config.ai.gemini;
  const supportedModels = g?.supportedModels ?? [
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
  ];
  const hasVaultKey = g?.source === "admin_vault";
  const hasEnvKey = g?.source === "environment";
  const showKeyInput = !hasVaultKey || replaceMode;

  return (
    <AppShell user={user} config={config}>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#17243A]">
            Settings &amp; Environment Diagnostics
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Configure Gemini Vision credentials, verify PayPal / simulation mode, and inspect
            automatic fallback readiness.
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
              <span className="text-xs font-semibold text-slate-700">Active AI Mode</span>
              {config.ai.activeTier === "gemini_live" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              ) : config.ai.activeTier === "prepared_demo" ? (
                <Cpu className="h-4 w-4 text-[#2563EB]" />
              ) : config.ai.configured ? (
                <CheckCircle2 className="h-4 w-4 text-blue-600" />
              ) : (
                <Cpu className="h-4 w-4 text-amber-600" />
              )}
            </div>
            <p className="text-sm font-bold text-[#17243A]">
              {config.ai.activeTier === "prepared_demo"
                ? "Prepared Demo + Guided"
                : config.ai.activeTier === "gemini_live"
                ? `Gemini (${config.ai.model})`
                : config.ai.configured
                ? `${config.ai.provider} (${config.ai.model})`
                : "Guided Review"}
            </p>
            <p className="text-xs text-slate-500">
              {config.ai.activeTier === "prepared_demo"
                ? "Mode C · Sample inspection + Checklist (0 API calls)"
                : config.ai.activeTier === "gemini_live"
                ? "Mode A · Live Multimodal Vision"
                : config.ai.activeTier === "ollama_local"
                ? "Mode B · Local Ollama Fallback"
                : "Manual / Guided Checklist"}
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

        {/* AI Configuration Card */}
        <Card className="p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-[#2563EB]" />
                <h2 className="text-base font-semibold text-[#17243A]">AI &amp; Demo Inspection Status</h2>
              </div>
              <p className="text-xs text-slate-500">
                Supports Mode A (Gemini Live), Mode B (Local Ollama), and Mode C (Prepared Demo +
                Guided Review).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {config.ai.activeTier === "prepared_demo" && (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-semibold text-blue-800">
                  Demo Mode Active (AI_PROVIDER=demo)
                </span>
              )}
              <span
                className={`rounded-full border px-2.5 py-1 font-semibold ${
                  g?.configured
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                {g?.configured
                  ? g.source === "admin_vault"
                    ? "Gemini Configured (Encrypted Vault)"
                    : "Gemini Configured (Environment)"
                  : "Gemini Key Not Configured"}
              </span>
              {g?.cooldownActive && (
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">
                  Quota Cooldown Active
                </span>
              )}
            </div>
          </div>

          {/* 3-Mode Readiness Grid */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 text-xs">
            <div
              className={`rounded-xl border p-3 ${
                config.ai.activeTier === "gemini_live"
                  ? "border-emerald-200 bg-emerald-50/70"
                  : "border-slate-200 bg-[#F7F8FA]"
              }`}
            >
              <p className="font-semibold text-[#17243A]">Mode A · Gemini Live Vision</p>
              <p className="mt-0.5 text-slate-600">
                {config.ai.activeTier === "prepared_demo"
                  ? "Standby (paused while AI_PROVIDER=demo)"
                  : g?.configured
                  ? `Active (${g.model})`
                  : "Unavailable (no API key configured)"}
              </p>
            </div>
            <div
              className={`rounded-xl border p-3 ${
                config.ai.activeTier === "ollama_local"
                  ? "border-blue-200 bg-blue-50/70"
                  : "border-slate-200 bg-[#F7F8FA]"
              }`}
            >
              <p className="font-semibold text-[#17243A]">Mode B · Local AI (Ollama)</p>
              <p className="mt-0.5 text-slate-600">
                {ollama?.reachable && ollama?.modelAvailable
                  ? config.ai.activeTier === "prepared_demo"
                    ? `Standby (${ollama.model})`
                    : `Active (${ollama.model})`
                  : ollama?.error || "Unavailable (not reachable locally)"}
              </p>
            </div>
            <div
              className={`rounded-xl border p-3 ${
                config.ai.activeTier === "prepared_demo" || config.ai.activeTier === "guided_fallback"
                  ? "border-blue-200 bg-blue-50/70"
                  : "border-slate-200 bg-[#F7F8FA]"
              }`}
            >
              <p className="font-semibold text-[#17243A]">Mode C · Prepared Demo &amp; Guided</p>
              <p className="mt-0.5 text-slate-600">
                {config.ai.activeTier === "prepared_demo"
                  ? "Active · 6 prepared sample cases + Guided checklist"
                  : "Always available · Honest homeowner checklist"}
              </p>
            </div>
          </div>

          {aiBanner && (
            <div
              role="status"
              className={`rounded-xl border px-4 py-3 text-xs font-medium ${
                aiBanner.kind === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : aiBanner.kind === "quota"
                  ? "border-amber-300 bg-amber-50 text-amber-950"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {aiBanner.text}
            </div>
          )}

          {!canManage ? (
            <div className="rounded-xl border border-slate-200 bg-[#F7F8FA] p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-xs text-slate-700 max-w-xl">
                <ShieldAlert className="h-4 w-4 text-slate-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-[#17243A]">
                    Administrator access required to manage AI credentials
                  </p>
                  <p className="mt-0.5 text-slate-600">
                    For security, homeowners and contractors can never view, enter, or replace the
                    shared Gemini API key. Current status:{" "}
                    <strong>{g?.configured ? `Configured (${g.model})` : "Not configured"}</strong>.
                  </p>
                </div>
              </div>
              {user.email.endsWith("@punchpay.demo") && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={aiBusy !== null}
                  onClick={switchDemoToAdmin}
                >
                  Sign in as Demo Administrator
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="gemini-model-select"
                    className="block text-xs font-semibold text-[#17243A] mb-1.5"
                  >
                    Gemini Vision Model
                  </label>
                  <select
                    id="gemini-model-select"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#17243A] focus:border-[#2563EB] focus:outline-none"
                  >
                    {supportedModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                        {m === "gemini-3.5-flash" ? " (Recommended)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-lg border border-slate-200 bg-[#F7F8FA] px-3.5 py-2.5 text-xs">
                  <p className="font-semibold text-[#17243A]">Credential Storage Status</p>
                  <p className="mt-0.5 text-slate-600">
                    {hasVaultKey
                      ? `Encrypted in server vault (${g?.updatedAt ? new Date(g.updatedAt).toLocaleString() : "saved"}). Never returned to browser.`
                      : hasEnvKey
                      ? "Loaded from server environment variable (.env.local). Saving a key here overrides it without modifying .env.local."
                      : "No Gemini API key stored yet."}
                  </p>
                </div>
              </div>

              {showKeyInput ? (
                <div>
                  <label
                    htmlFor="gemini-api-key"
                    className="block text-xs font-semibold text-[#17243A] mb-1.5"
                  >
                    Gemini API Key
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        id="gemini-api-key"
                        type={showKey ? "text" : "password"}
                        autoComplete="off"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder={
                          replaceMode
                            ? "Paste replacement Gemini API key (AIza...)"
                            : "Paste Google AI Studio Gemini API key (AIza...)"
                        }
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-3 pr-20 font-mono-code text-sm text-[#17243A] placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey((v) => !v)}
                        aria-label={showKey ? "Hide API key" : "Show API key"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer"
                      >
                        {showKey ? (
                          <>
                            <EyeOff className="h-3.5 w-3.5" />
                            <span>Hide</span>
                          </>
                        ) : (
                          <>
                            <Eye className="h-3.5 w-3.5" />
                            <span>Show</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                {showKeyInput && (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={aiBusy !== null || !apiKeyInput.trim()}
                    onClick={saveApiKey}
                  >
                    {aiBusy === "save" ? "Encrypting & Saving..." : "Save API Key"}
                  </Button>
                )}

                {hasVaultKey && !replaceMode && (
                  <>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={aiBusy !== null}
                      onClick={() => {
                        setReplaceMode(true);
                        setApiKeyInput("");
                        setAiBanner(null);
                      }}
                    >
                      Replace Key
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={aiBusy !== null}
                      onClick={saveApiKey}
                    >
                      {aiBusy === "save" ? "Saving Model..." : "Save Model Selection"}
                    </Button>
                  </>
                )}

                {replaceMode && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={aiBusy !== null}
                    onClick={() => {
                      setReplaceMode(false);
                      setApiKeyInput("");
                    }}
                  >
                    Cancel Replace
                  </Button>
                )}

                <Button
                  type="button"
                  variant="outline"
                  disabled={aiBusy !== null || (!g?.configured && !apiKeyInput.trim())}
                  onClick={testConnection}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${aiBusy === "test" ? "animate-spin" : ""}`} />
                  {aiBusy === "test" ? "Testing Gemini Vision..." : "Test Connection"}
                </Button>

                {hasVaultKey && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={aiBusy !== null}
                    onClick={removeStoredKey}
                    className="border-red-200 text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {aiBusy === "remove" ? "Removing..." : "Remove Key"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-6 space-y-4">
          <h2 className="text-base font-semibold text-[#17243A]">
            Optional Server Environment Reference (<code>.env.local</code>)
          </h2>
          <pre className="overflow-x-auto rounded-xl bg-[#17243A] p-4 font-mono-code text-xs text-slate-100 leading-relaxed">
{`# Interactive Demo Environment (no external PayPal or Gemini credentials required)
PUNCHPAY_DEMO_MODE=true
PAYMENT_MODE=simulation
AI_PROVIDER=demo

# Optional Live Providers (for future Sandbox / Vision activation)
# PAYPAL_CLIENT_ID=...
# PAYPAL_CLIENT_SECRET=...
# PAYPAL_MERCHANT_ID=...
GEMINI_MODEL=gemini-3.5-flash
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5vl:3b

# Server Encryption Key for Stored Admin Credentials (required on hosted deployments)
PUNCHPAY_CREDENTIAL_ENCRYPTION_KEY=min_16_char_separate_encryption_secret`}
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
