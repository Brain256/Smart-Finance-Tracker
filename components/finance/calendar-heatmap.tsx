"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { DaySummaryPanel } from "@/components/finance/day-summary";
import { buildDaySummary, buildHeatmapDays, NON_ZERO_INTENSITY_LEVEL_COUNT } from "@/lib/finance-analytics";
import { formatCurrency } from "@/lib/format";
import type { ExpenseRecord } from "@/lib/types";

type CalendarHeatmapProps = {
  expenses: ExpenseRecord[];
  monthKey: string;
  activeCellKey: string | null;
  selectedDateKey: string | null;
  onChangeMonth: (offset: number) => void;
  onActiveCellKeyChange: (key: string | null | ((current: string | null) => string | null)) => void;
  onSelectDate: (key: string | null) => void;
  financeTimezone: string;
};

const DAY_SUMMARY_PANEL_ID = "calendar-day-summary";

export type IntensityLevel = { className: string; descriptor: string };

/** One zero level plus four ordered teal levels shared by the cells and the legend. */
export const INTENSITY_LEVELS: IntensityLevel[] = [
  { className: "bg-slate-100", descriptor: "no spending" },
  { className: "bg-teal-100", descriptor: "low spending" },
  { className: "bg-teal-300", descriptor: "moderate spending" },
  { className: "bg-teal-500", descriptor: "high spending" },
  { className: "bg-teal-700", descriptor: "highest spending" }
];
export const NON_ZERO_LEVEL_COUNT = NON_ZERO_INTENSITY_LEVEL_COUNT;

const monthLabelFormatter = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
const cellDateFormatter = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function toUtcNoon(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

export function getMonthKeyLabel(monthKey: string): string {
  return monthLabelFormatter.format(toUtcNoon(`${monthKey}-01`));
}

function formatCellDate(dateKey: string): string {
  return cellDateFormatter.format(toUtcNoon(dateKey));
}

function getCellLabel(dateKey: string, total: number, level: number): string {
  const amount = total > 0 ? `${formatCurrency(total)} spent` : "no spending";
  return `${formatCellDate(dateKey)}: ${amount}, ${INTENSITY_LEVELS[level].descriptor}`;
}

function CalendarLegend() {
  return <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-[var(--muted)] sm:justify-end"><span className="font-medium">Less</span><ul className="flex flex-wrap items-center gap-x-3 gap-y-2">{INTENSITY_LEVELS.map((level) => <li className="flex items-center gap-1.5" key={level.descriptor}><span aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 rounded-sm border border-slate-200 ${level.className}`} /><span className="whitespace-nowrap">{level.descriptor}</span></li>)}</ul><span className="font-medium">More</span></div>;
}

export function CalendarHeatmap({ expenses, monthKey, activeCellKey, selectedDateKey, onChangeMonth, onActiveCellKeyChange, onSelectDate, financeTimezone }: CalendarHeatmapProps) {
  const grid = buildHeatmapDays(expenses, monthKey, financeTimezone);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const daySummary = selectedDateKey === null ? null : buildDaySummary(expenses, selectedDateKey, financeTimezone);

  // Requirement 13.13: a tap outside the open cell closes its detail.
  useEffect(() => {
    if (activeCellKey === null) return;

    function handlePointerDown(event: PointerEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) {
        onActiveCellKeyChange(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [activeCellKey, onActiveCellKeyChange]);

  return <section className="rounded-lg border border-[var(--border)] bg-white p-3 shadow-sm sm:p-4" ref={containerRef}><div className="mb-4 flex items-center justify-between gap-3"><button aria-label="Previous month" className="focus-ring flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] bg-white text-slate-700 hover:bg-slate-50" onClick={() => onChangeMonth(-1)} type="button"><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button><h2 className="min-w-0 text-center text-lg font-semibold tracking-normal text-slate-950">{getMonthKeyLabel(monthKey)}</h2><button aria-label="Next month" className="focus-ring flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] bg-white text-slate-700 hover:bg-slate-50" onClick={() => onChangeMonth(1)} type="button"><ChevronRight aria-hidden="true" className="h-4 w-4" /></button></div><div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-[var(--muted)] sm:gap-1.5">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div className="py-1" key={day}>{day}</div>)}</div><div className="mt-1 grid grid-cols-7 gap-1 sm:gap-1.5">{Array.from({ length: grid.leadingPadding }, (_, index) => <div aria-hidden="true" className="aspect-square rounded-sm" key={`leading-${index}`} />)}{grid.days.map((day) => {
    const label = getCellLabel(day.dateKey, day.total, day.level);
    const isActive = activeCellKey === day.dateKey;

    const isSelected = selectedDateKey === day.dateKey;

    return <div className="relative" key={day.dateKey}><button aria-controls={isSelected ? DAY_SUMMARY_PANEL_ID : undefined} aria-expanded={isSelected} aria-label={label} className={`focus-ring block aspect-square w-full rounded-sm border ${isSelected ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200"} ${INTENSITY_LEVELS[day.level].className}`} data-date={day.dateKey} data-level={day.level} onBlur={() => onActiveCellKeyChange((current: string | null) => current === day.dateKey ? null : current)} onClick={() => { onActiveCellKeyChange(day.dateKey); onSelectDate(isSelected ? null : day.dateKey); }} onFocus={() => onActiveCellKeyChange(day.dateKey)} onMouseEnter={() => onActiveCellKeyChange(day.dateKey)} onMouseLeave={() => onActiveCellKeyChange((current: string | null) => current === day.dateKey ? null : current)} type="button" />{isActive ? <div className="absolute bottom-full left-1/2 z-20 mb-1 w-max max-w-[12rem] -translate-x-1/2 rounded-md border border-slate-200 bg-white px-2 py-1 text-left text-xs font-medium text-slate-900 shadow-lg" role="status"><span className="block whitespace-nowrap">{formatCellDate(day.dateKey)}</span><span className="block whitespace-nowrap text-slate-600">{day.total > 0 ? formatCurrency(day.total) : "No spending"}</span></div> : null}</div>;
  })}{Array.from({ length: grid.trailingPadding }, (_, index) => <div aria-hidden="true" className="aspect-square rounded-sm" key={`trailing-${index}`} />)}</div><CalendarLegend />{daySummary === null ? null : <DaySummaryPanel financeTimezone={financeTimezone} onClose={() => onSelectDate(null)} panelId={DAY_SUMMARY_PANEL_ID} summary={daySummary} />}</section>;
}
