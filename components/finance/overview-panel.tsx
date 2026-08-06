"use client";

import { LineChart as LineChartIcon, MapPin } from "lucide-react";
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
  getFinanceDateKey,
  getFinanceMonthKey,
  getPeriodPacing,
  getPeriodMetrics,
  getPlanningLimits,
  isSpendingExpense,
  type PlanningPrerequisite
} from "@/lib/finance-analytics";
import { CalendarHeatmapPreview } from "@/components/finance/calendar-heatmap";
import { SpendingBudgetPanel } from "@/components/finance/spending-budget-panel";
import { formatCompactCurrency, formatCurrency, formatDate } from "@/lib/format";
import type {
  ChartDatum,
  ExpenseRecord,
  FeatureLoadState,
  IncomeRecord,
  SavingsTarget,
  TrendPoint
} from "@/lib/types";

type OverviewPanelProps = {
  expenses: ExpenseRecord[];
  financeTimezone: string;
  incomeRecords: FeatureLoadState<IncomeRecord[]>;
  savingsTarget: FeatureLoadState<SavingsTarget | null>;
  trend: FeatureLoadState<TrendPoint[]>;
  onOpenCalendar: () => void;
};

const chartColors = ["#0f766e", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#4b5563"];

const prerequisiteLabels: Record<PlanningPrerequisite, string> = {
  "active-income": "an active income record",
  "savings-target": "a savings target"
};

/** Reads optional snapshot data, mapping an unavailable capability to the analytics null input. */
function readyOrNull<T>(state: FeatureLoadState<T>): T | null {
  return state.status === "ready" ? state.data : null;
}

function listPrerequisites(missing: readonly PlanningPrerequisite[]): string {
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

export function OverviewPanel({ expenses, financeTimezone, incomeRecords, savingsTarget, trend, onOpenCalendar }: OverviewPanelProps) {
  const calculationDate = getFinanceDateKey(new Date(), financeTimezone);
  const currentMonthKey = getFinanceMonthKey(new Date(), financeTimezone);
  const spendingExpenses = expenses.filter(isSpendingExpense);
  const metrics = getPeriodMetrics(expenses, calculationDate, financeTimezone);
  const limits = getPlanningLimits(readyOrNull(incomeRecords), readyOrNull(savingsTarget), calculationDate);
  const periodBudgetUsage = getPeriodPacing(expenses, metrics, limits, calculationDate, financeTimezone);
  const planningUnavailableReasons = [incomeRecords, savingsTarget]
    .filter((state): state is { status: "unavailable"; reason: string } => state.status === "unavailable")
    .map((state) => state.reason);
  const planningUnavailableReason = planningUnavailableReasons.length > 0 ? planningUnavailableReasons.join(" ") : null;
  const incompletePlanningMessage = limits.status === "incomplete"
    ? `Add ${listPrerequisites(limits.missing)} in Settings to compare spending against a budget.`
    : null;
  const locationChartData = groupSmallSlices(groupByTotal(spendingExpenses, (expense) => expense.merchantName), 6);
  const categoryChartData = groupByTotal(spendingExpenses, (expense) => expense.category);

  return (
    <section className="grid gap-5">
      <SpendingBudgetPanel
        incompleteMessage={incompletePlanningMessage}
        limits={limits}
        planningUnavailableReason={planningUnavailableReason}
        savingsTarget={readyOrNull(savingsTarget)}
        usage={periodBudgetUsage}
      />

      <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(220px,1fr)]">
        <SpendingTrendChart trend={trend} />
        <div className="hidden sm:block">
          <CalendarHeatmapPreview expenses={expenses} financeTimezone={financeTimezone} monthKey={currentMonthKey} onOpenCalendar={onOpenCalendar} />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <SpendingPieChart data={locationChartData} icon={<MapPin aria-hidden="true" className="h-4 w-4" />} subtitle="Grouped by merchant until a dedicated location field exists" title="Spending by location" />
        <SpendingPieChart data={categoryChartData} icon={<span aria-hidden="true" className="text-sm">%</span>} subtitle="Income is excluded from spending allocation" title="Spending by category" />
      </div>

    </section>
  );
}
