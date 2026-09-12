"use client";

import { ChevronRight, ReceiptText } from "lucide-react";

import { getFinanceDateKey, getRecentSpendingExpenses } from "@/lib/finance-analytics";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ExpenseRecord } from "@/lib/types";

type RecentTransactionsPanelProps = {
  expenses: ExpenseRecord[];
  financeTimezone: string;
  onOpenTransactions: () => void;
};

function formatExpenseDate(expense: ExpenseRecord, financeTimezone: string): string {
  const dateKey = getFinanceDateKey(new Date(expense.timestamp), financeTimezone);
  return formatDate(`${dateKey}T12:00:00.000Z`);
}

export function RecentTransactionsPanel({
  expenses,
  financeTimezone,
  onOpenTransactions
}: RecentTransactionsPanelProps) {
  const recentExpenses = getRecentSpendingExpenses(expenses);

  return (
    <section aria-labelledby="recent-transactions-heading" className="dashboard-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal text-slate-950" id="recent-transactions-heading">
            Recent transactions
          </h2>
          <p className="text-sm text-[var(--muted)]">Your five most recent expenses</p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center dashboard-icon-tile">
          <ReceiptText aria-hidden="true" className="h-4 w-4" />
        </div>
      </div>

      {recentExpenses.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-soft)] px-4 py-6 text-sm text-[var(--muted)]">
          No spending transactions have been recorded yet.
        </p>
      ) : (
        <ul aria-label="Recent spending transactions" className="divide-y divide-[var(--border)]">
          {recentExpenses.map((expense, index) => {
            const dateLabel = formatExpenseDate(expense, financeTimezone);

            return (
              <li key={expense.id}>
                <button
                  aria-label={`Open transaction from ${expense.merchantName}: ${expense.category}, ${formatCurrency(expense.amount)}, ${dateLabel}`}
                  className="dashboard-recent-row focus-ring group flex w-full items-center gap-3 rounded-2xl py-3 text-left transition-[background-color,transform] duration-200 ease-out hover:translate-x-0.5 hover:bg-[var(--panel-soft)]"
                  onClick={onOpenTransactions}
                  style={{ animationDelay: `${index * 45}ms` }}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-950">{expense.merchantName}</span>
                    <span className="mt-1 block truncate text-xs text-[var(--muted)]">
                      {expense.category} · {dateLabel}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold text-slate-950">{formatCurrency(expense.amount)}</span>
                  <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--muted)] transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
