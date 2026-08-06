"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { deleteExpense } from "@/app/dashboard/actions";
import { CalendarHeatmap } from "@/components/finance/calendar-heatmap";
import { OverviewPanel } from "@/components/finance/overview-panel";
import { SettingsPanel } from "@/components/finance/settings-panel";
import { TransactionsPanel } from "@/components/finance/transactions-panel";
import { addCalendarMonths, getFinanceMonthKey } from "@/lib/finance-analytics";
import { formatCurrency } from "@/lib/format";
import type {
  ClassificationAccuracy,
  ExpenseRecord,
  FeatureLoadState,
  IncomeRecord,
  SavingsTarget,
  SortState,
  TrendPoint
} from "@/lib/types";

export { INTENSITY_LEVELS, NON_ZERO_LEVEL_COUNT } from "@/components/finance/calendar-heatmap";
export type { IntensityLevel } from "@/components/finance/calendar-heatmap";

type DashboardClientProps = {
  canDelete: boolean;
  expenses: ExpenseRecord[];
  financeTimezone: string;
  reviewThreshold: number;
  incomeRecords: FeatureLoadState<IncomeRecord[]>;
  savingsTarget: FeatureLoadState<SavingsTarget | null>;
  trend: FeatureLoadState<TrendPoint[]>;
  accuracy: FeatureLoadState<ClassificationAccuracy>;
};
type TabKey = "overview" | "calendar" | "transactions" | "settings";

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "calendar", label: "Calendar" },
  { key: "transactions", label: "Transactions" },
  { key: "settings", label: "Settings" }
];

export function DashboardClient({ canDelete, expenses, financeTimezone, reviewThreshold, incomeRecords, savingsTarget, trend, accuracy }: DashboardClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [displayedExpenses, setDisplayedExpenses] = useState(expenses);
  const [monthKey, setMonthKey] = useState(() => getFinanceMonthKey(new Date(), financeTimezone));
  const [activeCellKey, setActiveCellKey] = useState<string | null>(null);
  // Selection is separate from the hover tooltip: the detail panel must survive the
  // mouse leaving the cell that opened it.
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingExpenseId, setDeletingExpenseId] = useState<number | null>(null);
  const [isDeletePending, startDeleteTransition] = useTransition();
  const [sortState, setSortState] = useState<SortState>({ key: "timestamp", direction: "desc" });

  useEffect(() => {
    setDisplayedExpenses(expenses);
  }, [expenses]);

  function handleDelete(expense: ExpenseRecord): void {
    if (!window.confirm(`Delete the ${formatCurrency(expense.amount)} transaction from ${expense.merchantName}?`)) return;
    setDeleteError(null);
    setDeletingExpenseId(expense.id);
    startDeleteTransition(async () => {
      try {
        const result = await deleteExpense(expense.id);
        if (!result.ok) {
          setDeleteError(result.message);
        }
      } catch {
        setDeleteError("Unable to delete the transaction. Please try again.");
      } finally {
        setDeletingExpenseId(null);
      }
    });
  }

  function handleCorrection(correctedExpense: ExpenseRecord): void {
    setDisplayedExpenses((current) => current.map((expense) => expense.id === correctedExpense.id ? correctedExpense : expense));
    router.refresh();
  }

  const changeMonth = (offset: number) => {
    setActiveCellKey(null);
    setSelectedDateKey(null);
    setMonthKey((current) => addCalendarMonths(current, offset));
  };

  return <div className="flex min-w-0 flex-col gap-5" data-finance-timezone={financeTimezone} data-review-threshold={reviewThreshold}><nav aria-label="Dashboard sections" className="grid grid-cols-2 rounded-lg border border-[var(--border)] bg-white p-1 shadow-sm sm:grid-cols-4">{tabs.map((tab) => <button aria-selected={activeTab === tab.key} className={`focus-ring h-10 rounded-md px-2 text-sm font-medium transition ${activeTab === tab.key ? "bg-[var(--primary)] text-white" : "text-slate-600 hover:bg-slate-50"}`} key={tab.key} onClick={() => setActiveTab(tab.key)} role="tab" type="button">{tab.label}</button>)}</nav>{activeTab === "overview" ? <OverviewPanel expenses={displayedExpenses} financeTimezone={financeTimezone} incomeRecords={incomeRecords} onOpenCalendar={() => setActiveTab("calendar")} savingsTarget={savingsTarget} trend={trend} /> : null}{activeTab === "calendar" ? <CalendarHeatmap activeCellKey={activeCellKey} expenses={displayedExpenses} financeTimezone={financeTimezone} monthKey={monthKey} onActiveCellKeyChange={setActiveCellKey} onChangeMonth={changeMonth} onSelectDate={setSelectedDateKey} selectedDateKey={selectedDateKey} /> : null}{activeTab === "transactions" ? <TransactionsPanel accuracy={accuracy} canDelete={canDelete} deleteError={deleteError} deletingExpenseId={deletingExpenseId} expenses={displayedExpenses} financeTimezone={financeTimezone} isDeletePending={isDeletePending} onCorrection={handleCorrection} onDelete={handleDelete} onSortStateChange={setSortState} reviewThreshold={reviewThreshold} sortState={sortState} /> : null}{activeTab === "settings" ? <SettingsPanel incomeRecords={incomeRecords} savingsTarget={savingsTarget} /> : null}</div>;
}
