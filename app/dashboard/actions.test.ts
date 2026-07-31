import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseExpenseClient: mocks.createClient
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  deleteCategoryBudget,
  deleteIncomeRecord,
  deleteSavingsTarget,
  saveCategoryBudget,
  saveIncomeRecord,
  saveSavingsTarget
} from "./actions";

function authorizedSession() {
  mocks.auth.mockResolvedValue({ user: { email: "owner@example.com" } });
  process.env.AUTH_ALLOWED_EMAIL = "owner@example.com";
}

function makeMutation(data: unknown) {
  const query = {
    upsert: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn()
  };
  query.upsert.mockReturnValue(query);
  query.insert.mockReturnValue(query);
  query.update.mockReturnValue(query);
  query.delete.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.lte.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.single.mockResolvedValue({ data, error: null });
  query.maybeSingle.mockResolvedValue({ data, error: null });
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  authorizedSession();
});

describe("planning dashboard actions", () => {
  it("rejects invalid planning primitives before creating a Supabase client", async () => {
    await expect(saveCategoryBudget("Income", "25.00")).resolves.toMatchObject({ ok: false });
    await expect(
      saveIncomeRecord({ amount: "0", frequency: "monthly", effectiveDate: "2024-01-01" })
    ).resolves.toMatchObject({ ok: false });
    await expect(saveSavingsTarget("percentage", "100.01")).resolves.toMatchObject({ ok: false });

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("upserts a validated category budget and invalidates the dashboard", async () => {
    const budget = makeMutation({
      category: "Food",
      monthly_limit: "250.00",
      updated_at: "2024-01-01T00:00:00.000Z"
    });
    mocks.createClient.mockReturnValue({ from: vi.fn(() => budget) });

    await expect(saveCategoryBudget("Food", "250.00")).resolves.toEqual({
      ok: true,
      data: {
        category: "Food",
        monthlyLimit: 250,
        updatedAt: "2024-01-01T00:00:00.000Z"
      }
    });

    expect(budget.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Food", monthly_limit: 250 }),
      { onConflict: "category" }
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("adds an income record and revalidates after the successful write", async () => {
    const income = makeMutation({
      id: 8,
      amount: "1200.00",
      frequency: "biweekly",
      effective_date: "2024-01-01",
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z"
    });
    mocks.createClient.mockReturnValue({ from: vi.fn(() => income) });

    await expect(
      saveIncomeRecord({ amount: "1200.00", frequency: "biweekly", effectiveDate: "2024-01-01" })
    ).resolves.toMatchObject({ ok: true, data: { id: 8, amount: 1200 } });

    expect(income.insert).toHaveBeenCalledWith(expect.objectContaining({
      amount: 1200,
      frequency: "biweekly",
      effective_date: "2024-01-01"
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects unaffordable fixed savings targets without writing one", async () => {
    const activeIncome = makeMutation({ amount: "100.00", frequency: "monthly" });
    const target = makeMutation({
      id: 1,
      mode: "fixed",
      value: "100.00",
      updated_at: "2024-01-01T00:00:00.000Z"
    });
    const from = vi.fn((table: string) =>
      table === "income_records" ? activeIncome : target
    );
    mocks.createClient.mockReturnValue({ from });

    await expect(saveSavingsTarget("fixed", "100.01")).resolves.toEqual({
      ok: false,
      message: "The fixed savings target cannot exceed active normalized monthly income."
    });

    expect(target.upsert).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("removes planning values through their scoped tables and revalidates", async () => {
    const budget = makeMutation(null);
    const income = makeMutation(null);
    const savings = makeMutation(null);
    const from = vi.fn((table: string) => {
      if (table === "category_budgets") return budget;
      if (table === "income_records") return income;
      return savings;
    });
    mocks.createClient.mockReturnValue({ from });

    await expect(deleteCategoryBudget("Food")).resolves.toEqual({
      ok: true,
      data: { deletedCategory: "Food" }
    });
    await expect(deleteIncomeRecord(4)).resolves.toEqual({
      ok: true,
      data: { deletedIncomeRecordId: 4 }
    });
    await expect(deleteSavingsTarget()).resolves.toEqual({
      ok: true,
      data: { deletedSavingsTargetId: 1 }
    });

    expect(budget.eq).toHaveBeenCalledWith("category", "Food");
    expect(income.eq).toHaveBeenCalledWith("id", 4);
    expect(savings.eq).toHaveBeenCalledWith("id", 1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(3);
  });
});
