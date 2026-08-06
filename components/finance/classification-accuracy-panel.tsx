"use client";

import { ShieldCheck } from "lucide-react";

import type { ClassificationAccuracy, FeatureLoadState } from "@/lib/types";

type ClassificationAccuracyPanelProps = {
  accuracy: FeatureLoadState<ClassificationAccuracy>;
};

export function ClassificationAccuracyPanel({ accuracy }: ClassificationAccuracyPanelProps) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal text-slate-950">Classification accuracy</h2>
          <p className="text-sm text-[var(--muted)]">Share of the last 90 days of classifications that were never corrected</p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
          <ShieldCheck aria-hidden="true" className="h-4 w-4" />
        </div>
      </div>
      {accuracy.status === "unavailable" ? (
        <p className="text-sm text-[var(--muted)]">{accuracy.reason}</p>
      ) : accuracy.data.accuracy === null ? (
        <p className="text-sm text-[var(--muted)]">Not enough classified transactions yet to report accuracy.</p>
      ) : (
        <div>
          <p className="text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
            {`${(accuracy.data.accuracy * 100).toFixed(1)}%`}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {`${accuracy.data.correctedCount} corrected of ${accuracy.data.totalClassified} classified since ${accuracy.data.windowStart}`}
          </p>
        </div>
      )}
    </section>
  );
}
