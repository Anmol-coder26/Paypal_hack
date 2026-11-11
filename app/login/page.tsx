"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Hammer, Home, ShieldCheck, UserPlus } from "lucide-react";
import { Button, Card, Input } from "@/components/ui/primitives";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const isGuidedEntry = params.get("demo") === "1";

  const [tab, setTab] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"homeowner" | "contractor">("homeowner");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleDemoLogin(demoRole: "homeowner" | "contractor") {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "demo", role: demoRole }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Demo sign-in failed");
      if (isGuidedEntry && demoRole === "homeowner") {
        router.push("/projects/new?guided=1");
      } else {
        router.push(demoRole === "contractor" ? "/contractor" : "/dashboard");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = tab === "signin" ? "/api/auth/login" : "/api/auth/register";
      const body =
        tab === "signin"
          ? { mode: "password", email, password }
          : { name, email, password, role };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Authentication failed");
      const userRole = json.user?.role;
      router.push(userRole === "contractor" ? "/contractor" : "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-4 py-12">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2.5 text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0b1324] text-white">
              <ShieldCheck className="h-5 w-5 text-blue-400" />
            </span>
            <span className="text-xl font-bold tracking-tight">PunchPay</span>
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">
            {isGuidedEntry ? "Start your PunchPay Sandbox Session" : "Sign in to PunchPay"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Separate authenticated sessions for homeowners and repair contractors.
          </p>
        </div>

        {/* Sandbox Demo Accounts */}
        <Card className="p-5 border-blue-200/80 bg-gradient-to-b from-blue-50/60 to-white">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-700">
              Sandbox Demo Accounts
            </span>
            <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
              Server Session
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Issues a real HTTP-only server session cookie bound to that role&apos;s permissions.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Button
              type="button"
              variant="primary"
              disabled={loading}
              onClick={() => handleDemoLogin("homeowner")}
              className="w-full justify-between"
            >
              <span className="inline-flex items-center gap-1.5">
                <Home className="h-4 w-4" />
                Demo Homeowner
              </span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => handleDemoLogin("contractor")}
              className="w-full justify-between"
            >
              <span className="inline-flex items-center gap-1.5">
                <Hammer className="h-4 w-4" />
                Demo Contractor
              </span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="mt-2.5 text-[11px] text-slate-500">
            Homeowner: <code>homeowner@punchpay.demo</code> · Contractor:{" "}
            <code>contractor@punchpay.demo</code>
          </p>
        </Card>

        <Card className="p-6">
          <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setTab("signin");
                setError("");
              }}
              className={`rounded-md py-1.5 text-xs font-semibold cursor-pointer ${
                tab === "signin"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Email Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("register");
                setError("");
              }}
              className={`rounded-md py-1.5 text-xs font-semibold cursor-pointer ${
                tab === "register"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {tab === "register" && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Full name
                  </label>
                  <Input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Morgan"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Account Role
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["homeowner", "contractor"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRole(r)}
                        className={`rounded-lg border px-3 py-2 text-xs font-medium capitalize cursor-pointer ${
                          role === r
                            ? "border-blue-600 bg-blue-50 text-blue-700"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Email address
              </label>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Password
              </label>
              <Input
                type="password"
                required
                minLength={tab === "register" ? 8 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={tab === "register" ? "Minimum 8 characters" : "Your password"}
              />
            </div>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}

            <Button type="submit" disabled={loading} className="w-full" size="lg">
              {tab === "signin" ? (
                loading ? "Signing in..." : "Sign In"
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  {loading ? "Creating account..." : "Create Account"}
                </>
              )}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <LoginForm />
    </Suspense>
  );
}
