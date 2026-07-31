import {
  DEFAULT_FINANCE_TIMEZONE,
  DEFAULT_REVIEW_THRESHOLD,
  getFinanceConfig
} from "@/lib/finance-config";
import { sampleExpenses } from "@/lib/sample-data";
import { createSupabaseExpenseClient, hasSupabaseDashboardConfig } from "@/lib/supabase-server";
import {
  expenseCategories,
  type CategoryBudget,
  type ClassificationAccuracy,
  type DashboardSnapshot,
  type ExpenseCategory,
  type ExpenseRecord,
  type ExpenseTableRow,
  type FeatureLoadState,
  type IncomeFrequency,
  type IncomeRecord,
  type SavingsTarget,
  type SpendingCategory,
  type TrendPoint
} from "@/lib/types";

type BudgetTableRow = {
  category: string;
  monthly_limit: number | string;
  updated_at: string;
};

type IncomeTableRow = {
  id: number;
  amount: number | string;
  frequency: string;
  effective_date: string;
  created_at: string;
  updated_at: string;
};

type SavingsTargetTableRow = {
  id: number;
  mode: string;
  value: number | string;
  updated_at: string;
};

type TrendTableRow = {
  local_date: string;
  total: number | string;
};

type AccuracyTableRow = {
  total_classified: number | string;
  corrected_count: number | string;
};

export type DashboardDateWindow = {
  startDate: string;
  endDate: string;
  startTimestamp: string;
  endTimestamp: string;
};

function isExpenseCategory(value: string): value is ExpenseCategory {
  return expenseCategories.includes(value as ExpenseCategory);
}

function isSpendingCategory(value: string): value is SpendingCategory {
  return value !== "Income" && isExpenseCategory(value);
}

function isIncomeFrequency(value: string): value is IncomeFrequency {
  return value === "weekly" || value === "biweekly" || value === "monthly";
}

function normalizeConfidence(value: ExpenseTableRow["confidence"]): number | null {
  if (value === null || typeof value === "undefined") {
    return null;
  }

  const confidence = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
    ? confidence
    : null;
}

function isClassificationOrigin(value: string | null | undefined): value is "llm" | "correction_lookup" {
  return value === "llm" || value === "correction_lookup";
}

function parseFiniteNumber(value: number | string, fieldName: string): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} is not a finite number.`);
  }

  return parsed;
}

function parseNonNegativeInteger(value: number | string, fieldName: string): number {
  const parsed = parseFiniteNumber(value, fieldName);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} is not a non-negative integer.`);
  }

  return parsed;
}

export function normalizeExpenseRow(row: ExpenseTableRow): ExpenseRecord {
  const amount =
    typeof row.amount === "number" ? row.amount : Number.parseFloat(row.amount);

  return {
    id: row.id,
    createdAt: row.created_at,
    merchantName: row.merchant_name,
    amount: Number.isFinite(amount) ? amount : 0,
    category: isExpenseCategory(row.category) ? row.category : "Miscellaneous",
    timestamp: row.timestamp,
    confidence: normalizeConfidence(row.confidence),
    reviewed: typeof row.reviewed === "boolean" ? row.reviewed : null,
    classifiedAt: row.classified_at ?? null,
    classificationOrigin: isClassificationOrigin(row.classification_origin)
      ? row.classification_origin
      : null
  };
}

function normalizeBudgetRow(row: BudgetTableRow): CategoryBudget {
  if (!isSpendingCategory(row.category)) {
    throw new Error("Category budget has an unsupported category.");
  }

  const monthlyLimit = parseFiniteNumber(row.monthly_limit, "Category budget monthly limit");
  if (monthlyLimit < 0) {
    throw new Error("Category budget monthly limit cannot be negative.");
  }

  return { category: row.category, monthlyLimit, updatedAt: row.updated_at };
}

function normalizeIncomeRow(row: IncomeTableRow): IncomeRecord {
  if (!isIncomeFrequency(row.frequency)) {
    throw new Error("Income record has an unsupported frequency.");
  }

  const amount = parseFiniteNumber(row.amount, "Income record amount");
  if (amount <= 0) {
    throw new Error("Income record amount must be positive.");
  }

  return {
    id: row.id,
    amount,
    frequency: row.frequency,
    effectiveDate: row.effective_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeSavingsTargetRow(row: SavingsTargetTableRow): SavingsTarget {
  const id = parseNonNegativeInteger(row.id, "Savings target ID");
  const value = parseFiniteNumber(row.value, "Savings target value");
  if (id !== 1 || (row.mode !== "fixed" && row.mode !== "percentage") || value < 0) {
    throw new Error("Savings target is invalid.");
  }

  return { id: 1, mode: row.mode, value, updatedAt: row.updated_at };
}

function normalizeTrendRow(row: TrendTableRow): TrendPoint {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.local_date)) {
    throw new Error("Trend point has an invalid local date.");
  }

  return { date: row.local_date, total: parseFiniteNumber(row.total, "Trend total") };
}

function normalizeAccuracyRow(
  row: AccuracyTableRow,
  window: DashboardDateWindow
): ClassificationAccuracy {
  const totalClassified = parseNonNegativeInteger(
    row.total_classified,
    "Accuracy total classified"
  );
  const correctedCount = parseNonNegativeInteger(
    row.corrected_count,
    "Accuracy corrected count"
  );
  if (correctedCount > totalClassified) {
    throw new Error("Accuracy correction count exceeds the classified count.");
  }

  return {
    accuracy: totalClassified === 0 ? null : 1 - correctedCount / totalClassified,
    totalClassified,
    correctedCount,
    windowStart: window.startDate,
    windowEnd: window.endDate
  };
}

function getFinanceDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function addCalendarDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function getTimeZoneOffsetMilliseconds(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return (
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second)
    ) - instant.getTime()
  );
}

function zonedMidnightToUtc(dateKey: string, timeZone: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day));
  const initialOffset = getTimeZoneOffsetMilliseconds(utcGuess, timeZone);
  const candidate = new Date(utcGuess.getTime() - initialOffset);
  const correctedOffset = getTimeZoneOffsetMilliseconds(candidate, timeZone);

  return new Date(utcGuess.getTime() - correctedOffset).toISOString();
}

export function getDashboardDateWindow(now: Date, timeZone: string): DashboardDateWindow {
  const endDate = getFinanceDateKey(now, timeZone);
  const startDate = addCalendarDays(endDate, -89);
  const exclusiveEndDate = addCalendarDays(endDate, 1);

  return {
    startDate,
    endDate,
    startTimestamp: zonedMidnightToUtc(startDate, timeZone),
    endTimestamp: zonedMidnightToUtc(exclusiveEndDate, timeZone)
  };
}

function unavailable<T>(featureName: string): FeatureLoadState<T> {
  return {
    status: "unavailable",
    reason: `${featureName} is unavailable. Apply the required migration and verify dashboard configuration.`
  };
}

async function loadOptional<T>(
  featureName: string,
  load: () => Promise<T>
): Promise<FeatureLoadState<T>> {
  try {
    return { status: "ready", data: await load() };
  } catch {
    return unavailable<T>(featureName);
  }
}

function coreFallback(
  financeTimezone: string,
  reviewThreshold: number,
  loadError: string
): DashboardSnapshot {
  const reason = "Optional dashboard capabilities require a live expense-data connection.";

  return {
    expenses: sampleExpenses,
    budgets: { status: "unavailable", reason },
    incomeRecords: { status: "unavailable", reason },
    savingsTarget: { status: "unavailable", reason },
    trend: { status: "unavailable", reason },
    accuracy: { status: "unavailable", reason },
    financeTimezone,
    reviewThreshold,
    isDemoData: true,
    loadError
  };
}

export async function getDashboardData(): Promise<DashboardSnapshot> {
  let financeTimezone = DEFAULT_FINANCE_TIMEZONE;
  let reviewThreshold = DEFAULT_REVIEW_THRESHOLD;

  try {
    const financeConfig = getFinanceConfig();
    financeTimezone = financeConfig.financeTimezone;
    reviewThreshold = financeConfig.reviewThreshold;
  } catch {
    return coreFallback(
      financeTimezone,
      reviewThreshold,
      "Finance dashboard configuration is invalid. Set FINANCE_TIMEZONE and REVIEW_THRESHOLD to valid values."
    );
  }

  if (!hasSupabaseDashboardConfig()) {
    return coreFallback(
      financeTimezone,
      reviewThreshold,
      "Supabase dashboard credentials are not configured."
    );
  }

  let client: ReturnType<typeof createSupabaseExpenseClient> | null = null;
  let expenses: ExpenseRecord[];

  try {
    client = createSupabaseExpenseClient();
    const { data, error } = await client
      .from("expenses")
      .select(
        "id, created_at, merchant_name, amount, category, timestamp, confidence, reviewed, classified_at, classification_origin"
      )
      .order("timestamp", { ascending: false });

    if (error) {
      throw new Error("Expense query failed.");
    }

    expenses = ((data ?? []) as ExpenseTableRow[]).map(normalizeExpenseRow);
  } catch {
    return coreFallback(
      financeTimezone,
      reviewThreshold,
      "Expense data is unavailable. Check Supabase dashboard configuration and database access."
    );
  }

  const window = getDashboardDateWindow(new Date(), financeTimezone);
  const [budgets, incomeRecords, savingsTarget, trend, accuracy] = await Promise.all([
    loadOptional("Category budgets", async () => {
      const { data, error } = await client
        .from("category_budgets")
        .select("category, monthly_limit, updated_at")
        .order("category", { ascending: true });
      if (error) throw new Error("Category budget query failed.");
      return ((data ?? []) as BudgetTableRow[]).map(normalizeBudgetRow);
    }),
    loadOptional("Income records", async () => {
      const { data, error } = await client
        .from("income_records")
        .select("id, amount, frequency, effective_date, created_at, updated_at")
        .order("effective_date", { ascending: false });
      if (error) throw new Error("Income record query failed.");
      return ((data ?? []) as IncomeTableRow[]).map(normalizeIncomeRow);
    }),
    loadOptional("Savings target", async () => {
      const { data, error } = await client
        .from("savings_targets")
        .select("id, mode, value, updated_at")
        .maybeSingle();
      if (error) throw new Error("Savings target query failed.");
      return data === null ? null : normalizeSavingsTargetRow(data as SavingsTargetTableRow);
    }),
    loadOptional("Spending trend", async () => {
      const { data, error } = await client.rpc("get_daily_spending_trend", {
        p_start_date: window.startDate,
        p_end_date: window.endDate,
        p_timezone: financeTimezone
      });
      if (error) throw new Error("Spending trend query failed.");
      return ((data ?? []) as TrendTableRow[]).map(normalizeTrendRow);
    }),
    loadOptional("Classification accuracy", async () => {
      const { data, error } = await client.rpc("get_classification_accuracy", {
        p_start: window.startTimestamp,
        p_end: window.endTimestamp
      });
      if (error) throw new Error("Classification accuracy query failed.");
      const row = (data as AccuracyTableRow[] | null)?.[0];
      if (!row) throw new Error("Classification accuracy returned no result.");
      return normalizeAccuracyRow(row, window);
    })
  ]);

  return {
    expenses,
    budgets,
    incomeRecords,
    savingsTarget,
    trend,
    accuracy,
    financeTimezone,
    reviewThreshold,
    isDemoData: false
  };
}
