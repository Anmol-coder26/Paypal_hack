"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Briefcase,
  CheckCircle2,
  CreditCard,
  FileSearch,
  FlaskConical,
  FolderKanban,
  Hammer,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import type { Profile, ProjectBundle, SystemConfigStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AppShellProps {
  user: Profile;
  config: SystemConfigStatus;
  projects?: ProjectBundle[];
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  children: React.ReactNode;
}

export function AppShell({
  user,
  config,
  projects = [],
  searchValue,
  onSearchChange,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const [switching, setSwitching] = useState(false);

  const navItems =
    user.role === "homeowner"
      ? [
          { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
          { href: "/projects/new", label: "Create Project", icon: FolderKanban },
          { href: "/payments", label: "Payment Control", icon: CreditCard },
          { href: "/reviews", label: "Evidence Reviews", icon: FileSearch },
          { href: "/ledger", label: "Settlement Ledger", icon: ReceiptText },
          { href: "/playground", label: "PayPal Fault Lab", icon: FlaskConical },
          { href: "/settings", label: "Settings & Demo", icon: Settings },
        ]
      : [
          { href: "/contractor", label: "Contractor Desk", icon: Hammer },
          { href: "/reviews", label: "Evidence Reviews", icon: FileSearch },
          { href: "/payments", label: "Payment Status", icon: CreditCard },
          { href: "/ledger", label: "Settlement Ledger", icon: ReceiptText },
          { href: "/playground", label: "PayPal Fault Lab", icon: FlaskConical },
          { href: "/settings", label: "Settings & Demo", icon: Settings },
        ];

  const notifications = projects.flatMap((p) =>
    p.tasks
      .filter((t) =>
        user.role === "homeowner"
          ? ["EVIDENCE_SUBMITTED", "AI_REVIEWED"].includes(t.work_status) &&
            t.payment_status === "AUTHORIZED"
          : ["PENDING_EVIDENCE", "BEFORE_SUBMITTED", "CORRECTIONS_REQUESTED"].includes(
              t.work_status
            )
      )
      .map((t) => ({
        id: t.id,
        projectId: p.id,
        title: t.title,
        projectTitle: p.title,
        text:
          user.role === "homeowner"
            ? t.latest_review
              ? `AI inspection complete (${t.latest_review.structured_findings.overall_assessment.replaceAll("_", " ")}) — awaiting your decision`
              : "Contractor submitted before/after evidence"
            : t.work_status === "CORRECTIONS_REQUESTED"
            ? `Corrections requested: ${t.homeowner_feedback || "Check feedback"}`
            : "Ready for photo evidence upload",
      }))
  );

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function handleDemoRoleSwitch() {
    if (!user.email.endsWith("@punchpay.demo")) return;
    setSwitching(true);
    const nextRole = user.role === "homeowner" ? "contractor" : "homeowner";
    try {
      await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "demo", role: nextRole }),
      });
      router.push(nextRole === "contractor" ? "/contractor" : "/dashboard");
      router.refresh();
    } finally {
      setSwitching(false);
    }
  }

  const SidebarContent = (
    <div className="flex h-full flex-col bg-[#0b1324] text-slate-200">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <Link href="/" className="flex items-center gap-2.5 text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
            <ShieldCheck className="h-4.5 w-4.5" />
          </span>
          <div>
            <span className="block text-sm font-semibold tracking-tight">PunchPay</span>
            <span className="block text-[11px] text-slate-400">Repair Settlement</span>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden cursor-pointer"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 py-3">
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Active Role
          </p>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium capitalize text-white">{user.role}</span>
            <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
              Sandbox
            </span>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Primary Navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" &&
              item.href !== "/contractor" &&
              pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-slate-300 hover:bg-white/8 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-4 space-y-2.5">
        {user.email.endsWith("@punchpay.demo") && (
          <button
            type="button"
            disabled={switching}
            onClick={handleDemoRoleSwitch}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
          >
            <Briefcase className="h-3.5 w-3.5 text-blue-400" />
            {switching
              ? "Switching session..."
              : `Switch to Demo ${user.role === "homeowner" ? "Contractor" : "Homeowner"}`}
          </button>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-white">{user.name}</p>
            <p className="truncate text-[11px] text-slate-400">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block lg:w-64 lg:shrink-0 sticky top-0 h-screen">
        {SidebarContent}
      </aside>

      {/* Mobile slide-over */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 w-64 h-full">{SidebarContent}</div>
        </div>
      )}

      {/* Main workspace column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
          <div className="flex h-15 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:hidden cursor-pointer"
                aria-label="Open menu"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-800">Workspace</span>
                <span>/</span>
                <span className="capitalize">{user.role} Console</span>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {onSearchChange ? (
                <div className="relative hidden md:block w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={searchValue ?? localSearch}
                    onChange={(e) => {
                      setLocalSearch(e.target.value);
                      onSearchChange(e.target.value);
                    }}
                    placeholder="Search projects or IDs..."
                    className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
                  />
                </div>
              ) : null}

              <Link
                href="/settings"
                className={cn(
                  "hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  config.paypal.configured && config.ai.configured
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                )}
              >
                {config.paypal.configured && config.ai.configured ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    PayPal Sandbox + AI Live
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Setup Required
                  </>
                )}
              </Link>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen((v) => !v)}
                  aria-label="Notifications"
                  className="relative rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  <Bell className="h-4 w-4" />
                  {notifications.length > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-semibold text-white">
                      {notifications.length}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl z-40">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <span className="text-xs font-semibold text-slate-900">
                        Action Notifications
                      </span>
                      <button
                        type="button"
                        onClick={() => setNotifOpen(false)}
                        className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                    {notifications.length === 0 ? (
                      <p className="py-4 text-center text-xs text-slate-500">
                        No pending review alerts right now.
                      </p>
                    ) : (
                      <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
                        {notifications.map((n) => (
                          <li key={n.id}>
                            <Link
                              href={`/tasks/${n.id}`}
                              onClick={() => setNotifOpen(false)}
                              className="block rounded-lg p-2 hover:bg-slate-50"
                            >
                              <p className="text-xs font-medium text-slate-900">
                                {n.title} · <span className="text-slate-500">{n.projectTitle}</span>
                              </p>
                              <p className="mt-0.5 text-[11px] text-slate-600">{n.text}</p>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {(!config.paypal.configured || !config.ai.configured) && (
            <div className="border-t border-amber-200/80 bg-amber-50/90 px-4 py-2 text-xs text-amber-900 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                <span>
                  <strong>Integration status:</strong>{" "}
                  {!config.paypal.configured && "PayPal Sandbox not configured"}
                  {!config.paypal.configured && !config.ai.configured && " · "}
                  {!config.ai.configured && "AI Vision key (Gemini or Anthropic) not configured"}
                  {" · "}
                  Database active ({config.database.driver.toUpperCase()}). Real financial &amp; AI calls require credentials in <code>.env.local</code>.
                </span>
              </div>
              <Link
                href="/settings"
                className="font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950"
              >
                View setup instructions
              </Link>
            </div>
          )}
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
