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

export type ExpenseRecord = {
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
};

export type DashboardData = {
  expenses: ExpenseRecord[];
  isDemoData: boolean;
  loadError?: string;
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
