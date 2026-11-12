"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, FileSearch, HelpCircle } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import {
  Button,
  Card,
  PaymentStatusBadge,
  Skeleton,
  WorkStatusBadge,
} from "@/components/ui/primitives";
import type { Profile, ProjectBundle, SystemConfigStatus } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

export default function EvidenceReviewsPage() {
  const router = useRouter();
  const [user, setUser] = useState<Profile | null>(null);
  const [config, setConfig] = useState<SystemConfigStatus | null>(null);
  const [projects, setProjects] = useState<ProjectBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<
    "all" | "appears_satisfied" | "concerns_identified" | "insufficient_evidence" | "unreviewed"
  >("all");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const json = await res.json();
      setUser(json.user);
      setConfig(json.config);
      setProjects(json.projects || []);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => {
    const all = projects.flatMap((p) => p.tasks.map((t) => ({ project: p, task: t })));
    return all.filter(({ task }) => {
      const a = task.latest_review?.structured_findings.overall_assessment;
      if (filter === "all") return true;
      if (filter === "unreviewed") return !a;
      return a === filter;
    });
  }, [projects, filter]);

  if (loading || !user || !config) {
    return (
      <div className="min-h-screen bg-slate-50 p-8 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <AppShell user={user} config={config} projects={projects}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">AI Evidence Reviews</h1>
            <p className="mt-1 text-sm text-slate-500">
              Inspect submitted before &amp; after photographs, structured multimodal AI
              findings, and make final homeowner settlement decisions.
            </p>
          </div>
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {(
              [
                ["all", "All"],
                ["appears_satisfied", "Satisfied"],
                ["concerns_identified", "Concerns"],
                ["insufficient_evidence", "Insufficient"],
                ["unreviewed", "Not Reviewed"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={`rounded-md px-3 py-1 text-xs font-medium cursor-pointer ${
                  filter === k
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {items.length === 0 ? (
          <Card className="p-8 text-center space-y-2">
            <FileSearch className="h-8 w-8 text-slate-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-900">No matching tasks</p>
            <p className="text-xs text-slate-500">
              Tasks appear here with their evidence photos and multimodal AI inspection
              reports.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {items.map(({ project, task }) => {
              const findings = task.latest_review?.structured_findings;
              return (
                <Card key={task.id} className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-slate-500">{project.title}</p>
                      <h2 className="text-base font-semibold text-slate-900">{task.title}</h2>
                    </div>
                    <span className="font-mono-code text-sm font-bold text-slate-900">
                      {formatMoney(task.amount_minor_units)}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <WorkStatusBadge status={task.work_status} />
                    <PaymentStatusBadge status={task.payment_status} />
                  </div>

                  {findings ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1.5">
                      <div className="flex items-center gap-1.5 font-semibold">
                        {findings.overall_assessment === "appears_satisfied" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : findings.overall_assessment === "concerns_identified" ? (
                          <AlertTriangle className="h-4 w-4 text-red-600" />
                        ) : (
                          <HelpCircle className="h-4 w-4 text-amber-600" />
                        )}
                        <span className="capitalize">
                          {findings.overall_assessment.replaceAll("_", " ")}
                        </span>
                        <span className="ml-auto font-mono-code text-[11px] text-slate-500">
                          {task.latest_review?.analysis_source === "prepared_demo"
                            ? "Prepared demo"
                            : task.latest_review?.analysis_source === "guided_checklist"
                            ? "Guided review"
                            : task.latest_review?.provider}{" "}
                          · v{task.latest_review?.review_version}
                        </span>
                      </div>
                      <p className="text-slate-600 line-clamp-2">{findings.summary}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      {task.evidence.length} evidence file(s) uploaded · Inspection pending
                    </p>
                  )}

                  <div className="flex justify-end">
                    <Link href={`/tasks/${task.id}`}>
                      <Button size="sm" variant="primary">
                        Open Inspection Workspace
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
