"use client";

import { useState, useTransition } from "react";
import { Banknote, PiggyBank, Target } from "lucide-react";

import {
  deleteCategoryBudget,
  deleteIncomeRecord,
  deleteSavingsTarget,
  saveCategoryBudget,
  saveIncomeRecord,
  saveSavingsTarget
} from "@/app/dashboard/actions";
import { formatCurrency } from "@/lib/format";
import {
  expenseCategories,
  type CategoryBudget,
  type FeatureLoadState,
  type IncomeFrequency,
  type IncomeRecord,
  type SavingsTarget,
  type SavingsTargetMode,
  type SpendingCategory
} from "@/lib/types";

type SettingsPanelProps = {
  budgets: FeatureLoadState<CategoryBudget[]>;
  incomeRecords: FeatureLoadState<IncomeRecord[]>;
  savingsTarget: FeatureLoadState<SavingsTarget | null>;
};

const spendingCategories = expenseCategories.filter(
  (category): category is SpendingCategory => category !== "Income"
);
const incomeFrequencies: IncomeFrequency[] = ["weekly", "biweekly", "monthly"];

const fieldClass =
  "focus-ring w-full rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60";
const primaryButtonClass =
  "focus-ring rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";
const subtleButtonClass =
  "focus-ring rounded-md px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60";
const destructiveButtonClass =
  "focus-ring rounded-md px-2 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60";

function SectionShell({
  icon,
  title,
  description,
  error,
  children
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-[var(--border)] p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold tracking-normal text-slate-950">{title}</h3>
          <p className="text-sm text-[var(--muted)]">{description}</p>
        </div>
      </div>
      {error ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

function UnavailableNotice({ reason }: { reason: string }) {
  return <p className="text-sm text-[var(--muted)]">{reason}</p>;
}

function IncomeSection({ state }: { state: FeatureLoadState<IncomeRecord[]> }) {
  const [records, setRecords] = useState<IncomeRecord[]>(
    state.status === "ready" ? state.data : []
  );
  const [editingId, setEditingId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<IncomeFrequency>("monthly");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resetForm(): void {
    setEditingId(null);
    setAmount("");
    setFrequency("monthly");
    setEffectiveDate("");
  }

  function submit(): void {
    setError(null);
    startTransition(async () => {
      const result = await saveIncomeRecord({
        id: editingId ?? undefined,
        amount,
        frequency,
        effectiveDate
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }

      setRecords((current) => {
        const others = current.filter((record) => record.id !== result.data.id);
        return [...others, result.data].sort((first, second) =>
          second.effectiveDate.localeCompare(first.effectiveDate)
        );
      });
      resetForm();
    });
  }

  function remove(record: IncomeRecord): void {
    setError(null);
    startTransition(async () => {
      const result = await deleteIncomeRecord(record.id);
      if (!result.ok) {
        setError(result.message);
        return;
      }

      setRecords((current) => current.filter((item) => item.id !== record.id));
      if (editingId === record.id) resetForm();
    });
  }

  return (
    <SectionShell
      description="The latest record effective on or before today drives planned income."
      error={error}
      icon={<Banknote aria-hidden="true" className="h-4 w-4" />}
      title="Income history"
    >
      {state.status === "unavailable" ? (
        <UnavailableNotice reason={state.reason} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="income-amount">
                Amount
              </label>
              <input
                className={fieldClass}
                disabled={isPending}
                id="income-amount"
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                value={amount}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="income-frequency">
                Frequency
              </label>
              <select
                className={fieldClass}
                disabled={isPending}
                id="income-frequency"
                onChange={(event) => setFrequency(event.target.value as IncomeFrequency)}
                value={frequency}
              >
                {incomeFrequencies.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="income-effective-date">
                Effective date
              </label>
              <input
                className={fieldClass}
                disabled={isPending}
                id="income-effective-date"
                onChange={(event) => setEffectiveDate(event.target.value)}
                type="date"
                value={effectiveDate}
              />
            </div>
            <div className="flex items-center gap-2">
              <button className={primaryButtonClass} disabled={isPending} onClick={submit} type="button">
                {editingId === null ? "Add income record" : "Save income record"}
              </button>
              {editingId === null ? null : (
                <button className={subtleButtonClass} disabled={isPending} onClick={resetForm} type="button">
                  Cancel
                </button>
              )}
            </div>
          </div>

          {records.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No income records yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
              {records.map((record) => (
                <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" key={record.id}>
                  <span className="text-slate-700">
                    <span className="font-semibold text-slate-950">{formatCurrency(record.amount)}</span>{" "}
                    {record.frequency} from {record.effectiveDate}
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      aria-label={`Edit income record effective ${record.effectiveDate}`}
                      className={subtleButtonClass}
                      disabled={isPending}
                      onClick={() => {
                        setEditingId(record.id);
                        setAmount(record.amount.toFixed(2));
                        setFrequency(record.frequency);
                        setEffectiveDate(record.effectiveDate);
                        setError(null);
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      aria-label={`Remove income record effective ${record.effectiveDate}`}
                      className={destructiveButtonClass}
                      disabled={isPending}
                      onClick={() => remove(record)}
                      type="button"
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SectionShell>
  );
}

function SavingsSection({ state }: { state: FeatureLoadState<SavingsTarget | null> }) {
  const persisted = state.status === "ready" ? state.data : null;
  const [target, setTarget] = useState<SavingsTarget | null>(persisted);
  const [mode, setMode] = useState<SavingsTargetMode>(persisted?.mode ?? "percentage");
  const [value, setValue] = useState(persisted ? persisted.value.toFixed(2) : "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    startTransition(async () => {
      const result = await saveSavingsTarget(mode, value);
      if (!result.ok) {
        setError(result.message);
        return;
      }

      setTarget(result.data);
      setMode(result.data.mode);
      setValue(result.data.value.toFixed(2));
    });
  }

  function remove(): void {
    setError(null);
    startTransition(async () => {
      const result = await deleteSavingsTarget();
      if (!result.ok) {
        setError(result.message);
        return;
      }

      setTarget(null);
      setValue("");
    });
  }

  return (
    <SectionShell
      description="A fixed monthly amount or a percentage of normalized monthly income."
      error={error}
      icon={<PiggyBank aria-hidden="true" className="h-4 w-4" />}
      title="Savings target"
    >
      {state.status === "unavailable" ? (
        <UnavailableNotice reason={state.reason} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="savings-mode">
                Mode
              </label>
              <select
                className={fieldClass}
                disabled={isPending}
                id="savings-mode"
                onChange={(event) => setMode(event.target.value as SavingsTargetMode)}
                value={mode}
              >
                <option value="percentage">percentage</option>
                <option value="fixed">fixed</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="savings-value">
                {mode === "percentage" ? "Percent of income" : "Monthly amount"}
              </label>
              <input
                className={fieldClass}
                disabled={isPending}
                id="savings-value"
                inputMode="decimal"
                onChange={(event) => setValue(event.target.value)}
                placeholder={mode === "percentage" ? "20" : "0.00"}
                value={value}
              />
            </div>
            <div className="flex items-center gap-2">
              <button className={primaryButtonClass} disabled={isPending} onClick={submit} type="button">
                Save savings target
              </button>
              {target === null ? null : (
                <button className={destructiveButtonClass} disabled={isPending} onClick={remove} type="button">
                  Remove
                </button>
              )}
            </div>
          </div>
          <p className="text-sm text-[var(--muted)]">
            {target === null
              ? "No savings target is configured."
              : `Saved target: ${
                  target.mode === "percentage"
                    ? `${target.value}% of normalized monthly income`
                    : `${formatCurrency(target.value)} each month`
                }.`}
          </p>
        </div>
      )}
    </SectionShell>
  );
}

function BudgetSection({ state }: { state: FeatureLoadState<CategoryBudget[]> }) {
  const [budgets, setBudgets] = useState<CategoryBudget[]>(
    state.status === "ready" ? state.data : []
  );
  const [category, setCategory] = useState<SpendingCategory>(spendingCategories[0]);
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    startTransition(async () => {
      const result = await saveCategoryBudget(category, monthlyLimit);
      if (!result.ok) {
        setError(result.message);
        return;
      }

      setBudgets((current) => {
        const others = current.filter((budget) => budget.category !== result.data.category);
        return [...others, result.data].sort((first, second) =>
          first.category.localeCompare(second.category)
        );
      });
      setMonthlyLimit("");
    });
  }

  function remove(budget: CategoryBudget): void {
    setError(null);
    startTransition(async () => {
      const result = await deleteCategoryBudget(budget.category);
      if (!result.ok) {
        setError(result.message);
        return;
      }

      setBudgets((current) => current.filter((item) => item.category !== budget.category));
    });
  }

  return (
    <SectionShell
      description="One monthly limit for each spending category. Income cannot hold a budget."
      error={error}
      icon={<Target aria-hidden="true" className="h-4 w-4" />}
      title="Category budgets"
    >
      {state.status === "unavailable" ? (
        <UnavailableNotice reason={state.reason} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="budget-category">
                Category
              </label>
              <select
                className={fieldClass}
                disabled={isPending}
                id="budget-category"
                onChange={(event) => setCategory(event.target.value as SpendingCategory)}
                value={category}
              >
                {spendingCategories.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="budget-monthly-limit">
                Monthly limit
              </label>
              <input
                className={fieldClass}
                disabled={isPending}
                id="budget-monthly-limit"
                inputMode="decimal"
                onChange={(event) => setMonthlyLimit(event.target.value)}
                placeholder="0.00"
                value={monthlyLimit}
              />
            </div>
            <button className={primaryButtonClass} disabled={isPending} onClick={submit} type="button">
              Save budget
            </button>
          </div>

          {budgets.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No category budgets yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
              {budgets.map((budget) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  key={budget.category}
                >
                  <span className="text-slate-700">
                    <span className="font-semibold text-slate-950">{budget.category}</span>{" "}
                    {formatCurrency(budget.monthlyLimit)} per month
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      aria-label={`Edit ${budget.category} budget`}
                      className={subtleButtonClass}
                      disabled={isPending}
                      onClick={() => {
                        setCategory(budget.category);
                        setMonthlyLimit(budget.monthlyLimit.toFixed(2));
                        setError(null);
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      aria-label={`Remove ${budget.category} budget`}
                      className={destructiveButtonClass}
                      disabled={isPending}
                      onClick={() => remove(budget)}
                      type="button"
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SectionShell>
  );
}

/**
 * Editing surface for planned income, savings, and budgets. Derived limits are presented on
 * Overview only, so this panel never shows a calculated value as an editable field.
 */
export function SettingsPanel({ budgets, incomeRecords, savingsTarget }: SettingsPanelProps) {
  return (
    <section className="grid gap-5">
      <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold tracking-normal text-slate-950">Settings</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Planned income, savings, and category budgets feed the derived limits and projection on Overview.
        </p>
      </div>
      <IncomeSection state={incomeRecords} />
      <SavingsSection state={savingsTarget} />
      <BudgetSection state={budgets} />
    </section>
  );
}
