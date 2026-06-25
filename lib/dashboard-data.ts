import { sampleExpenses } from "@/lib/sample-data";
import { createSupabaseExpenseClient, hasSupabaseDashboardConfig } from "@/lib/supabase-server";
import {
  expenseCategories,
  type DashboardData,
  type ExpenseCategory,
  type ExpenseRecord,
  type ExpenseTableRow
} from "@/lib/types";

function isExpenseCategory(value: string): value is ExpenseCategory {
  return expenseCategories.includes(value as ExpenseCategory);
}

function normalizeExpenseRow(row: ExpenseTableRow): ExpenseRecord {
  const amount =
    typeof row.amount === "number" ? row.amount : Number.parseFloat(row.amount);

  return {
    id: row.id,
    createdAt: row.created_at,
    merchantName: row.merchant_name,
    amount: Number.isFinite(amount) ? amount : 0,
    category: isExpenseCategory(row.category) ? row.category : "Miscellaneous",
    timestamp: row.timestamp
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  if (!hasSupabaseDashboardConfig()) {
    return {
      expenses: sampleExpenses,
      isDemoData: true,
      loadError: "Supabase dashboard credentials are not configured."
    };
  }

  const client = createSupabaseExpenseClient();

  try {
    const { data, error } = await client
      .from("expenses")
      .select("id, created_at, merchant_name, amount, category, timestamp")
      .order("timestamp", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return {
      expenses: ((data ?? []) as ExpenseTableRow[]).map(normalizeExpenseRow),
      isDemoData: false
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Supabase query failure.";

    return {
      expenses: sampleExpenses,
      isDemoData: true,
      loadError: message
    };
  }
}
