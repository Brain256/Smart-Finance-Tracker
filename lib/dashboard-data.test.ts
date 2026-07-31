import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getDashboardData,
  getDashboardDateWindow,
  normalizeExpenseRow
} from "@/lib/dashboard-data";
import { sampleExpenses } from "@/lib/sample-data";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("normalizeExpenseRow", () => {
  it("preserves unavailable historical metadata as null without changing financial values", () => {
    const expense = normalizeExpenseRow({
      id: 12,
      created_at: "2025-01-02T12:00:00Z",
      merchant_name: "Legacy Market",
      amount: "12.34",
      category: "Food",
      timestamp: "2025-01-02T12:00:00Z",
      confidence: null,
      reviewed: null,
      classified_at: null,
      classification_origin: null
    });

    expect(expense).toMatchObject({
      id: 12,
      amount: 12.34,
      category: "Food",
      confidence: null,
      reviewed: null,
      classifiedAt: null,
      classificationOrigin: null
    });
  });

  it("preserves an actual zero confidence while sample expenses remain calculation-compatible", () => {
    const expense = normalizeExpenseRow({
      id: 13,
      created_at: "2025-01-03T12:00:00Z",
      merchant_name: "New Market",
      amount: 10,
      category: "Food",
      timestamp: "2025-01-03T12:00:00Z",
      confidence: "0",
      reviewed: false,
      classified_at: "2025-01-03T12:00:00Z",
      classification_origin: "llm"
    });

    expect(expense.confidence).toBe(0);
    expect(sampleExpenses.reduce((total, item) => total + item.amount, 0)).toBeGreaterThan(0);
  });
});

describe("getDashboardDateWindow", () => {
  it("uses finance-local calendar boundaries across a daylight-saving transition", () => {
    expect(
      getDashboardDateWindow(new Date("2025-03-09T17:00:00Z"), "America/Toronto")
    ).toEqual({
      startDate: "2024-12-10",
      endDate: "2025-03-09",
      startTimestamp: "2024-12-10T05:00:00.000Z",
      endTimestamp: "2025-03-10T04:00:00.000Z"
    });
  });
});

describe("getDashboardData", () => {
  it("retains the demo fallback and a fully typed unavailable snapshot when core configuration is absent", async () => {
    vi.stubEnv("FINANCE_TIMEZONE", "America/Vancouver");
    vi.stubEnv("REVIEW_THRESHOLD", "0.42");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const snapshot = await getDashboardData();

    expect(snapshot).toMatchObject({
      expenses: sampleExpenses,
      isDemoData: true,
      financeTimezone: "America/Vancouver",
      reviewThreshold: 0.42
    });
    expect(snapshot.loadError).toContain("credentials are not configured");
    expect(snapshot.budgets.status).toBe("unavailable");
    expect(snapshot.incomeRecords.status).toBe("unavailable");
    expect(snapshot.savingsTarget.status).toBe("unavailable");
    expect(snapshot.trend.status).toBe("unavailable");
    expect(snapshot.accuracy.status).toBe("unavailable");
  });
});
