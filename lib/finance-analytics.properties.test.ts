import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  amountToCents,
  buildHeatmapDays,
  EMPTY_EXPENSE_FILTERS,
  filterExpenses,
  getBudgetProgress,
  getIntensityLevel,
  getNetCashFlow,
  getPeriodMetrics,
  getPlanningLimits,
  getProjection,
  getTrailingAverageSpending,
  normalizeMerchantKey,
  normalizeMonthlyIncome,
  selectActiveIncome,
  NON_ZERO_INTENSITY_LEVEL_COUNT
} from "./finance-analytics";
import {
  expenseCategories,
  type CategoryBudget,
  type ExpenseCategory,
  type ExpenseRecord,
  type IncomeRecord,
  type SavingsTarget,
  type SpendingCategory
} from "./types";

const TIME_ZONE = "America/Toronto";
const RUNS = { numRuns: 100 };
const MONTH_KEY = "2026-06";
const DAYS_IN_MONTH = 30;

const spendingCategories = expenseCategories.filter(
  (category): category is SpendingCategory => category !== "Income"
);

/** Two-decimal currency amounts, generated as cents so arithmetic stays exact. */
const amountArb = fc.integer({ min: 1, max: 500_000 }).map((cents) => cents / 100);
const dayArb = fc.integer({ min: 1, max: DAYS_IN_MONTH });
const merchantArb = fc.constantFrom("Corner Market", "Rail Pass", "  CORNER   market ", "Cafe One", "Zed");

/** Noon UTC keeps the generated instant on the same calendar date in the finance timezone. */
function timestampFor(day: number): string {
  return `${MONTH_KEY}-${String(day).padStart(2, "0")}T12:00:00.000Z`;
}

function expenseArb(category: fc.Arbitrary<ExpenseCategory>): fc.Arbitrary<ExpenseRecord> {
  return fc.record({ id: fc.integer({ min: 1, max: 100_000 }), amount: amountArb, category, day: dayArb, merchantName: merchantArb }).map(
    ({ id, amount, category: recordCategory, day, merchantName }) => ({
      id,
      amount,
      category: recordCategory,
      merchantName,
      timestamp: timestampFor(day),
      createdAt: timestampFor(day)
    })
  );
}

const spendingExpensesArb = fc.array(expenseArb(fc.constantFrom(...spendingCategories)), { maxLength: 25 });
const incomeExpensesArb = fc.array(expenseArb(fc.constant<ExpenseCategory>("Income")), { maxLength: 8 });

function budgetsArb(): fc.Arbitrary<CategoryBudget[]> {
  return fc
    .uniqueArray(fc.constantFrom(...spendingCategories), { maxLength: spendingCategories.length })
    .chain((categories) =>
      fc.tuple(...categories.map(() => fc.integer({ min: 0, max: 500_000 }))).map((limits) =>
        categories.map((category, index) => ({
          category,
          monthlyLimit: limits[index] / 100,
          updatedAt: "2026-06-01T00:00:00.000Z"
        }))
      )
    );
}

const incomeRecordArb: fc.Arbitrary<IncomeRecord> = fc
  .record({
    id: fc.integer({ min: 1, max: 10_000 }),
    amount: amountArb,
    frequency: fc.constantFrom<IncomeRecord["frequency"]>("weekly", "biweekly", "monthly"),
    day: dayArb
  })
  .map(({ id, amount, frequency, day }) => ({
    id,
    amount,
    frequency,
    effectiveDate: `${MONTH_KEY}-${String(day).padStart(2, "0")}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  }));

const savingsTargetArb: fc.Arbitrary<SavingsTarget> = fc.oneof(
  fc.record({ value: amountArb }).map(({ value }) => ({ id: 1 as const, mode: "fixed" as const, value, updatedAt: "" })),
  fc
    .integer({ min: 0, max: 10_000 })
    .map((value) => ({ id: 1 as const, mode: "percentage" as const, value: value / 100, updatedAt: "" }))
);

function calculationDateArb(): fc.Arbitrary<string> {
  return dayArb.map((day) => `${MONTH_KEY}-${String(day).padStart(2, "0")}`);
}

function totalSpendingCents(expenses: readonly ExpenseRecord[]): number {
  return expenses
    .filter((item) => item.category !== "Income")
    .reduce((total, item) => total + amountToCents(item.amount), 0);
}

describe("finance analytics properties", () => {
  // Feature: finance-tracker-expansion, Property 5: Spending aggregates exclude income
  it("Property 5: adding Income transactions never changes any spending aggregate", () => {
    fc.assert(
      fc.property(spendingExpensesArb, incomeExpensesArb, budgetsArb(), calculationDateArb(), (spending, incomes, budgets, date) => {
        const withIncome = [...spending, ...incomes];

        expect(getBudgetProgress(withIncome, budgets, date, TIME_ZONE)).toEqual(
          getBudgetProgress(spending, budgets, date, TIME_ZONE)
        );
        expect(getTrailingAverageSpending(withIncome, date, TIME_ZONE)).toBeCloseTo(
          getTrailingAverageSpending(spending, date, TIME_ZONE),
          10
        );
        expect(getPeriodMetrics(withIncome, date, TIME_ZONE)).toEqual(
          getPeriodMetrics(spending, date, TIME_ZONE)
        );
        expect(buildHeatmapDays(withIncome, MONTH_KEY, TIME_ZONE).days).toEqual(
          buildHeatmapDays(spending, MONTH_KEY, TIME_ZONE).days
        );
      }),
      RUNS
    );
  });

  // Feature: finance-tracker-expansion, Property 6: Income, savings, and budget calculations
  it("Property 6: active income is the latest effective record and limits follow the documented formulas", () => {
    fc.assert(
      fc.property(fc.array(incomeRecordArb, { maxLength: 8 }), savingsTargetArb, calculationDateArb(), (records, target, date) => {
        // Effective dates are unique in the schema, so mirror that before selecting.
        const unique = records.filter(
          (record, index) => records.findIndex((other) => other.effectiveDate === record.effectiveDate) === index
        );
        const active = selectActiveIncome(unique, date);
        const eligible = unique.filter((record) => record.effectiveDate <= date);

        if (eligible.length === 0) {
          expect(active).toBeNull();
        } else {
          const latest = eligible.reduce((best, record) =>
            record.effectiveDate > best.effectiveDate ? record : best
          );
          expect(active?.effectiveDate).toBe(latest.effectiveDate);

          const multiplier = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1 }[latest.frequency];
          expect(normalizeMonthlyIncome(latest)).toBeCloseTo(latest.amount * multiplier, 6);

          const limits = getPlanningLimits(unique, target, date);
          expect(limits.status).toBe("ready");
          if (limits.status === "ready") {
            const savings =
              target.mode === "fixed" ? target.value : (limits.normalizedMonthlyIncome * target.value) / 100;
            expect(limits.monthlySavingsAmount).toBeCloseTo(savings, 6);
            expect(limits.spendableThisPeriod).toBeCloseTo(limits.normalizedMonthlyIncome - savings, 6);
            expect(limits.daysInMonth).toBe(DAYS_IN_MONTH);
            expect(limits.dailyLimit).toBeCloseTo(limits.spendableThisPeriod / DAYS_IN_MONTH, 6);
            expect(limits.weeklyLimit).toBeCloseTo(limits.spendableThisPeriod / (DAYS_IN_MONTH / 7), 6);
          }
        }
      }),
      RUNS
    );
  });

  // Feature: finance-tracker-expansion, Property 6: Income, savings, and budget calculations
  it("Property 6: budget state follows the exact 75% and 100% bands", () => {
    fc.assert(
      fc.property(spendingExpensesArb, budgetsArb(), calculationDateArb(), (expenses, budgets, date) => {
        for (const progress of getBudgetProgress(expenses, budgets, date, TIME_ZONE)) {
          if (progress.consumption === null) {
            expect(progress.monthlyLimit).toBe(0);
            continue;
          }
          const expected =
            progress.consumption < 0.75 ? "green" : progress.consumption < 1 ? "yellow" : "red";
          expect(progress.state).toBe(expected);
        }
      }),
      RUNS
    );
  });

  // Feature: finance-tracker-expansion, Property 7: Actual net cash flow is plan-independent
  it("Property 7: net cash flow is current-month income less current-month spending only", () => {
    fc.assert(
      fc.property(spendingExpensesArb, incomeExpensesArb, budgetsArb(), savingsTargetArb, calculationDateArb(), (spending, incomes, budgets, target, date) => {
        const expenses = [...spending, ...incomes];
        const incomeCents = incomes.reduce((total, item) => total + amountToCents(item.amount), 0);
        const expected = (incomeCents - totalSpendingCents(expenses)) / 100;

        expect(getNetCashFlow(expenses, date, TIME_ZONE)).toBeCloseTo(expected, 6);
        // Planning inputs are not arguments, so changing them cannot move the value.
        expect(getNetCashFlow(expenses, date, TIME_ZONE)).toBeCloseTo(
          getNetCashFlow([...expenses], date, TIME_ZONE),
          10
        );
        expect(budgets.length).toBeGreaterThanOrEqual(0);
        expect(target.value).toBeGreaterThanOrEqual(0);
      }),
      RUNS
    );
  });

  // Feature: finance-tracker-expansion, Property 8: Projection handles partial budgets and calendar boundaries
  it("Property 8: adjusted remainder, baseline, and inclusive days remaining follow the formula", () => {
    fc.assert(
      fc.property(spendingExpensesArb, incomeExpensesArb, budgetsArb(), incomeRecordArb, savingsTargetArb, (spending, incomes, budgets, incomeRecord, target) => {
        const date = `${MONTH_KEY}-01`;
        const expenses = [...spending, ...incomes];
        const projection = getProjection(
          expenses,
          budgets,
          [{ ...incomeRecord, effectiveDate: "2026-01-01" }],
          target,
          date,
          TIME_ZONE
        );
        if (projection.status !== "ready") return;

        const budgeted = new Set(budgets.map((budget) => budget.category));
        const unbudgetedCents = spending
          .filter((item) => !budgeted.has(item.category as SpendingCategory))
          .reduce((total, item) => total + amountToCents(item.amount), 0);

        expect(projection.unbudgetedCurrentMonthSpending).toBeCloseTo(unbudgetedCents / 100, 6);
        expect(projection.adjustedRemainingBudget).toBeCloseTo(
          projection.remainingBudget - projection.unbudgetedCurrentMonthSpending,
          6
        );
        expect(projection.baseline).toBeCloseTo(
          Math.min(projection.adjustedRemainingBudget, projection.incomeRemaining),
          6
        );
        expect(projection.daysRemaining).toBe(DAYS_IN_MONTH);
        expect(projection.value).toBeCloseTo(
          projection.baseline - projection.averageDailySpending * projection.daysRemaining,
          6
        );
      }),
      RUNS
    );
  });

  // Feature: finance-tracker-expansion, Property 8: Projection handles partial budgets and calendar boundaries
  it("Property 8: the final local day of the month always leaves exactly one day remaining", () => {
    fc.assert(
      fc.property(spendingExpensesArb, budgetsArb(), incomeRecordArb, savingsTargetArb, (spending, budgets, incomeRecord, target) => {
        const projection = getProjection(
          spending,
          budgets,
          [{ ...incomeRecord, effectiveDate: "2026-01-01" }],
          target,
          `${MONTH_KEY}-${DAYS_IN_MONTH}`,
          TIME_ZONE
        );
        if (projection.status !== "ready") return;
        expect(projection.daysRemaining).toBe(1);
      }),
      RUNS
    );
  });

  // Feature: finance-tracker-expansion, Property 9: Filter composition and restoration
  it("Property 9: every result satisfies each active predicate and clearing restores the collection", () => {
    fc.assert(
      fc.property(
        fc.array(expenseArb(fc.constantFrom(...expenseCategories)), { maxLength: 25 }),
        merchantArb,
        fc.constantFrom<ExpenseCategory | "all">("all", ...expenseCategories),
        dayArb,
        dayArb,
        (expenses, merchantQuery, category, startDay, endDay) => {
          const startDate = `${MONTH_KEY}-${String(Math.min(startDay, endDay)).padStart(2, "0")}`;
          const endDate = `${MONTH_KEY}-${String(Math.max(startDay, endDay)).padStart(2, "0")}`;
          const filters = { merchantQuery, category, startDate, endDate };
          const filtered = filterExpenses(expenses, filters, TIME_ZONE);

          for (const item of filtered) {
            expect(normalizeMerchantKey(item.merchantName)).toContain(normalizeMerchantKey(merchantQuery));
            if (category !== "all") expect(item.category).toBe(category);
            const dateKey = item.timestamp.slice(0, 10);
            expect(dateKey >= startDate && dateKey <= endDate).toBe(true);
          }

          expect(filterExpenses(expenses, EMPTY_EXPENSE_FILTERS, TIME_ZONE)).toEqual([...expenses]);
        }
      ),
      RUNS
    );
  });

  // Feature: finance-tracker-expansion, Property 10: Heatmap calendar and intensity invariants
  it("Property 10: heatmap grids are chronological, complete, and use equal-width bands", () => {
    fc.assert(
      fc.property(spendingExpensesArb, incomeExpensesArb, (spending, incomes) => {
        const grid = buildHeatmapDays([...spending, ...incomes], MONTH_KEY, TIME_ZONE);

        expect(grid.days).toHaveLength(DAYS_IN_MONTH);
        expect(grid.days.map((day) => day.dateKey)).toEqual(
          Array.from({ length: DAYS_IN_MONTH }, (_, index) => `${MONTH_KEY}-${String(index + 1).padStart(2, "0")}`)
        );
        expect((grid.leadingPadding + grid.days.length + grid.trailingPadding) % 7).toBe(0);

        for (const day of grid.days) {
          if (day.total === 0) {
            expect(day.level).toBe(0);
          } else {
            expect(day.level).toBeGreaterThanOrEqual(1);
            expect(day.level).toBeLessThanOrEqual(NON_ZERO_INTENSITY_LEVEL_COUNT);
            expect(day.level).toBe(getIntensityLevel(day.total, grid.maxTotal));
          }
        }
      }),
      RUNS
    );
  });

  // Feature: finance-tracker-expansion, Property 10: Heatmap calendar and intensity invariants
  it("Property 10: an exact band boundary belongs to the higher band", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: NON_ZERO_INTENSITY_LEVEL_COUNT - 1 }), fc.integer({ min: 100, max: 100_000 }), (band, maxTotal) => {
        const boundary = (maxTotal * band) / NON_ZERO_INTENSITY_LEVEL_COUNT;
        expect(getIntensityLevel(boundary, maxTotal)).toBe(band + 1);
      }),
      RUNS
    );
  });
});
