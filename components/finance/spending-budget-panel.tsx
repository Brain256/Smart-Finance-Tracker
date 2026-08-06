"use client";

import { Wallet } from "lucide-react";

import type { PeriodBudgetUsage, PlanningLimits } from "@/lib/finance-analytics";
import { formatCurrency } from "@/lib/format";
import type { SavingsTarget } from "@/lib/types";

type SpendingBudgetPanelProps = {
  limits: PlanningLimits;
  usage: PeriodBudgetUsage[];
  savingsTarget: SavingsTarget | null;
  planningUnavailableReason: string | null;
  incompleteMessage: string | null;
};

const stateClasses: Record<"green" | "yellow" | "red", string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500"
};

const periodLabels: Record<PeriodBudgetUsage["period"], { label: string; detail: string }> = {
  today: { label: "Spending today", detail: "Local calendar day" },
  week: { label: "Spending this week", detail: "Monday through today" },
  month: { label: "Spending this month", detail: "Current calendar month" }
};

function formatPercentage(value: number): string {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function savingsTargetMessage(limits: PlanningLimits, savingsTarget: SavingsTarget | null): string | null {
  if (limits.status !== "ready" || !savingsTarget) return null;
  if (savingsTarget.mode === "fixed") {
    return `Your savings target is ${formatCurrency(limits.monthlySavingsAmount)} per month.`;
  }
  return `Your savings target is ${formatPercentage(savingsTarget.value)} of monthly income (${formatCurrency(limits.monthlySavingsAmount)} per month).`;
}

function pacingMessage(usage: PeriodBudgetUsage): string | null {
  switch (usage.pacingState) {
    case "under":
      return "Under pace";
    case "ahead":
      return "Spending ahead of pace";
    case "on":
      return "On pace";
    default:
      return null;
  }
}

function BudgetUsageBar({ usage, label }: { usage: PeriodBudgetUsage; label: string }): React.ReactElement {
  const percentage = usage.consumption === null ? null : usage.consumption * 100;
  const width = percentage === null ? (usage.budget === 0 && usage.spending > 0 ? 100 : 0) : Math.min(100, percentage);
  const actualClass = usage.state ? stateClasses[usage.state] : "bg-slate-300";
  const projectedWidth = usage.projectedConsumption === null || usage.projectedConsumption === undefined
    ? null
    : Math.min(100, usage.projectedConsumption * 100);
  const projectedClass = usage.projectedState ? stateClasses[usage.projectedState] : "bg-slate-500";

  return (
    <div
      aria-label={`${label}'s budget usage`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percentage === null ? 0 : Math.min(100, Math.round(percentage))}
      className="relative mt-3 h-2 w-full overflow-visible rounded-full bg-slate-100"
      role="progressbar"
    >
      <div className={`h-full rounded-full ${actualClass}`} style={{ width: `${width}%` }} />
      {projectedWidth !== null ? (
        <span
          aria-hidden="true"
          className={`absolute -top-1 h-4 w-0.5 rounded-full ${projectedClass}`}
          style={{ left: `calc(${projectedWidth}% - 1px)` }}
        />
      ) : null}
    </div>
  );
}

function TimeProgressBar({ usage, label }: { usage: PeriodBudgetUsage; label: string }): React.ReactElement | null {
  if (usage.elapsedRatio === undefined || usage.elapsedDays === undefined || usage.totalDays === undefined) return null;
  const elapsedPercentage = usage.elapsedRatio * 100;

  return (
    <>
      <div
        aria-label={`${label}'s time elapsed`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(elapsedPercentage)}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
      >
        <div className="h-full rounded-full bg-slate-400" style={{ width: `${elapsedPercentage}%` }} />
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {`${usage.elapsedDays} of ${usage.totalDays} days elapsed · ${usage.remainingDays ?? 0} day${usage.remainingDays === 1 ? "" : "s"} remaining`}
      </p>
    </>
  );
}

function PeriodBudgetRow({ usage }: { usage: PeriodBudgetUsage }): React.ReactElement {
  const labels = periodLabels[usage.period];
  const percentage = usage.consumption === null ? null : usage.consumption * 100;
  const pace = pacingMessage(usage);

  return (
    <li className="rounded-md border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div>
          <p className="font-medium text-slate-900">{labels.label}</p>
          <p className="text-sm text-[var(--muted)]">{labels.detail}</p>
        </div>
        <p className="text-right text-sm text-slate-600">
          <span className="font-semibold text-slate-950">{formatCurrency(usage.spending)}</span>
          {usage.budget === null ? " spent" : (
            <>
              {" of "}
              <span className="font-medium text-slate-950">{formatCurrency(usage.budget)}</span>
            </>
          )}
        </p>
      </div>

      <BudgetUsageBar label={labels.label} usage={usage} />
      <p className="mt-2 text-xs text-[var(--muted)]">
        {usage.budget === null
          ? "Budget unavailable"
          : percentage !== null
            ? `${formatPercentage(percentage)} used${percentage >= 100 ? " — over budget" : ""}`
            : usage.spending > 0
              ? "No budget available"
              : "No spending yet"}
      </p>

      {usage.period === "today" && usage.averageDailySpending !== undefined ? (
        <p className="mt-2 text-xs text-[var(--muted)]">
          {`Average daily spend this week: ${formatCurrency(usage.averageDailySpending)}`}
        </p>
      ) : null}

      {usage.projectedSpending !== undefined ? (
        <p className="mt-2 text-xs text-[var(--muted)]">
          {`Projected: ${formatCurrency(usage.projectedSpending)}${usage.projectedConsumption !== null && usage.projectedConsumption !== undefined && usage.projectedConsumption >= 1 ? " — over budget" : ""}`}
        </p>
      ) : null}

      <TimeProgressBar label={labels.label} usage={usage} />
      {pace ? <p className="mt-2 text-xs font-medium text-slate-700">{pace}</p> : null}
    </li>
  );
}

export function SpendingBudgetPanel({ limits, usage, savingsTarget, planningUnavailableReason, incompleteMessage }: SpendingBudgetPanelProps) {
  const targetMessage = savingsTargetMessage(limits, savingsTarget);
  const planningMessage = planningUnavailableReason ?? incompleteMessage;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal text-slate-950">Spending against budget</h2>
          <p className="text-sm text-[var(--muted)]">Compare actual spending, projected spending, and time elapsed</p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
          <Wallet aria-hidden="true" className="h-4 w-4" />
        </div>
      </div>

      <ul className="grid gap-3 md:grid-cols-3" aria-label="Spending budget usage">
        {usage.map((item) => <PeriodBudgetRow key={item.period} usage={item} />)}
      </ul>

      {planningMessage ? <p className="mt-4 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">{planningMessage}</p> : null}
      {targetMessage ? <p className="mt-4 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">{targetMessage}</p> : null}
    </section>
  );
}
