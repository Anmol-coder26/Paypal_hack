"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Briefcase,
  CheckCircle2,
  Cpu,
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

  const primaryNav =
    user.role === "admin"
      ? [{ href: "/settings", label: "AI & System Settings", icon: Settings }]
      : user.role === "homeowner"
      ? [
          { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
          { href: "/reviews", label: "Evidence Reviews", icon: FileSearch },
          { href: "/payments", label: "Payment Control", icon: CreditCard },
          { href: "/ledger", label: "Settlement Ledger", icon: ReceiptText },
        ]
      : [
          { href: "/contractor", label: "Contractor Desk", icon: Hammer },
          { href: "/reviews", label: "Evidence Reviews", icon: FileSearch },
          { href: "/payments", label: "Payment Control", icon: CreditCard },
          { href: "/ledger", label: "Settlement Ledger", icon: ReceiptText },
        ];

  const utilityNav = [
    ...(user.role === "homeowner"
      ? [{ href: "/projects/new", label: "New Project", icon: FolderKanban }]
      : []),
    { href: "/playground", label: "Fault Lab", icon: FlaskConical },
    ...(user.role !== "admin" ? [{ href: "/settings", label: "Settings", icon: Settings }] : []),
  ];

  const notifications = projects.flatMap((p) =>
    p.tasks
      .filter((t) =>
        user.role === "homeowner"
          ? ["EVIDENCE_SUBMITTED", "AI_REVIEWED"].includes(t.work_status) &&
            t.payment_status === "AUTHORIZED"
          : user.role === "contractor"
          ? ["PENDING_EVIDENCE", "BEFORE_SUBMITTED", "CORRECTIONS_REQUESTED"].includes(
              t.work_status
            )
          : false
      )
      .map((t) => ({
        id: t.id,
        projectId: p.id,
        title: t.title,
        projectTitle: p.title,
        text:
          user.role === "homeowner"
            ? t.latest_review
              ? `Inspection complete (${t.latest_review.structured_findings.overall_assessment.replaceAll("_", " ")}) — awaiting decision`
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

  const isSimMode = config.payment?.mode === "simulation";

  const SidebarContent = (
    <div className="flex h-full flex-col bg-[#17243A] text-slate-200">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <Link href="/" className="flex items-center gap-2.5 text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2563EB] text-white">
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
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-200">
              {isSimMode ? "Simulation" : "Sandbox"}
            </span>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Primary Navigation">
        {primaryNav.map((item) => {
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
                  ? "bg-[#2563EB] text-white"
                  : "text-slate-300 hover:bg-white/8 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        <div className="pt-4 pb-1 px-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Workspace Tools
          </span>
        </div>
        {utilityNav.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                active
                  ? "bg-[#2563EB] text-white"
                  : "text-slate-300 hover:bg-white/8 hover:text-white"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
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
            <Briefcase className="h-3.5 w-3.5 text-blue-300" />
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
    <div className="min-h-screen bg-[#F7F8FA] flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block lg:w-64 lg:shrink-0 sticky top-0 h-screen">
        {SidebarContent}
      </aside>

      {/* Mobile slide-over */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-[#17243A]/60"
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
                <span className="font-semibold text-[#17243A]">PunchPay</span>
                <span>/</span>
                <span className="capitalize">{user.role} Workspace</span>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-2.5">
              {onSearchChange ? (
                <div className="relative hidden md:block w-60">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={searchValue ?? localSearch}
                    onChange={(e) => {
                      setLocalSearch(e.target.value);
                      onSearchChange(e.target.value);
                    }}
                    placeholder="Search projects or IDs..."
                    className="h-8 w-full rounded-lg border border-slate-200 bg-[#F7F8FA] pl-8 pr-3 text-xs text-[#17243A] placeholder:text-slate-400 focus:border-[#2563EB] focus:bg-white focus:outline-none"
                  />
                </div>
              ) : null}

              {/* Restrained Environment Mode Pill */}
              <Link
                href="/settings"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  isSimMode
                    ? "border-slate-300 bg-[#F7F8FA] text-slate-700 hover:bg-slate-100"
                    : "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100"
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    isSimMode ? "bg-amber-600" : "bg-[#2563EB]"
                  )}
                />
                <span>
                  {config.payment?.label ||
                    (isSimMode
                      ? "Simulation · No money moved"
                      : "PayPal Sandbox · Test transactions")}
                </span>
              </Link>

              {/* AI Mode Badge */}
              <Link
                href="/settings"
                className={cn(
                  "hidden md:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  config.ai.activeTier === "gemini_live"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : config.ai.configured
                    ? "border-blue-200 bg-blue-50 text-blue-800"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                )}
              >
                {config.ai.activeTier === "gemini_live" ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    <span>Gemini AI · {config.ai.model}</span>
                  </>
                ) : config.ai.configured ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    <span>
                      {config.ai.provider === "ollama"
                        ? `Local AI · ${config.ai.model}`
                        : `${config.ai.provider} · ${config.ai.model}`}
                    </span>
                  </>
                ) : (
                  <>
                    <Cpu className="h-3 w-3 text-slate-400" />
                    <span>AI: Guided Review</span>
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
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#2563EB] text-[10px] font-semibold text-white">
                      {notifications.length}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl z-40">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <span className="text-xs font-semibold text-[#17243A]">
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
                              <p className="text-xs font-medium text-[#17243A]">
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
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
