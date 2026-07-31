import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  getDashboardMutationErrorMessage,
  validateBudgetMonthlyLimit,
  validateExpenseCategory,
  validateExpenseId,
  validateIncomeAmount,
  validateIncomeFrequency,
  validateIsoDate,
  validateSavingsTargetMode,
  validateSavingsTargetValue,
  validateSpendingCategory
} from "./dashboard-mutations";

describe("dashboard mutation validation", () => {
  it("accepts safe transaction IDs and supported categories", () => {
    expect(validateExpenseId(42)).toEqual({ ok: true, data: 42 });
    expect(validateExpenseCategory("Food")).toEqual({ ok: true, data: "Food" });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null])(
    "rejects invalid transaction identifier %j before a database operation",
    value => expect(validateExpenseId(value).ok).toBe(false)
  );

  it("validates spending budget categories and non-negative two-decimal limits", () => {
    expect(validateSpendingCategory("Food")).toEqual({ ok: true, data: "Food" });
    expect(validateSpendingCategory("Income").ok).toBe(false);
    expect(validateBudgetMonthlyLimit("0")).toEqual({ ok: true, data: 0 });
    expect(validateBudgetMonthlyLimit(12.5)).toEqual({ ok: true, data: 12.5 });
    expect(validateBudgetMonthlyLimit("-0.01").ok).toBe(false);
    expect(validateBudgetMonthlyLimit("12.345").ok).toBe(false);
  });

  it("validates positive income, frequency, and real ISO effective dates", () => {
    expect(validateIncomeAmount("1200.00")).toEqual({ ok: true, data: 1200 });
    expect(validateIncomeAmount(0).ok).toBe(false);
    expect(validateIncomeAmount("1.234").ok).toBe(false);
    expect(validateIncomeFrequency("biweekly")).toEqual({ ok: true, data: "biweekly" });
    expect(validateIncomeFrequency("quarterly").ok).toBe(false);
    expect(validateIsoDate("2024-02-29")).toEqual({ ok: true, data: "2024-02-29" });
    expect(validateIsoDate("2023-02-29").ok).toBe(false);
  });

  it("validates savings mode and enforces the percentage maximum", () => {
    expect(validateSavingsTargetMode("fixed")).toEqual({ ok: true, data: "fixed" });
    expect(validateSavingsTargetMode("dollar").ok).toBe(false);
    expect(validateSavingsTargetValue("100", "percentage")).toEqual({ ok: true, data: 100 });
    expect(validateSavingsTargetValue("100.01", "percentage").ok).toBe(false);
    expect(validateSavingsTargetValue("50.123", "fixed").ok).toBe(false);
  });

  it("rejects unsupported categories and never includes provider details in errors", () => {
    expect(validateExpenseCategory("Other").ok).toBe(false);
    const message = getDashboardMutationErrorMessage("correction", {
      code: "XX000",
      message: "SUPABASE_SERVICE_ROLE_KEY=secret select * from expenses"
    });
    expect(message).toBe("Unable to save the category correction. Please try again.");
    expect(message).not.toContain("secret");
  });

  it("translates correction-retention conflicts into a safe deletion message", () => {
    expect(getDashboardMutationErrorMessage("deletion", { code: "23503" })).toBe(
      "This transaction cannot be deleted because its correction history must be retained."
    );
  });

  /** Feature: finance-tracker-expansion, Property 12: Mutation validation and safe errors.
   * **Validates: Requirements 16.4, 16.5** */
  it("rejects every generated invalid transaction identifier", () => {
    const invalidIds = fc.oneof(
      fc.integer({ max: 0 }),
      fc.double({ noNaN: true, noDefaultInfinity: true }).filter(
        value => !Number.isSafeInteger(value) || value <= 0
      ),
      fc.string(),
      fc.constant(null),
      fc.constant(undefined)
    );
    fc.assert(fc.property(invalidIds, value => !validateExpenseId(value).ok), { numRuns: 100 });
  });
});
