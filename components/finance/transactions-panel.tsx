"use client";

import { useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Pencil, ReceiptText, Trash2 } from "lucide-react";

import { correctExpenseCategory } from "@/app/dashboard/actions";
import { ClassificationAccuracyPanel } from "@/components/finance/classification-accuracy-panel";
import { EMPTY_EXPENSE_FILTERS, filterExpenses, validateFilterDateRange, type ExpenseFilters } from "@/lib/finance-analytics";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { expenseCategories, type ClassificationAccuracy, type ExpenseRecord, type FeatureLoadState, type SortKey, type SortState } from "@/lib/types";

type TransactionsPanelProps = {
  accuracy: FeatureLoadState<ClassificationAccuracy>;
  canDelete: boolean;
  expenses: ExpenseRecord[];
  financeTimezone: string;
  reviewThreshold: number;
  sortState: SortState;
  onCorrection: (expense: ExpenseRecord) => void;
  onSortStateChange: (update: (current: SortState) => SortState) => void;
  deleteError: string | null;
  deletingExpenseId: number | null;
  isDeletePending: boolean;
  onDelete: (expense: ExpenseRecord) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
};

function sortExpenses(expenses: ExpenseRecord[], sortState: SortState): ExpenseRecord[] {
  return [...expenses].sort((first, second) => {
    const direction = sortState.direction === "asc" ? 1 : -1;
    if (sortState.key === "amount") return (first.amount - second.amount) * direction;
    if (sortState.key === "timestamp") return (new Date(first.timestamp).getTime() - new Date(second.timestamp).getTime()) * direction;
    return first[sortState.key].localeCompare(second[sortState.key]) * direction;
  });
}

function nextSortState(current: SortState, key: SortKey): SortState {
  if (current.key !== key) return { key, direction: key === "timestamp" ? "desc" : "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

function SortIcon({ sortState, sortKey }: { sortState: SortState; sortKey: SortKey }) {
  if (sortState.key !== sortKey) return <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5" />;
  return sortState.direction === "asc" ? <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" /> : <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />;
}

export function isUnverified(expense: ExpenseRecord, reviewThreshold: number): boolean {
  return expense.confidence != null && expense.confidence < reviewThreshold && expense.reviewed === false;
}

type CategoryEditorProps = Pick<TransactionsPanelProps, "onCorrection"> & {
  expense: ExpenseRecord;
  onClose: () => void;
  selectRef: (element: HTMLSelectElement | null) => void;
};

function CategoryEditor({ expense, onCorrection, onClose, selectRef }: CategoryEditorProps) {
  const [selectedCategory, setSelectedCategory] = useState(expense.category);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectId = `expense-${expense.id}-category`;
  const errorId = `expense-${expense.id}-category-error`;

  useEffect(() => {
    setSelectedCategory(expense.category);
  }, [expense.category]);

  function save(): void {
    setError(null);
    startTransition(async () => {
      try {
        const result = await correctExpenseCategory(expense.id, selectedCategory);
        if (!result.ok) {
          setSelectedCategory(expense.category);
          setError(result.message);
          return;
        }

        onCorrection(result.data.expense);
        onClose();
      } catch {
        setSelectedCategory(expense.category);
        setError("Unable to save the category correction. Please try again.");
      }
    });
  }

  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-2 sm:min-w-52">
      <label className="sr-only" htmlFor={selectId}>Category for {expense.merchantName}</label>
      <select
        aria-describedby={error ? errorId : undefined}
        className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        id={selectId}
        onChange={(event) => setSelectedCategory(event.target.value as ExpenseRecord["category"])}
        ref={selectRef}
        value={selectedCategory}
      >
        {expenseCategories.map((category) => <option key={category} value={category}>{category}</option>)}
      </select>
      <div className="flex items-center gap-2">
        <button
          aria-label={`Save category for ${expense.merchantName}`}
          className="focus-ring rounded-xl bg-[var(--primary)] px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending || selectedCategory === expense.category}
          onClick={save}
          type="button"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        <button
          aria-label={`Cancel category edit for ${expense.merchantName}`}
          className="focus-ring rounded-xl bg-[var(--panel-soft)] px-2.5 py-1.5 text-xs font-semibold text-[var(--primary-dark)] transition hover:bg-[#d7ecdf] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending}
          onClick={() => {
            setSelectedCategory(expense.category);
            setError(null);
            onClose();
          }}
          type="button"
        >
          Cancel
        </button>
      </div>
      {error ? <p className="text-xs text-[var(--danger)]" id={errorId} role="alert">{error}</p> : null}
    </div>
  );
}

const filterFieldClass = "focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--foreground)] shadow-sm";

function FilterControls({ filters, onChange, onClear }: { filters: ExpenseFilters; onChange: (next: ExpenseFilters) => void; onClear: () => void }) {
  const dateRange = validateFilterDateRange(filters.startDate, filters.endDate);

  return <div className="border-b border-[var(--border)] p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"><div><label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="filter-merchant">Search merchant</label><input className={filterFieldClass} id="filter-merchant" onChange={(event) => onChange({ ...filters, merchantQuery: event.target.value })} placeholder="Any merchant" type="search" value={filters.merchantQuery} /></div><div><label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="filter-category">Category</label><select className={filterFieldClass} id="filter-category" onChange={(event) => onChange({ ...filters, category: event.target.value as ExpenseFilters["category"] })} value={filters.category}><option value="all">All categories</option>{expenseCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></div><div><label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="filter-start-date">Start date</label><input className={filterFieldClass} id="filter-start-date" onChange={(event) => onChange({ ...filters, startDate: event.target.value })} type="date" value={filters.startDate} /></div><div><label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="filter-end-date">End date</label><input className={filterFieldClass} id="filter-end-date" onChange={(event) => onChange({ ...filters, endDate: event.target.value })} type="date" value={filters.endDate} /></div><button className="focus-ring rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] px-3 py-2 text-xs font-semibold text-[var(--primary-dark)] transition hover:bg-[#d7ecdf]" onClick={onClear} type="button">Clear filters</button></div>{dateRange.status === "invalid" ? <p className="mt-2 text-sm text-[var(--danger)]" role="alert">{dateRange.message}</p> : null}</div>;
}

export function TransactionsPanel({ accuracy, canDelete, expenses, financeTimezone, reviewThreshold, sortState, onCorrection, onSortStateChange, deleteError, deletingExpenseId, isDeletePending, onDelete, headingRef }: TransactionsPanelProps) {
  const selectRefs = useRef<Record<number, HTMLSelectElement | null>>({});
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [focusExpenseId, setFocusExpenseId] = useState<number | null>(null);
  const [filters, setFilters] = useState<ExpenseFilters>(EMPTY_EXPENSE_FILTERS);
  // Requirement 12: validate the range, filter, then apply the existing sort.
  const sortedExpenses = sortExpenses(filterExpenses(expenses, filters, financeTimezone), sortState);
  const columns: Array<[SortKey, string]> = [["timestamp", "Date"], ["merchantName", "Merchant"], ["category", "Category"], ["amount", "Amount"]];

  useEffect(() => {
    if (focusExpenseId === null || editingExpenseId !== focusExpenseId) return;
    const select = selectRefs.current[focusExpenseId];
    if (!select) return;
    select.focus();
    setFocusExpenseId(null);
  }, [editingExpenseId, focusExpenseId]);

  function openEditor(expenseId: number, focus = false): void {
    setEditingExpenseId(expenseId);
    setFocusExpenseId(focus ? expenseId : null);
  }

  function closeEditor(): void {
    setEditingExpenseId(null);
    setFocusExpenseId(null);
  }

  return (
    <div className="grid gap-5">
      <ClassificationAccuracyPanel accuracy={accuracy} />
      <section className="dashboard-card">
        <div className="flex items-center gap-3 border-b border-[var(--border)] p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center dashboard-icon-tile"><ReceiptText aria-hidden="true" className="h-4 w-4" /></div>
          <div><h2 className="text-base font-semibold tracking-normal text-slate-950" id="transactions-panel-heading" ref={headingRef} tabIndex={-1}>Transactions</h2><p className="text-sm text-[var(--muted)]">{sortedExpenses.length} of {expenses.length} records sorted by {sortState.key}</p></div>
        </div>
        <FilterControls filters={filters} onChange={setFilters} onClear={() => setFilters(EMPTY_EXPENSE_FILTERS)} />
        {deleteError ? <div className="border-b border-[var(--danger-soft)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]" role="alert">{deleteError}</div> : null}
        {sortedExpenses.length === 0 ? <p className="px-4 py-6 text-sm text-[var(--muted)]">{expenses.length === 0 ? "No transactions have been recorded yet." : "No transactions match the current search and filters."}</p> : <div className="min-w-0 max-w-full"><table className="block w-full min-w-0 text-left text-sm sm:table sm:table-fixed"><thead className="hidden bg-[var(--panel-soft)] text-xs uppercase text-[var(--muted-strong)] sm:table-header-group"><tr className="sm:table-row">{columns.map(([key, label]) => <th className="px-4 py-3 font-semibold" key={key}><button className="focus-ring inline-flex items-center gap-1 rounded-md text-left hover:text-[var(--primary-dark)]" onClick={() => onSortStateChange((current) => nextSortState(current, key))} type="button">{label}<SortIcon sortKey={key} sortState={sortState} /></button></th>)}<th className="w-28 px-4 py-3 text-right font-semibold">Actions</th></tr></thead><tbody className="block divide-y divide-[var(--border)] sm:table-row-group">{sortedExpenses.map((expense) => {
          const needsReview = isUnverified(expense, reviewThreshold);
          const confidenceUnavailable = expense.confidence == null;
          const isEditing = editingExpenseId === expense.id;

          return <tr className="block border-b border-[var(--border)] p-3 hover:bg-[var(--panel-soft)] sm:table-row sm:border-b-0 sm:p-0" key={expense.id}><td className="block px-0 py-1 text-slate-700 sm:table-cell sm:px-4 sm:py-3">{formatDateTime(expense.timestamp)}</td><td className="block px-0 py-1 font-medium text-slate-950 sm:table-cell sm:px-4 sm:py-3"><div className="flex flex-wrap items-center gap-2"><span>{expense.merchantName}</span>{needsReview ? <button aria-label={`Unverified category for ${expense.merchantName}. Focus category editor`} className="focus-ring inline-flex items-center gap-1 rounded-full bg-[var(--warning-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--warning)] hover:bg-[#ffe8ad]" onClick={() => openEditor(expense.id, true)} type="button"><AlertTriangle aria-hidden="true" className="h-3 w-3" />Unverified</button> : confidenceUnavailable ? <span className="rounded-full bg-[var(--panel-soft)] px-2.5 py-1 text-xs font-medium text-[var(--muted-strong)]">Confidence unavailable</span> : null}</div></td><td className="block px-0 py-1 text-slate-700 sm:table-cell sm:px-4 sm:py-3">{expense.category}</td><td className="block px-0 py-1 font-semibold text-slate-950 sm:table-cell sm:px-4 sm:py-3">{formatCurrency(expense.amount)}</td><td className="block px-0 py-1 text-right sm:table-cell sm:px-4 sm:py-3"><div className="flex items-center justify-end gap-2"><button aria-label={`Edit category for ${expense.merchantName}`} className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--panel-soft)] text-[var(--primary-dark)] transition hover:bg-[#d7ecdf]" onClick={() => openEditor(expense.id)} title="Edit category" type="button"><Pencil aria-hidden="true" className="h-4 w-4" /></button>{canDelete ? <button aria-label={`Delete transaction from ${expense.merchantName}`} className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--danger-soft)] text-[var(--danger)] transition hover:bg-[#ffd4ce] disabled:cursor-not-allowed disabled:opacity-50" disabled={isDeletePending} onClick={() => onDelete(expense)} title="Delete transaction" type="button"><Trash2 aria-hidden="true" className="h-4 w-4" /></button> : null}</div>{isEditing ? <div className="mt-3 flex justify-end border-t border-[var(--border)] pt-3"><CategoryEditor expense={expense} onClose={closeEditor} onCorrection={onCorrection} selectRef={(element) => { selectRefs.current[expense.id] = element; }} /></div> : null}</td></tr>;
        })}</tbody></table></div>}
      </section>
    </div>
  );
}
