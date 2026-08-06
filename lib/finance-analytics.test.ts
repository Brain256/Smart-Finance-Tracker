import { describe, expect, it } from "vitest";

import {
  amountToCents,
  buildDaySummary,
  centsToAmount,
  getBudgetProgress,
  getFinanceDateKey,
  getMonthlySavingsAmount,
  getNetCashFlow,
  getPeriodBudgetUsage,
  getPeriodPacing,
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

  it("combines period spending with daily, weekly, and monthly budgets", () => {
    const limits = getPlanningLimits(
      [income(1, 4000, "monthly", "2025-01-01")],
      { id: 1, mode: "fixed", value: 1000, updatedAt: "2025-01-01T00:00:00Z" },
      "2025-01-15"
    );
    const usage = getPeriodBudgetUsage(
      { today: 75, week: 600, month: 3000 },
      limits
    );

    expect(usage[0]).toMatchObject({ period: "today", spending: 75, state: "yellow" });
    expect(usage[0].budget).toBeCloseTo(3000 / 31, 2);
    expect(usage[1]).toMatchObject({ period: "week", spending: 600, state: "yellow" });
    expect(usage[1].budget).toBeCloseTo((3000 / 31) * 7, 2);
    expect(usage[2]).toMatchObject({ period: "month", spending: 3000, budget: 3000, consumption: 1, state: "red" });
  });

  it("adds elapsed time, weekly average, and end-of-period pacing forecasts", () => {
    const calculationDate = "2025-01-15";
    const expenses = [
      expense(1, 50, "Food", "2025-01-13T17:00:00.000Z"),
      expense(2, 100, "Food", "2025-01-15T17:00:00.000Z")
    ];
    const metrics = {
      today: 100,
      week: 150,
      month: 150
    };
    const limits = getPlanningLimits(
      [income(1, 4000, "monthly", "2025-01-01")],
      { id: 1, mode: "fixed", value: 1000, updatedAt: "2025-01-01T00:00:00Z" },
      calculationDate
    );
    const pacing = getPeriodPacing(expenses, metrics, limits, calculationDate, TIME_ZONE);

    expect(pacing[0]).toMatchObject({
      period: "today",
      averageDailySpending: 50,
      elapsedDays: 3,
      remainingDays: 4
    });
    expect(pacing[1]).toMatchObject({
      period: "week",
      elapsedDays: 3,
      totalDays: 7,
      remainingDays: 4,
      projectedSpending: 171.44,
      pacingState: "under"
    });
    expect(pacing[2]).toMatchObject({
      period: "month",
      elapsedDays: 15,
      totalDays: 31,
      remainingDays: 16,
      projectedSpending: 235.76,
      pacingState: "under"
    });
  });

  it("leaves period budgets unavailable when planning prerequisites are incomplete", () => {
    const usage = getPeriodBudgetUsage(
      { today: 12.34, week: 56.78, month: 90.12 },
      getPlanningLimits([], null, "2025-01-15")
    );

    expect(usage).toEqual([
      { period: "today", spending: 12.34, budget: null, consumption: null, state: null },
      { period: "week", spending: 56.78, budget: null, consumption: null, state: null },
      { period: "month", spending: 90.12, budget: null, consumption: null, state: null }
    ]);
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

describe("buildDaySummary", () => {
  it("buckets by the finance-local day, not the UTC day", () => {
    // 03:30 UTC on Jan 9 is 22:30 on Jan 8 in Toronto, so it belongs to the 8th.
    const lateEvening = expense(1, 20, "Food", "2026-01-09T03:30:00.000Z");
    const nextMorning = expense(2, 30, "Food", "2026-01-09T14:00:00.000Z");
    const expenses = [lateEvening, nextMorning];

    expect(buildDaySummary(expenses, "2026-01-08", TIME_ZONE)).toMatchObject({
      spendingTotal: 20,
      spendingCount: 1
    });
    expect(buildDaySummary(expenses, "2026-01-09", TIME_ZONE)).toMatchObject({
      spendingTotal: 30,
      spendingCount: 1
    });
  });

  it("keeps income out of the spending total and returns it separately", () => {
    const summary = buildDaySummary(
      [
        expense(1, 40, "Food", "2026-01-08T17:00:00.000Z"),
        expense(2, 9999, "Income", "2026-01-08T18:00:00.000Z")
      ],
      "2026-01-08",
      TIME_ZONE
    );

    expect(summary.spendingTotal).toBe(40);
    expect(summary.spendingCount).toBe(1);
    expect(summary.transactions.map((entry) => entry.id)).toEqual([1]);
    expect(summary.incomeTransactions.map((entry) => entry.id)).toEqual([2]);
    expect(summary.categoryTotals).toEqual([{ category: "Food", total: 40 }]);
  });

  it("orders transactions chronologically and categories by descending total", () => {
    const summary = buildDaySummary(
      [
        expense(1, 5, "Transport", "2026-01-08T20:00:00.000Z"),
        expense(2, 30, "Food", "2026-01-08T13:00:00.000Z"),
        expense(3, 12, "Food", "2026-01-08T16:00:00.000Z")
      ],
      "2026-01-08",
      TIME_ZONE
    );

    expect(summary.transactions.map((entry) => entry.id)).toEqual([2, 3, 1]);
    expect(summary.categoryTotals).toEqual([
      { category: "Food", total: 42 },
      { category: "Transport", total: 5 }
    ]);
  });

  it("breaks category ties by name so the order is deterministic", () => {
    const summary = buildDaySummary(
      [
        expense(1, 10, "Transport", "2026-01-08T13:00:00.000Z"),
        expense(2, 10, "Bills", "2026-01-08T14:00:00.000Z"),
        expense(3, 10, "Food", "2026-01-08T15:00:00.000Z")
      ],
      "2026-01-08",
      TIME_ZONE
    );

    expect(summary.categoryTotals.map((entry) => entry.category)).toEqual([
      "Bills",
      "Food",
      "Transport"
    ]);
  });

  it("sums in cents so repeating decimals do not drift", () => {
    const summary = buildDaySummary(
      [
        expense(1, 0.1, "Food", "2026-01-08T13:00:00.000Z"),
        expense(2, 0.2, "Food", "2026-01-08T14:00:00.000Z")
      ],
      "2026-01-08",
      TIME_ZONE
    );

    expect(summary.spendingTotal).toBe(0.3);
    expect(summary.categoryTotals).toEqual([{ category: "Food", total: 0.3 }]);
  });

  it("returns an empty summary for a day with no transactions", () => {
    expect(
      buildDaySummary([expense(1, 40, "Food", "2026-01-08T17:00:00.000Z")], "2026-01-09", TIME_ZONE)
    ).toEqual({
      dateKey: "2026-01-09",
      spendingTotal: 0,
      spendingCount: 0,
      transactions: [],
      incomeTransactions: [],
      categoryTotals: []
    });
  });
});
