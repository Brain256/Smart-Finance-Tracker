import {
  expenseCategories,
  type ExpenseCategory,
  type IncomeFrequency,
  type MutationResult,
  type SavingsTargetMode,
  type SpendingCategory
} from "@/lib/types";

export type DashboardMutationOperation =
  | "correction"
  | "deletion"
  | "category-budget"
  | "income-record"
  | "savings-target";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MONEY_AMOUNT = 9_999_999_999.99;

function invalid<T>(message: string): MutationResult<T> {
  return { ok: false, message };
}

function parseTwoDecimalValue(value: unknown, message: string): MutationResult<number> {
  let parsed: number;

  if (typeof value === "string") {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return invalid(message);
    parsed = Number(value);
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) return invalid(message);
    const cents = Math.round(value * 100);
    if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 1e-8) {
      return invalid(message);
    }
    parsed = cents / 100;
  } else {
    return invalid(message);
  }

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_MONEY_AMOUNT) {
    return invalid(message);
  }

  return { ok: true, data: parsed };
}

export function validateExpenseId(value: unknown): MutationResult<number> {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return invalid("Choose a valid transaction before saving changes.");
  }

  return { ok: true, data: value };
}

export function validatePlanningRecordId(value: unknown): MutationResult<number> {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return invalid("Choose a valid income record before saving changes.");
  }

  return { ok: true, data: value };
}

export function validateExpenseCategory(value: unknown): MutationResult<ExpenseCategory> {
  if (typeof value !== "string" || !expenseCategories.includes(value as ExpenseCategory)) {
    return invalid("Choose a supported transaction category.");
  }

  return { ok: true, data: value as ExpenseCategory };
}

export function validateSpendingCategory(value: unknown): MutationResult<SpendingCategory> {
  const category = validateExpenseCategory(value);
  if (!category.ok || category.data === "Income") {
    return invalid("Choose a supported spending category.");
  }

  return { ok: true, data: category.data };
}

export function validateBudgetMonthlyLimit(value: unknown): MutationResult<number> {
  return parseTwoDecimalValue(value, "Enter a non-negative monthly limit with no more than two decimal places.");
}

export function validateIncomeAmount(value: unknown): MutationResult<number> {
  const amount = parseTwoDecimalValue(
    value,
    "Enter an income amount greater than zero with no more than two decimal places."
  );
  if (!amount.ok || amount.data <= 0) {
    return invalid("Enter an income amount greater than zero with no more than two decimal places.");
  }

  return amount;
}

export function validateIncomeFrequency(value: unknown): MutationResult<IncomeFrequency> {
  if (value !== "weekly" && value !== "biweekly" && value !== "monthly") {
    return invalid("Choose weekly, biweekly, or monthly income frequency.");
  }

  return { ok: true, data: value };
}

export function validateIsoDate(value: unknown): MutationResult<string> {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return invalid("Enter an effective date in YYYY-MM-DD format.");
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return invalid("Enter an effective date in YYYY-MM-DD format.");
  }

  return { ok: true, data: value };
}

export function validateSavingsTargetMode(value: unknown): MutationResult<SavingsTargetMode> {
  if (value !== "fixed" && value !== "percentage") {
    return invalid("Choose a fixed-dollar or percentage savings target.");
  }

  return { ok: true, data: value };
}

export function validateSavingsTargetValue(
  value: unknown,
  mode: SavingsTargetMode
): MutationResult<number> {
  const target = parseTwoDecimalValue(
    value,
    mode === "percentage"
      ? "Enter a savings percentage from 0 through 100 with no more than two decimal places."
      : "Enter a non-negative savings target with no more than two decimal places."
  );
  if (!target.ok) return target;

  if (mode === "percentage" && target.data > 100) {
    return invalid("Enter a savings percentage from 0 through 100 with no more than two decimal places.");
  }

  return target;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/** Converts server/provider failures into fixed messages that contain no implementation detail. */
export function getDashboardMutationErrorMessage(
  operation: DashboardMutationOperation,
  error: unknown
): string {
  if (operation === "deletion" && hasErrorCode(error, "23503")) {
    return "This transaction cannot be deleted because its correction history must be retained.";
  }

  if (hasErrorCode(error, "P0002")) {
    return "This transaction no longer exists.";
  }

  switch (operation) {
    case "deletion":
      return "Unable to delete the transaction. Please try again.";
    case "category-budget":
      return "Unable to save the category budget. Please try again.";
    case "income-record":
      return "Unable to save the income record. Please try again.";
    case "savings-target":
      return "Unable to save the savings target. Please try again.";
    default:
      return "Unable to save the category correction. Please try again.";
  }
}
