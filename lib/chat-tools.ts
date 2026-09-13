/**
 * Chat assistant tool layer.
 *
 * The model chooses a tool name and fills in arguments; it never composes SQL and never
 * receives database credentials. Because `createSupabaseExpenseClient` uses the service
 * role key and bypasses row-level security, this module is the only thing standing
 * between model output and a fully privileged database connection. Every argument that
 * arrives here is untrusted input and is validated before any query is built.
 *
 * Validators mirror the conventions in lib/dashboard-mutations.ts: hand-rolled checks
 * returning `MutationResult<T>` with fixed, user-safe messages.
 */

import { normalizeExpenseRow } from "@/lib/dashboard-data";
import { amountToCents, centsToAmount, normalizeMerchantKey } from "@/lib/finance-analytics";
import { getFinanceConfig } from "@/lib/finance-config";
import {
  addCalendarDays,
  getFinanceDateKey,
  getUtcRangeBounds,
  parseDateKey
} from "@/lib/finance-dates";
import { createSupabaseExpenseClient } from "@/lib/supabase-server";
import {
  expenseCategories,
  type AggregateSpendingResult,
  type CategorySpendingTotal,
  type ChatToolName,
  type ChatToolResultData,
  type ChatTransactionMatch,
  type ExpenseCategory,
  type ExpenseTableRow,
  type MerchantSpendingTotal,
  type MutationResult,
  type SearchTransactionsResult,
  type SpendingCategory
} from "@/lib/types";

/**
 * Widest range a single tool call may span. One leap year of days keeps "the last year"
 * answerable in one call while bounding the row count any single query can return.
 */
export const MAX_RANGE_DAYS = 366;

/** Merchant fragments longer than this are model noise rather than a real merchant name. */
export const MAX_MERCHANT_QUERY_LENGTH = 100;

export const DEFAULT_RESULT_LIMIT = 20;

/** Hard ceiling on returned rows, since every row is re-sent to the model as tokens. */
export const MAX_RESULT_LIMIT = 50;

/**
 * Merchants returned in a breakdown. Unlike categories, which top out at six, merchant
 * cardinality is unbounded — a year of transactions can span hundreds — so the ranking is
 * capped and the remainder is reported as an aggregate tail.
 */
export const MAX_MERCHANT_GROUPS = 10;

/** Spending categories, in schema order. Income is deliberately absent. */
export const spendingCategories = expenseCategories.filter(
  (category): category is SpendingCategory => category !== "Income"
);

export type ToolDateRange = {
  startDate: string;
  endDate: string;
};

export type SearchTransactionsArgs = ToolDateRange & {
  /** Any category including Income, since search is a listing rather than a spending total. */
  category: ExpenseCategory | null;
  merchantQuery: string | null;
  limit: number;
};

export type AggregateSpendingArgs = ToolDateRange & {
  category: SpendingCategory | null;
  /**
   * Merchant filter, mirroring search. Without this, a merchant-scoped total such as
   * "how much did I spend at Tim Hortons" would force the model to list rows and add
   * them up itself, which is both error-prone and silently wrong once the row limit
   * truncates the list.
   */
  merchantQuery: string | null;
  /** Adds a per-merchant ranking, for questions about which merchant cost the most. */
  includeMerchantBreakdown: boolean;
};

export type ComparePeriodsArgs = {
  current: ToolDateRange;
  baseline: ToolDateRange;
  category: SpendingCategory | null;
};

function invalid<T>(message: string): MutationResult<T> {
  return { ok: false, message };
}

const DATE_FORMAT_MESSAGE =
  "Provide both dates as absolute calendar dates in YYYY-MM-DD format.";

/**
 * Validates an inclusive finance-local date range supplied by the model.
 *
 * Both bounds are required. A half-specified range is rejected rather than silently
 * widened, because guessing the missing bound would produce a confidently wrong total.
 *
 * @param startDate - Candidate inclusive start date.
 * @param endDate - Candidate inclusive end date.
 * @returns The validated range, or a user-safe message.
 */
export function validateToolDateRange(
  startDate: unknown,
  endDate: unknown
): MutationResult<ToolDateRange> {
  if (typeof startDate !== "string" || typeof endDate !== "string") {
    return invalid(DATE_FORMAT_MESSAGE);
  }

  try {
    parseDateKey(startDate);
    parseDateKey(endDate);
  } catch {
    return invalid(DATE_FORMAT_MESSAGE);
  }

  if (startDate > endDate) {
    return invalid("The start date must be on or before the end date.");
  }

  // Compare against the day after the cap so a range of exactly MAX_RANGE_DAYS passes.
  if (endDate >= addCalendarDays(startDate, MAX_RANGE_DAYS)) {
    return invalid(
      `Limit the date range to ${MAX_RANGE_DAYS} days or fewer, then ask about additional periods separately.`
    );
  }

  return { ok: true, data: { startDate, endDate } };
}

/**
 * Validates an optional category filter that may name any category, including Income.
 *
 * Used by transaction search, where listing income deposits is a legitimate request.
 *
 * @param value - Candidate category, or null/undefined when the model omitted it.
 * @returns The validated category, null when absent, or a user-safe message.
 */
export function validateOptionalExpenseCategory(
  value: unknown
): MutationResult<ExpenseCategory | null> {
  if (value === null || typeof value === "undefined") {
    return { ok: true, data: null };
  }

  if (typeof value !== "string" || !expenseCategories.includes(value as ExpenseCategory)) {
    return invalid(
      `Choose one of these categories, or omit the filter: ${expenseCategories.join(", ")}.`
    );
  }

  return { ok: true, data: value as ExpenseCategory };
}

/**
 * Validates an optional category filter that must name a spending category.
 *
 * Income is rejected rather than silently ignored. Income is not spending, so an income
 * total from a spending tool would be a category error, not a filter.
 *
 * @param value - Candidate category, or null/undefined when the model omitted it.
 * @returns The validated spending category, null when absent, or a user-safe message.
 */
export function validateOptionalSpendingCategory(
  value: unknown
): MutationResult<SpendingCategory | null> {
  if (value === null || typeof value === "undefined") {
    return { ok: true, data: null };
  }

  if (value === "Income") {
    return invalid(
      "Income is not a spending category. Use the transaction search tool to look at income instead."
    );
  }

  if (typeof value !== "string" || !spendingCategories.includes(value as SpendingCategory)) {
    return invalid(
      `Choose one of these spending categories, or omit the filter: ${spendingCategories.join(", ")}.`
    );
  }

  return { ok: true, data: value as SpendingCategory };
}

/**
 * Validates an optional merchant name fragment.
 *
 * A blank or whitespace-only value is treated as an omitted filter rather than an error,
 * since an empty `ilike` pattern would match every row and quietly change the question.
 *
 * @param value - Candidate merchant fragment, or null/undefined when omitted.
 * @returns The trimmed fragment, null when absent, or a user-safe message.
 */
export function validateMerchantQuery(value: unknown): MutationResult<string | null> {
  if (value === null || typeof value === "undefined") {
    return { ok: true, data: null };
  }

  if (typeof value !== "string") {
    return invalid("Provide the merchant filter as text.");
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, data: null };
  }

  if (trimmed.length > MAX_MERCHANT_QUERY_LENGTH) {
    return invalid(
      `Shorten the merchant filter to ${MAX_MERCHANT_QUERY_LENGTH} characters or fewer.`
    );
  }

  return { ok: true, data: trimmed };
}

/**
 * Validates the row limit for transaction search.
 *
 * An omitted limit falls back to the default. An integer above the ceiling is clamped
 * rather than rejected, since asking for more rows than the budget allows is a
 * reasonable request that simply cannot be fully honoured. Non-integers and values
 * below one are rejected outright, because there is no sensible interpretation.
 *
 * @param value - Candidate row limit, or null/undefined when omitted.
 * @returns A limit between 1 and MAX_RESULT_LIMIT, or a user-safe message.
 */
export function validateResultLimit(value: unknown): MutationResult<number> {
  if (value === null || typeof value === "undefined") {
    return { ok: true, data: DEFAULT_RESULT_LIMIT };
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return invalid(
      `Provide the result limit as a whole number from 1 through ${MAX_RESULT_LIMIT}.`
    );
  }

  return { ok: true, data: Math.min(value, MAX_RESULT_LIMIT) };
}

/**
 * Validates an optional boolean flag.
 *
 * Only real booleans are accepted. Strings such as "true" are rejected rather than
 * coerced, because a model that sends the wrong type is better corrected than guessed at.
 *
 * @param value - Candidate flag, or null/undefined when the model omitted it.
 * @param fieldName - Property name, used in the message when the type is wrong.
 * @returns The flag, false when absent, or a user-safe message.
 */
export function validateOptionalFlag(
  value: unknown,
  fieldName: string
): MutationResult<boolean> {
  if (value === null || typeof value === "undefined") {
    return { ok: true, data: false };
  }

  if (typeof value !== "boolean") {
    return invalid(`Provide ${fieldName} as true or false.`);
  }

  return { ok: true, data: value };
}

/**
 * Validates the complete argument set for transaction search.
 *
 * @param rawArguments - Parsed but unvalidated tool arguments from the model.
 * @returns Validated arguments, or the first user-safe validation message.
 */
export function validateSearchTransactionsArgs(
  rawArguments: Record<string, unknown>
): MutationResult<SearchTransactionsArgs> {
  const range = validateToolDateRange(rawArguments.startDate, rawArguments.endDate);
  if (!range.ok) return range;

  const category = validateOptionalExpenseCategory(rawArguments.category);
  if (!category.ok) return category;

  const merchantQuery = validateMerchantQuery(rawArguments.merchantQuery);
  if (!merchantQuery.ok) return merchantQuery;

  const limit = validateResultLimit(rawArguments.limit);
  if (!limit.ok) return limit;

  return {
    ok: true,
    data: {
      startDate: range.data.startDate,
      endDate: range.data.endDate,
      category: category.data,
      merchantQuery: merchantQuery.data,
      limit: limit.data
    }
  };
}

/**
 * Validates the complete argument set for spending aggregation.
 *
 * @param rawArguments - Parsed but unvalidated tool arguments from the model.
 * @returns Validated arguments, or the first user-safe validation message.
 */
export function validateAggregateSpendingArgs(
  rawArguments: Record<string, unknown>
): MutationResult<AggregateSpendingArgs> {
  const range = validateToolDateRange(rawArguments.startDate, rawArguments.endDate);
  if (!range.ok) return range;

  const category = validateOptionalSpendingCategory(rawArguments.category);
  if (!category.ok) return category;

  const merchantQuery = validateMerchantQuery(rawArguments.merchantQuery);
  if (!merchantQuery.ok) return merchantQuery;

  const includeMerchantBreakdown = validateOptionalFlag(
    rawArguments.includeMerchantBreakdown,
    "includeMerchantBreakdown"
  );
  if (!includeMerchantBreakdown.ok) return includeMerchantBreakdown;

  return {
    ok: true,
    data: {
      startDate: range.data.startDate,
      endDate: range.data.endDate,
      category: category.data,
      merchantQuery: merchantQuery.data,
      includeMerchantBreakdown: includeMerchantBreakdown.data
    }
  };
}

/**
 * Validates the complete argument set for a two-period comparison.
 *
 * The ranges are validated independently and may overlap; each is counted on its own.
 *
 * @param rawArguments - Parsed but unvalidated tool arguments from the model.
 * @returns Validated arguments, or the first user-safe validation message.
 */
export function validateComparePeriodsArgs(
  rawArguments: Record<string, unknown>
): MutationResult<ComparePeriodsArgs> {
  const current = validateToolDateRange(
    rawArguments.currentStartDate,
    rawArguments.currentEndDate
  );
  if (!current.ok) return current;

  const baseline = validateToolDateRange(
    rawArguments.baselineStartDate,
    rawArguments.baselineEndDate
  );
  if (!baseline.ok) return baseline;

  const category = validateOptionalSpendingCategory(rawArguments.category);
  if (!category.ok) return category;

  return {
    ok: true,
    data: { current: current.data, baseline: baseline.data, category: category.data }
  };
}

/* ------------------------------------------------------------------ *
 * Tool schemas
 *
 * These descriptions are the model-facing interface. Their wording determines whether
 * the model picks the right tool and fills arguments correctly, so they state the
 * schema's conventions explicitly: amounts are positive dollars, income is a category
 * rather than a sign, and dates are absolute finance-local calendar dates.
 * ------------------------------------------------------------------ */

type JsonSchemaProperty = {
  /** An array admits null, which optional properties must do. See NULLABLE_NOTE. */
  type: string | readonly string[];
  description: string;
  enum?: readonly (string | null)[];
  minimum?: number;
  maximum?: number;
};

/**
 * Optional properties must be declared nullable.
 *
 * Groq validates the model's tool call against these schemas server-side and rejects the
 * whole request with a 400 before the handler runs. Models routinely represent an omitted
 * optional as an explicit null, so a bare `type: "string"` on an optional property causes
 * intermittent hard failures that no amount of validation on our side can catch. Enums
 * must include null for the same reason: `enum` is checked independently of `type`.
 */
const NULLABLE_NOTE = "Optional. Omit or send null when not needed.";

/** Declares an optional string property that also accepts an explicit null. */
function nullableString(description: string): JsonSchemaProperty {
  return { type: ["string", "null"], description: `${description} ${NULLABLE_NOTE}` };
}

/** Declares an optional enum property that also accepts an explicit null. */
function nullableEnum(
  description: string,
  values: readonly string[]
): JsonSchemaProperty {
  return {
    type: ["string", "null"],
    description: `${description} ${NULLABLE_NOTE}`,
    enum: [...values, null]
  };
}

export type ChatToolSchema = {
  type: "function";
  function: {
    name: ChatToolName;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, JsonSchemaProperty>;
      required: readonly string[];
      additionalProperties: false;
    };
  };
};

const DATE_PROPERTY_SUFFIX =
  "Absolute calendar date in YYYY-MM-DD format, interpreted in the user's local finance timezone. Resolve relative phrases such as \"last month\" yourself using today's date, which is given in the system message.";

const MERCHANT_PROPERTY_DESCRIPTION =
  "Optional case-insensitive merchant name fragment, matched as a substring. Use \"tim hortons\" rather than \"TIM HORTONS #4920\", since stored merchant names are already cleaned of store numbers and locations.";

export const TOOL_SCHEMAS: readonly ChatToolSchema[] = [
  {
    type: "function",
    function: {
      name: "search_transactions",
      description:
        "List individual transactions in a date range, newest first. Use this when the user asks which transactions occurred, wants to see specific purchases, asks about a particular merchant, or asks about income deposits. Returns individual rows, not totals — use aggregate_spending when the user wants a sum. Amounts are positive dollar values; income is identified by the Income category rather than by a negative amount.",
      parameters: {
        type: "object",
        properties: {
          startDate: {
            type: "string",
            description: `Inclusive first day of the range. ${DATE_PROPERTY_SUFFIX}`
          },
          endDate: {
            type: "string",
            description: `Inclusive last day of the range. ${DATE_PROPERTY_SUFFIX}`
          },
          category: nullableEnum(
            "Single-category filter. Omit to include every category. Use Income to list deposits, payroll, refunds, and credits.",
            expenseCategories
          ),
          merchantQuery: nullableString(MERCHANT_PROPERTY_DESCRIPTION),
          limit: {
            type: ["integer", "null"],
            description: `Maximum rows to return, from 1 through ${MAX_RESULT_LIMIT}. Defaults to ${DEFAULT_RESULT_LIMIT}. ${NULLABLE_NOTE}`,
            minimum: 1,
            maximum: MAX_RESULT_LIMIT
          }
        },
        required: ["startDate", "endDate"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "aggregate_spending",
      description:
        "Total spending over a date range, optionally narrowed to one category or one merchant. Use this for every question that wants a sum rather than a list: how much was spent in total, at a specific merchant, or in a specific category, and which category was largest. Income is always excluded, so the result is pure spending. Returns the overall total, the transaction count, and a per-category breakdown. Never add up transaction amounts yourself — call this tool instead, because it totals every matching row rather than only the rows a listing would show.",
      parameters: {
        type: "object",
        properties: {
          startDate: {
            type: "string",
            description: `Inclusive first day of the range. ${DATE_PROPERTY_SUFFIX}`
          },
          endDate: {
            type: "string",
            description: `Inclusive last day of the range. ${DATE_PROPERTY_SUFFIX}`
          },
          category: nullableEnum(
            "Single-category filter. Omit to total every spending category and receive the full breakdown. Income is not accepted here because income is not spending.",
            spendingCategories
          ),
          merchantQuery: nullableString(
            `${MERCHANT_PROPERTY_DESCRIPTION} Set this for a merchant-scoped total such as how much was spent at one coffee shop.`
          ),
          includeMerchantBreakdown: {
            type: ["boolean", "null"],
            description: `Set to true when the question ranks or compares merchants, such as which merchant cost the most or where the money went. Adds the top ${MAX_MERCHANT_GROUPS} merchants by total, plus a count and total for the remaining merchants. ${NULLABLE_NOTE}`
          }
        },
        required: ["startDate", "endDate"],
        additionalProperties: false
      }
    }
  }
];

/* ------------------------------------------------------------------ *
 * Query handlers
 *
 * Each handler owns its own parameterized query. Filters are applied with the Supabase
 * query builder against columns that exist in the schema; no part of any query string
 * originates from the model. The service role key means a mistake here has no second
 * line of defence, so nothing reaches the client until validation has passed.
 * ------------------------------------------------------------------ */

/** Columns needed to reuse the dashboard's row normalizer. */
const EXPENSE_COLUMNS =
  "id, created_at, merchant_name, amount, category, timestamp, confidence, reviewed, classified_at, classification_origin";

const QUERY_FAILURE_MESSAGE =
  "Unable to read transaction data right now. Please try again.";

const CONFIGURATION_FAILURE_MESSAGE =
  "Transaction data is unavailable because the finance configuration is incomplete.";

/**
 * Builds a case-insensitive containment pattern for a merchant fragment.
 *
 * LIKE metacharacters are escaped so a fragment such as "50% off" matches literally
 * instead of turning into a wildcard. Asterisks are removed rather than escaped because
 * PostgREST rewrites `*` to `%` while parsing the pattern, before any escape applies.
 *
 * @param value - Validated, trimmed merchant fragment.
 * @returns A pattern safe to hand to `.ilike()`.
 */
function toMerchantContainmentPattern(value: string): string {
  const escaped = value.replace(/\*/g, "").replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}

/**
 * Resolves the finance timezone, converting a configuration failure into a safe message.
 *
 * @returns The configured IANA timezone, or a user-safe message.
 */
function resolveFinanceTimezone(): MutationResult<string> {
  try {
    return { ok: true, data: getFinanceConfig().financeTimezone };
  } catch {
    return invalid(CONFIGURATION_FAILURE_MESSAGE);
  }
}

/**
 * Lists individual transactions matching the requested filters, newest first.
 *
 * One row beyond the requested limit is fetched so the caller can tell a complete result
 * from a truncated one. Reporting truncation matters more than it looks: a model that
 * believes it has every row may add them up and state a total that silently omits the
 * remainder.
 *
 * @param rawArguments - Parsed but unvalidated tool arguments from the model.
 * @returns Matching transactions, or a user-safe message.
 */
export async function searchTransactions(
  rawArguments: Record<string, unknown>
): Promise<MutationResult<SearchTransactionsResult>> {
  const args = validateSearchTransactionsArgs(rawArguments);
  if (!args.ok) return args;

  const timeZone = resolveFinanceTimezone();
  if (!timeZone.ok) return timeZone;

  const { startDate, endDate, category, merchantQuery, limit } = args.data;

  try {
    const bounds = getUtcRangeBounds(startDate, endDate, timeZone.data);
    const client = createSupabaseExpenseClient();

    let query = client
      .from("expenses")
      .select(EXPENSE_COLUMNS)
      .gte("timestamp", bounds.startTimestamp)
      .lt("timestamp", bounds.endTimestamp);

    if (category !== null) {
      query = query.eq("category", category);
    }
    if (merchantQuery !== null) {
      // Matches the generated, whitespace-collapsed lowercase column so the fragment
      // behaves the same way the dashboard's merchant filter does.
      query = query.ilike("normalized_merchant", toMerchantContainmentPattern(merchantQuery));
    }

    const { data, error } = await query
      .order("timestamp", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (error) {
      return invalid(QUERY_FAILURE_MESSAGE);
    }

    const rows = (data ?? []) as ExpenseTableRow[];
    const truncated = rows.length > limit;
    const transactions: ChatTransactionMatch[] = rows
      .slice(0, limit)
      .map((row) => normalizeExpenseRow(row))
      .map((expense) => ({
        merchant: expense.merchantName,
        amount: expense.amount,
        category: expense.category,
        date: getFinanceDateKey(new Date(expense.timestamp), timeZone.data)
      }));

    return {
      ok: true,
      data: {
        startDate,
        endDate,
        returnedCount: transactions.length,
        truncated,
        transactions
      }
    };
  } catch {
    return invalid(QUERY_FAILURE_MESSAGE);
  }
}

type AggregateRow = Pick<ExpenseTableRow, "amount" | "category"> & {
  merchant_name?: string | null;
};

type MerchantGroup = {
  cents: number;
  count: number;
  /** Raw variant to display, chosen by highest single-transaction spend. */
  displayName: string;
  displayCents: number;
};

/**
 * Accumulates one row into the merchant grouping.
 *
 * Rows are grouped by normalized merchant key, using the same collapse rule as the
 * database's generated `normalized_merchant` column, so "TIM HORTONS #4920" and
 * "Tim  Hortons" land in one group. The normalized key is not shown to the user, though:
 * it is lowercased, so the group keeps a real raw variant for display instead.
 *
 * @param groups - Accumulator keyed by normalized merchant name.
 * @param merchantName - Raw merchant name from the row, if present.
 * @param cents - Integer cents for this row.
 */
function accumulateMerchant(
  groups: Map<string, MerchantGroup>,
  merchantName: string | null | undefined,
  cents: number
): void {
  if (typeof merchantName !== "string" || merchantName.trim().length === 0) return;

  const key = normalizeMerchantKey(merchantName);
  const existing = groups.get(key);

  if (!existing) {
    groups.set(key, {
      cents,
      count: 1,
      displayName: merchantName.trim(),
      displayCents: cents
    });
    return;
  }

  existing.cents += cents;
  existing.count += 1;
  if (cents > existing.displayCents) {
    existing.displayName = merchantName.trim();
    existing.displayCents = cents;
  }
}

/**
 * Reduces merchant groups to a capped ranking plus an aggregate tail.
 *
 * The tail is reported explicitly because a model shown ten merchants with no remainder
 * would reasonably describe them as the complete list.
 *
 * @param groups - Accumulated merchant groups.
 * @returns The top merchants by total, and the count and total of those omitted.
 */
function summarizeMerchantGroups(groups: Map<string, MerchantGroup>): {
  merchantTotals: MerchantSpendingTotal[];
  otherMerchantCount: number;
  otherMerchantTotal: number;
} {
  const ranked = [...groups.values()].sort((first, second) =>
    second.cents !== first.cents
      ? second.cents - first.cents
      : first.displayName.localeCompare(second.displayName)
  );

  const top = ranked.slice(0, MAX_MERCHANT_GROUPS);
  const remainder = ranked.slice(MAX_MERCHANT_GROUPS);

  return {
    merchantTotals: top.map((group) => ({
      merchant: group.displayName,
      total: centsToAmount(group.cents),
      transactionCount: group.count
    })),
    otherMerchantCount: remainder.length,
    otherMerchantTotal: centsToAmount(
      remainder.reduce((total, group) => total + group.cents, 0)
    )
  };
}

/**
 * Totals spending over a date range, grouped by category.
 *
 * Income is excluded at the query level, matching the `get_daily_spending_trend` RPC.
 * Totals accumulate in integer cents so repeated addition cannot drift, and there is no
 * row limit: a total that reflects only some matching rows would be worse than no total.
 *
 * @param rawArguments - Parsed but unvalidated tool arguments from the model.
 * @returns Spending totals with a per-category breakdown, optionally a merchant ranking,
 *   or a user-safe message.
 */
export async function aggregateSpending(
  rawArguments: Record<string, unknown>
): Promise<MutationResult<AggregateSpendingResult>> {
  const args = validateAggregateSpendingArgs(rawArguments);
  if (!args.ok) return args;

  const timeZone = resolveFinanceTimezone();
  if (!timeZone.ok) return timeZone;

  const { startDate, endDate, category, merchantQuery, includeMerchantBreakdown } = args.data;

  try {
    const bounds = getUtcRangeBounds(startDate, endDate, timeZone.data);
    const client = createSupabaseExpenseClient();

    let query = client
      .from("expenses")
      // Selected unconditionally: a literal column list keeps the typed select parser
      // working, and the extra column costs bytes over the wire rather than model tokens,
      // since the merchant ranking is only serialized into the reply when requested.
      .select("amount, category, merchant_name")
      .neq("category", "Income")
      .gte("timestamp", bounds.startTimestamp)
      .lt("timestamp", bounds.endTimestamp);

    if (category !== null) {
      query = query.eq("category", category);
    }
    if (merchantQuery !== null) {
      query = query.ilike("normalized_merchant", toMerchantContainmentPattern(merchantQuery));
    }

    const { data, error } = await query;

    if (error) {
      return invalid(QUERY_FAILURE_MESSAGE);
    }

    const rows = (data ?? []) as AggregateRow[];
    const centsByCategory = new Map<SpendingCategory, { cents: number; count: number }>();
    const centsByMerchant = new Map<string, MerchantGroup>();
    let totalCents = 0;
    let transactionCount = 0;

    for (const row of rows) {
      // Defence in depth: the query already excludes income, so a row reaching this
      // branch would mean the filter was lost rather than that income should be counted.
      if (row.category === "Income") continue;
      if (!spendingCategories.includes(row.category as SpendingCategory)) continue;

      const amount = typeof row.amount === "number" ? row.amount : Number.parseFloat(row.amount);
      if (!Number.isFinite(amount)) continue;

      const rowCategory = row.category as SpendingCategory;
      const cents = amountToCents(amount);
      const existing = centsByCategory.get(rowCategory) ?? { cents: 0, count: 0 };

      centsByCategory.set(rowCategory, {
        cents: existing.cents + cents,
        count: existing.count + 1
      });
      totalCents += cents;
      transactionCount += 1;

      if (includeMerchantBreakdown) {
        accumulateMerchant(centsByMerchant, row.merchant_name, cents);
      }
    }

    const categoryTotals: CategorySpendingTotal[] = [...centsByCategory.entries()]
      .map(([totalCategory, totals]) => ({
        category: totalCategory,
        total: centsToAmount(totals.cents),
        transactionCount: totals.count
      }))
      // Largest first, since "what did I spend most on" is the common follow-up. Ties
      // break on category name so the ordering is deterministic.
      .sort((first, second) =>
        second.total !== first.total
          ? second.total - first.total
          : first.category.localeCompare(second.category)
      );

    return {
      ok: true,
      data: {
        startDate,
        endDate,
        total: centsToAmount(totalCents),
        transactionCount,
        categoryTotals,
        ...(includeMerchantBreakdown ? summarizeMerchantGroups(centsByMerchant) : {})
      }
    };
  } catch {
    return invalid(QUERY_FAILURE_MESSAGE);
  }
}

/* ------------------------------------------------------------------ *
 * Registry and dispatch
 * ------------------------------------------------------------------ */

type ChatToolHandler = (
  rawArguments: Record<string, unknown>
) => Promise<MutationResult<ChatToolResultData>>;

/**
 * The only tools the model can reach. Typed as a total record over ChatToolName so a
 * tool added to the name union without a handler fails to compile.
 */
const TOOL_HANDLERS: Record<ChatToolName, ChatToolHandler> = {
  search_transactions: searchTransactions,
  aggregate_spending: aggregateSpending
};

export type ChatToolDispatch = {
  /** Echoes the requested name even when it is not a known tool, for diagnostics. */
  requestedName: string;
  /** Parsed arguments, or an empty object when the model sent unparseable JSON. */
  arguments: Record<string, unknown>;
  result: MutationResult<ChatToolResultData>;
};

/**
 * Parses and routes a single tool call from the model.
 *
 * Both failure modes a model can produce here — an invented tool name and malformed
 * argument JSON — resolve to an error result rather than throwing, so one bad call
 * becomes feedback the model can correct on the next step instead of failing the turn.
 *
 * @param name - Tool name requested by the model.
 * @param rawArgumentsJson - Raw JSON string of arguments as emitted by the model.
 * @returns The dispatch record, including the tool result or a user-safe message.
 */
export async function dispatchToolCall(
  name: string,
  rawArgumentsJson: string
): Promise<ChatToolDispatch> {
  if (!Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, name)) {
    return {
      requestedName: name,
      arguments: {},
      result: invalid(
        `Unknown tool. Use one of: ${Object.keys(TOOL_HANDLERS).join(", ")}.`
      )
    };
  }

  let parsedArguments: unknown;
  try {
    parsedArguments = rawArgumentsJson.trim().length === 0 ? {} : JSON.parse(rawArgumentsJson);
  } catch {
    return {
      requestedName: name,
      arguments: {},
      result: invalid("Tool arguments were not valid JSON. Send them again as a JSON object.")
    };
  }

  if (typeof parsedArguments !== "object" || parsedArguments === null || Array.isArray(parsedArguments)) {
    return {
      requestedName: name,
      arguments: {},
      result: invalid("Tool arguments must be a JSON object.")
    };
  }

  const toolArguments = parsedArguments as Record<string, unknown>;

  return {
    requestedName: name,
    arguments: toolArguments,
    result: await TOOL_HANDLERS[name as ChatToolName](toolArguments)
  };
}
