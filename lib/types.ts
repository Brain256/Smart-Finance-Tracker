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
};
