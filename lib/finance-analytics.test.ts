import { describe, expect, it } from "vitest";

import {
  amountToCents,
  centsToAmount,
  getBudgetProgress,
  getFinanceDateKey,
  getMonthlySavingsAmount,
  getNetCashFlow,
  getPlanningLimits,
  getProjection,
  getTrailingAverageSpending,
  normalizeMonthlyIncome,
  selectActiveIncome
} from "./finance-analytics";
import type {
  CategoryBudget,
  ExpenseRecord,
  IncomeRecord,
  SavingsTarget
} from "./types";

const TIME_ZONE = "America/Toronto";

function expense(
  id: number,
  amount: number,
  category: ExpenseRecord["category"],
  timestamp: string
): ExpenseRecord {
  return {
    id,
    amount,
    category,
    timestamp,
    createdAt: timestamp,
    merchantName: `Merchant ${id}`
  };
}

function income(
  id: number,
  amount: number,
  frequency: IncomeRecord["frequency"],
  effectiveDate: string
): IncomeRecord {
  return {
    id,
    amount,
    frequency,
    effectiveDate,
    createdAt: `${effectiveDate}T00:00:00Z`,
    updatedAt: `${effectiveDate}T00:00:00Z`
  };
}

const fixedSavings: SavingsTarget = {
  id: 1,
  mode: "fixed",
  value: 100,
  updatedAt: "2026-06-01T00:00:00Z"
};

describe("finance analytics", () => {
  it("uses finance-local keys and integer-cent conversion at the data boundary", () => {
    expect(getFinanceDateKey(new Date("2026-01-01T02:00:00Z"), TIME_ZONE)).toBe(
      "2025-12-31"
    );
    expect(amountToCents(12.34)).toBe(1234);
    expect(centsToAmount(1234)).toBe(12.34);
  });

  it("selects the latest effective income and normalizes its frequency", () => {
    const records = [
      income(1, 1000, "monthly", "2026-01-01"),
      income(2, 100, "weekly", "2026-02-15"),
      income(3, 200, "biweekly", "2026-03-01")
    ];

    expect(selectActiveIncome(records, "2026-02-14")?.id).toBe(1);
    expect(selectActiveIncome(records, "2026-02-15")?.id).toBe(2);
    expect(normalizeMonthlyIncome(records[1])).toBeCloseTo((100 * 52) / 12, 10);
    expect(
      getMonthlySavingsAmount(1200, {
        id: 1,
        mode: "percentage",
        value: 12.5,
        updatedAt: "2026-02-01T00:00:00Z"
      })
    ).toBe(150);
  });

  it("derives limits from actual month length and names unavailable planning prerequisites", () => {
    const limits = getPlanningLimits(
      [income(1, 1200, "monthly", "2024-01-01")],
      fixedSavings,
      "2024-02-10"
    );

    expect(limits).toMatchObject({ status: "ready", daysInMonth: 29 });
    if (limits.status === "ready") {
      expect(limits.normalizedMonthlyIncome).toBe(1200);
      expect(limits.monthlySavingsAmount).toBe(100);
      expect(limits.spendableThisPeriod).toBe(1100);
      expect(limits.dailyLimit).toBeCloseTo(1100 / 29, 10);
      expect(limits.weeklyLimit).toBeCloseTo(1100 / (29 / 7), 10);
    }

    expect(getPlanningLimits([], null, "2026-06-15")).toEqual({
      status: "incomplete",
      missing: ["active-income", "savings-target"]
    });
  });

  it("tracks configured category consumption while excluding Income from spending", () => {
    const budgets: CategoryBudget[] = [
      { category: "Food", monthlyLimit: 200, updatedAt: "2026-06-01T00:00:00Z" },
      { category: "Transport", monthlyLimit: 100, updatedAt: "2026-06-01T00:00:00Z" },
      { category: "Shopping", monthlyLimit: 0, updatedAt: "2026-06-01T00:00:00Z" }
    ];
    const progress = getBudgetProgress(
      [
        expense(1, 150, "Food", "2026-06-10T16:00:00Z"),
        expense(2, 100, "Transport", "2026-06-11T16:00:00Z"),
        expense(3, 900, "Income", "2026-06-12T16:00:00Z")
      ],
      budgets,
      "2026-06-15",
      TIME_ZONE
    );

    expect(progress).toEqual([
      expect.objectContaining({ category: "Food", spending: 150, consumption: 0.75, state: "yellow" }),
      expect.objectContaining({ category: "Transport", spending: 100, consumption: 1, state: "red" }),
      expect.objectContaining({ category: "Shopping", spending: 0, consumption: null, state: "green" })
    ]);
  });

  it("calculates actual monthly net cash flow independently of planning inputs", () => {
    const expenses = [
      expense(1, 1000, "Income", "2026-06-02T16:00:00Z"),
      expense(2, 100, "Food", "2026-06-03T16:00:00Z"),
      expense(3, 50, "Shopping", "2026-06-04T16:00:00Z"),
      expense(4, 500, "Income", "2026-05-31T16:00:00Z")
    ];

    expect(getNetCashFlow(expenses, "2026-06-15", TIME_ZONE)).toBe(850);
    expect(getTrailingAverageSpending(expenses, "2026-06-15", TIME_ZONE)).toBeCloseTo(
      150 / 28,
      10
    );
  });

  it("projects partial budgets, counts the final local day, and reports missing data", () => {
    const expenses = [
      expense(1, 100, "Food", "2026-06-15T16:00:00Z"),
      expense(2, 150, "Shopping", "2026-06-14T16:00:00Z"),
      expense(3, 1000, "Income", "2026-06-15T16:00:00Z")
    ];
    const budgets: CategoryBudget[] = [
      { category: "Food", monthlyLimit: 500, updatedAt: "2026-06-01T00:00:00Z" }
    ];
    const projection = getProjection(
      expenses,
      budgets,
      [income(1, 1000, "monthly", "2026-01-01")],
      fixedSavings,
      "2026-06-15",
      TIME_ZONE
    );

    expect(projection).toMatchObject({
      status: "ready",
      daysRemaining: 16,
      remainingBudget: 400,
      unbudgetedCurrentMonthSpending: 150,
      adjustedRemainingBudget: 250,
      incomeRemaining: 650,
      baseline: 250
    });
    if (projection.status === "ready") {
      expect(projection.averageDailySpending).toBeCloseTo(250 / 28, 10);
      expect(projection.value).toBeCloseTo(250 - (250 / 28) * 16, 10);
    }

    const finalDayProjection = getProjection(
      [],
      budgets,
      [income(1, 1000, "monthly", "2026-01-01")],
      fixedSavings,
      "2026-01-31",
      TIME_ZONE
    );
    expect(finalDayProjection).toMatchObject({ status: "ready", daysRemaining: 1 });
    expect(getProjection(expenses, null, null, null, "2026-06-15", TIME_ZONE)).toEqual({
      status: "incomplete",
      missing: ["budgets", "active-income", "savings-target"]
    });
  });
});
