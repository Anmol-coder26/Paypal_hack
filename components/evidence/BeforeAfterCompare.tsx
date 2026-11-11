"use client";

import React, { useState } from "react";
import {
  Columns2,
  Layers,
  MapPin,
  SlidersHorizontal,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { EvidenceAnnotation, EvidenceRecord } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

export function BeforeAfterCompare({
  taskId,
  before,
  after,
  allEvidence,
  annotations = [],
  canAnnotate = false,
  canDelete,
  onDelete,
  onAnnotationChange,
}: {
  taskId?: string;
  before: EvidenceRecord | null;
  after: EvidenceRecord | null;
  allEvidence: EvidenceRecord[];
  annotations?: EvidenceAnnotation[];
  canAnnotate?: boolean;
  canDelete?: boolean;
  onDelete?: (evidenceId: string) => void;
  onAnnotationChange?: () => void;
}) {
  const [mode, setMode] = useState<"side-by-side" | "slider" | "overlay">("side-by-side");
  const [split, setSplit] = useState(50);
  const [overlayOpacity, setOverlayOpacity] = useState(50);
  const [zoomed, setZoomed] = useState(false);

  // Pin annotation composer
  const [pinMode, setPinMode] = useState(false);
  const [pendingPin, setPendingPin] = useState<{
    evidenceId: string;
    xPct: number;
    yPct: number;
  } | null>(null);
  const [pinLabel, setPinLabel] = useState("");
  const [pinSeverity, setPinSeverity] = useState<"info" | "concern" | "verified">("info");
  const [savingPin, setSavingPin] = useState(false);

  function handleImageClick(
    e: React.MouseEvent<HTMLDivElement>,
    record: EvidenceRecord | null
  ) {
    if (!pinMode || !record || !taskId || !canAnnotate) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const yPct = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    setPendingPin({
      evidenceId: record.id,
      xPct: Number(xPct.toFixed(1)),
      yPct: Number(yPct.toFixed(1)),
    });
    setPinLabel("");
  }

  async function savePin(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingPin || !taskId || !pinLabel.trim()) return;
    setSavingPin(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evidence_id: pendingPin.evidenceId,
          x_pct: pendingPin.xPct,
          y_pct: pendingPin.yPct,
          label: pinLabel.trim(),
          severity: pinSeverity,
        }),
      });
      if (res.ok) {
        setPendingPin(null);
        setPinMode(false);
        onAnnotationChange?.();
      }
    } finally {
      setSavingPin(false);
    }
  }

  async function removePin(annotationId: string) {
    if (!taskId) return;
    const res = await fetch(
      `/api/tasks/${taskId}/annotations?annotationId=${encodeURIComponent(annotationId)}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      onAnnotationChange?.();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">
          {before && after
            ? pinMode
              ? "Click anywhere on the Before or After photo to drop an inspection pin"
              : "Compare submitted before & after photographs"
            : "Upload both before and after photos to unlock comparison tools"}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          {canAnnotate && taskId && (before || after) && mode === "side-by-side" && (
            <button
              type="button"
              onClick={() => {
                setPinMode((v) => !v);
                setPendingPin(null);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors",
                pinMode
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600 hover:text-slate-900"
              )}
            >
              <MapPin className="h-3.5 w-3.5" />
              {pinMode ? "Cancel Pin" : "Drop Pin"}
            </button>
          )}

          {(before || after) && (
            <button
              type="button"
              onClick={() => setZoomed((z) => !z)}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors",
                zoomed
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:text-slate-900"
              )}
            >
              {zoomed ? <ZoomOut className="h-3.5 w-3.5" /> : <ZoomIn className="h-3.5 w-3.5" />}
              {zoomed ? "1×" : "2×"}
            </button>
          )}

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
                onClick={() => {
                  setMode("slider");
                  setPinMode(false);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors",
                  mode === "slider"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Wipe
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("overlay");
                  setPinMode(false);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors",
                  mode === "overlay"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                <Layers className="h-3.5 w-3.5" />
                Overlay
              </button>
            </div>
          )}
        </div>
      </div>

      {mode === "slider" && before?.url && after?.url ? (
        <div className="space-y-3">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={after.url}
              alt="After repair evidence"
              className={cn(
                "absolute inset-0 h-full w-full object-contain transition-transform duration-200",
                zoomed && "scale-150"
              )}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={before.url}
              alt="Before repair evidence"
              className={cn(
                "absolute inset-0 h-full w-full object-contain transition-transform duration-200",
                zoomed && "scale-150"
              )}
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
      ) : mode === "overlay" && before?.url && after?.url ? (
        <div className="space-y-3">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={before.url}
              alt="Before repair base layer"
              className={cn(
                "absolute inset-0 h-full w-full object-contain transition-transform duration-200",
                zoomed && "scale-150"
              )}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={after.url}
              alt="After repair onion-skin overlay"
              className={cn(
                "absolute inset-0 h-full w-full object-contain transition-transform duration-200",
                zoomed && "scale-150"
              )}
              style={{ opacity: overlayOpacity / 100 }}
            />
            <span className="absolute left-3 top-3 rounded-md bg-slate-900/85 px-2.5 py-0.5 text-[11px] font-semibold text-white">
              ONION-SKIN ALIGNMENT · {overlayOpacity}% AFTER
            </span>
          </div>
          <div className="flex items-center gap-3 px-1">
            <span className="text-xs font-medium text-slate-500">0% Before</span>
            <input
              type="range"
              min={0}
              max={100}
              value={overlayOpacity}
              aria-label="Onion-skin opacity"
              onChange={(e) => setOverlayOpacity(Number(e.target.value))}
              className="w-full accent-blue-600 cursor-pointer"
            />
            <span className="text-xs font-medium text-slate-500">100% After</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            { label: "Before Repair", record: before },
            { label: "After Repair", record: after },
          ].map(({ label, record }) => {
            const pins = record
              ? annotations.filter((a) => a.evidence_id === record.id)
              : [];
            return (
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
                <div
                  onClick={(e) => handleImageClick(e, record)}
                  className={cn(
                    "relative aspect-[4/3] bg-slate-100 flex items-center justify-center overflow-hidden",
                    pinMode && record && "cursor-crosshair ring-2 ring-inset ring-blue-500/60"
                  )}
                >
                  {record?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={record.url}
                      alt={`${label} photograph`}
                      className={cn(
                        "h-full w-full object-contain transition-transform duration-200",
                        zoomed && "scale-150"
                      )}
                    />
                  ) : (
                    <p className="px-4 text-center text-xs text-slate-400">
                      No {label.toLowerCase()} photo submitted yet
                    </p>
                  )}

                  {pins.map((pin, idx) => (
                    <div
                      key={pin.id}
                      style={{ left: `${pin.x_pct}%`, top: `${pin.y_pct}%` }}
                      title={`${pin.author_name} (${pin.author_role}): ${pin.label}`}
                      className={cn(
                        "absolute -translate-x-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow-md",
                        pin.severity === "concern"
                          ? "bg-red-600"
                          : pin.severity === "verified"
                          ? "bg-emerald-600"
                          : "bg-blue-600"
                      )}
                    >
                      {idx + 1}
                    </div>
                  ))}

                  {pendingPin && record && pendingPin.evidenceId === record.id && (
                    <div
                      style={{ left: `${pendingPin.xPct}%`, top: `${pendingPin.yPct}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 h-6 w-6 rounded-full border-2 border-white bg-amber-500 shadow-md animate-pulse"
                    />
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
            );
          })}
        </div>
      )}

      {pendingPin && (
        <form
          onSubmit={savePin}
          className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 space-y-2.5 text-xs"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-blue-900">
              Add Pin Note ({pendingPin.xPct}%, {pendingPin.yPct}%)
            </span>
            <button
              type="button"
              onClick={() => setPendingPin(null)}
              className="text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              required
              value={pinLabel}
              onChange={(e) => setPinLabel(e.target.value)}
              placeholder="e.g., Open grout gap on right joint"
              className="sm:col-span-2 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <select
              value={pinSeverity}
              onChange={(e) =>
                setPinSeverity(e.target.value as "info" | "concern" | "verified")
              }
              className="rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value="info">Note</option>
              <option value="verified">Looks Fixed</option>
              <option value="concern">Visible Concern</option>
            </select>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingPin}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer disabled:opacity-50"
            >
              {savingPin ? "Saving pin..." : "Save Pin Annotation"}
            </button>
          </div>
        </form>
      )}

      {annotations.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5 text-xs">
          <p className="font-semibold text-slate-800">
            Visual Inspection Pins ({annotations.length})
          </p>
          <ul className="space-y-1">
            {annotations.map((ann, idx) => (
              <li key={ann.id} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white",
                      ann.severity === "concern"
                        ? "bg-red-600"
                        : ann.severity === "verified"
                        ? "bg-emerald-600"
                        : "bg-blue-600"
                    )}
                  >
                    {idx + 1}
                  </span>
                  <span className="font-medium text-slate-900 truncate">{ann.label}</span>
                  <span className="text-[11px] text-slate-400 shrink-0">
                    ({ann.author_role})
                  </span>
                </div>
                {canAnnotate && (
                  <button
                    type="button"
                    onClick={() => removePin(ann.id)}
                    className="text-[11px] text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
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
