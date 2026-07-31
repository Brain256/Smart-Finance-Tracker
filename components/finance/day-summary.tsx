"use client";

import { X } from "lucide-react";

import type { DaySummary } from "@/lib/finance-analytics";
import { formatCurrency, formatTimeInZone } from "@/lib/format";
import type { ExpenseRecord } from "@/lib/types";

type DaySummaryPanelProps = {
  summary: DaySummary;
  financeTimezone: string;
  panelId: string;
  onClose: () => void;
};

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  weekday: "long",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC"
});

function formatDayHeading(dateKey: string): string {
  return dateFormatter.format(new Date(`${dateKey}T12:00:00.000Z`));
}

function TransactionRow({ expense, financeTimezone }: { expense: ExpenseRecord; financeTimezone: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-2">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="w-16 shrink-0 text-xs tabular-nums text-[var(--muted)]">
          {formatTimeInZone(expense.timestamp, financeTimezone)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-950">{expense.merchantName}</p>
          <p className="text-xs text-[var(--muted)]">{expense.category}</p>
        </div>
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-950">
        {formatCurrency(expense.amount)}
      </span>
    </li>
  );
}

export function DaySummaryPanel({ summary, financeTimezone, panelId, onClose }: DaySummaryPanelProps) {
  const { transactions, incomeTransactions, categoryTotals, spendingCount, spendingTotal } = summary;
  const isEmpty = transactions.length === 0 && incomeTransactions.length === 0;

  return (
    <section
      aria-label={`Transactions for ${formatDayHeading(summary.dateKey)}`}
      className="mt-4 rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm"
      id={panelId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-normal text-slate-950">
            {formatDayHeading(summary.dateKey)}
          </h3>
          <p className="text-sm text-[var(--muted)]">
            {formatCurrency(spendingTotal)} &middot; {spendingCount}{" "}
            {spendingCount === 1 ? "transaction" : "transactions"}
          </p>
        </div>
        <button
          aria-label="Close day details"
          className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      {isEmpty ? (
        <p className="mt-3 border-t border-[var(--border)] pt-3 text-sm text-[var(--muted)]">
          No transactions on this day.
        </p>
      ) : null}

      {categoryTotals.length > 0 ? (
        <ul aria-label="Category breakdown" className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
          {categoryTotals.map((entry) => (
            <li
              className="flex items-baseline gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs"
              key={entry.category}
            >
              <span className="font-medium text-slate-700">{entry.category}</span>
              <span className="font-semibold tabular-nums text-slate-950">
                {formatCurrency(entry.total)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {transactions.length > 0 ? (
        <ul aria-label="Spending transactions" className="mt-1 divide-y divide-[var(--border)]">
          {transactions.map((expense) => (
            <TransactionRow expense={expense} financeTimezone={financeTimezone} key={expense.id} />
          ))}
        </ul>
      ) : null}

      {incomeTransactions.length > 0 ? (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          {/* Income is listed for completeness but excluded from the spending total above,
              so the panel always agrees with the cell intensity that opened it. */}
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Income (not counted in the total)
          </h4>
          <ul aria-label="Income transactions" className="divide-y divide-[var(--border)]">
            {incomeTransactions.map((expense) => (
              <TransactionRow expense={expense} financeTimezone={financeTimezone} key={expense.id} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
