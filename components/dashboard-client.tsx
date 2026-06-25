"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  PieChart as PieChartIcon,
  ReceiptText,
  Wallet
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip
} from "recharts";

import {
  formatCompactCurrency,
  formatCurrency,
  formatDateTime,
  getMonthLabel,
  toDateKey
} from "@/lib/format";
import type {
  ChartDatum,
  ExpenseRecord,
  PeriodMetrics,
  SortKey,
  SortState
} from "@/lib/types";

type DashboardClientProps = {
  expenses: ExpenseRecord[];
};

type TabKey = "overview" | "calendar" | "transactions";

type CalendarCell = {
  date: Date;
  key: string;
  isCurrentMonth: boolean;
  total: number;
};

const chartColors = [
  "#0f766e",
  "#2563eb",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#4b5563"
];

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "calendar", label: "Calendar" },
  { key: "transactions", label: "Transactions" }
];

function isSpendingExpense(expense: ExpenseRecord): boolean {
  return expense.category !== "Income";
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfLocalWeek(date: Date): Date {
  const day = date.getDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  const start = startOfLocalDay(date);
  start.setDate(start.getDate() - mondayOffset);

  return start;
}

function startOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function sumExpenses(expenses: ExpenseRecord[]): number {
  return expenses.reduce((total, expense) => total + expense.amount, 0);
}

function getPeriodMetrics(expenses: ExpenseRecord[], now: Date): PeriodMetrics {
  const todayStart = startOfLocalDay(now);
  const weekStart = startOfLocalWeek(now);
  const monthStart = startOfLocalMonth(now);
  const spendingExpenses = expenses.filter(isSpendingExpense);

  return {
    today: sumExpenses(
      spendingExpenses.filter((expense) => new Date(expense.timestamp) >= todayStart)
    ),
    week: sumExpenses(
      spendingExpenses.filter((expense) => new Date(expense.timestamp) >= weekStart)
    ),
    month: sumExpenses(
      spendingExpenses.filter((expense) => new Date(expense.timestamp) >= monthStart)
    )
  };
}

function groupByTotal(
  expenses: ExpenseRecord[],
  getLabel: (expense: ExpenseRecord) => string
): ChartDatum[] {
  const totals = new Map<string, number>();

  expenses.forEach((expense) => {
    const label = getLabel(expense);
    totals.set(label, (totals.get(label) ?? 0) + expense.amount);
  });

  return Array.from(totals.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((first, second) => second.value - first.value);
}

function groupSmallSlices(data: ChartDatum[], maxSlices: number): ChartDatum[] {
  if (data.length <= maxSlices) {
    return data;
  }

  const visible = data.slice(0, maxSlices - 1);
  const other = sumChartValues(data.slice(maxSlices - 1));

  return [...visible, { name: "Other", value: other }];
}

function sumChartValues(data: ChartDatum[]): number {
  return data.reduce((total, item) => total + item.value, 0);
}

function buildCalendarCells(expenses: ExpenseRecord[], monthAnchor: Date): CalendarCell[] {
  const firstOfMonth = new Date(
    monthAnchor.getFullYear(),
    monthAnchor.getMonth(),
    1
  );
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  const dailyTotals = new Map<string, number>();
  expenses.filter(isSpendingExpense).forEach((expense) => {
    const key = toDateKey(new Date(expense.timestamp));
    dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + expense.amount);
  });

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const key = toDateKey(date);

    return {
      date,
      key,
      isCurrentMonth: date.getMonth() === monthAnchor.getMonth(),
      total: dailyTotals.get(key) ?? 0
    };
  });
}

function getCalendarIntensity(total: number, maxTotal: number): string {
  if (total <= 0 || maxTotal <= 0) {
    return "bg-white";
  }

  const ratio = total / maxTotal;

  if (ratio > 0.75) {
    return "bg-teal-700 text-white";
  }

  if (ratio > 0.45) {
    return "bg-teal-200 text-teal-950";
  }

  return "bg-teal-50 text-teal-950";
}

function sortExpenses(expenses: ExpenseRecord[], sortState: SortState): ExpenseRecord[] {
  return [...expenses].sort((first, second) => {
    const direction = sortState.direction === "asc" ? 1 : -1;

    if (sortState.key === "amount") {
      return (first.amount - second.amount) * direction;
    }

    if (sortState.key === "timestamp") {
      return (
        (new Date(first.timestamp).getTime() -
          new Date(second.timestamp).getTime()) *
        direction
      );
    }

    return first[sortState.key].localeCompare(second[sortState.key]) * direction;
  });
}

function nextSortState(current: SortState, key: SortKey): SortState {
  if (current.key !== key) {
    return {
      key,
      direction: key === "timestamp" ? "desc" : "asc"
    };
  }

  return {
    key,
    direction: current.direction === "asc" ? "desc" : "asc"
  };
}

function SortIcon({ sortState, sortKey }: { sortState: SortState; sortKey: SortKey }) {
  if (sortState.key !== sortKey) {
    return <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5" />;
  }

  if (sortState.direction === "asc") {
    return <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />;
  }

  return <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />;
}

function MetricCard({
  icon,
  label,
  value,
  detail
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--muted)]">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
            {formatCurrency(value)}
          </p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--panel-soft)] text-[var(--primary)]">
          {icon}
        </div>
      </div>
      <p className="mt-3 text-sm text-[var(--muted)]">{detail}</p>
    </section>
  );
}

function SpendingPieChart({
  title,
  subtitle,
  data,
  icon
}: {
  title: string;
  subtitle: string;
  data: ChartDatum[];
  icon: React.ReactNode;
}) {
  const total = sumChartValues(data);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal text-slate-950">
            {title}
          </h2>
          <p className="text-sm text-[var(--muted)]">{subtitle}</p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
          {icon}
        </div>
      </div>

      {total > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
          <div className="h-72 min-w-0">
            <ResponsiveContainer height="100%" width="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  innerRadius="58%"
                  nameKey="name"
                  outerRadius="86%"
                  paddingAngle={2}
                >
                  {data.map((entry, index) => (
                    <Cell
                      fill={chartColors[index % chartColors.length]}
                      key={entry.name}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => [
                    formatCurrency(Number(value)),
                    "Spent"
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="grid content-center gap-2">
            {data.map((item, index) => {
              const percentage = total > 0 ? (item.value / total) * 100 : 0;

              return (
                <div className="flex items-center gap-2 text-sm" key={item.name}>
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{
                      backgroundColor: chartColors[index % chartColors.length]
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate text-slate-700">
                    {item.name}
                  </span>
                  <span className="shrink-0 font-medium text-slate-950">
                    {percentage.toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-[var(--border)] text-sm text-[var(--muted)]">
          No spending data yet
        </div>
      )}
    </section>
  );
}

export function DashboardClient({ expenses }: DashboardClientProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [sortState, setSortState] = useState<SortState>({
    key: "timestamp",
    direction: "desc"
  });

  const spendingExpenses = useMemo(
    () => expenses.filter(isSpendingExpense),
    [expenses]
  );
  const metrics = useMemo(
    () => getPeriodMetrics(expenses, new Date()),
    [expenses]
  );
  const calendarCells = useMemo(
    () => buildCalendarCells(expenses, monthAnchor),
    [expenses, monthAnchor]
  );
  const maxDailySpend = Math.max(...calendarCells.map((cell) => cell.total), 0);
  const sortedExpenses = useMemo(
    () => sortExpenses(expenses, sortState),
    [expenses, sortState]
  );
  const locationChartData = useMemo(
    () =>
      groupSmallSlices(
        groupByTotal(spendingExpenses, (expense) => expense.merchantName),
        6
      ),
    [spendingExpenses]
  );
  const categoryChartData = useMemo(
    () => groupByTotal(spendingExpenses, (expense) => expense.category),
    [spendingExpenses]
  );

  const changeMonth = (offset: number) => {
    setMonthAnchor((current) => {
      const next = new Date(current);
      next.setMonth(current.getMonth() + offset, 1);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <nav
        aria-label="Dashboard sections"
        className="grid grid-cols-3 rounded-lg border border-[var(--border)] bg-white p-1 shadow-sm"
      >
        {tabs.map((tab) => (
          <button
            aria-selected={activeTab === tab.key}
            className={`focus-ring h-10 rounded-md px-2 text-sm font-medium transition ${
              activeTab === tab.key
                ? "bg-[var(--primary)] text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "overview" ? (
        <section className="grid gap-5">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              detail="Local calendar day"
              icon={<Clock3 aria-hidden="true" className="h-5 w-5" />}
              label="Spending today"
              value={metrics.today}
            />
            <MetricCard
              detail="Monday through today"
              icon={<CalendarDays aria-hidden="true" className="h-5 w-5" />}
              label="Spending this week"
              value={metrics.week}
            />
            <MetricCard
              detail="Current calendar month"
              icon={<Wallet aria-hidden="true" className="h-5 w-5" />}
              label="Spending this month"
              value={metrics.month}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <SpendingPieChart
              data={locationChartData}
              icon={<MapPin aria-hidden="true" className="h-4 w-4" />}
              subtitle="Grouped by merchant until a dedicated location field exists"
              title="Spending by location"
            />
            <SpendingPieChart
              data={categoryChartData}
              icon={<PieChartIcon aria-hidden="true" className="h-4 w-4" />}
              subtitle="Income is excluded from spending allocation"
              title="Spending by category"
            />
          </div>
        </section>
      ) : null}

      {activeTab === "calendar" ? (
        <section className="rounded-lg border border-[var(--border)] bg-white p-3 shadow-sm sm:p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              aria-label="Previous month"
              className="focus-ring flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] bg-white text-slate-700 hover:bg-slate-50"
              onClick={() => changeMonth(-1)}
              type="button"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            <h2 className="min-w-0 text-center text-lg font-semibold tracking-normal text-slate-950">
              {getMonthLabel(monthAnchor)}
            </h2>
            <button
              aria-label="Next month"
              className="focus-ring flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] bg-white text-slate-700 hover:bg-slate-50"
              onClick={() => changeMonth(1)}
              type="button"
            >
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-[var(--muted)] sm:gap-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div className="py-1" key={day}>
                {day}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1 sm:gap-2">
            {calendarCells.map((cell) => (
              <div
                className={`min-h-16 rounded-md border p-1.5 sm:min-h-24 sm:p-2 ${
                  cell.isCurrentMonth
                    ? "border-[var(--border)]"
                    : "border-slate-100 opacity-45"
                } ${getCalendarIntensity(cell.total, maxDailySpend)}`}
                key={cell.key}
              >
                <div className="flex h-full min-h-12 flex-col justify-between gap-1 sm:min-h-20">
                  <span className="text-left text-xs font-semibold sm:text-sm">
                    {cell.date.getDate()}
                  </span>
                  <span className="truncate text-left text-[0.68rem] font-medium leading-tight sm:text-xs">
                    {cell.total > 0 ? formatCompactCurrency(cell.total) : "$0"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "transactions" ? (
        <section className="rounded-lg border border-[var(--border)] bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-[var(--border)] p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
              <ReceiptText aria-hidden="true" className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-normal text-slate-950">
                Transactions
              </h2>
              <p className="text-sm text-[var(--muted)]">
                {expenses.length} records sorted by {sortState.key}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[680px] table-fixed text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {[
                    ["timestamp", "Date"],
                    ["merchantName", "Merchant"],
                    ["category", "Category"],
                    ["amount", "Amount"]
                  ].map(([key, label]) => (
                    <th className="px-4 py-3 font-semibold" key={key}>
                      <button
                        className="focus-ring inline-flex items-center gap-1 rounded-sm text-left hover:text-slate-900"
                        onClick={() =>
                          setSortState((current) =>
                            nextSortState(current, key as SortKey)
                          )
                        }
                        type="button"
                      >
                        {label}
                        <SortIcon sortKey={key as SortKey} sortState={sortState} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {sortedExpenses.map((expense) => (
                  <tr className="hover:bg-slate-50" key={expense.id}>
                    <td className="px-4 py-3 text-slate-700">
                      {formatDateTime(expense.timestamp)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-950">
                      {expense.merchantName}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{expense.category}</td>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {formatCurrency(expense.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
