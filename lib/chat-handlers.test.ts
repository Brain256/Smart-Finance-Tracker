import fc from "fast-check";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn()
}));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseExpenseClient: mocks.createClient,
  hasSupabaseDashboardConfig: () => true
}));

import {
  aggregateSpending,
  dispatchToolCall,
  MAX_MERCHANT_GROUPS,
  searchTransactions
} from "./chat-tools";

const TIME_ZONE = "America/Toronto";
const RUNS = { numRuns: 100 };
const MAY = { startDate: "2026-05-01", endDate: "2026-05-31" };

/** May 2026 in America/Toronto is EDT, so local midnight is 04:00Z. */
const MAY_BOUNDS = {
  start: "2026-05-01T04:00:00.000Z",
  end: "2026-06-01T04:00:00.000Z"
};

type QueryResponse = { data: unknown; error: unknown };

/**
 * Chainable stand-in for the PostgREST filter builder. Every filter returns the same
 * object so the recorded calls describe the whole chain, and the object is awaitable
 * because the real builder resolves when awaited rather than on an explicit terminal.
 */
function makeQuery(response: QueryResponse) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    ilike: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: (
      resolve: (value: QueryResponse) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(response).then(resolve, reject)
  };

  for (const method of ["select", "eq", "neq", "gte", "lt", "ilike", "order", "limit"] as const) {
    query[method].mockReturnValue(query);
  }

  return query;
}

function mockClient(response: QueryResponse) {
  const query = makeQuery(response);
  const from = vi.fn(() => query);
  mocks.createClient.mockReturnValue({ from });

  return { query, from };
}

function expenseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    created_at: "2026-05-04T16:30:00.000Z",
    merchant_name: "Tim Hortons",
    amount: "14.50",
    category: "Food",
    timestamp: "2026-05-04T16:30:00.000Z",
    confidence: "0.910",
    reviewed: null,
    classified_at: "2026-05-04T16:30:05.000Z",
    classification_origin: "llm",
    ...overrides
  };
}

beforeEach(() => {
  // resetAllMocks rather than clearAllMocks: one test installs a throwing
  // implementation, which clearAllMocks would leave in place for later tests.
  vi.resetAllMocks();
  vi.stubEnv("FINANCE_TIMEZONE", TIME_ZONE);
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("searchTransactions", () => {
  it("rejects invalid arguments before creating a Supabase client", async () => {
    await expect(
      searchTransactions({ startDate: "last month", endDate: "2026-05-31" })
    ).resolves.toMatchObject({ ok: false });

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("queries the half-open UTC range for the finance-local dates", async () => {
    const { query, from } = mockClient({ data: [expenseRow()], error: null });

    await searchTransactions({ ...MAY });

    expect(from).toHaveBeenCalledWith("expenses");
    expect(query.gte).toHaveBeenCalledWith("timestamp", MAY_BOUNDS.start);
    // Strictly less than midnight the day after, which keeps endDate inclusive without
    // pulling in transactions from 1 June.
    expect(query.lt).toHaveBeenCalledWith("timestamp", MAY_BOUNDS.end);
  });

  it("orders newest first with a deterministic tie-break and fetches one extra row", async () => {
    const { query } = mockClient({ data: [expenseRow()], error: null });

    await searchTransactions({ ...MAY, limit: 5 });

    expect(query.order).toHaveBeenNthCalledWith(1, "timestamp", { ascending: false });
    expect(query.order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(6);
  });

  it("applies no category or merchant filter when both are omitted", async () => {
    const { query } = mockClient({ data: [], error: null });

    await searchTransactions({ ...MAY });

    expect(query.eq).not.toHaveBeenCalled();
    expect(query.ilike).not.toHaveBeenCalled();
  });

  it("filters on category equality when a category is supplied", async () => {
    const { query } = mockClient({ data: [], error: null });

    await searchTransactions({ ...MAY, category: "Food" });

    expect(query.eq).toHaveBeenCalledWith("category", "Food");
  });

  it("includes income when asked, since search lists rows rather than totalling spending", async () => {
    const { query } = mockClient({ data: [], error: null });

    await searchTransactions({ ...MAY, category: "Income" });

    expect(query.eq).toHaveBeenCalledWith("category", "Income");
    expect(query.neq).not.toHaveBeenCalled();
  });

  it("matches merchants as containment against the generated normalized column", async () => {
    const { query } = mockClient({ data: [], error: null });

    await searchTransactions({ ...MAY, merchantQuery: "Tim Hortons" });

    expect(query.ilike).toHaveBeenCalledWith("normalized_merchant", "%Tim Hortons%");
  });

  it("escapes LIKE metacharacters so a fragment cannot become a wildcard", async () => {
    const { query } = mockClient({ data: [], error: null });

    await searchTransactions({ ...MAY, merchantQuery: "50% off_now" });

    expect(query.ilike).toHaveBeenCalledWith("normalized_merchant", "%50\\% off\\_now%");
  });

  it("strips asterisks, which PostgREST would otherwise rewrite into wildcards", async () => {
    const { query } = mockClient({ data: [], error: null });

    await searchTransactions({ ...MAY, merchantQuery: "cafe*" });

    expect(query.ilike).toHaveBeenCalledWith("normalized_merchant", "%cafe%");
  });

  it("projects rows to a compact shape with finance-local dates", async () => {
    mockClient({
      data: [
        expenseRow({ id: 2, merchant_name: "Rail Pass", amount: "3.35", category: "Transport" })
      ],
      error: null
    });

    await expect(searchTransactions({ ...MAY })).resolves.toEqual({
      ok: true,
      data: {
        startDate: "2026-05-01",
        endDate: "2026-05-31",
        returnedCount: 1,
        truncated: false,
        transactions: [
          { merchant: "Rail Pass", amount: 3.35, category: "Transport", date: "2026-05-04" }
        ]
      }
    });
  });

  it("uses the finance timezone when a UTC instant falls on the previous local day", async () => {
    mockClient({
      data: [expenseRow({ timestamp: "2026-05-05T02:00:00.000Z" })],
      error: null
    });

    const result = await searchTransactions({ ...MAY });

    // 02:00Z on 5 May is 22:00 on 4 May in Toronto.
    expect(result.ok === true && result.data.transactions[0].date).toBe("2026-05-04");
  });

  it("reports truncation and trims the extra row when more matches exist", async () => {
    const rows = Array.from({ length: 4 }, (_, index) => expenseRow({ id: index + 1 }));
    mockClient({ data: rows, error: null });

    const result = await searchTransactions({ ...MAY, limit: 3 });

    expect(result).toMatchObject({ ok: true, data: { returnedCount: 3, truncated: true } });
  });

  it("reports no truncation when the result exactly fills the limit", async () => {
    const rows = Array.from({ length: 3 }, (_, index) => expenseRow({ id: index + 1 }));
    mockClient({ data: rows, error: null });

    const result = await searchTransactions({ ...MAY, limit: 3 });

    expect(result).toMatchObject({ ok: true, data: { returnedCount: 3, truncated: false } });
  });

  it("returns an empty result rather than an error when nothing matches", async () => {
    mockClient({ data: [], error: null });

    await expect(searchTransactions({ ...MAY })).resolves.toMatchObject({
      ok: true,
      data: { returnedCount: 0, truncated: false, transactions: [] }
    });
  });

  it("returns a safe message on a query error without leaking provider detail", async () => {
    mockClient({ data: null, error: { code: "42P01", message: 'relation "expenses" does not exist' } });

    const result = await searchTransactions({ ...MAY });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toBe(
      "Unable to read transaction data right now. Please try again."
    );
    expect(result.ok === false && result.message).not.toContain("relation");
  });

  it("returns a safe message when the client throws", async () => {
    mocks.createClient.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
    });

    const result = await searchTransactions({ ...MAY });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).not.toContain("SERVICE_ROLE");
  });
});

describe("aggregateSpending", () => {
  it("rejects invalid arguments before creating a Supabase client", async () => {
    await expect(
      aggregateSpending({ ...MAY, category: "Income" })
    ).resolves.toMatchObject({ ok: false });

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("excludes income at the query level and selects only the columns it totals", async () => {
    const { query } = mockClient({ data: [], error: null });

    await aggregateSpending({ ...MAY });

    expect(query.select).toHaveBeenCalledWith("amount, category, merchant_name");
    expect(query.neq).toHaveBeenCalledWith("category", "Income");
  });

  it("queries the half-open UTC range and applies no row limit", async () => {
    const { query } = mockClient({ data: [], error: null });

    await aggregateSpending({ ...MAY });

    expect(query.gte).toHaveBeenCalledWith("timestamp", MAY_BOUNDS.start);
    expect(query.lt).toHaveBeenCalledWith("timestamp", MAY_BOUNDS.end);
    // A total that covered only some matching rows would be worse than no total.
    expect(query.limit).not.toHaveBeenCalled();
  });

  it("filters by merchant so a merchant total never requires summing listed rows", async () => {
    const { query } = mockClient({ data: [], error: null });

    await aggregateSpending({ ...MAY, merchantQuery: "tim hortons" });

    expect(query.ilike).toHaveBeenCalledWith("normalized_merchant", "%tim hortons%");
  });

  it("combines category and merchant filters", async () => {
    const { query } = mockClient({ data: [], error: null });

    await aggregateSpending({ ...MAY, category: "Food", merchantQuery: "tim hortons" });

    expect(query.eq).toHaveBeenCalledWith("category", "Food");
    expect(query.ilike).toHaveBeenCalledWith("normalized_merchant", "%tim hortons%");
  });

  it("groups totals by category, largest first, matching a hand-summed fixture", async () => {
    mockClient({
      data: [
        { amount: "14.50", category: "Food" },
        { amount: "3.35", category: "Transport" },
        { amount: "22.00", category: "Food" },
        { amount: "60.00", category: "Bills" },
        { amount: "1.65", category: "Transport" }
      ],
      error: null
    });

    await expect(aggregateSpending({ ...MAY })).resolves.toEqual({
      ok: true,
      data: {
        startDate: "2026-05-01",
        endDate: "2026-05-31",
        total: 101.5,
        transactionCount: 5,
        categoryTotals: [
          { category: "Bills", total: 60, transactionCount: 1 },
          { category: "Food", total: 36.5, transactionCount: 2 },
          { category: "Transport", total: 5, transactionCount: 2 }
        ]
      }
    });
  });

  it("drops income defensively even if the query filter were lost", async () => {
    mockClient({
      data: [
        { amount: "14.50", category: "Food" },
        { amount: "2500.00", category: "Income" }
      ],
      error: null
    });

    await expect(aggregateSpending({ ...MAY })).resolves.toMatchObject({
      ok: true,
      data: {
        total: 14.5,
        transactionCount: 1,
        categoryTotals: [{ category: "Food", total: 14.5, transactionCount: 1 }]
      }
    });
  });

  it("ignores unknown categories and non-numeric amounts instead of corrupting the total", async () => {
    mockClient({
      data: [
        { amount: "14.50", category: "Food" },
        { amount: "9.99", category: "Cryptocurrency" },
        { amount: "not a number", category: "Food" }
      ],
      error: null
    });

    await expect(aggregateSpending({ ...MAY })).resolves.toMatchObject({
      ok: true,
      data: { total: 14.5, transactionCount: 1 }
    });
  });

  it("returns zeroed totals rather than null for an empty range", async () => {
    mockClient({ data: [], error: null });

    await expect(aggregateSpending({ ...MAY })).resolves.toEqual({
      ok: true,
      data: {
        startDate: "2026-05-01",
        endDate: "2026-05-31",
        total: 0,
        transactionCount: 0,
        categoryTotals: []
      }
    });
  });

  it("omits merchant fields entirely when the breakdown is not requested", async () => {
    mockClient({
      data: [{ amount: "14.50", category: "Food", merchant_name: "Tim Hortons" }],
      error: null
    });

    const result = await aggregateSpending({ ...MAY });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toHaveProperty("merchantTotals");
      expect(result.data).not.toHaveProperty("otherMerchantCount");
    }
  });

  it("rejects a non-boolean breakdown flag rather than coercing it", async () => {
    await expect(
      aggregateSpending({ ...MAY, includeMerchantBreakdown: "true" })
    ).resolves.toMatchObject({ ok: false });

    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("aggregateSpending merchant breakdown", () => {
  it("ranks merchants by total, largest first, alongside the category totals", async () => {
    mockClient({
      data: [
        { amount: "14.50", category: "Food", merchant_name: "Tim Hortons" },
        { amount: "60.00", category: "Bills", merchant_name: "Hydro One" },
        { amount: "22.00", category: "Food", merchant_name: "Tim Hortons" },
        { amount: "3.35", category: "Transport", merchant_name: "Rail Pass" }
      ],
      error: null
    });

    await expect(
      aggregateSpending({ ...MAY, includeMerchantBreakdown: true })
    ).resolves.toMatchObject({
      ok: true,
      data: {
        total: 99.85,
        transactionCount: 4,
        merchantTotals: [
          { merchant: "Hydro One", total: 60, transactionCount: 1 },
          { merchant: "Tim Hortons", total: 36.5, transactionCount: 2 },
          { merchant: "Rail Pass", total: 3.35, transactionCount: 1 }
        ],
        otherMerchantCount: 0,
        otherMerchantTotal: 0,
        categoryTotals: [
          { category: "Bills", total: 60, transactionCount: 1 },
          { category: "Food", total: 36.5, transactionCount: 2 },
          { category: "Transport", total: 3.35, transactionCount: 1 }
        ]
      }
    });
  });

  it("collapses case and whitespace variants into one merchant group", async () => {
    mockClient({
      data: [
        { amount: "10.00", category: "Food", merchant_name: "Tim Hortons" },
        { amount: "20.00", category: "Food", merchant_name: "TIM HORTONS" },
        { amount: "5.00", category: "Food", merchant_name: "  tim   hortons  " }
      ],
      error: null
    });

    const result = await aggregateSpending({ ...MAY, includeMerchantBreakdown: true });

    expect(result.ok === true && result.data.merchantTotals).toEqual([
      { merchant: "TIM HORTONS", total: 35, transactionCount: 3 }
    ]);
  });

  it("displays the raw variant from the highest-spend transaction, never the lowercase key", async () => {
    mockClient({
      data: [
        { amount: "5.00", category: "Food", merchant_name: "tim hortons" },
        { amount: "40.00", category: "Food", merchant_name: "Tim Hortons" }
      ],
      error: null
    });

    const result = await aggregateSpending({ ...MAY, includeMerchantBreakdown: true });

    expect(result.ok === true && result.data.merchantTotals?.[0].merchant).toBe("Tim Hortons");
  });

  it(`caps the ranking at ${MAX_MERCHANT_GROUPS} and reports the remainder as a tail`, async () => {
    // 14 merchants with descending totals: $14.00 down to $1.00.
    mockClient({
      data: Array.from({ length: 14 }, (_, index) => ({
        amount: `${14 - index}.00`,
        category: "Food",
        merchant_name: `Merchant ${String(index).padStart(2, "0")}`
      })),
      error: null
    });

    const result = await aggregateSpending({ ...MAY, includeMerchantBreakdown: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.merchantTotals).toHaveLength(MAX_MERCHANT_GROUPS);
    expect(result.data.merchantTotals?.[0].total).toBe(14);
    // The four omitted merchants are $4, $3, $2, $1.
    expect(result.data.otherMerchantCount).toBe(4);
    expect(result.data.otherMerchantTotal).toBe(10);
    // The tail plus the ranking must reconcile to the overall total.
    const rankedTotal =
      result.data.merchantTotals?.reduce((sum, entry) => sum + entry.total, 0) ?? 0;
    expect(rankedTotal + (result.data.otherMerchantTotal ?? 0)).toBe(result.data.total);
  });

  it("skips rows with a missing or blank merchant name without losing them from the total", async () => {
    mockClient({
      data: [
        { amount: "10.00", category: "Food", merchant_name: "Tim Hortons" },
        { amount: "7.00", category: "Food", merchant_name: "   " },
        { amount: "3.00", category: "Food", merchant_name: null }
      ],
      error: null
    });

    const result = await aggregateSpending({ ...MAY, includeMerchantBreakdown: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The unnamed rows stay in the overall total; they are only absent from the ranking.
    expect(result.data.total).toBe(20);
    expect(result.data.transactionCount).toBe(3);
    expect(result.data.merchantTotals).toEqual([
      { merchant: "Tim Hortons", total: 10, transactionCount: 1 }
    ]);
  });

  it("returns an empty ranking for a range with no spending", async () => {
    mockClient({ data: [], error: null });

    await expect(
      aggregateSpending({ ...MAY, includeMerchantBreakdown: true })
    ).resolves.toMatchObject({
      ok: true,
      data: { merchantTotals: [], otherMerchantCount: 0, otherMerchantTotal: 0 }
    });
  });

  it("reconciles the ranking against the overall total for any merchant distribution", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            cents: fc.integer({ min: 1, max: 200_000 }),
            merchant: fc.integer({ min: 0, max: 24 })
          }),
          { minLength: 1, maxLength: 80 }
        ),
        async (entries) => {
          mockClient({
            data: entries.map((entry) => ({
              amount: (entry.cents / 100).toFixed(2),
              category: "Food",
              merchant_name: `Merchant ${entry.merchant}`
            })),
            error: null
          });

          const result = await aggregateSpending({ ...MAY, includeMerchantBreakdown: true });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const rankedCents = (result.data.merchantTotals ?? []).reduce(
            (sum, entry) => sum + Math.round(entry.total * 100),
            0
          );
          const tailCents = Math.round((result.data.otherMerchantTotal ?? 0) * 100);
          const rankedCount = (result.data.merchantTotals ?? []).reduce(
            (sum, entry) => sum + entry.transactionCount,
            0
          );

          // Nothing is double-counted and nothing is dropped.
          expect(rankedCents + tailCents).toBe(Math.round(result.data.total * 100));
          expect(rankedCount + (result.data.otherMerchantCount ?? 0) >= 0).toBe(true);
          expect(result.data.merchantTotals?.length).toBeLessThanOrEqual(MAX_MERCHANT_GROUPS);
        }
      ),
      RUNS
    );
  });

  it("accepts a numeric amount as well as the string Postgres numeric returns", async () => {
    mockClient({
      data: [
        { amount: 14.5, category: "Food" },
        { amount: "14.50", category: "Food" }
      ],
      error: null
    });

    await expect(aggregateSpending({ ...MAY })).resolves.toMatchObject({
      ok: true,
      data: { total: 29, transactionCount: 2 }
    });
  });

  it("sums two-decimal amounts exactly, without float drift", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 500_000 }), { minLength: 1, maxLength: 60 }),
        async (centsValues) => {
          mockClient({
            data: centsValues.map((cents) => ({
              amount: (cents / 100).toFixed(2),
              category: "Food"
            })),
            error: null
          });

          const expectedCents = centsValues.reduce((total, cents) => total + cents, 0);
          const result = await aggregateSpending({ ...MAY });

          expect(result.ok).toBe(true);
          if (result.ok) {
            // Compare in cents so the assertion itself cannot introduce drift.
            expect(Math.round(result.data.total * 100)).toBe(expectedCents);
            expect(result.data.transactionCount).toBe(centsValues.length);
          }
        }
      ),
      RUNS
    );
  });

  it("returns a safe message on a query error", async () => {
    mockClient({ data: null, error: { code: "57014", message: "canceling statement due to timeout" } });

    const result = await aggregateSpending({ ...MAY });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toBe(
      "Unable to read transaction data right now. Please try again."
    );
  });

  it("returns a safe message when the finance timezone is misconfigured", async () => {
    vi.stubEnv("FINANCE_TIMEZONE", "Not/AZone");

    const result = await aggregateSpending({ ...MAY });

    expect(result.ok).toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("dispatchToolCall", () => {
  it("routes a known tool and returns the parsed arguments alongside the result", async () => {
    mockClient({ data: [], error: null });

    const dispatch = await dispatchToolCall(
      "aggregate_spending",
      JSON.stringify({ ...MAY, category: "Food" })
    );

    expect(dispatch.requestedName).toBe("aggregate_spending");
    expect(dispatch.arguments).toEqual({ ...MAY, category: "Food" });
    expect(dispatch.result.ok).toBe(true);
  });

  it("routes transaction search", async () => {
    mockClient({ data: [expenseRow()], error: null });

    const dispatch = await dispatchToolCall("search_transactions", JSON.stringify(MAY));

    expect(dispatch.result.ok).toBe(true);
  });

  it("rejects an unknown tool name and lists the available tools", async () => {
    const dispatch = await dispatchToolCall("delete_everything", JSON.stringify(MAY));

    expect(dispatch.result.ok).toBe(false);
    expect(dispatch.result.ok === false && dispatch.result.message).toContain(
      "search_transactions"
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["truncated JSON", '{"startDate":"2026-05-01"'],
    ["prose instead of JSON", "startDate is 2026-05-01"],
    ["a bare string", '"2026-05-01"'],
    ["an array", '["2026-05-01","2026-05-31"]'],
    ["null", "null"]
  ])("fails safely on %s without throwing", async (_label, rawArguments) => {
    const dispatch = await dispatchToolCall("aggregate_spending", rawArguments);

    expect(dispatch.result.ok).toBe(false);
    expect(dispatch.arguments).toEqual({});
  });

  it("treats empty arguments as an empty object, which then fails validation", async () => {
    const dispatch = await dispatchToolCall("aggregate_spending", "");

    expect(dispatch.result.ok).toBe(false);
    expect(dispatch.result.ok === false && dispatch.result.message).toContain("YYYY-MM-DD");
  });

  it("never throws for any tool name and argument string the model might emit", async () => {
    mockClient({ data: [], error: null });

    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (name, rawArguments) => {
        await expect(dispatchToolCall(name, rawArguments)).resolves.toMatchObject({
          requestedName: name
        });
      }),
      RUNS
    );
  });

  it("does not treat inherited object properties as tools", async () => {
    const dispatch = await dispatchToolCall("toString", "{}");

    expect(dispatch.result.ok).toBe(false);
  });
});
