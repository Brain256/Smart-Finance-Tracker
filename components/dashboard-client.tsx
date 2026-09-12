"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { deleteExpense } from "@/app/dashboard/actions";
import { CalendarHeatmap } from "@/components/finance/calendar-heatmap";
import { OverviewPanel } from "@/components/finance/overview-panel";
import { SettingsPanel } from "@/components/finance/settings-panel";
import { TransactionsPanel } from "@/components/finance/transactions-panel";
import {
  DashboardNavigation,
  getDashboardPanelId,
  getDashboardTabId,
  type DashboardTabKey
} from "@/components/dashboard-navigation";
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

export function DashboardClient({
  canDelete,
  expenses,
  financeTimezone,
  reviewThreshold,
  incomeRecords,
  savingsTarget,
  trend,
  accuracy
}: DashboardClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<DashboardTabKey>("overview");
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
  const [shouldFocusTransactionsHeading, setShouldFocusTransactionsHeading] = useState(false);
  const transactionsHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setDisplayedExpenses(expenses);
  }, [expenses]);

  useEffect(() => {
    if (!shouldFocusTransactionsHeading || activeTab !== "transactions") return;
    transactionsHeadingRef.current?.focus();
    setShouldFocusTransactionsHeading(false);
  }, [activeTab, shouldFocusTransactionsHeading]);

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
    setDisplayedExpenses((current) =>
      current.map((expense) => expense.id === correctedExpense.id ? correctedExpense : expense)
    );
    router.refresh();
  }

  function handleTabSelect(tab: DashboardTabKey): void {
    setShouldFocusTransactionsHeading(false);
    setActiveTab(tab);
  }

  function handleOpenTransactions(): void {
    setShouldFocusTransactionsHeading(true);
    setActiveTab("transactions");
  }

  const changeMonth = (offset: number) => {
    setActiveCellKey(null);
    setSelectedDateKey(null);
    setMonthKey((current) => addCalendarMonths(current, offset));
  };

  return (
    <div
      className="grid min-w-0 items-start gap-6 pb-24 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8 lg:pb-0"
      data-finance-timezone={financeTimezone}
      data-review-threshold={reviewThreshold}
    >
      <DashboardNavigation activeTab={activeTab} onSelect={handleTabSelect} />

      <div className="min-w-0 w-full">
        <div
          aria-labelledby={getDashboardTabId(activeTab)}
          className="dashboard-tab-content min-w-0 w-full"
          id={getDashboardPanelId(activeTab)}
          key={activeTab}
          role="tabpanel"
        >
        {activeTab === "overview" ? (
          <OverviewPanel
            expenses={displayedExpenses}
            financeTimezone={financeTimezone}
            incomeRecords={incomeRecords}
            onOpenCalendar={() => handleTabSelect("calendar")}
            onOpenTransactions={handleOpenTransactions}
            savingsTarget={savingsTarget}
            trend={trend}
          />
        ) : null}
        {activeTab === "calendar" ? (
          <CalendarHeatmap
            activeCellKey={activeCellKey}
            expenses={displayedExpenses}
            financeTimezone={financeTimezone}
            monthKey={monthKey}
            onActiveCellKeyChange={setActiveCellKey}
            onChangeMonth={changeMonth}
            onSelectDate={setSelectedDateKey}
            selectedDateKey={selectedDateKey}
          />
        ) : null}
        {activeTab === "transactions" ? (
          <TransactionsPanel
            accuracy={accuracy}
            canDelete={canDelete}
            deleteError={deleteError}
            deletingExpenseId={deletingExpenseId}
            expenses={displayedExpenses}
            financeTimezone={financeTimezone}
            headingRef={transactionsHeadingRef}
            isDeletePending={isDeletePending}
            onCorrection={handleCorrection}
            onDelete={handleDelete}
            onSortStateChange={setSortState}
            reviewThreshold={reviewThreshold}
            sortState={sortState}
          />
        ) : null}
        {activeTab === "settings" ? (
          <SettingsPanel incomeRecords={incomeRecords} savingsTarget={savingsTarget} />
        ) : null}
        </div>
      </div>
    </div>
  );
}
