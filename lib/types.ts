export const expenseCategories = [
  "Food",
  "Transport",
  "Entertainment",
  "Bills",
  "Shopping",
  "Income",
  "Miscellaneous"
] as const;

export type ExpenseCategory = (typeof expenseCategories)[number];
export type SpendingCategory = Exclude<ExpenseCategory, "Income">;
export type ClassificationOrigin = "llm" | "correction_lookup";

/**
 * Expansion metadata is optional for source compatibility with legacy fixtures.
 * Dashboard row mappers normalize an omitted value to null, never to zero.
 */
export type ExpenseClassificationMetadata = {
  confidence?: number | null;
  reviewed?: boolean | null;
  classifiedAt?: string | null;
  classificationOrigin?: ClassificationOrigin | null;
};

export type ExpenseRecord = ExpenseClassificationMetadata & {
  id: number;
  createdAt: string;
  merchantName: string;
  amount: number;
  category: ExpenseCategory;
  timestamp: string;
};

export type ExpenseTableRow = {
  id: number;
  created_at: string;
  merchant_name: string;
  amount: number | string;
  category: string;
  timestamp: string;
  confidence?: number | string | null;
  reviewed?: boolean | null;
  classified_at?: string | null;
  classification_origin?: string | null;
};

export type MutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export type CorrectionResult = MutationResult<{
  expense: ExpenseRecord;
  changed: boolean;
  correctionId: number | null;
}>;

export type DeleteExpenseResult = MutationResult<{
  deletedExpenseId: number;
}>;

export type ClassificationAccuracy = {
  accuracy: number | null;
  totalClassified: number;
  correctedCount: number;
  windowStart: string;
  windowEnd: string;
};

export type TrendPoint = {
  date: string;
  total: number;
};

export type CategoryBudget = {
  category: SpendingCategory;
  monthlyLimit: number;
  updatedAt: string;
};

export type IncomeFrequency = "weekly" | "biweekly" | "monthly";

export type IncomeRecord = {
  id: number;
  amount: number;
  frequency: IncomeFrequency;
  effectiveDate: string;
  createdAt: string;
  updatedAt: string;
};

export type SavingsTargetMode = "fixed" | "percentage";

export type SavingsTarget = {
  id: 1;
  mode: SavingsTargetMode;
  value: number;
  updatedAt: string;
};

export type CategoryBudgetMutationResult = MutationResult<CategoryBudget>;

export type DeleteCategoryBudgetResult = MutationResult<{
  deletedCategory: SpendingCategory;
}>;

export type IncomeRecordMutationResult = MutationResult<IncomeRecord>;

export type DeleteIncomeRecordResult = MutationResult<{
  deletedIncomeRecordId: number;
}>;

export type SavingsTargetMutationResult = MutationResult<SavingsTarget>;

export type DeleteSavingsTargetResult = MutationResult<{
  deletedSavingsTargetId: 1;
}>;

export type ProjectionPrerequisite = "budgets" | "active-income" | "savings-target";

export type CashFlowProjection =
  | {
      status: "ready";
      value: number;
      averageDailySpending: number;
      daysRemaining: number;
      remainingBudget: number;
      unbudgetedCurrentMonthSpending: number;
      adjustedRemainingBudget: number;
      incomeRemaining: number;
      baseline: number;
    }
  | { status: "incomplete"; missing: ProjectionPrerequisite[] };

export type FeatureLoadState<T> =
  | { status: "ready"; data: T }
  | { status: "unavailable"; reason: string };

/** Alias retained for the snapshot terminology in the approved design. */
export type LoadState<T> = FeatureLoadState<T>;

export type DashboardData = {
  expenses: ExpenseRecord[];
  isDemoData: boolean;
  loadError?: string;
};

export type DashboardSnapshot = DashboardData & {
  incomeRecords: FeatureLoadState<IncomeRecord[]>;
  savingsTarget: FeatureLoadState<SavingsTarget | null>;
  trend: FeatureLoadState<TrendPoint[]>;
  accuracy: FeatureLoadState<ClassificationAccuracy>;
  financeTimezone: string;
  reviewThreshold: number;
};

export type SortDirection = "asc" | "desc";

export type SortKey = "timestamp" | "merchantName" | "category" | "amount";

export type SortState = {
  key: SortKey;
  direction: SortDirection;
};

export type ChartDatum = {
  name: string;
  value: number;
};

export type PeriodMetrics = {
  today: number;
  week: number;
  month: number;
  allTime: number;
};

/* ------------------------------------------------------------------ *
 * Chat assistant
 *
 * The assistant answers read-only questions about transactions by calling
 * whitelisted, parameterized query functions. It never composes SQL.
 * ------------------------------------------------------------------ */

/** Only user and assistant turns cross the transport; system and tool turns stay server-side. */
export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

/**
 * Dispatchable tool names.
 *
 * A dedicated two-period comparison tool was deliberately not included: the model can
 * compose the same answer from two parallel `aggregate_spending` calls, and the general
 * path has to work anyway for comparisons that are not exactly two ranges. The
 * `ComparePeriodsResult` types and their validator are retained unused so the tool can
 * be added cheaply if the model's own delta arithmetic proves unreliable.
 */
export const chatToolNames = ["search_transactions", "aggregate_spending"] as const;

export type ChatToolName = (typeof chatToolNames)[number];

/** A single transaction projected down to the fields worth spending tokens on. */
export type ChatTransactionMatch = {
  merchant: string;
  amount: number;
  category: ExpenseCategory;
  /** Finance-local YYYY-MM-DD date of the transaction. */
  date: string;
};

export type SearchTransactionsResult = {
  startDate: string;
  endDate: string;
  returnedCount: number;
  /** True when the result hit the row limit, so more matches exist than were returned. */
  truncated: boolean;
  transactions: ChatTransactionMatch[];
};

export type CategorySpendingTotal = {
  category: SpendingCategory;
  total: number;
  transactionCount: number;
};

export type MerchantSpendingTotal = {
  /** Display name, taken from the highest-spend raw variant within the group. */
  merchant: string;
  total: number;
  transactionCount: number;
};

export type AggregateSpendingResult = {
  startDate: string;
  endDate: string;
  total: number;
  transactionCount: number;
  categoryTotals: CategorySpendingTotal[];
  /** Top merchants by total, present only when the merchant breakdown was requested. */
  merchantTotals?: MerchantSpendingTotal[];
  /**
   * Merchants beyond the returned top group. Reported so a truncated ranking is never
   * mistaken for the complete list of merchants in the range.
   */
  otherMerchantCount?: number;
  otherMerchantTotal?: number;
};

export type PeriodSpendingSummary = {
  startDate: string;
  endDate: string;
  total: number;
  transactionCount: number;
};

export type ComparePeriodsResult = {
  current: PeriodSpendingSummary;
  baseline: PeriodSpendingSummary;
  absoluteDelta: number;
  /** Null when the baseline total is zero, so the value is never Infinity or NaN. */
  percentageDelta: number | null;
};

export type ChatToolResultData =
  | SearchTransactionsResult
  | AggregateSpendingResult
  | ComparePeriodsResult;

/**
 * A record of one tool the model invoked. Returned alongside the reply so a wrong
 * answer can be diagnosed against the query that produced it.
 */
export type ChatToolInvocation = {
  /** Loosely typed on purpose: an invented tool name is worth surfacing, not discarding. */
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
};

export type ChatTurnResult = MutationResult<{
  reply: string;
  toolCalls: ChatToolInvocation[];
}>;
