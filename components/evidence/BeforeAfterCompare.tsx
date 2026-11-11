"use client";

import React, { useState } from "react";
import { Columns2, SlidersHorizontal, Trash2 } from "lucide-react";
import type { EvidenceRecord } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

export function BeforeAfterCompare({
  before,
  after,
  allEvidence,
  canDelete,
  onDelete,
}: {
  before: EvidenceRecord | null;
  after: EvidenceRecord | null;
  allEvidence: EvidenceRecord[];
  canDelete?: boolean;
  onDelete?: (evidenceId: string) => void;
}) {
  const [mode, setMode] = useState<"side-by-side" | "slider">("side-by-side");
  const [split, setSplit] = useState(50);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">
          {before && after
            ? "Compare submitted before & after photographs"
            : "Upload both before and after photos to enable side-by-side wipe comparison"}
        </p>
        {before && after && (
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setMode("side-by-side")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors",
                mode === "side-by-side"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <Columns2 className="h-3.5 w-3.5" />
              Side by side
            </button>
            <button
              type="button"
              onClick={() => setMode("slider")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors",
                mode === "slider"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Slider wipe
            </button>
          </div>
        )}
      </div>

      {mode === "slider" && before?.url && after?.url ? (
        <div className="space-y-3">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={after.url}
              alt="After repair evidence"
              className="absolute inset-0 h-full w-full object-contain"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={before.url}
              alt="Before repair evidence"
              className="absolute inset-0 h-full w-full object-contain"
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.4)]"
              style={{ left: `${split}%` }}
            />
            <span className="absolute left-3 top-3 rounded-md bg-slate-900/80 px-2 py-0.5 text-[11px] font-semibold text-white">
              BEFORE
            </span>
            <span className="absolute right-3 top-3 rounded-md bg-blue-600/90 px-2 py-0.5 text-[11px] font-semibold text-white">
              AFTER
            </span>
          </div>
          <div className="flex items-center gap-3 px-1">
            <span className="text-xs font-medium text-slate-500">Before</span>
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              aria-label="Before and after comparison position"
              onChange={(e) => setSplit(Number(e.target.value))}
              className="w-full accent-blue-600 cursor-pointer"
            />
            <span className="text-xs font-medium text-slate-500">After</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            { label: "Before Repair", record: before },
            { label: "After Repair", record: after },
          ].map(({ label, record }) => (
            <div
              key={label}
              className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
            >
              <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
                <span className="text-xs font-semibold text-slate-800">{label}</span>
                {record && (
                  <span className="text-[11px] text-slate-500">
                    {record.width}×{record.height}
                  </span>
                )}
              </div>
              <div className="relative aspect-[4/3] bg-slate-100 flex items-center justify-center">
                {record?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={record.url}
                    alt={`${label} photograph`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <p className="px-4 text-center text-xs text-slate-400">
                    No {label.toLowerCase()} photo submitted yet
                  </p>
                )}
              </div>
              {record && (
                <div className="flex items-center justify-between border-t border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
                  <span>{formatDateTime(record.created_at)}</span>
                  {canDelete && onDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(record.id)}
                      className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {allEvidence.length > 2 && (
        <div className="pt-2">
          <p className="mb-2 text-xs font-semibold text-slate-700">
            Submitted Photo History ({allEvidence.length})
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {allEvidence.map((ev) => (
              <div
                key={ev.id}
                className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
              >
                {ev.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ev.url}
                    alt={`${ev.evidence_type} submission`}
                    className="aspect-square w-full object-cover"
                  />
                )}
                <span className="absolute left-1 top-1 rounded bg-slate-900/75 px-1.5 py-0.5 text-[10px] font-medium uppercase text-white">
                  {ev.evidence_type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
