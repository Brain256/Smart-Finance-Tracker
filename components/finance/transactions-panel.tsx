"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ReceiptText, Trash2 } from "lucide-react";

import { correctExpenseCategory } from "@/app/dashboard/actions";
import { EMPTY_EXPENSE_FILTERS, filterExpenses, validateFilterDateRange, type ExpenseFilters } from "@/lib/finance-analytics";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { expenseCategories, type ExpenseRecord, type SortKey, type SortState } from "@/lib/types";

type TransactionsPanelProps = {
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

function CategoryEditor({ expense, onCorrection, selectRef }: Pick<TransactionsPanelProps, "onCorrection"> & { expense: ExpenseRecord; selectRef: (element: HTMLSelectElement | null) => void }) {
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
      } catch {
        setSelectedCategory(expense.category);
        setError("Unable to save the category correction. Please try again.");
      }
    });
  }

  return <div className="flex min-w-52 flex-col items-start gap-2"><label className="sr-only" htmlFor={selectId}>Category for {expense.merchantName}</label><select aria-describedby={error ? errorId : undefined} className="focus-ring w-full rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60" disabled={isPending} id={selectId} onChange={(event) => setSelectedCategory(event.target.value as ExpenseRecord["category"])} ref={selectRef} value={selectedCategory}>{expenseCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select><div className="flex items-center gap-2"><button className="focus-ring rounded-md bg-[var(--primary)] px-2 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60" disabled={isPending || selectedCategory === expense.category} aria-label={`Save category for ${expense.merchantName}`} onClick={save} type="button">{isPending ? "Saving..." : "Save"}</button><button aria-label={`Cancel category edit for ${expense.merchantName}`} className="focus-ring rounded-md px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60" disabled={isPending || selectedCategory === expense.category} onClick={() => { setSelectedCategory(expense.category); setError(null); }} type="button">Cancel</button></div>{error ? <p className="text-xs text-red-700" id={errorId} role="alert">{error}</p> : null}</div>;
}

const filterFieldClass = "focus-ring w-full rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-sm text-slate-900";

function FilterControls({ filters, onChange, onClear }: { filters: ExpenseFilters; onChange: (next: ExpenseFilters) => void; onClear: () => void }) {
  const dateRange = validateFilterDateRange(filters.startDate, filters.endDate);

  return <div className="border-b border-[var(--border)] p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"><div><label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="filter-merchant">Search merchant</label><input className={filterFieldClass} id="filter-merchant" onChange={(event) => onChange({ ...filters, merchantQuery: event.target.value })} placeholder="Any merchant" type="search" value={filters.merchantQuery} /></div><div><label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="filter-category">Category</label><select className={filterFieldClass} id="filter-category" onChange={(event) => onChange({ ...filters, category: event.target.value as ExpenseFilters["category"] })} value={filters.category}><option value="all">All categories</option>{expenseCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></div><div><label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="filter-start-date">Start date</label><input className={filterFieldClass} id="filter-start-date" onChange={(event) => onChange({ ...filters, startDate: event.target.value })} type="date" value={filters.startDate} /></div><div><label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="filter-end-date">End date</label><input className={filterFieldClass} id="filter-end-date" onChange={(event) => onChange({ ...filters, endDate: event.target.value })} type="date" value={filters.endDate} /></div><button className="focus-ring rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" onClick={onClear} type="button">Clear filters</button></div>{dateRange.status === "invalid" ? <p className="mt-2 text-sm text-red-700" role="alert">{dateRange.message}</p> : null}</div>;
}

export function TransactionsPanel({ canDelete, expenses, financeTimezone, reviewThreshold, sortState, onCorrection, onSortStateChange, deleteError, deletingExpenseId, isDeletePending, onDelete }: TransactionsPanelProps) {
  const selectRefs = useRef<Record<number, HTMLSelectElement | null>>({});
  const [filters, setFilters] = useState<ExpenseFilters>(EMPTY_EXPENSE_FILTERS);
  // Requirement 12: validate the range, filter, then apply the existing sort.
  const sortedExpenses = sortExpenses(filterExpenses(expenses, filters, financeTimezone), sortState);
  const columns: Array<[SortKey, string]> = [["timestamp", "Date"], ["merchantName", "Merchant"], ["category", "Category"], ["amount", "Amount"]];

  return <section className="rounded-lg border border-[var(--border)] bg-white shadow-sm"><div className="flex items-center gap-3 border-b border-[var(--border)] p-4"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700"><ReceiptText aria-hidden="true" className="h-4 w-4" /></div><div><h2 className="text-base font-semibold tracking-normal text-slate-950">Transactions</h2><p className="text-sm text-[var(--muted)]">{sortedExpenses.length} of {expenses.length} records sorted by {sortState.key}</p></div></div><FilterControls filters={filters} onChange={setFilters} onClear={() => setFilters(EMPTY_EXPENSE_FILTERS)} />{deleteError ? <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{deleteError}</div> : null}{sortedExpenses.length === 0 ? <p className="px-4 py-6 text-sm text-[var(--muted)]">{expenses.length === 0 ? "No transactions have been recorded yet." : "No transactions match the current search and filters."}</p> : <div className="overflow-x-auto"><table className="min-w-[780px] table-fixed text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{columns.map(([key, label]) => <th className="px-4 py-3 font-semibold" key={key}><button className="focus-ring inline-flex items-center gap-1 rounded-sm text-left hover:text-slate-900" onClick={() => onSortStateChange((current) => nextSortState(current, key))} type="button">{label}<SortIcon sortKey={key} sortState={sortState} /></button></th>)}<th className="w-52 px-4 py-3 font-semibold">Category editor</th>{canDelete ? <th className="w-32 px-4 py-3 text-right font-semibold">Actions</th> : null}</tr></thead><tbody className="divide-y divide-[var(--border)]">{sortedExpenses.map((expense) => {
    const needsReview = isUnverified(expense, reviewThreshold);
    const confidenceUnavailable = expense.confidence == null;

    return <tr className="hover:bg-slate-50" key={expense.id}><td className="px-4 py-3 text-slate-700">{formatDateTime(expense.timestamp)}</td><td className="px-4 py-3 font-medium text-slate-950"><div className="flex flex-wrap items-center gap-2"><span>{expense.merchantName}</span>{needsReview ? <button aria-label={`Unverified category for ${expense.merchantName}. Focus category editor`} className="focus-ring inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 hover:bg-amber-200" onClick={() => selectRefs.current[expense.id]?.focus()} type="button"><AlertTriangle aria-hidden="true" className="h-3 w-3" />Unverified</button> : confidenceUnavailable ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Confidence unavailable</span> : null}</div></td><td className="px-4 py-3 text-slate-700">{expense.category}</td><td className="px-4 py-3 font-semibold text-slate-950">{formatCurrency(expense.amount)}</td><td className="px-4 py-3"><CategoryEditor expense={expense} onCorrection={onCorrection} selectRef={(element) => { selectRefs.current[expense.id] = element; }} /></td>{canDelete ? <td className="px-4 py-3 text-right"><button aria-label={`Delete transaction from ${expense.merchantName}`} className="focus-ring inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={isDeletePending} onClick={() => onDelete(expense)} type="button"><Trash2 aria-hidden="true" className="h-3.5 w-3.5" />{isDeletePending && deletingExpenseId === expense.id ? "Deleting..." : "Delete"}</button></td> : null}</tr>;
  })}</tbody></table></div>}</section>;
}
