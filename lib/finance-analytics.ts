import {
  addCalendarDays,
  getFinanceDateKey,
  getFinanceMonthKey,
  parseDateKey
} from "@/lib/finance-dates";
import type {
  CashFlowProjection,
  CategoryBudget,
  ExpenseCategory,
  ExpenseRecord,
  IncomeRecord,
  PeriodMetrics,
  ProjectionPrerequisite,
  SavingsTarget,
  SpendingCategory
} from "@/lib/types";

/**
 * Re-exported so existing consumers keep importing finance-local date keys from the
 * analytics module. The implementations now live in lib/finance-dates.ts, shared with
 * the dashboard read path and the chat tool layer.
 */
export { getFinanceDateKey, getFinanceMonthKey };

export type PlanningPrerequisite = "active-income" | "savings-target";
export type PlanningLimits =
  | {
      status: "ready";
      normalizedMonthlyIncome: number;
      monthlySavingsAmount: number;
      spendableThisPeriod: number;
      dailyLimit: number;
      weeklyLimit: number;
      daysInMonth: number;
    }
  | { status: "incomplete"; missing: PlanningPrerequisite[] };

export type BudgetProgressState = "green" | "yellow" | "red";
export type BudgetProgress = {
  category: SpendingCategory;
  monthlyLimit: number;
  spending: number;
  consumption: number | null;
  ratio: number | null;
  state: BudgetProgressState;
};

export type PeriodBudget = "today" | "week" | "month";
export type PacingState = "under" | "on" | "ahead";
export type PeriodBudgetUsage = {
  period: PeriodBudget;
  spending: number;
  budget: number | null;
  consumption: number | null;
  state: BudgetProgressState | null;
  elapsedDays?: number;
  totalDays?: number;
  remainingDays?: number;
  elapsedRatio?: number;
  averageDailySpending?: number;
  projectedSpending?: number;
  projectedConsumption?: number | null;
  projectedState?: BudgetProgressState | null;
  pacingState?: PacingState | null;
};

export type CalendarDayProgress = {
  dateKey: string;
  dayOfMonth: number;
  daysInMonth: number;
};

export type ExpenseFilters = {
  merchantQuery: string;
  category: ExpenseCategory | "all";
  startDate: string;
  endDate: string;
};

export type FilterDateRange =
  | { status: "none" }
  | { status: "applied"; startDate: string; endDate: string }
  | { status: "invalid"; message: string };

export type DayCategoryTotal = { category: ExpenseCategory; total: number };
export type DaySummary = {
  dateKey: string;
  spendingTotal: number;
  spendingCount: number;
  transactions: ExpenseRecord[];
  incomeTransactions: ExpenseRecord[];
  categoryTotals: DayCategoryTotal[];
};

export type HeatmapDay = { dateKey: string; day: number; total: number; level: number };
export type HeatmapGrid = {
  monthKey: string;
  days: HeatmapDay[];
  leadingPadding: number;
  trailingPadding: number;
  maxTotal: number;
};

/** One zero band plus the four ordered non-zero bands shared with the legend. */
export const NON_ZERO_INTENSITY_LEVEL_COUNT = 4;

const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;
const DAYS_PER_WEEK = 7;

export const EMPTY_EXPENSE_FILTERS: ExpenseFilters = {
  merchantQuery: "",
  category: "all",
  startDate: "",
  endDate: ""
};

function assertFinite(value: number, fieldName: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${fieldName} must be finite.`);
  }
}

function getDaysInMonth(dateKey: string): number {
  const { year, month } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getMonthKeyFromDateKey(dateKey: string): string {
  parseDateKey(dateKey);
  return dateKey.slice(0, 7);
}

function getExpenseDateKey(expense: ExpenseRecord, timeZone: string): string {
  return getFinanceDateKey(new Date(expense.timestamp), timeZone);
}

function getSpendingCents(
  expenses: readonly ExpenseRecord[],
  predicate: (expense: ExpenseRecord, dateKey: string) => boolean,
  timeZone: string
): number {
  return expenses.reduce((total, expense) => {
    if (!isSpendingExpense(expense)) {
      return total;
    }

    const dateKey = getExpenseDateKey(expense, timeZone);
    return predicate(expense, dateKey) ? total + amountToCents(expense.amount) : total;
  }, 0);
}

function getNormalizedMonthlyIncomeCents(income: IncomeRecord): number {
  const amountCents = amountToCents(income.amount);
  switch (income.frequency) {
    case "weekly":
      return (amountCents * 52) / 12;
    case "biweekly":
      return (amountCents * 26) / 12;
    case "monthly":
      return amountCents;
  }
}

function getSavingsCents(monthlyIncomeCents: number, target: SavingsTarget): number {
  return target.mode === "fixed"
    ? amountToCents(target.value)
    : (monthlyIncomeCents * target.value) / 100;
}

function getBudgetState(consumption: number | null, spendingCents: number): BudgetProgressState {
  if (consumption === null) {
    return spendingCents === 0 ? "green" : "red";
  }
  if (consumption < 0.75) return "green";
  if (consumption < 1) return "yellow";
  return "red";
}

function parseMonthKey(monthKey: string): { year: number; month: number } {
  if (!MONTH_KEY_PATTERN.test(monthKey)) {
    throw new RangeError("Month keys must use YYYY-MM.");
  }

  const [year, month] = monthKey.split("-").map(Number);
  if (month < 1 || month > 12) {
    throw new RangeError("Month key is not a calendar month.");
  }

  return { year, month };
}

/** Sunday-indexed weekday for a finance-local date key, computed without browser-local time. */
function getWeekdayIndex(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Shifts a YYYY-MM key by whole months without crossing a browser-local boundary. */
export function addCalendarMonths(monthKey: string, offset: number): string {
  const { year, month } = parseMonthKey(monthKey);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Collapses case and interior whitespace so merchant matching mirrors the SQL normalization rule. */
export function normalizeMerchantKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Converts a finite database currency amount to its nearest integer cent. */
export function amountToCents(amount: number): number {
  assertFinite(amount, "Amount");
  return Math.round((amount + Number.EPSILON) * 100);
}

/** Converts a cent value to the number used only by formatting and presentation. */
export function centsToAmount(cents: number): number {
  assertFinite(cents, "Cents");
  return cents / 100;
}

/** Income is the only category that is not spending. */
export function isSpendingExpense<T extends Pick<ExpenseRecord, "category">>(
  expense: T
): expense is T & { category: SpendingCategory } {
  return expense.category !== "Income";
}

/**
 * Selects the newest spending records without mutating the loaded expense array.
 * Equal timestamps use the record id as a deterministic newest-first tie-breaker.
 */
export function getRecentSpendingExpenses(
  expenses: readonly ExpenseRecord[],
  limit = 5
): ExpenseRecord[] {
  if (!Number.isInteger(limit) || limit <= 0) return [];

  return expenses
    .filter(isSpendingExpense)
    .sort((first, second) => {
      const firstTime = Date.parse(first.timestamp);
      const secondTime = Date.parse(second.timestamp);

      if (firstTime !== secondTime) {
        if (!Number.isFinite(firstTime)) return 1;
        if (!Number.isFinite(secondTime)) return -1;
        return secondTime - firstTime;
      }

      return second.id - first.id;
    })
    .slice(0, limit);
}

/** Selects the latest record that was effective on or before the calculation date. */
export function selectActiveIncome(
  incomeRecords: readonly IncomeRecord[],
  calculationDate: string
): IncomeRecord | null {
  parseDateKey(calculationDate);
  let selected: IncomeRecord | null = null;

  for (const income of incomeRecords) {
    parseDateKey(income.effectiveDate);
    if (
      income.effectiveDate <= calculationDate &&
      (selected === null || income.effectiveDate > selected.effectiveDate)
    ) {
      selected = income;
    }
  }

  return selected;
}

/** Normalizes weekly, biweekly, and monthly planned income to a monthly amount. */
export function normalizeMonthlyIncome(income: IncomeRecord): number {
  return centsToAmount(getNormalizedMonthlyIncomeCents(income));
}

/** Converts either a fixed or percentage savings target into a monthly currency amount. */
export function getMonthlySavingsAmount(
  normalizedMonthlyIncome: number,
  target: SavingsTarget
): number {
  return centsToAmount(getSavingsCents(amountToCents(normalizedMonthlyIncome), target));
}

/**
 * Calculates monthly savings and period limits. Missing planning inputs deliberately
 * return an incomplete state rather than a misleading zero-valued limit.
 */
export function getPlanningLimits(
  incomeRecords: readonly IncomeRecord[] | null | undefined,
  savingsTarget: SavingsTarget | null | undefined,
  calculationDate: string
): PlanningLimits {
  const missing: PlanningPrerequisite[] = [];
  const activeIncome = incomeRecords ? selectActiveIncome(incomeRecords, calculationDate) : null;
  if (!activeIncome || getNormalizedMonthlyIncomeCents(activeIncome) <= 0) {
    missing.push("active-income");
  }
  if (!savingsTarget) {
    missing.push("savings-target");
  }
  if (missing.length > 0) {
    return { status: "incomplete", missing };
  }

  const normalizedMonthlyIncomeCents = getNormalizedMonthlyIncomeCents(activeIncome!);
  const monthlySavingsCents = getSavingsCents(normalizedMonthlyIncomeCents, savingsTarget!);
  const spendableCents = normalizedMonthlyIncomeCents - monthlySavingsCents;
  const daysInMonth = getDaysInMonth(calculationDate);

  return {
    status: "ready",
    normalizedMonthlyIncome: centsToAmount(normalizedMonthlyIncomeCents),
    monthlySavingsAmount: centsToAmount(monthlySavingsCents),
    spendableThisPeriod: centsToAmount(spendableCents),
    dailyLimit: centsToAmount(spendableCents / daysInMonth),
    weeklyLimit: centsToAmount(spendableCents / (daysInMonth / 7)),
    daysInMonth
  };
}

/** Computes current-finance-month progress only for configured spending categories. */
export function getBudgetProgress(
  expenses: readonly ExpenseRecord[],
  budgets: readonly CategoryBudget[],
  calculationDate: string,
  timeZone: string
): BudgetProgress[] {
  const monthKey = getMonthKeyFromDateKey(calculationDate);

  return budgets.map((budget) => {
    const spendingCents = getSpendingCents(
      expenses,
      (expense, dateKey) => expense.category === budget.category && getMonthKeyFromDateKey(dateKey) === monthKey,
      timeZone
    );
    const limitCents = amountToCents(budget.monthlyLimit);
    const consumption = limitCents === 0 ? null : spendingCents / limitCents;

    return {
      category: budget.category,
      monthlyLimit: centsToAmount(limitCents),
      spending: centsToAmount(spendingCents),
      consumption,
      ratio: consumption,
      state: getBudgetState(consumption, spendingCents)
    };
  });
}

/** Returns the Monday that begins the finance-local week containing the given date key. */
export function getWeekStartDateKey(dateKey: string): string {
  const weekday = getWeekdayIndex(dateKey);
  return addCalendarDays(dateKey, -(weekday === 0 ? 6 : weekday - 1));
}

/** Today, week-to-date, month-to-date, and all recorded spending, keyed to the finance timezone. */
export function getPeriodMetrics(
  expenses: readonly ExpenseRecord[],
  calculationDate: string,
  timeZone: string
): PeriodMetrics {
  const weekStart = getWeekStartDateKey(calculationDate);
  const monthKey = getMonthKeyFromDateKey(calculationDate);

  return {
    today: centsToAmount(getSpendingCents(expenses, (_, key) => key === calculationDate, timeZone)),
    week: centsToAmount(
      getSpendingCents(expenses, (_, key) => key >= weekStart && key <= calculationDate, timeZone)
    ),
    month: centsToAmount(
      getSpendingCents(expenses, (_, key) => getMonthKeyFromDateKey(key) === monthKey, timeZone)
    ),
    allTime: centsToAmount(getSpendingCents(expenses, () => true, timeZone))
  };
}

/** Combines period spending totals with the derived daily, weekly, and monthly budgets. */
export function getPeriodBudgetUsage(
  metrics: PeriodMetrics,
  limits: PlanningLimits
): PeriodBudgetUsage[] {
  const budgets: Record<PeriodBudget, number | null> = limits.status === "ready"
    ? { today: limits.dailyLimit, week: limits.weeklyLimit, month: limits.spendableThisPeriod }
    : { today: null, week: null, month: null };
  const spending: Record<PeriodBudget, number> = {
    today: metrics.today,
    week: metrics.week,
    month: metrics.month
  };

  return (["today", "week", "month"] as const).map((period) => {
    const budget = budgets[period];
    const spendingCents = amountToCents(spending[period]);

    if (budget === null) {
      return { period, spending: centsToAmount(spendingCents), budget: null, consumption: null, state: null };
    }

    const budgetCents = amountToCents(budget);
    const consumption = budgetCents === 0 ? null : spendingCents / budgetCents;
    return {
      period,
      spending: centsToAmount(spendingCents),
      budget: centsToAmount(budgetCents),
      consumption,
      state: getBudgetState(consumption, spendingCents)
    };
  });
}

/** Returns a period budget remainder in cents-safe currency units, including negative overspending. */
export function getRemainingPeriodBudget(
  usage: Pick<PeriodBudgetUsage, "budget" | "spending">
): number | null {
  if (usage.budget === null) return null;
  return centsToAmount(amountToCents(usage.budget) - amountToCents(usage.spending));
}

/** Returns the finance-local day number and total number of days in a calendar month. */
export function getCalendarDayProgress(calculationDate: string): CalendarDayProgress {
  const { day } = parseDateKey(calculationDate);
  return {
    dateKey: calculationDate,
    dayOfMonth: day,
    daysInMonth: getDaysInMonth(calculationDate)
  };
}

function getPacingState(consumption: number | null, elapsedRatio: number): PacingState | null {
  if (consumption === null) return null;
  const difference = consumption - elapsedRatio;
  if (difference > 0.1) return "ahead";
  if (difference < -0.1) return "under";
  return "on";
}

/** Adds week/month elapsed time, pacing, and end-of-period forecasts to budget usage. */
export function getPeriodPacing(
  expenses: readonly ExpenseRecord[],
  metrics: PeriodMetrics,
  limits: PlanningLimits,
  calculationDate: string,
  timeZone: string
): PeriodBudgetUsage[] {
  const baseUsage = getPeriodBudgetUsage(metrics, limits);
  const weekElapsedDays = getWeekdayIndex(calculationDate) === 0 ? 7 : getWeekdayIndex(calculationDate);
  const monthElapsedDays = parseDateKey(calculationDate).day;
  const monthTotalDays = getDaysInMonth(calculationDate);
  const trailingAverage = getTrailingAverageSpending(expenses, calculationDate, timeZone);
  const weekAverage = centsToAmount(amountToCents(metrics.week) / weekElapsedDays);

  return baseUsage.map((usage) => {
    if (usage.period === "today") {
      return {
        ...usage,
        elapsedDays: weekElapsedDays,
        totalDays: 7,
        remainingDays: 7 - weekElapsedDays,
        elapsedRatio: weekElapsedDays / 7,
        averageDailySpending: weekAverage,
        projectedSpending: undefined,
        projectedConsumption: null,
        projectedState: null,
        pacingState: null
      };
    }

    const elapsedDays = usage.period === "week" ? weekElapsedDays : monthElapsedDays;
    const totalDays = usage.period === "week" ? 7 : monthTotalDays;
    const remainingDays = totalDays - elapsedDays;
    const projectedSpendingCents = amountToCents(usage.spending) + amountToCents(trailingAverage) * remainingDays;
    const projectedSpending = centsToAmount(projectedSpendingCents);
    const projectedBudgetCents = usage.budget === null ? null : amountToCents(usage.budget);
    const projectedConsumption = projectedBudgetCents === null || projectedBudgetCents === 0
      ? null
      : projectedSpendingCents / projectedBudgetCents;

    return {
      ...usage,
      elapsedDays,
      totalDays,
      remainingDays,
      elapsedRatio: elapsedDays / totalDays,
      projectedSpending,
      projectedConsumption,
      projectedState: projectedBudgetCents === null ? null : getBudgetState(projectedConsumption, projectedSpendingCents),
      pacingState: getPacingState(usage.consumption, elapsedDays / totalDays)
    };
  });
}

export function getNetCashFlow(
  expenses: readonly ExpenseRecord[],
  calculationDate: string,
  timeZone: string
): number {
  const monthKey = getMonthKeyFromDateKey(calculationDate);
  let incomeCents = 0;
  let spendingCents = 0;

  for (const expense of expenses) {
    if (getMonthKeyFromDateKey(getExpenseDateKey(expense, timeZone)) !== monthKey) continue;
    if (expense.category === "Income") {
      incomeCents += amountToCents(expense.amount);
    } else {
      spendingCents += amountToCents(expense.amount);
    }
  }

  return centsToAmount(incomeCents - spendingCents);
}

/** Averages the trailing 28 local calendar days, including the calculation date. */
export function getTrailingAverageSpending(
  expenses: readonly ExpenseRecord[],
  calculationDate: string,
  timeZone: string
): number {
  parseDateKey(calculationDate);
  const startDate = addCalendarDays(calculationDate, -27);
  const totalCents = getSpendingCents(
    expenses,
    (_, dateKey) => dateKey >= startDate && dateKey <= calculationDate,
    timeZone
  );
  return centsToAmount(totalCents / 28);
}

/**
 * Resolves the transaction date filter. Exactly one boundary or an inverted range is a
 * validation state that is displayed and deliberately not applied to the expense list.
 */
export function validateFilterDateRange(startDate: string, endDate: string): FilterDateRange {
  const hasStart = startDate.length > 0;
  const hasEnd = endDate.length > 0;

  if (!hasStart && !hasEnd) return { status: "none" };
  if (hasStart !== hasEnd) {
    return { status: "invalid", message: "Select both a start date and an end date to filter by date." };
  }

  for (const value of [startDate, endDate]) {
    try {
      parseDateKey(value);
    } catch {
      return { status: "invalid", message: "Enter both dates in YYYY-MM-DD format." };
    }
  }

  if (startDate > endDate) {
    return { status: "invalid", message: "The start date must be on or before the end date." };
  }

  return { status: "applied", startDate, endDate };
}

/**
 * Applies every active filter before sorting. Merchant matching is normalized containment and
 * date bounds are inclusive finance-local keys.
 */
export function filterExpenses(
  expenses: readonly ExpenseRecord[],
  filters: ExpenseFilters,
  timeZone: string
): ExpenseRecord[] {
  const merchantQuery = normalizeMerchantKey(filters.merchantQuery);
  const dateRange = validateFilterDateRange(filters.startDate, filters.endDate);

  return expenses.filter((expense) => {
    if (merchantQuery.length > 0 && !normalizeMerchantKey(expense.merchantName).includes(merchantQuery)) {
      return false;
    }
    if (filters.category !== "all" && expense.category !== filters.category) {
      return false;
    }
    if (dateRange.status === "applied") {
      const dateKey = getExpenseDateKey(expense, timeZone);
      if (dateKey < dateRange.startDate || dateKey > dateRange.endDate) return false;
    }

    return true;
  });
}

/**
 * Assigns the shared intensity band. Bands are equal width over the month maximum and
 * an exact boundary value belongs to the higher band, per requirement 13.7.
 */
export function getIntensityLevel(total: number, maxTotal: number): number {
  if (total <= 0 || maxTotal <= 0) return 0;
  const ratio = total / maxTotal;
  return Math.min(
    NON_ZERO_INTENSITY_LEVEL_COUNT,
    Math.floor(ratio * NON_ZERO_INTENSITY_LEVEL_COUNT) + 1
  );
}

/**
 * Builds exactly one real day for each date of the selected month. Padding counts describe
 * the inert leading and trailing grid positions that carry no date or total.
 */
export function buildHeatmapDays(
  expenses: readonly ExpenseRecord[],
  monthKey: string,
  timeZone: string
): HeatmapGrid {
  const { year, month } = parseMonthKey(monthKey);
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const totalsByDateKey = new Map<string, number>();

  for (const expense of expenses) {
    if (!isSpendingExpense(expense)) continue;
    const dateKey = getExpenseDateKey(expense, timeZone);
    if (dateKey.slice(0, 7) !== monthKey) continue;
    totalsByDateKey.set(dateKey, (totalsByDateKey.get(dateKey) ?? 0) + amountToCents(expense.amount));
  }

  const dayCents = Array.from({ length: dayCount }, (_, index) => {
    const day = index + 1;
    const dateKey = `${monthKey}-${String(day).padStart(2, "0")}`;
    return { dateKey, day, cents: totalsByDateKey.get(dateKey) ?? 0 };
  });
  const maxCents = dayCents.reduce((max, entry) => Math.max(max, entry.cents), 0);
  const leadingPadding = getWeekdayIndex(dayCents[0].dateKey);
  const trailingPadding =
    (DAYS_PER_WEEK - ((leadingPadding + dayCount) % DAYS_PER_WEEK)) % DAYS_PER_WEEK;

  return {
    monthKey,
    days: dayCents.map((entry) => ({
      dateKey: entry.dateKey,
      day: entry.day,
      total: centsToAmount(entry.cents),
      level: getIntensityLevel(entry.cents, maxCents)
    })),
    leadingPadding,
    trailingPadding,
    maxTotal: centsToAmount(maxCents)
  };
}

/**
 * Summarizes one finance-local day for the calendar detail panel. Selection uses the
 * same date key the heatmap buckets on, so a panel can never disagree with the cell
 * that opened it. Income is returned separately and never enters the spending total.
 */
export function buildDaySummary(
  expenses: readonly ExpenseRecord[],
  dateKey: string,
  timeZone: string
): DaySummary {
  const transactions: ExpenseRecord[] = [];
  const incomeTransactions: ExpenseRecord[] = [];
  const centsByCategory = new Map<ExpenseCategory, number>();
  let spendingCents = 0;

  for (const expense of expenses) {
    if (getExpenseDateKey(expense, timeZone) !== dateKey) continue;

    if (!isSpendingExpense(expense)) {
      incomeTransactions.push(expense);
      continue;
    }

    const cents = amountToCents(expense.amount);
    spendingCents += cents;
    centsByCategory.set(expense.category, (centsByCategory.get(expense.category) ?? 0) + cents);
    transactions.push(expense);
  }

  const byTimestampAscending = (first: ExpenseRecord, second: ExpenseRecord): number =>
    new Date(first.timestamp).getTime() - new Date(second.timestamp).getTime();

  return {
    dateKey,
    spendingTotal: centsToAmount(spendingCents),
    spendingCount: transactions.length,
    transactions: transactions.sort(byTimestampAscending),
    incomeTransactions: incomeTransactions.sort(byTimestampAscending),
    // Largest category first; the name breaks ties so equal totals stay deterministic.
    categoryTotals: Array.from(centsByCategory, ([category, cents]) => ({
      category,
      total: centsToAmount(cents)
    })).sort((first, second) =>
      second.total - first.total || first.category.localeCompare(second.category)
    )
  };
}

/**
 * Projects the end-of-month available funds. A missing available budget dataset,
 * active income, or savings target returns named prerequisites instead of currency.
 */
export function getProjection(
  expenses: readonly ExpenseRecord[],
  budgets: readonly CategoryBudget[] | null | undefined,
  incomeRecords: readonly IncomeRecord[] | null | undefined,
  savingsTarget: SavingsTarget | null | undefined,
  calculationDate: string,
  timeZone: string
): CashFlowProjection {
  parseDateKey(calculationDate);
  const missing: ProjectionPrerequisite[] = [];
  if (!budgets) missing.push("budgets");

  const limits = getPlanningLimits(incomeRecords, savingsTarget, calculationDate);
  if (limits.status === "incomplete") {
    missing.push(...limits.missing);
  }
  if (missing.length > 0) {
    return { status: "incomplete", missing: [...new Set(missing)] };
  }

  const monthKey = getMonthKeyFromDateKey(calculationDate);
  const resolvedBudgets = budgets!;
  const budgetByCategory = new Map(
    resolvedBudgets.map((budget) => [budget.category, budget])
  );
  const configuredSpendCents = new Map<SpendingCategory, number>();
  let totalCurrentMonthSpendingCents = 0;
  let unbudgetedCurrentMonthSpendingCents = 0;

  for (const expense of expenses) {
    if (
      !isSpendingExpense(expense) ||
      getMonthKeyFromDateKey(getExpenseDateKey(expense, timeZone)) !== monthKey
    ) {
      continue;
    }

    const amountCents = amountToCents(expense.amount);
    totalCurrentMonthSpendingCents += amountCents;
    if (budgetByCategory.has(expense.category)) {
      configuredSpendCents.set(
        expense.category,
        (configuredSpendCents.get(expense.category) ?? 0) + amountCents
      );
    } else {
      unbudgetedCurrentMonthSpendingCents += amountCents;
    }
  }

  const remainingBudgetCents = resolvedBudgets.reduce(
    (total, budget) =>
      total + amountToCents(budget.monthlyLimit) - (configuredSpendCents.get(budget.category) ?? 0),
    0
  );
  const adjustedRemainingBudgetCents =
    remainingBudgetCents - unbudgetedCurrentMonthSpendingCents;
  const activeIncome = selectActiveIncome(incomeRecords ?? [], calculationDate);
  if (!activeIncome) {
    throw new Error("Active income was unavailable after planning-limit validation.");
  }
  const spendableCents =
    getNormalizedMonthlyIncomeCents(activeIncome) -
    getSavingsCents(getNormalizedMonthlyIncomeCents(activeIncome), savingsTarget!);
  const incomeRemainingCents = spendableCents - totalCurrentMonthSpendingCents;
  const baselineCents = Math.min(adjustedRemainingBudgetCents, incomeRemainingCents);
  const { day } = parseDateKey(calculationDate);
  const daysRemaining = getDaysInMonth(calculationDate) - day + 1;
  const trailingStartDate = addCalendarDays(calculationDate, -27);
  const trailingSpendingCents = getSpendingCents(
    expenses,
    (_, dateKey) => dateKey >= trailingStartDate && dateKey <= calculationDate,
    timeZone
  );
  const averageDailySpendingCents = trailingSpendingCents / 28;
  const valueCents = baselineCents - averageDailySpendingCents * daysRemaining;

  return {
    status: "ready",
    value: centsToAmount(valueCents),
    averageDailySpending: centsToAmount(averageDailySpendingCents),
    daysRemaining,
    remainingBudget: centsToAmount(remainingBudgetCents),
    unbudgetedCurrentMonthSpending: centsToAmount(unbudgetedCurrentMonthSpendingCents),
    adjustedRemainingBudget: centsToAmount(adjustedRemainingBudgetCents),
    incomeRemaining: centsToAmount(incomeRemainingCents),
    baseline: centsToAmount(baselineCents)
  };
}
