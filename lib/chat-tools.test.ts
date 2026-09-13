import fc from "fast-check";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_RESULT_LIMIT,
  MAX_MERCHANT_QUERY_LENGTH,
  MAX_RANGE_DAYS,
  MAX_RESULT_LIMIT,
  spendingCategories,
  TOOL_SCHEMAS,
  validateAggregateSpendingArgs,
  validateComparePeriodsArgs,
  validateMerchantQuery,
  validateOptionalExpenseCategory,
  validateOptionalFlag,
  validateOptionalSpendingCategory,
  validateResultLimit,
  validateSearchTransactionsArgs,
  validateToolDateRange
} from "./chat-tools";
import { addCalendarDays } from "./finance-dates";
import { chatToolNames, expenseCategories } from "./types";

const RUNS = { numRuns: 100 };

/** A valid baseline range reused wherever the range itself is not under test. */
const VALID_RANGE = { startDate: "2026-05-01", endDate: "2026-05-31" };

describe("validateToolDateRange", () => {
  it("accepts a valid inclusive range", () => {
    expect(validateToolDateRange("2026-05-01", "2026-05-31")).toEqual({
      ok: true,
      data: { startDate: "2026-05-01", endDate: "2026-05-31" }
    });
  });

  it("accepts a single-day range", () => {
    expect(validateToolDateRange("2026-06-17", "2026-06-17")).toEqual({
      ok: true,
      data: { startDate: "2026-06-17", endDate: "2026-06-17" }
    });
  });

  it.each([
    ["relative phrase", "last month", "2026-05-31"],
    ["relative phrase in end bound", "2026-05-01", "yesterday"],
    ["unpadded month", "2026-5-01", "2026-05-31"],
    ["slash separators", "2026/05/01", "2026/05/31"],
    ["full timestamp", "2026-05-01T00:00:00Z", "2026-05-31"],
    ["empty string", "", "2026-05-31"],
    ["non-calendar date", "2026-02-30", "2026-03-31"]
  ])("rejects %s", (_label, startDate, endDate) => {
    const result = validateToolDateRange(startDate, endDate);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/YYYY-MM-DD|start date/);
  });

  it.each([
    ["both bounds missing", undefined, undefined],
    ["start bound missing", undefined, "2026-05-31"],
    ["end bound missing", "2026-05-01", undefined],
    ["null bound", null, "2026-05-31"],
    ["numeric bound", 20260501, "2026-05-31"]
  ])("rejects %s rather than guessing the range", (_label, startDate, endDate) => {
    expect(validateToolDateRange(startDate, endDate).ok).toBe(false);
  });

  it("rejects an inverted range", () => {
    const result = validateToolDateRange("2026-05-31", "2026-05-01");

    expect(result).toEqual({
      ok: false,
      message: "The start date must be on or before the end date."
    });
  });

  it(`accepts a span of exactly ${MAX_RANGE_DAYS} days`, () => {
    const endDate = addCalendarDays("2026-01-01", MAX_RANGE_DAYS - 1);

    expect(validateToolDateRange("2026-01-01", endDate).ok).toBe(true);
  });

  it(`rejects a span wider than ${MAX_RANGE_DAYS} days`, () => {
    const endDate = addCalendarDays("2026-01-01", MAX_RANGE_DAYS);
    const result = validateToolDateRange("2026-01-01", endDate);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain(String(MAX_RANGE_DAYS));
  });

  it("accepts any in-range span and rejects any over-wide span", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 800 }), (span) => {
        const endDate = addCalendarDays("2026-01-01", span);

        expect(validateToolDateRange("2026-01-01", endDate).ok).toBe(span < MAX_RANGE_DAYS);
      }),
      RUNS
    );
  });
});

describe("validateOptionalExpenseCategory", () => {
  it.each([undefined, null])("treats %s as an omitted filter", (value) => {
    expect(validateOptionalExpenseCategory(value)).toEqual({ ok: true, data: null });
  });

  it.each(expenseCategories)("accepts %s", (category) => {
    expect(validateOptionalExpenseCategory(category)).toEqual({ ok: true, data: category });
  });

  it("accepts Income, because listing income transactions is a valid search", () => {
    expect(validateOptionalExpenseCategory("Income")).toEqual({ ok: true, data: "Income" });
  });

  it.each(["food", "FOOD", "Groceries", "", "Food ", 42, true, {}, []])(
    "rejects unsupported category %s",
    (value) => {
      expect(validateOptionalExpenseCategory(value).ok).toBe(false);
    }
  );
});

describe("validateOptionalSpendingCategory", () => {
  it.each([undefined, null])("treats %s as an omitted filter", (value) => {
    expect(validateOptionalSpendingCategory(value)).toEqual({ ok: true, data: null });
  });

  it.each(spendingCategories)("accepts spending category %s", (category) => {
    expect(validateOptionalSpendingCategory(category)).toEqual({ ok: true, data: category });
  });

  it("rejects Income with a message that redirects to the search tool", () => {
    const result = validateOptionalSpendingCategory("Income");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("Income is not a spending category");
  });

  it.each(["income", "Savings", "", 0, false])("rejects %s", (value) => {
    expect(validateOptionalSpendingCategory(value).ok).toBe(false);
  });
});

describe("validateMerchantQuery", () => {
  it.each([undefined, null])("treats %s as an omitted filter", (value) => {
    expect(validateMerchantQuery(value)).toEqual({ ok: true, data: null });
  });

  it("trims surrounding whitespace", () => {
    expect(validateMerchantQuery("  Tim Hortons  ")).toEqual({
      ok: true,
      data: "Tim Hortons"
    });
  });

  it.each(["", "   ", "\t\n"])(
    "treats blank value %j as an omitted filter rather than a match-everything pattern",
    (value) => {
      expect(validateMerchantQuery(value)).toEqual({ ok: true, data: null });
    }
  );

  it(`accepts exactly ${MAX_MERCHANT_QUERY_LENGTH} characters`, () => {
    const query = "a".repeat(MAX_MERCHANT_QUERY_LENGTH);

    expect(validateMerchantQuery(query)).toEqual({ ok: true, data: query });
  });

  it("rejects an over-long fragment", () => {
    const result = validateMerchantQuery("a".repeat(MAX_MERCHANT_QUERY_LENGTH + 1));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain(String(MAX_MERCHANT_QUERY_LENGTH));
  });

  it.each([42, true, {}, ["Tim Hortons"]])("rejects non-text value %j", (value) => {
    expect(validateMerchantQuery(value).ok).toBe(false);
  });
});

describe("validateResultLimit", () => {
  it.each([undefined, null])("falls back to the default for %s", (value) => {
    expect(validateResultLimit(value)).toEqual({ ok: true, data: DEFAULT_RESULT_LIMIT });
  });

  it.each([1, 20, MAX_RESULT_LIMIT])("accepts in-range limit %i", (value) => {
    expect(validateResultLimit(value)).toEqual({ ok: true, data: value });
  });

  it("clamps an over-large limit instead of failing the call", () => {
    expect(validateResultLimit(500)).toEqual({ ok: true, data: MAX_RESULT_LIMIT });
  });

  it.each([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, "20", true, {}])(
    "rejects %j",
    (value) => {
      expect(validateResultLimit(value).ok).toBe(false);
    }
  );

  it("never returns a limit outside 1 through the ceiling", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), (value) => {
        const result = validateResultLimit(value);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data).toBeGreaterThanOrEqual(1);
          expect(result.data).toBeLessThanOrEqual(MAX_RESULT_LIMIT);
        }
      }),
      RUNS
    );
  });
});

describe("validateSearchTransactionsArgs", () => {
  it("fills defaults for every omitted optional argument", () => {
    expect(validateSearchTransactionsArgs({ ...VALID_RANGE })).toEqual({
      ok: true,
      data: {
        startDate: "2026-05-01",
        endDate: "2026-05-31",
        category: null,
        merchantQuery: null,
        limit: DEFAULT_RESULT_LIMIT
      }
    });
  });

  it("accepts a fully specified argument set", () => {
    expect(
      validateSearchTransactionsArgs({
        ...VALID_RANGE,
        category: "Food",
        merchantQuery: " tim hortons ",
        limit: 5
      })
    ).toEqual({
      ok: true,
      data: {
        startDate: "2026-05-01",
        endDate: "2026-05-31",
        category: "Food",
        merchantQuery: "tim hortons",
        limit: 5
      }
    });
  });

  it("rejects when the date range is malformed", () => {
    expect(
      validateSearchTransactionsArgs({ startDate: "last month", endDate: "2026-05-31" }).ok
    ).toBe(false);
  });

  it("rejects when an optional argument is malformed", () => {
    expect(
      validateSearchTransactionsArgs({ ...VALID_RANGE, category: "Groceries" }).ok
    ).toBe(false);
    expect(validateSearchTransactionsArgs({ ...VALID_RANGE, limit: -3 }).ok).toBe(false);
  });

  it("ignores unrecognized properties the model may invent", () => {
    const result = validateSearchTransactionsArgs({
      ...VALID_RANGE,
      sortBy: "amount",
      includeRefunds: true
    });

    expect(result.ok).toBe(true);
  });
});

describe("validateAggregateSpendingArgs", () => {
  it("accepts a range with no filters", () => {
    expect(validateAggregateSpendingArgs({ ...VALID_RANGE })).toEqual({
      ok: true,
      data: {
        startDate: "2026-05-01",
        endDate: "2026-05-31",
        category: null,
        merchantQuery: null,
        includeMerchantBreakdown: false
      }
    });
  });

  it("accepts a spending category filter", () => {
    expect(validateAggregateSpendingArgs({ ...VALID_RANGE, category: "Food" })).toEqual({
      ok: true,
      data: {
        startDate: "2026-05-01",
        endDate: "2026-05-31",
        category: "Food",
        merchantQuery: null,
        includeMerchantBreakdown: false
      }
    });
  });

  it("accepts a merchant filter, so a merchant total never requires summing rows", () => {
    expect(
      validateAggregateSpendingArgs({ ...VALID_RANGE, merchantQuery: " Tim Hortons " })
    ).toEqual({
      ok: true,
      data: {
        startDate: "2026-05-01",
        endDate: "2026-05-31",
        category: null,
        merchantQuery: "Tim Hortons",
        includeMerchantBreakdown: false
      }
    });
  });

  it("accepts a combined merchant and category filter", () => {
    expect(
      validateAggregateSpendingArgs({
        ...VALID_RANGE,
        category: "Food",
        merchantQuery: "tim hortons"
      })
    ).toEqual({
      ok: true,
      data: {
        startDate: "2026-05-01",
        endDate: "2026-05-31",
        category: "Food",
        merchantQuery: "tim hortons",
        includeMerchantBreakdown: false
      }
    });
  });

  it("accepts the merchant breakdown flag", () => {
    expect(
      validateAggregateSpendingArgs({ ...VALID_RANGE, includeMerchantBreakdown: true })
    ).toMatchObject({ ok: true, data: { includeMerchantBreakdown: true } });
  });

  it("rejects an Income filter on a spending aggregate", () => {
    expect(validateAggregateSpendingArgs({ ...VALID_RANGE, category: "Income" }).ok).toBe(
      false
    );
  });

  it("rejects a malformed merchant filter", () => {
    expect(validateAggregateSpendingArgs({ ...VALID_RANGE, merchantQuery: 42 }).ok).toBe(
      false
    );
  });

  it.each(["true", "false", 1, 0, null])(
    "rejects non-boolean breakdown flag %j rather than coercing it",
    (value) => {
      if (value === null) {
        // Absent is the one non-boolean that is meaningful, and it means false.
        expect(
          validateAggregateSpendingArgs({ ...VALID_RANGE, includeMerchantBreakdown: value })
        ).toMatchObject({ ok: true, data: { includeMerchantBreakdown: false } });
        return;
      }

      expect(
        validateAggregateSpendingArgs({ ...VALID_RANGE, includeMerchantBreakdown: value }).ok
      ).toBe(false);
    }
  );
});

describe("validateOptionalFlag", () => {
  it.each([undefined, null])("treats %s as false", (value) => {
    expect(validateOptionalFlag(value, "includeMerchantBreakdown")).toEqual({
      ok: true,
      data: false
    });
  });

  it.each([true, false])("accepts boolean %s", (value) => {
    expect(validateOptionalFlag(value, "includeMerchantBreakdown")).toEqual({
      ok: true,
      data: value
    });
  });

  it("names the field in the message so the model can correct the right argument", () => {
    const result = validateOptionalFlag("yes", "includeMerchantBreakdown");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("includeMerchantBreakdown");
  });
});

/**
 * Retained but not routed. The two-period comparison tool was dropped in favour of two
 * parallel aggregate_spending calls; these tests keep the validator honest so the tool
 * can be reinstated cheaply if the model's own delta arithmetic proves unreliable.
 */
describe("validateComparePeriodsArgs", () => {
  const VALID_COMPARISON = {
    currentStartDate: "2026-05-01",
    currentEndDate: "2026-05-31",
    baselineStartDate: "2026-04-01",
    baselineEndDate: "2026-04-30"
  };

  it("accepts two independent ranges", () => {
    expect(validateComparePeriodsArgs({ ...VALID_COMPARISON })).toEqual({
      ok: true,
      data: {
        current: { startDate: "2026-05-01", endDate: "2026-05-31" },
        baseline: { startDate: "2026-04-01", endDate: "2026-04-30" },
        category: null
      }
    });
  });

  it("permits overlapping ranges, since each is counted independently", () => {
    expect(
      validateComparePeriodsArgs({
        currentStartDate: "2026-05-01",
        currentEndDate: "2026-05-31",
        baselineStartDate: "2026-05-15",
        baselineEndDate: "2026-06-14"
      }).ok
    ).toBe(true);
  });

  it("rejects when either range is malformed", () => {
    expect(
      validateComparePeriodsArgs({ ...VALID_COMPARISON, currentEndDate: "not a date" }).ok
    ).toBe(false);
    expect(
      validateComparePeriodsArgs({ ...VALID_COMPARISON, baselineStartDate: undefined }).ok
    ).toBe(false);
  });

  it("rejects an inverted baseline range", () => {
    expect(
      validateComparePeriodsArgs({
        ...VALID_COMPARISON,
        baselineStartDate: "2026-04-30",
        baselineEndDate: "2026-04-01"
      }).ok
    ).toBe(false);
  });

  it("rejects an Income filter", () => {
    expect(
      validateComparePeriodsArgs({ ...VALID_COMPARISON, category: "Income" }).ok
    ).toBe(false);
  });
});

describe("TOOL_SCHEMAS", () => {
  it("declares exactly the known tool names, with no duplicates", () => {
    const names = TOOL_SCHEMAS.map((schema) => schema.function.name);

    expect(names).toEqual([...chatToolNames]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("marks every required property as declared, and rejects unknown properties", () => {
    for (const schema of TOOL_SCHEMAS) {
      const { properties, required, additionalProperties } = schema.function.parameters;

      expect(additionalProperties).toBe(false);
      for (const name of required) {
        expect(properties).toHaveProperty(name);
      }
    }
  });

  it("states the schema conventions the model needs in every description", () => {
    for (const schema of TOOL_SCHEMAS) {
      expect(schema.function.description.length).toBeGreaterThan(80);
    }

    const searchSchema = TOOL_SCHEMAS.find(
      (schema) => schema.function.name === "search_transactions"
    );
    const aggregateSchema = TOOL_SCHEMAS.find(
      (schema) => schema.function.name === "aggregate_spending"
    );

    // Search may list income; the spending aggregate must say income is excluded.
    // Null is appended to every optional enum so the provider accepts an omitted filter.
    expect(searchSchema?.function.parameters.properties.category.enum).toEqual([
      ...expenseCategories,
      null
    ]);
    expect(aggregateSchema?.function.parameters.properties.category.enum).toEqual([
      ...spendingCategories,
      null
    ]);
    expect(aggregateSchema?.function.description).toContain("Income is always excluded");

    // Without this instruction the model would answer merchant-scoped totals by listing
    // rows and adding them up, which silently undercounts once the row limit truncates.
    expect(aggregateSchema?.function.description).toContain("Never add up transaction amounts");
  });

  it("offers the same filter surface on both tools, differing only in what is returned", () => {
    for (const schema of TOOL_SCHEMAS) {
      const { properties } = schema.function.parameters;

      expect(properties).toHaveProperty("startDate");
      expect(properties).toHaveProperty("endDate");
      expect(properties).toHaveProperty("category");
      expect(properties).toHaveProperty("merchantQuery");
    }
  });

  it("declares every optional property nullable, since the provider rejects null against a non-nullable type", () => {
    for (const schema of TOOL_SCHEMAS) {
      const { properties, required } = schema.function.parameters;

      for (const [name, property] of Object.entries(properties)) {
        if (required.includes(name)) continue;

        // Models represent an omitted optional as an explicit null, and Groq validates
        // tool calls against this schema server-side before the handler ever runs.
        expect(property.type, `${schema.function.name}.${name} type`).toContain("null");

        if (property.enum) {
          expect(property.enum, `${schema.function.name}.${name} enum`).toContain(null);
        }
      }
    }
  });

  it("keeps required properties non-nullable", () => {
    for (const schema of TOOL_SCHEMAS) {
      const { properties, required } = schema.function.parameters;

      for (const name of required) {
        expect(properties[name].type).toBe("string");
      }
    }
  });

  it("declares the merchant breakdown flag as a boolean on the aggregate tool only", () => {
    const aggregateSchema = TOOL_SCHEMAS.find(
      (schema) => schema.function.name === "aggregate_spending"
    );
    const searchSchema = TOOL_SCHEMAS.find(
      (schema) => schema.function.name === "search_transactions"
    );

    expect(aggregateSchema?.function.parameters.properties.includeMerchantBreakdown.type).toEqual(
      ["boolean", "null"]
    );
    expect(searchSchema?.function.parameters.properties).not.toHaveProperty(
      "includeMerchantBreakdown"
    );
  });

  it("tells the model to resolve relative dates itself on every date property", () => {
    for (const schema of TOOL_SCHEMAS) {
      const dateProperties = Object.entries(schema.function.parameters.properties).filter(
        ([name]) => name.toLowerCase().includes("date")
      );

      expect(dateProperties.length).toBeGreaterThan(0);
      for (const [, property] of dateProperties) {
        expect(property.description).toContain("YYYY-MM-DD");
      }
    }
  });
});
