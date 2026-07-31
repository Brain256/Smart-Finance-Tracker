"use client";

import {
  CalendarDays,
  Clock3,
  LineChart as LineChartIcon,
  MapPin,
  PieChart as PieChartIcon,
  Scale,
  ShieldCheck,
  TrendingUp,
  Wallet
} from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import {
  getBudgetProgress,
  getFinanceDateKey,
  getNetCashFlow,
  getPeriodMetrics,
  getPlanningLimits,
  getProjection,
  isSpendingExpense,
  type BudgetProgress
} from "@/lib/finance-analytics";
import { formatCompactCurrency, formatCurrency, formatDate } from "@/lib/format";
import type {
  CategoryBudget,
  ChartDatum,
  ClassificationAccuracy,
  ExpenseRecord,
  FeatureLoadState,
  IncomeRecord,
  ProjectionPrerequisite,
  SavingsTarget,
  TrendPoint
} from "@/lib/types";

type OverviewPanelProps = {
  expenses: ExpenseRecord[];
  financeTimezone: string;
  budgets: FeatureLoadState<CategoryBudget[]>;
  incomeRecords: FeatureLoadState<IncomeRecord[]>;
  savingsTarget: FeatureLoadState<SavingsTarget | null>;
  trend: FeatureLoadState<TrendPoint[]>;
  accuracy: FeatureLoadState<ClassificationAccuracy>;
};

const chartColors = ["#0f766e", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#4b5563"];

const budgetStateClasses: Record<BudgetProgress["state"], string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500"
};

const prerequisiteLabels: Record<ProjectionPrerequisite, string> = {
  budgets: "category budgets",
  "active-income": "an active income record",
  "savings-target": "a savings target"
};

/** Reads optional snapshot data, mapping an unavailable capability to the analytics null input. */
function readyOrNull<T>(state: FeatureLoadState<T>): T | null {
  return state.status === "ready" ? state.data : null;
}

function listPrerequisites(missing: readonly ProjectionPrerequisite[]): string {
  return missing.map((item) => prerequisiteLabels[item]).join(", ");
}

function sumChartValues(data: ChartDatum[]): number {
  return data.reduce((total, item) => total + item.value, 0);
}

function groupByTotal(expenses: ExpenseRecord[], getLabel: (expense: ExpenseRecord) => string): ChartDatum[] {
  const totals = new Map<string, number>();
  expenses.forEach((expense) => totals.set(getLabel(expense), (totals.get(getLabel(expense)) ?? 0) + expense.amount));
  return Array.from(totals.entries()).map(([name, value]) => ({ name, value })).sort((first, second) => second.value - first.value);
}

function groupSmallSlices(data: ChartDatum[], maxSlices: number): ChartDatum[] {
  if (data.length <= maxSlices) return data;
  return [...data.slice(0, maxSlices - 1), { name: "Other", value: sumChartValues(data.slice(maxSlices - 1)) }];
}

function MetricCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: number; detail: string }) {
  return <section className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-[var(--muted)]">{label}</p><p className="mt-2 text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">{formatCurrency(value)}</p></div><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--panel-soft)] text-[var(--primary)]">{icon}</div></div><p className="mt-3 text-sm text-[var(--muted)]">{detail}</p></section>;
}

function PanelShell({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm"><div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold tracking-normal text-slate-950">{title}</h2><p className="text-sm text-[var(--muted)]">{subtitle}</p></div><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">{icon}</div></div>{children}</section>;
}

function SpendingPieChart({ title, subtitle, data, icon }: { title: string; subtitle: string; data: ChartDatum[]; icon: React.ReactNode }) {
  const total = sumChartValues(data);
  return <section className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm"><div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold tracking-normal text-slate-950">{title}</h2><p className="text-sm text-[var(--muted)]">{subtitle}</p></div><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">{icon}</div></div>{total > 0 ? <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]"><div className="h-72 min-w-0"><ResponsiveContainer height="100%" width="100%"><PieChart><Pie data={data} dataKey="value" innerRadius="58%" nameKey="name" outerRadius="86%" paddingAngle={2}>{data.map((entry, index) => <Cell fill={chartColors[index % chartColors.length]} key={entry.name} />)}</Pie><Tooltip formatter={(value) => [formatCurrency(Number(value)), "Spent"]} /></PieChart></ResponsiveContainer></div><div className="grid content-center gap-2">{data.map((item, index) => <div className="flex items-center gap-2 text-sm" key={item.name}><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: chartColors[index % chartColors.length] }} /><span className="min-w-0 flex-1 truncate text-slate-700">{item.name}</span><span className="shrink-0 font-medium text-slate-950">{((item.value / total) * 100).toFixed(0)}%</span></div>)}</div></div> : <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-[var(--border)] text-sm text-[var(--muted)]">No spending data yet</div>}</section>;
}

function SpendingTrendChart({ trend }: { trend: FeatureLoadState<TrendPoint[]> }) {
  return (
    <PanelShell
      icon={<LineChartIcon aria-hidden="true" className="h-4 w-4" />}
      subtitle="Zero-filled daily spending for the trailing 90 days, excluding Income"
      title="Spending trend"
    >
      {trend.status === "unavailable" ? (
        <p className="text-sm text-[var(--muted)]">{trend.reason}</p>
      ) : (
        <>
          <div className="h-64 min-w-0">
            <ResponsiveContainer height="100%" width="100%">
              <LineChart data={trend.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" minTickGap={28} tick={{ fontSize: 12 }} tickFormatter={(value: string) => formatDate(`${value}T12:00:00.000Z`)} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(value: number) => formatCompactCurrency(value)} width={70} />
                <Tooltip
                  formatter={(value) => [formatCurrency(Number(value)), "Spent"]}
                  labelFormatter={(label) => formatDate(`${String(label)}T12:00:00.000Z`)}
                />
                <Line dataKey="total" dot={false} stroke="#0f766e" strokeWidth={2} type="monotone" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {/* Recharts renders the line to canvas-like SVG, so the same series is exposed as focusable text. */}
          <ul className="sr-only">
            {trend.data.map((point) => (
              <li key={point.date} tabIndex={0}>{`${point.date}: ${formatCurrency(point.total)} spent`}</li>
            ))}
          </ul>
        </>
      )}
    </PanelShell>
  );
}

function BudgetProgressList({ budgets, progress }: { budgets: FeatureLoadState<CategoryBudget[]>; progress: BudgetProgress[] }) {
  if (budgets.status === "unavailable") {
    return <p className="mt-4 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">{budgets.reason}</p>;
  }
  if (progress.length === 0) {
    return <p className="mt-4 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">No category budgets are configured yet.</p>;
  }

  return (
    <ul className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4">
      {progress.map((item) => (
        <li key={item.category}>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium text-slate-800">{item.category}</span>
            <span className="text-slate-600">
              {formatCurrency(item.spending)} of {formatCurrency(item.monthlyLimit)}
              {item.consumption === null ? " (no limit set)" : ` (${Math.round(item.consumption * 100)}%)`}
            </span>
          </div>
          <div
            aria-label={`${item.category} budget usage`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={item.consumption === null ? 0 : Math.round(item.consumption * 100)}
            className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
          >
            <div
              className={`h-full rounded-full ${budgetStateClasses[item.state]}`}
              data-state={item.state}
              style={{ width: `${Math.min(100, item.consumption === null ? (item.spending > 0 ? 100 : 0) : item.consumption * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function AccuracyPanel({ accuracy }: { accuracy: FeatureLoadState<ClassificationAccuracy> }) {
  return (
    <PanelShell
      icon={<ShieldCheck aria-hidden="true" className="h-4 w-4" />}
      subtitle="Share of the last 90 days of classifications that were never corrected"
      title="Classification accuracy"
    >
      {accuracy.status === "unavailable" ? (
        <p className="text-sm text-[var(--muted)]">{accuracy.reason}</p>
      ) : accuracy.data.accuracy === null ? (
        <p className="text-sm text-[var(--muted)]">Not enough classified transactions yet to report accuracy.</p>
      ) : (
        <div>
          <p className="text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
            {`${(accuracy.data.accuracy * 100).toFixed(1)}%`}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {`${accuracy.data.correctedCount} corrected of ${accuracy.data.totalClassified} classified since ${accuracy.data.windowStart}`}
          </p>
        </div>
      )}
    </PanelShell>
  );
}

export function OverviewPanel({ expenses, financeTimezone, budgets, incomeRecords, savingsTarget, trend, accuracy }: OverviewPanelProps) {
  const calculationDate = getFinanceDateKey(new Date(), financeTimezone);
  const spendingExpenses = expenses.filter(isSpendingExpense);
  const metrics = getPeriodMetrics(expenses, calculationDate, financeTimezone);
  const netThisMonth = getNetCashFlow(expenses, calculationDate, financeTimezone);
  const limits = getPlanningLimits(readyOrNull(incomeRecords), readyOrNull(savingsTarget), calculationDate);
  const budgetProgress = getBudgetProgress(expenses, readyOrNull(budgets) ?? [], calculationDate, financeTimezone);
  const projection = getProjection(
    expenses,
    readyOrNull(budgets),
    readyOrNull(incomeRecords),
    readyOrNull(savingsTarget),
    calculationDate,
    financeTimezone
  );
  const locationChartData = groupSmallSlices(groupByTotal(spendingExpenses, (expense) => expense.merchantName), 6);
  const categoryChartData = groupByTotal(spendingExpenses, (expense) => expense.category);

  return (
    <section className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard detail="Local calendar day" icon={<Clock3 aria-hidden="true" className="h-5 w-5" />} label="Spending today" value={metrics.today} />
        <MetricCard detail="Monday through today" icon={<CalendarDays aria-hidden="true" className="h-5 w-5" />} label="Spending this week" value={metrics.week} />
        <MetricCard detail="Current calendar month" icon={<Wallet aria-hidden="true" className="h-5 w-5" />} label="Spending this month" value={metrics.month} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <PanelShell
          icon={<Scale aria-hidden="true" className="h-4 w-4" />}
          subtitle="Actual recorded income less actual recorded spending; planning settings never change it"
          title="Net this month"
        >
          <p className="text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">{formatCurrency(netThisMonth)}</p>
        </PanelShell>

        <PanelShell
          icon={<TrendingUp aria-hidden="true" className="h-4 w-4" />}
          subtitle="Remaining funds projected to the end of the month"
          title="Cash-flow projection"
        >
          {projection.status === "incomplete" ? (
            <p className="text-sm text-[var(--muted)]">{`Add ${listPrerequisites(projection.missing)} to see a projection.`}</p>
          ) : (
            <div>
              <p className="text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">{formatCurrency(projection.value)}</p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {`${formatCurrency(projection.averageDailySpending)} average daily spending over ${projection.daysRemaining} day${projection.daysRemaining === 1 ? "" : "s"} remaining`}
              </p>
            </div>
          )}
        </PanelShell>
      </div>

      <PanelShell
        icon={<Wallet aria-hidden="true" className="h-4 w-4" />}
        subtitle="Derived from the active income record and savings target"
        title="Planning limits"
      >
        {limits.status === "incomplete" ? (
          <p className="text-sm text-[var(--muted)]">{`Add ${listPrerequisites(limits.missing)} in Settings to derive spending limits.`}</p>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm font-medium text-[var(--muted)]">Spendable this period</dt>
              <dd className="mt-1 text-xl font-semibold text-slate-950">{formatCurrency(limits.spendableThisPeriod)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-[var(--muted)]">Daily limit</dt>
              <dd className="mt-1 text-xl font-semibold text-slate-950">{formatCurrency(limits.dailyLimit)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-[var(--muted)]">Weekly limit</dt>
              <dd className="mt-1 text-xl font-semibold text-slate-950">{formatCurrency(limits.weeklyLimit)}</dd>
            </div>
          </dl>
        )}
      </PanelShell>

      <SpendingTrendChart trend={trend} />

      <div className="grid gap-5 xl:grid-cols-2">
        <SpendingPieChart data={locationChartData} icon={<MapPin aria-hidden="true" className="h-4 w-4" />} subtitle="Grouped by merchant until a dedicated location field exists" title="Spending by location" />
        <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold tracking-normal text-slate-950">Spending by category</h2>
              <p className="text-sm text-[var(--muted)]">Income is excluded from spending allocation</p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
              <PieChartIcon aria-hidden="true" className="h-4 w-4" />
            </div>
          </div>
          {sumChartValues(categoryChartData) > 0 ? (
            <div className="h-72 min-w-0">
              <ResponsiveContainer height="100%" width="100%">
                <PieChart>
                  <Pie data={categoryChartData} dataKey="value" innerRadius="58%" nameKey="name" outerRadius="86%" paddingAngle={2}>
                    {categoryChartData.map((entry, index) => <Cell fill={chartColors[index % chartColors.length]} key={entry.name} />)}
                  </Pie>
                  <Tooltip formatter={(value) => [formatCurrency(Number(value)), "Spent"]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-[var(--border)] text-sm text-[var(--muted)]">No spending data yet</div>
          )}
          <BudgetProgressList budgets={budgets} progress={budgetProgress} />
        </div>
      </div>

      <AccuracyPanel accuracy={accuracy} />
    </section>
  );
}
