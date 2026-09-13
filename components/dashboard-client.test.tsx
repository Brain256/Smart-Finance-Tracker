import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardClient } from "@/components/dashboard-client";
import { INTENSITY_LEVELS } from "@/components/finance/calendar-heatmap";
import type {
  CategoryBudget,
  ClassificationAccuracy,
  ExpenseRecord,
  FeatureLoadState,
  IncomeRecord,
  SavingsTarget,
  TrendPoint
} from "@/lib/types";

const {
  correctExpenseCategoryMock,
  deleteExpenseMock,
  routerRefreshMock,
  saveCategoryBudgetMock,
  deleteCategoryBudgetMock,
  saveIncomeRecordMock,
  deleteIncomeRecordMock,
  saveSavingsTargetMock,
  deleteSavingsTargetMock
} = vi.hoisted(() => ({
  correctExpenseCategoryMock: vi.fn(),
  deleteExpenseMock: vi.fn(),
  routerRefreshMock: vi.fn(),
  saveCategoryBudgetMock: vi.fn(),
  deleteCategoryBudgetMock: vi.fn(),
  saveIncomeRecordMock: vi.fn(),
  deleteIncomeRecordMock: vi.fn(),
  saveSavingsTargetMock: vi.fn(),
  deleteSavingsTargetMock: vi.fn()
}));

vi.mock("@/app/dashboard/actions", () => ({
  correctExpenseCategory: correctExpenseCategoryMock,
  deleteExpense: deleteExpenseMock,
  saveCategoryBudget: saveCategoryBudgetMock,
  deleteCategoryBudget: deleteCategoryBudgetMock,
  saveIncomeRecord: saveIncomeRecordMock,
  deleteIncomeRecord: deleteIncomeRecordMock,
  saveSavingsTarget: saveSavingsTargetMock,
  deleteSavingsTarget: deleteSavingsTargetMock
}));
vi.mock("@/app/login/actions", () => ({ signOutOfDashboard: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefreshMock }) }));

const FINANCE_TIMEZONE = "America/Toronto";
/** Fixed finance-local "today" of 2025-01-15 for every date-dependent assertion. */
const NOW = new Date("2025-01-15T17:00:00.000Z");

const lowConfidenceExpense: ExpenseRecord = {
  id: 17,
  createdAt: "2025-01-02T00:00:00.000Z",
  merchantName: "Corner Market",
  amount: 18.5,
  category: "Transport",
  timestamp: "2025-01-02T12:00:00.000Z",
  confidence: 0.3,
  reviewed: false,
  classifiedAt: "2025-01-02T12:00:00.000Z",
  classificationOrigin: "llm"
};

const historicalExpense: ExpenseRecord = {
  id: 18,
  createdAt: "2024-01-02T00:00:00.000Z",
  merchantName: "Historic Shop",
  amount: 12,
  category: "Shopping",
  timestamp: "2024-01-02T12:00:00.000Z",
  confidence: null,
  reviewed: null
};

function expense(overrides: Partial<ExpenseRecord> & Pick<ExpenseRecord, "id">): ExpenseRecord {
  return {
    createdAt: "2025-01-01T00:00:00.000Z",
    merchantName: "Merchant",
    amount: 10,
    category: "Food",
    timestamp: "2025-01-10T17:00:00.000Z",
    confidence: 0.9,
    reviewed: true,
    ...overrides
  };
}

const unavailable = <T,>(reason: string): FeatureLoadState<T> => ({ status: "unavailable", reason });
const ready = <T,>(data: T): FeatureLoadState<T> => ({ status: "ready", data });

type SnapshotProps = {
  budgets: FeatureLoadState<CategoryBudget[]>;
  incomeRecords: FeatureLoadState<IncomeRecord[]>;
  savingsTarget: FeatureLoadState<SavingsTarget | null>;
  trend: FeatureLoadState<TrendPoint[]>;
  accuracy: FeatureLoadState<ClassificationAccuracy>;
};

const unavailableSnapshot: SnapshotProps = {
  budgets: unavailable("Category budgets are unavailable."),
  incomeRecords: unavailable("Income records are unavailable."),
  savingsTarget: unavailable("Savings target is unavailable."),
  trend: unavailable("Spending trend is unavailable."),
  accuracy: unavailable("Classification accuracy is unavailable.")
};

function renderDashboard(expenses: ExpenseRecord[], snapshot: Partial<SnapshotProps> = {}, canDelete = false) {
  return render(
    <DashboardClient
      canDelete={canDelete}
      expenses={expenses}
      financeTimezone={FINANCE_TIMEZONE}
      reviewThreshold={0.7}
      {...unavailableSnapshot}
      {...snapshot}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  for (const mock of [
    correctExpenseCategoryMock,
    deleteExpenseMock,
    routerRefreshMock,
    saveCategoryBudgetMock,
    deleteCategoryBudgetMock,
    saveIncomeRecordMock,
    deleteIncomeRecordMock,
    saveSavingsTargetMock,
    deleteSavingsTargetMock
  ]) {
    mock.mockReset();
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DashboardClient composition", () => {
  it("keeps the existing panels in tabs and provides a separate Settings tab", async () => {
    const user = userEvent.setup();

    renderDashboard([]);

    expect(screen.getByRole("navigation", { name: "Dashboard sections" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("title", "Overview");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-controls", "dashboard-panel-overview");
    expect(screen.getByRole("tabpanel", { name: "Overview" })).toHaveAttribute("id", "dashboard-panel-overview");
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
    expect(screen.getByText("Brian")).toBeInTheDocument();
    const spendingSummary = screen.getByRole("region", { name: "Spending summary" });
    expect(within(spendingSummary).getByText("Today")).toBeInTheDocument();
    expect(within(spendingSummary).getByText("This week")).toBeInTheDocument();
    expect(within(spendingSummary).getByText("This month")).toBeInTheDocument();
    expect(within(spendingSummary).getByText("All time")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Spending against budget" })).toBeInTheDocument();
    expect(screen.getByText("Spending today")).toBeInTheDocument();
    expect(screen.getByText("Spending this week")).toBeInTheDocument();
    expect(screen.getByText("Spending this month")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(screen.getByRole("tabpanel", { name: "Calendar" })).toHaveAttribute("id", "dashboard-panel-calendar");
    expect(screen.getByRole("button", { name: "Previous month" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Transactions" }));
    expect(screen.getByRole("tabpanel", { name: "Transactions" })).toHaveAttribute("id", "dashboard-panel-transactions");
    expect(screen.getByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Income history" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Savings target" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Category budgets" })).not.toBeInTheDocument();
  });

  it("shows the five newest spending transactions and opens Transactions from a row", async () => {
    const user = userEvent.setup();
    renderDashboard([
      expense({ id: 1, merchantName: "Old Expense", timestamp: "2025-01-01T17:00:00.000Z" }),
      expense({ id: 2, merchantName: "Second Expense", timestamp: "2025-01-10T17:00:00.000Z" }),
      expense({ id: 3, merchantName: "Third Expense", timestamp: "2025-01-11T17:00:00.000Z" }),
      expense({ id: 4, merchantName: "Fourth Expense", timestamp: "2025-01-12T17:00:00.000Z" }),
      expense({ id: 5, merchantName: "Fifth Expense", timestamp: "2025-01-13T17:00:00.000Z" }),
      expense({ id: 6, merchantName: "Newest Expense", timestamp: "2025-01-14T17:00:00.000Z" }),
      expense({ id: 99, merchantName: "Paycheque", category: "Income", amount: 2000, timestamp: "2025-01-15T17:00:00.000Z" })
    ]);

    const recent = screen.getByRole("region", { name: "Recent transactions" });
    const recentList = within(recent).getByRole("list", { name: "Recent spending transactions" });
    const rows = within(recentList).getAllByRole("listitem");

    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.textContent?.trim())).toEqual([
      expect.stringContaining("Newest Expense"),
      expect.stringContaining("Fifth Expense"),
      expect.stringContaining("Fourth Expense"),
      expect.stringContaining("Third Expense"),
      expect.stringContaining("Second Expense")
    ]);
    expect(within(recentList).queryByText("Old Expense")).not.toBeInTheDocument();
    expect(within(recentList).queryByText("Paycheque")).not.toBeInTheDocument();

    await user.click(within(rows[0]).getByRole("button", { name: /Open transaction from Newest Expense/ }));

    expect(screen.getByRole("tab", { name: "Transactions" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Transactions" })).toHaveFocus();

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    const keyboardRow = within(screen.getByRole("region", { name: "Recent transactions" }))
      .getByRole("button", { name: /Open transaction from Second Expense/ });
    keyboardRow.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("tab", { name: "Transactions" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows available spending rows and an explicit empty state", () => {
    const { unmount } = renderDashboard([
      expense({ id: 1, merchantName: "Only Expense" }),
      expense({ id: 2, merchantName: "Income Record", category: "Income" })
    ]);

    const recent = screen.getByRole("region", { name: "Recent transactions" });
    expect(within(recent).getAllByRole("listitem")).toHaveLength(1);
    expect(within(recent).getByText("Only Expense")).toBeInTheDocument();
    expect(within(recent).queryByText("Income Record")).not.toBeInTheDocument();

    unmount();
    renderDashboard([]);
    expect(screen.getByText("No spending transactions have been recorded yet.")).toBeInTheDocument();
  });

  it("focuses the matching editor and replaces a successfully corrected low-confidence row", async () => {
    const user = userEvent.setup();
    const correctedExpense = { ...lowConfidenceExpense, category: "Food" as const, reviewed: true };
    correctExpenseCategoryMock.mockResolvedValue({
      ok: true,
      data: { expense: correctedExpense, changed: true, correctionId: 8 }
    });

    renderDashboard([lowConfidenceExpense, historicalExpense]);
    await user.click(screen.getByRole("tab", { name: "Transactions" }));

    await user.click(screen.getByRole("button", { name: "Unverified category for Corner Market. Focus category editor" }));
    const categorySelect = screen.getByLabelText("Category for Corner Market");
    expect(categorySelect).toHaveFocus();
    expect(screen.getByText("Confidence unavailable")).toBeInTheDocument();

    await user.selectOptions(categorySelect, "Food");
    await user.click(screen.getByRole("button", { name: "Save category for Corner Market" }));

    await waitFor(() => expect(correctExpenseCategoryMock).toHaveBeenCalledWith(17, "Food"));
    await waitFor(() => expect(screen.queryByLabelText("Category for Corner Market")).not.toBeInTheDocument());
    const correctedRow = screen.getAllByRole("row").find((row) => row.textContent?.includes("Corner Market")) as HTMLElement;
    expect(within(correctedRow).getAllByRole("cell")[2]).toHaveTextContent("Food");
    expect(screen.queryByRole("button", { name: /Unverified category for Corner Market/ })).not.toBeInTheDocument();
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("restores the pre-edit category and presents a row error when correction fails", async () => {
    const user = userEvent.setup();
    correctExpenseCategoryMock.mockResolvedValue({ ok: false, message: "Unable to save the category correction. Please try again." });

    renderDashboard([lowConfidenceExpense]);
    await user.click(screen.getByRole("tab", { name: "Transactions" }));

    await user.click(screen.getByRole("button", { name: "Unverified category for Corner Market. Focus category editor" }));
    const categorySelect = screen.getByLabelText("Category for Corner Market");
    await user.selectOptions(categorySelect, "Food");
    await user.click(screen.getByRole("button", { name: "Save category for Corner Market" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save the category correction. Please try again.");
    expect(categorySelect).toHaveValue("Transport");
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it("submits the current category as a no-op that keeps the row unchanged", async () => {
    const user = userEvent.setup();
    correctExpenseCategoryMock.mockResolvedValue({
      ok: true,
      data: { expense: lowConfidenceExpense, changed: false, correctionId: null }
    });

    renderDashboard([lowConfidenceExpense]);
    await user.click(screen.getByRole("tab", { name: "Transactions" }));

    await user.click(screen.getByRole("button", { name: "Unverified category for Corner Market. Focus category editor" }));
    const categorySelect = screen.getByLabelText("Category for Corner Market");
    await user.selectOptions(categorySelect, "Food");
    await user.selectOptions(categorySelect, "Transport");

    // Save stays disabled while the selection matches the persisted category.
    expect(screen.getByRole("button", { name: "Save category for Corner Market" })).toBeDisabled();
    expect(correctExpenseCategoryMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Unverified category for Corner Market/ })).toBeInTheDocument();
  });
  it("renders pencil and trash actions as compact accessible controls", async () => {
    const user = userEvent.setup();

    renderDashboard([expense({ id: 20, merchantName: "Corner Cafe" })], {}, true);
    await user.click(screen.getByRole("tab", { name: "Transactions" }));

    expect(screen.getByRole("button", { name: "Edit category for Corner Cafe" })).toHaveAttribute("title", "Edit category");
    expect(screen.getByRole("button", { name: "Delete transaction from Corner Cafe" })).toHaveAttribute("title", "Delete transaction");
  });
});

describe("Assistant tab", () => {
  it("exposes an Assistant tab alongside the existing sections", async () => {
    const user = userEvent.setup();
    renderDashboard([], {}, true);

    const tab = screen.getByRole("tab", { name: "Assistant" });
    expect(tab).toHaveAttribute("aria-controls", "dashboard-panel-assistant");

    await user.click(tab);

    expect(screen.getByRole("region", { name: "Assistant" })).toBeInTheDocument();
    expect(screen.getByLabelText(/ask a question about your transactions/i)).toBeInTheDocument();
  });

  it("disables the assistant when the dashboard is showing sample data", async () => {
    const user = userEvent.setup();
    // canDelete is false exactly when the snapshot fell back to demo data.
    renderDashboard([], {}, false);

    await user.click(screen.getByRole("tab", { name: "Assistant" }));

    expect(screen.getByText(/unavailable while the dashboard is showing sample data/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/ask a question about your transactions/i)).not.toBeInTheDocument();
  });
});

describe("Overview accuracy and planning presentation", () => {
  it("renders 90-day accuracy with its classified and corrected counts", async () => {
    renderDashboard([], {
      accuracy: ready({
        accuracy: 0.9,
        totalClassified: 20,
        correctedCount: 2,
        windowStart: "2024-10-18",
        windowEnd: "2025-01-15"
      })
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Transactions" }));

    expect(screen.getByText("90.0%")).toBeInTheDocument();
    expect(screen.getByText(/2 corrected of 20 classified since 2024-10-18/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Spending by category" })).not.toBeInTheDocument();
  });

  it("shows category spending percentages in the chart legend", () => {
    renderDashboard([
      expense({ id: 1, category: "Food", amount: 25 }),
      expense({ id: 2, category: "Transport", amount: 75 })
    ]);

    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("reports insufficient data instead of an accuracy value when nothing was classified", async () => {
    renderDashboard([], {
      accuracy: ready({
        accuracy: null,
        totalClassified: 0,
        correctedCount: 0,
        windowStart: "2024-10-18",
        windowEnd: "2025-01-15"
      })
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Transactions" }));

    expect(screen.getByText(/Not enough classified transactions yet/)).toBeInTheDocument();
  });

  it("names each missing prerequisite instead of showing a zero-valued limit or projection", () => {
    renderDashboard([], { budgets: ready([]), incomeRecords: ready([]), savingsTarget: ready(null) });

    expect(screen.getByText("Add an active income record, a savings target in Settings to compare spending against a budget.")).toBeInTheDocument();
  });

  it("renders derived budgets and period pacing when planning data is complete", () => {
    renderDashboard([expense({ id: 1, amount: 100, category: "Food" })], {
      budgets: ready([{ category: "Food", monthlyLimit: 500, updatedAt: "2025-01-01T00:00:00.000Z" }]),
      incomeRecords: ready([
        { id: 1, amount: 4000, frequency: "monthly", effectiveDate: "2025-01-01", createdAt: "", updatedAt: "" }
      ]),
      savingsTarget: ready({ id: 1, mode: "fixed", value: 1000, updatedAt: "" })
    });

    // Spendable = 4000 - 1000 = 3000 over a 31-day month.
    const panel = screen.getByRole("heading", { name: "Spending against budget" }).closest("section") as HTMLElement;
    const monthRow = within(panel).getByText("Spending this month").closest("li") as HTMLElement;
    expect(within(panel).getByText("$3,000.00")).toBeInTheDocument();
    expect(within(panel).getByText("$96.77")).toBeInTheDocument();
    expect(within(monthRow).getByText(/Projected:/)).toBeInTheDocument();
    expect(within(monthRow).getByText(/16 days remaining/)).toBeInTheDocument();
  });

  it("combines period spending, budget usage bars, and the savings target", () => {
    renderDashboard(
      [
        expense({ id: 1, amount: 75, timestamp: "2025-01-15T17:00:00.000Z" }),
        expense({ id: 2, amount: 600, timestamp: "2025-01-13T17:00:00.000Z" })
      ],
      {
        budgets: ready([]),
        incomeRecords: ready([
          { id: 1, amount: 4000, frequency: "monthly", effectiveDate: "2025-01-01", createdAt: "", updatedAt: "" }
        ]),
        savingsTarget: ready({ id: 1, mode: "fixed", value: 1000, updatedAt: "" })
      }
    );

    const panel = screen.getByRole("heading", { name: "Spending against budget" }).closest("section") as HTMLElement;
    expect(within(panel).getByText("$75.00")).toBeInTheDocument();
    const monthRow = within(panel).getByText("Spending this month").closest("li") as HTMLElement;
    expect(within(monthRow).getByText("$675.00")).toBeInTheDocument();
    expect(within(panel).getByText("$3,000.00")).toBeInTheDocument();
    expect(within(panel).getByText("Your savings target is $1,000.00 per month.")).toBeInTheDocument();
    expect(within(panel).getAllByRole("progressbar")).toHaveLength(6);
  });

  it("removes the standalone net panel while keeping Income out of spending totals", () => {
    const expenses = [
      expense({ id: 1, amount: 2000, category: "Income", merchantName: "Payroll" }),
      expense({ id: 2, amount: 250, category: "Food", timestamp: "2025-01-15T17:00:00.000Z" })
    ];

    renderDashboard(expenses);

    expect(screen.queryByRole("heading", { name: "Net this month" })).not.toBeInTheDocument();
    expect(screen.getAllByText("$250.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("$1,750.00")).not.toBeInTheDocument();
  });

  it("shows the month forecast from actual spending and the trailing daily average", () => {
    renderDashboard(
      [
        expense({ id: 1, amount: 100, category: "Food" }),
        expense({ id: 2, amount: 150, category: "Shopping" })
      ],
      {
        budgets: ready([{ category: "Food", monthlyLimit: 500, updatedAt: "" }]),
        incomeRecords: ready([
          { id: 1, amount: 100000, frequency: "monthly", effectiveDate: "2025-01-01", createdAt: "", updatedAt: "" }
        ]),
        savingsTarget: ready({ id: 1, mode: "fixed", value: 0, updatedAt: "" })
      }
    );

    const panel = screen.getByRole("heading", { name: "Spending against budget" }).closest("section") as HTMLElement;
    const monthRow = within(panel).getByText("Spending this month").closest("li") as HTMLElement;
    expect(within(monthRow).getByText(/Projected: \$392.88/)).toBeInTheDocument();
  });

  it("renders the zero-filled 90-day trend as accessible date and amount detail", () => {
    renderDashboard([], {
      trend: ready([
        { date: "2025-01-13", total: 0 },
        { date: "2025-01-14", total: 42.5 }
      ])
    });

    expect(screen.getByText("2025-01-13: $0.00 spent")).toBeInTheDocument();
    expect(screen.getByText("2025-01-14: $42.50 spent")).toBeInTheDocument();
  });

  it("marks only the related capability unavailable without hiding real expenses", () => {
    renderDashboard([expense({ id: 1, amount: 25, timestamp: "2025-01-15T17:00:00.000Z" })], { trend: unavailable("Spending trend is unavailable.") });

    expect(screen.getByText("Spending trend is unavailable.")).toBeInTheDocument();
    expect(screen.getAllByText("$25.00").length).toBeGreaterThan(0);
  });
});

describe("Transactions search and filtering", () => {
  const filterExpenses = [
    expense({ id: 1, merchantName: "Corner Market", category: "Food", amount: 10, timestamp: "2025-01-05T17:00:00.000Z" }),
    expense({ id: 2, merchantName: "  corner   MARKET  ", category: "Transport", amount: 20, timestamp: "2025-01-10T17:00:00.000Z" }),
    expense({ id: 3, merchantName: "Rail Pass", category: "Transport", amount: 30, timestamp: "2025-01-20T17:00:00.000Z" })
  ];

  async function openTransactions() {
    const user = userEvent.setup();
    renderDashboard(filterExpenses);
    await user.click(screen.getByRole("tab", { name: "Transactions" }));
    return user;
  }

  function visibleMerchants(): string[] {
    return screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[1].textContent?.trim() ?? "");
  }

  it("matches merchants case-insensitively after whitespace normalization", async () => {
    const user = await openTransactions();

    await user.type(screen.getByLabelText("Search merchant"), "corner market");

    expect(visibleMerchants()).toHaveLength(2);
  });

  it("intersects merchant, category, and inclusive date filters", async () => {
    const user = await openTransactions();

    await user.type(screen.getByLabelText("Search merchant"), "corner");
    await user.selectOptions(screen.getByLabelText("Category"), "Transport");
    await user.type(screen.getByLabelText("Start date"), "2025-01-10");
    await user.type(screen.getByLabelText("End date"), "2025-01-10");

    expect(visibleMerchants()).toHaveLength(1);
    expect(screen.getByText("1 of 3 records sorted by timestamp")).toBeInTheDocument();
  });

  it("presents a validation message and applies no filter for exactly one date boundary", async () => {
    const user = await openTransactions();

    await user.type(screen.getByLabelText("Start date"), "2025-01-10");

    expect(screen.getByRole("alert")).toHaveTextContent("Select both a start date and an end date to filter by date.");
    expect(visibleMerchants()).toHaveLength(3);
  });

  it("presents a validation message and applies no filter for an inverted range", async () => {
    const user = await openTransactions();

    await user.type(screen.getByLabelText("Start date"), "2025-01-20");
    await user.type(screen.getByLabelText("End date"), "2025-01-05");

    expect(screen.getByRole("alert")).toHaveTextContent("The start date must be on or before the end date.");
    expect(visibleMerchants()).toHaveLength(3);
  });

  it("shows a no-matching state and restores every row when filters are cleared", async () => {
    const user = await openTransactions();

    await user.type(screen.getByLabelText("Search merchant"), "no such merchant");
    expect(screen.getByText("No transactions match the current search and filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(visibleMerchants()).toHaveLength(3);
  });
});

describe("Calendar heatmap", () => {
  function cells(): HTMLElement[] {
    return screen.getAllByRole("button").filter((button) => button.hasAttribute("data-date"));
  }

  it("renders exactly one cell per date of the initial finance-local month", async () => {
    renderDashboard([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Calendar" }));

    expect(screen.getByRole("heading", { name: "January 2025" })).toBeInTheDocument();
    expect(screen.getByLabelText("January 2025 total spending")).toHaveTextContent("$0.00 total spending");
    expect(cells()).toHaveLength(31);
    expect(cells().map((cell) => cell.getAttribute("data-date"))).toEqual(
      Array.from({ length: 31 }, (_, index) => `2025-01-${String(index + 1).padStart(2, "0")}`)
    );
  });

  it("assigns the zero level to every cell of an all-zero month", async () => {
    renderDashboard([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Calendar" }));

    expect(cells().every((cell) => cell.getAttribute("data-level") === "0")).toBe(true);
  });

  it("gives the only positive day the highest level and excludes Income", async () => {
    renderDashboard([
      expense({ id: 1, amount: 40, category: "Food", timestamp: "2025-01-08T17:00:00.000Z" }),
      expense({ id: 2, amount: 9999, category: "Income", timestamp: "2025-01-09T17:00:00.000Z" })
    ]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Calendar" }));

    const byDate = new Map(cells().map((cell) => [cell.getAttribute("data-date"), cell]));
    expect(byDate.get("2025-01-08")?.getAttribute("data-level")).toBe("4");
    expect(byDate.get("2025-01-09")?.getAttribute("data-level")).toBe("0");
    expect(screen.getByLabelText("January 2025 total spending")).toHaveTextContent("$40.00 total spending");
    expect(byDate.get("2025-01-15")).toHaveAttribute("data-today", "true");
    expect(byDate.get("2025-01-15")).toHaveAttribute("aria-current", "date");
    expect(byDate.get("2025-01-08")).toHaveAttribute(
      "aria-label",
      "Jan 8, 2025: $40.00 spent, highest spending"
    );
  });

  it("keeps month navigation, updates totals, and renders each month at its real length", async () => {
    renderDashboard([
      expense({ id: 1, amount: 40, timestamp: "2025-01-08T17:00:00.000Z" }),
      expense({ id: 2, amount: 12, timestamp: "2025-02-08T17:00:00.000Z" }),
      expense({ id: 3, amount: 999, category: "Income", timestamp: "2025-02-09T17:00:00.000Z" })
    ]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Calendar" }));

    expect(screen.getByLabelText("January 2025 total spending")).toHaveTextContent("$40.00 total spending");
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: "December 2024" })).toBeInTheDocument();
    expect(screen.getByLabelText("December 2024 total spending")).toHaveTextContent("$0.00 total spending");
    expect(cells()).toHaveLength(31);

    await user.click(screen.getByRole("button", { name: "Next month" }));
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "February 2025" })).toBeInTheDocument();
    expect(screen.getByLabelText("February 2025 total spending")).toHaveTextContent("$12.00 total spending");
    expect(cells()).toHaveLength(28);
    expect(cells().some((cell) => cell.getAttribute("data-today") === "true")).toBe(false);
  });

  it("opens one detail at a time and labels every legend intensity level", async () => {
    renderDashboard([expense({ id: 1, amount: 40, timestamp: "2025-01-08T17:00:00.000Z" })]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Calendar" }));

    const byDate = new Map(cells().map((cell) => [cell.getAttribute("data-date"), cell]));
    await user.click(byDate.get("2025-01-08")!);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("$40.00");

    await user.click(byDate.get("2025-01-09")!);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("No spending");

    for (const level of INTENSITY_LEVELS) {
      expect(screen.getByText(level.descriptor)).toBeInTheDocument();
    }
  });
});

describe("Calendar day summary", () => {
  function cells(): HTMLElement[] {
    return screen.getAllByRole("button").filter((button) => button.hasAttribute("data-date"));
  }

  async function openCalendar(expenses: ExpenseRecord[]) {
    renderDashboard(expenses);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Calendar" }));
    const byDate = new Map(cells().map((cell) => [cell.getAttribute("data-date"), cell]));

    return { user, byDate };
  }

  function panel(): HTMLElement {
    return screen.getByRole("region", { name: /Transactions for/ });
  }

  const dayExpenses: ExpenseRecord[] = [
    expense({ id: 1, merchantName: "Tim Hortons", amount: 14.5, category: "Food", timestamp: "2025-01-08T19:15:00.000Z" }),
    expense({ id: 2, merchantName: "T&T Supermarket", amount: 25.5, category: "Shopping", timestamp: "2025-01-08T23:40:00.000Z" }),
    expense({ id: 3, merchantName: "Other Day Cafe", amount: 99, category: "Food", timestamp: "2025-01-09T17:00:00.000Z" })
  ];

  it("lists only the clicked day's transactions with merchant, category, and amount", async () => {
    const { user, byDate } = await openCalendar(dayExpenses);

    await user.click(byDate.get("2025-01-08")!);

    const detail = panel();
    const rows = within(detail).getByRole("list", { name: "Spending transactions" });
    expect(within(rows).getByText("Tim Hortons")).toBeInTheDocument();
    expect(within(rows).getByText("$14.50")).toBeInTheDocument();
    expect(within(rows).getByText("T&T Supermarket")).toBeInTheDocument();
    expect(within(rows).getByText("$25.50")).toBeInTheDocument();
    expect(within(detail).queryByText("Other Day Cafe")).not.toBeInTheDocument();
    expect(detail).toHaveTextContent("$40.00");
    expect(detail).toHaveTextContent("2 transactions");
  });

  it("shows a per-category breakdown for the day", async () => {
    const { user, byDate } = await openCalendar([
      ...dayExpenses,
      expense({ id: 4, merchantName: "Second Cafe", amount: 10, category: "Food", timestamp: "2025-01-08T20:00:00.000Z" })
    ]);

    await user.click(byDate.get("2025-01-08")!);

    // Food sums two rows to 24.50, which still ranks below the single 25.50 Shopping entry.
    const breakdown = within(panel()).getByRole("list", { name: "Category breakdown" });
    expect(within(breakdown).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Shopping$25.50",
      "Food$24.50"
    ]);
  });

  it("lists income separately and keeps it out of the day total", async () => {
    const { user, byDate } = await openCalendar([
      expense({ id: 1, merchantName: "Tim Hortons", amount: 14.5, category: "Food", timestamp: "2025-01-08T19:15:00.000Z" }),
      expense({ id: 2, merchantName: "Payroll", amount: 2000, category: "Income", timestamp: "2025-01-08T14:00:00.000Z" })
    ]);

    await user.click(byDate.get("2025-01-08")!);

    const detail = panel();
    expect(detail).toHaveTextContent("$14.50 · 1 transaction");
    expect(within(detail).getByText(/Income \(not counted in the total\)/)).toBeInTheDocument();
    expect(within(detail).getByText("Payroll")).toBeInTheDocument();
    expect(detail).not.toHaveTextContent("$2,014.50");
  });

  it("opens an empty-state message for a day with no transactions", async () => {
    const { user, byDate } = await openCalendar(dayExpenses);

    await user.click(byDate.get("2025-01-20")!);

    expect(within(panel()).getByText("No transactions on this day.")).toBeInTheDocument();
  });

  it("dismisses on a second click of the same day and via the close button", async () => {
    const { user, byDate } = await openCalendar(dayExpenses);

    await user.click(byDate.get("2025-01-08")!);
    expect(screen.queryByRole("region", { name: /Transactions for/ })).toBeInTheDocument();

    await user.click(byDate.get("2025-01-08")!);
    expect(screen.queryByRole("region", { name: /Transactions for/ })).not.toBeInTheDocument();

    await user.click(byDate.get("2025-01-08")!);
    await user.click(screen.getByRole("button", { name: "Close day details" }));
    expect(screen.queryByRole("region", { name: /Transactions for/ })).not.toBeInTheDocument();
  });

  it("clears the panel when the month changes", async () => {
    const { user, byDate } = await openCalendar(dayExpenses);

    await user.click(byDate.get("2025-01-08")!);
    expect(screen.queryByRole("region", { name: /Transactions for/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.queryByRole("region", { name: /Transactions for/ })).not.toBeInTheDocument();
  });

  it("marks the selected cell as expanded and leaves the hover tooltip alone", async () => {
    const { user, byDate } = await openCalendar(dayExpenses);

    await user.click(byDate.get("2025-01-08")!);

    expect(byDate.get("2025-01-08")).toHaveAttribute("aria-expanded", "true");
    expect(byDate.get("2025-01-09")).toHaveAttribute("aria-expanded", "false");
    // The tooltip keeps sole ownership of role="status"; the panel must not add one.
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});

describe("Settings planning editors", () => {
  async function openSettings(snapshot: Partial<SnapshotProps> = {}) {
    const user = userEvent.setup();
    renderDashboard([], {
      budgets: ready([]),
      incomeRecords: ready([]),
      savingsTarget: ready(null),
      ...snapshot
    });
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    return user;
  }

  it("adds an income record and keeps derived limits out of the editing surface", async () => {
    saveIncomeRecordMock.mockResolvedValue({
      ok: true,
      data: { id: 5, amount: 2000, frequency: "biweekly", effectiveDate: "2025-01-01", createdAt: "", updatedAt: "" }
    });
    const user = await openSettings();

    await user.type(screen.getByLabelText("Amount"), "2000");
    await user.selectOptions(screen.getByLabelText("Frequency"), "biweekly");
    await user.type(screen.getByLabelText("Effective date"), "2025-01-01");
    await user.click(screen.getByRole("button", { name: "Add income record" }));

    await waitFor(() =>
      expect(saveIncomeRecordMock).toHaveBeenCalledWith({
        id: undefined,
        amount: "2000",
        frequency: "biweekly",
        effectiveDate: "2025-01-01"
      })
    );
    expect(await screen.findByText(/biweekly from 2025-01-01/)).toBeInTheDocument();
    expect(screen.queryByText(/Daily limit/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Spendable this period/)).not.toBeInTheDocument();
  });

  it("edits an existing income record through the same form", async () => {
    saveIncomeRecordMock.mockResolvedValue({
      ok: true,
      data: { id: 5, amount: 2500, frequency: "monthly", effectiveDate: "2025-01-01", createdAt: "", updatedAt: "" }
    });
    const user = await openSettings({
      incomeRecords: ready([
        { id: 5, amount: 2000, frequency: "monthly", effectiveDate: "2025-01-01", createdAt: "", updatedAt: "" }
      ])
    });

    await user.click(screen.getByRole("button", { name: "Edit income record effective 2025-01-01" }));
    const amountField = screen.getByLabelText("Amount");
    await user.clear(amountField);
    await user.type(amountField, "2500");
    await user.click(screen.getByRole("button", { name: "Save income record" }));

    await waitFor(() => expect(saveIncomeRecordMock).toHaveBeenCalledWith({
      id: 5,
      amount: "2500",
      frequency: "monthly",
      effectiveDate: "2025-01-01"
    }));
    expect(await screen.findByText(/\$2,500\.00/)).toBeInTheDocument();
  });

  it("saves the savings target and reports the persisted mode", async () => {
    saveSavingsTargetMock.mockResolvedValue({
      ok: true,
      data: { id: 1, mode: "percentage", value: 20, updatedAt: "" }
    });
    const user = await openSettings();

    await user.type(screen.getByLabelText("Percent of income"), "20");
    await user.click(screen.getByRole("button", { name: "Save savings target" }));

    await waitFor(() => expect(saveSavingsTargetMock).toHaveBeenCalledWith("percentage", "20"));
    expect(await screen.findByText(/20% of normalized monthly income/)).toBeInTheDocument();
  });

  it("explains each unavailable planning capability instead of rendering an editor", async () => {
    const user = userEvent.setup();
    renderDashboard([]);
    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(screen.getByText("Income records are unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Savings target is unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Category budgets" })).not.toBeInTheDocument();
  });
});
