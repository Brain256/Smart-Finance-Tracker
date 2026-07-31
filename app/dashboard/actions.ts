"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { normalizeExpenseRow } from "@/lib/dashboard-data";
import { getFinanceConfig } from "@/lib/finance-config";
import {
  getDashboardMutationErrorMessage,
  validateBudgetMonthlyLimit,
  validateExpenseCategory,
  validateExpenseId,
  validateIncomeAmount,
  validateIncomeFrequency,
  validateIsoDate,
  validatePlanningRecordId,
  validateSavingsTargetMode,
  validateSavingsTargetValue,
  validateSpendingCategory
} from "@/lib/dashboard-mutations";
import { createSupabaseExpenseClient } from "@/lib/supabase-server";
import type {
  CategoryBudget,
  CategoryBudgetMutationResult,
  CorrectionResult,
  DeleteCategoryBudgetResult,
  DeleteExpenseResult,
  DeleteIncomeRecordResult,
  DeleteSavingsTargetResult,
  ExpenseTableRow,
  IncomeRecord,
  IncomeRecordMutationResult,
  MutationResult,
  SavingsTarget,
  SavingsTargetMutationResult
} from "@/lib/types";

type CorrectionRpcRow = Omit<ExpenseTableRow, "created_at"> & {
  changed: boolean;
  correction_id: number | string | null;
};
type SuccessfulCorrection = Extract<CorrectionResult, { ok: true }>["data"];
type BudgetTableRow = {
  category: string;
  monthly_limit: number | string;
  updated_at: string;
};
type IncomeTableRow = {
  id: number | string;
  amount: number | string;
  frequency: string;
  effective_date: string;
  created_at: string;
  updated_at: string;
};
type SavingsTargetTableRow = {
  id: number | string;
  mode: string;
  value: number | string;
  updated_at: string;
};
type ActiveIncomeRow = Pick<IncomeTableRow, "amount" | "frequency">;

export type IncomeRecordMutationInput = {
  id?: unknown;
  amount: unknown;
  frequency: unknown;
  effectiveDate: unknown;
};

function failure<T>(message: string): MutationResult<T> {
  return { ok: false, message };
}

function getCreatedAt(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "created_at" in value &&
    typeof value.created_at === "string"
  ) {
    return value.created_at;
  }

  return null;
}

function parseFiniteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function normalizeBudgetResult(value: unknown): CategoryBudget | null {
  if (typeof value !== "object" || value === null) return null;

  const row = value as BudgetTableRow;
  const limit = parseFiniteNumber(row.monthly_limit);
  const validCategory = validateSpendingCategory(row.category);
  if (!validCategory.ok || limit === null || limit < 0 || typeof row.updated_at !== "string") {
    return null;
  }

  return { category: validCategory.data, monthlyLimit: limit, updatedAt: row.updated_at };
}

function normalizeIncomeResult(value: unknown): IncomeRecord | null {
  if (typeof value !== "object" || value === null) return null;

  const row = value as IncomeTableRow;
  const id = typeof row.id === "number" ? row.id : Number(row.id);
  const amount = parseFiniteNumber(row.amount);
  const validFrequency = validateIncomeFrequency(row.frequency);
  const validDate = validateIsoDate(row.effective_date);
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    amount === null ||
    amount <= 0 ||
    !validFrequency.ok ||
    !validDate.ok ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    return null;
  }

  return {
    id,
    amount,
    frequency: validFrequency.data,
    effectiveDate: validDate.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeSavingsTargetResult(value: unknown): SavingsTarget | null {
  if (typeof value !== "object" || value === null) return null;

  const row = value as SavingsTargetTableRow;
  const id = typeof row.id === "number" ? row.id : Number(row.id);
  const validMode = validateSavingsTargetMode(row.mode);
  if (id !== 1 || !validMode.ok || typeof row.updated_at !== "string") return null;

  const validValue = validateSavingsTargetValue(row.value, validMode.data);
  if (!validValue.ok) return null;

  return { id: 1, mode: validMode.data, value: validValue.data, updatedAt: row.updated_at };
}

function getFinanceLocalDate(): string {
  const { financeTimezone } = getFinanceConfig();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: financeTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const part = (type: "year" | "month" | "day") => parts.find(item => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");

  if (!year || !month || !day) throw new Error("Finance date configuration is invalid.");
  return `${year}-${month}-${day}`;
}

function getNormalizedMonthlyIncome(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;

  const row = value as ActiveIncomeRow;
  const amount = parseFiniteNumber(row.amount);
  if (amount === null || amount <= 0) return null;

  switch (row.frequency) {
    case "weekly":
      return (amount * 52) / 12;
    case "biweekly":
      return (amount * 26) / 12;
    case "monthly":
      return amount;
    default:
      return null;
  }
}

function now(): string {
  return new Date().toISOString();
}

function noActiveIncomeFailure<T>(): MutationResult<T> {
  return failure("Add an active income record before saving a savings target.");
}

function normalizeCorrectionResult(
  value: unknown,
  createdAt: string
): SuccessfulCorrection | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const row = value as CorrectionRpcRow;
  const id = typeof row.id === "number" ? row.id : Number(row.id);
  const correctionId =
    row.correction_id === null
      ? null
      : typeof row.correction_id === "number"
        ? row.correction_id
        : Number(row.correction_id);

  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !validateExpenseCategory(row.category).ok ||
    typeof row.changed !== "boolean" ||
    (correctionId !== null && (!Number.isSafeInteger(correctionId) || correctionId <= 0))
  ) {
    return null;
  }

  return {
    expense: normalizeExpenseRow({ ...row, id, created_at: createdAt }),
    changed: row.changed,
    correctionId
  };
}

/** Verifies the existing allowed-email authorization boundary before every mutation. */
export async function requireDashboardSession(): Promise<MutationResult<true>> {
  try {
    const session = await auth();
    const allowedEmail = process.env.AUTH_ALLOWED_EMAIL?.trim().toLowerCase();
    const sessionEmail = session?.user?.email?.trim().toLowerCase();

    if (!session?.user || !allowedEmail || sessionEmail !== allowedEmail) {
      return failure("You must be signed in with an authorized dashboard account.");
    }

    return { ok: true, data: true };
  } catch {
    return failure("Unable to verify dashboard access. Please try again.");
  }
}

export async function correctExpenseCategory(
  expenseId: unknown,
  correctedCategory: unknown
): Promise<CorrectionResult> {
  const session = await requireDashboardSession();
  if (!session.ok) return session;

  const validExpenseId = validateExpenseId(expenseId);
  if (!validExpenseId.ok) return validExpenseId;
  const validCategory = validateExpenseCategory(correctedCategory);
  if (!validCategory.ok) return validCategory;

  try {
    const client = createSupabaseExpenseClient();
    const { data: existingExpense, error: existingExpenseError } = await client
      .from("expenses")
      .select("created_at")
      .eq("id", validExpenseId.data)
      .maybeSingle();
    const createdAt = getCreatedAt(existingExpense);

    if (existingExpenseError || !createdAt) {
      return failure("This transaction no longer exists.");
    }

    const { data, error } = await client.rpc("correct_expense_category", {
      p_expense_id: validExpenseId.data,
      p_corrected_category: validCategory.data
    });
    const corrected = Array.isArray(data)
      ? normalizeCorrectionResult(data[0], createdAt)
      : normalizeCorrectionResult(data, createdAt);

    if (error || !corrected) {
      return failure(getDashboardMutationErrorMessage("correction", error));
    }

    revalidatePath("/dashboard");
    return { ok: true, data: corrected };
  } catch (error) {
    return failure(getDashboardMutationErrorMessage("correction", error));
  }
}

export async function deleteExpense(expenseId: unknown): Promise<DeleteExpenseResult> {
  const session = await requireDashboardSession();
  if (!session.ok) return session;

  const validExpenseId = validateExpenseId(expenseId);
  if (!validExpenseId.ok) return validExpenseId;

  try {
    const client = createSupabaseExpenseClient();
    const { error } = await client.from("expenses").delete().eq("id", validExpenseId.data);

    if (error) {
      return failure(getDashboardMutationErrorMessage("deletion", error));
    }

    revalidatePath("/dashboard");
    return { ok: true, data: { deletedExpenseId: validExpenseId.data } };
  } catch (error) {
    return failure(getDashboardMutationErrorMessage("deletion", error));
  }
}

/** Adds or replaces the single monthly budget limit for a spending category. */
export async function saveCategoryBudget(
  category: unknown,
  monthlyLimit: unknown
): Promise<CategoryBudgetMutationResult> {
  const session = await requireDashboardSession();
  if (!session.ok) return session;

  const validCategory = validateSpendingCategory(category);
  if (!validCategory.ok) return validCategory;
  const validLimit = validateBudgetMonthlyLimit(monthlyLimit);
  if (!validLimit.ok) return validLimit;

  try {
    const client = createSupabaseExpenseClient();
    const { data, error } = await client
      .from("category_budgets")
      .upsert(
        {
          category: validCategory.data,
          monthly_limit: validLimit.data,
          updated_at: now()
        },
        { onConflict: "category" }
      )
      .select("category, monthly_limit, updated_at")
      .single();
    const budget = normalizeBudgetResult(data);

    if (error || !budget) {
      return failure(getDashboardMutationErrorMessage("category-budget", error));
    }

    revalidatePath("/dashboard");
    return { ok: true, data: budget };
  } catch (error) {
    return failure(getDashboardMutationErrorMessage("category-budget", error));
  }
}

export async function deleteCategoryBudget(
  category: unknown
): Promise<DeleteCategoryBudgetResult> {
  const session = await requireDashboardSession();
  if (!session.ok) return session;

  const validCategory = validateSpendingCategory(category);
  if (!validCategory.ok) return validCategory;

  try {
    const client = createSupabaseExpenseClient();
    const { error } = await client
      .from("category_budgets")
      .delete()
      .eq("category", validCategory.data);

    if (error) {
      return failure(getDashboardMutationErrorMessage("category-budget", error));
    }

    revalidatePath("/dashboard");
    return { ok: true, data: { deletedCategory: validCategory.data } };
  } catch (error) {
    return failure(getDashboardMutationErrorMessage("category-budget", error));
  }
}

/** Adds an income record when id is omitted, or edits the identified historical record. */
export async function saveIncomeRecord(
  input: IncomeRecordMutationInput
): Promise<IncomeRecordMutationResult> {
  const session = await requireDashboardSession();
  if (!session.ok) return session;

  const validAmount = validateIncomeAmount(input?.amount);
  if (!validAmount.ok) return validAmount;
  const validFrequency = validateIncomeFrequency(input?.frequency);
  if (!validFrequency.ok) return validFrequency;
  const validEffectiveDate = validateIsoDate(input?.effectiveDate);
  if (!validEffectiveDate.ok) return validEffectiveDate;
  const isEdit = input?.id !== undefined && input?.id !== null;
  const validId = isEdit ? validatePlanningRecordId(input.id) : null;
  if (validId && !validId.ok) return validId;

  const payload = {
    amount: validAmount.data,
    frequency: validFrequency.data,
    effective_date: validEffectiveDate.data,
    updated_at: now()
  };

  try {
    const client = createSupabaseExpenseClient();
    const response = isEdit
      ? await client
          .from("income_records")
          .update(payload)
          .eq("id", validId!.data)
          .select("id, amount, frequency, effective_date, created_at, updated_at")
          .maybeSingle()
      : await client
          .from("income_records")
          .insert(payload)
          .select("id, amount, frequency, effective_date, created_at, updated_at")
          .single();
    const incomeRecord = normalizeIncomeResult(response.data);

    if (response.error || !incomeRecord) {
      return failure(getDashboardMutationErrorMessage("income-record", response.error));
    }

    revalidatePath("/dashboard");
    return { ok: true, data: incomeRecord };
  } catch (error) {
    return failure(getDashboardMutationErrorMessage("income-record", error));
  }
}

export async function deleteIncomeRecord(
  incomeRecordId: unknown
): Promise<DeleteIncomeRecordResult> {
  const session = await requireDashboardSession();
  if (!session.ok) return session;

  const validId = validatePlanningRecordId(incomeRecordId);
  if (!validId.ok) return validId;

  try {
    const client = createSupabaseExpenseClient();
    const { error } = await client.from("income_records").delete().eq("id", validId.data);

    if (error) {
      return failure(getDashboardMutationErrorMessage("income-record", error));
    }

    revalidatePath("/dashboard");
    return { ok: true, data: { deletedIncomeRecordId: validId.data } };
  } catch (error) {
    return failure(getDashboardMutationErrorMessage("income-record", error));
  }
}

/** Adds or updates the singleton savings target after verifying active-income affordability. */
export async function saveSavingsTarget(
  mode: unknown,
  value: unknown
): Promise<SavingsTargetMutationResult> {
  const session = await requireDashboardSession();
  if (!session.ok) return session;

  const validMode = validateSavingsTargetMode(mode);
  if (!validMode.ok) return validMode;
  const validValue = validateSavingsTargetValue(value, validMode.data);
  if (!validValue.ok) return validValue;

  try {
    const client = createSupabaseExpenseClient();
    const { data: activeIncome, error: activeIncomeError } = await client
      .from("income_records")
      .select("amount, frequency")
      .lte("effective_date", getFinanceLocalDate())
      .order("effective_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const normalizedIncome = getNormalizedMonthlyIncome(activeIncome);

    if (activeIncomeError || normalizedIncome === null || normalizedIncome <= 0) {
      return noActiveIncomeFailure();
    }

    if (validMode.data === "fixed" && validValue.data > normalizedIncome) {
      return failure("The fixed savings target cannot exceed active normalized monthly income.");
    }

    const { data, error } = await client
      .from("savings_targets")
      .upsert(
        { id: 1, mode: validMode.data, value: validValue.data, updated_at: now() },
        { onConflict: "id" }
      )
      .select("id, mode, value, updated_at")
      .single();
    const target = normalizeSavingsTargetResult(data);

    if (error || !target) {
      return failure(getDashboardMutationErrorMessage("savings-target", error));
    }

    revalidatePath("/dashboard");
    return { ok: true, data: target };
  } catch (error) {
    return failure(getDashboardMutationErrorMessage("savings-target", error));
  }
}

export async function deleteSavingsTarget(): Promise<DeleteSavingsTargetResult> {
  const session = await requireDashboardSession();
  if (!session.ok) return session;

  try {
    const client = createSupabaseExpenseClient();
    const { error } = await client.from("savings_targets").delete().eq("id", 1);

    if (error) {
      return failure(getDashboardMutationErrorMessage("savings-target", error));
    }

    revalidatePath("/dashboard");
    return { ok: true, data: { deletedSavingsTargetId: 1 } };
  } catch (error) {
    return failure(getDashboardMutationErrorMessage("savings-target", error));
  }
}
