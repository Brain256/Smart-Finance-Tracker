"use client";

import { useState, useTransition } from "react";
import { Banknote, PiggyBank } from "lucide-react";

import {
  deleteIncomeRecord,
  deleteSavingsTarget,
  saveIncomeRecord,
  saveSavingsTarget
} from "@/app/dashboard/actions";
import { formatCurrency } from "@/lib/format";
import {
  type FeatureLoadState,
  type IncomeFrequency,
  type IncomeRecord,
  type SavingsTarget,
  type SavingsTargetMode
} from "@/lib/types";

type SettingsPanelProps = {
  incomeRecords: FeatureLoadState<IncomeRecord[]>;
  savingsTarget: FeatureLoadState<SavingsTarget | null>;
};

const incomeFrequencies: IncomeFrequency[] = ["weekly", "biweekly", "monthly"];

const fieldClass =
  "focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--foreground)] shadow-sm disabled:cursor-not-allowed disabled:opacity-60";
const primaryButtonClass =
  "focus-ring rounded-xl bg-[var(--primary)] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-60";
const subtleButtonClass =
  "focus-ring rounded-xl bg-[var(--panel-soft)] px-2.5 py-1.5 text-xs font-semibold text-[var(--primary-dark)] transition hover:bg-[#d7ecdf] disabled:cursor-not-allowed disabled:opacity-60";
const destructiveButtonClass =
  "focus-ring rounded-xl bg-[var(--danger-soft)] px-2.5 py-1.5 text-xs font-semibold text-[var(--danger)] transition hover:bg-[#ffd4ce] disabled:cursor-not-allowed disabled:opacity-60";

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
    <section className="dashboard-card">
      <div className="flex items-center gap-3 border-b border-[var(--border)] p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center dashboard-icon-tile">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold tracking-normal text-slate-950">{title}</h3>
          <p className="text-sm text-[var(--muted)]">{description}</p>
        </div>
      </div>
      {error ? (
        <p className="border-b border-[var(--danger-soft)] bg-[var(--danger-soft)] px-4 py-2 text-sm text-[var(--danger)]" role="alert">
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
            <ul className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
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

/** Editing surface for planned income and savings. Derived limits are presented on Overview. */
export function SettingsPanel({ incomeRecords, savingsTarget }: SettingsPanelProps) {
  return (
    <section className="grid gap-5">
      <div className="dashboard-card p-4">
        <h2 className="text-base font-semibold tracking-normal text-slate-950">Settings</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Planned income and savings targets feed the derived spending limits on Overview.
        </p>
      </div>
      <IncomeSection state={incomeRecords} />
      <SavingsSection state={savingsTarget} />
    </section>
  );
}
