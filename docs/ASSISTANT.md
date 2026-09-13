# Chat Assistant

Read-only natural-language questions over recorded transactions, answered by a
Groq model that calls whitelisted, parameterized queries.

## How a question is answered

1. `components/finance/chat-panel.tsx` posts the whole conversation to
   `POST /api/chat`.
2. `app/api/chat/route.ts` calls `requireDashboardSession()` before anything
   else, then validates the body: roles restricted to `user` and `assistant`,
   2,000 characters per message, 40 turns per request, newest turn must be a
   question.
3. `lib/chat-agent.ts` builds the system prompt — which states today's
   finance-local date, since the model has no clock — and sends it with the tool
   schemas.
4. The model replies with either prose or a `tool_calls` array.
5. Each requested call goes through `dispatchToolCall` in `lib/chat-tools.ts`,
   which parses the arguments, validates them, and runs a parameterized query.
6. Results are appended to the conversation and the model is asked again, until
   it produces prose or the four-step cap is reached.

## Tools

| Tool | Returns |
| --- | --- |
| `search_transactions` | Individual rows, newest first, up to 50 |
| `aggregate_spending` | Total, count, per-category breakdown, optional top-10 merchant ranking |

Both take the same filters: inclusive `startDate`/`endDate` (required), one
`category`, and a `merchantQuery` fragment. Search additionally takes `limit`;
aggregation additionally takes `includeMerchantBreakdown`.

The identical filter surface is deliberate. The model's only decision is whether
the question wants rows or a number, not which tool supports which filter.

### Design decisions worth knowing

**Income is a category, not a sign.** `expenses.amount` is always positive, and
income is `category = 'Income'`. `aggregate_spending` excludes it at the query
level, matching the `get_daily_spending_trend` RPC. `search_transactions` allows
it, because listing deposits is a legitimate question and a listing is not a
spending total.

**Aggregation has no row limit.** A total covering only some matching rows would
be worse than no total. Search does have a limit, and fetches one row beyond it
to report `truncated` honestly — a model that thinks it has every row might add
them up.

**Merchant totals are a tool feature, not model arithmetic.** `merchantQuery` on
`aggregate_spending` exists so "how much did I spend at X" is one query. Without
it the model would list rows and sum them, which is error-prone and silently
wrong once the row limit truncates.

**Optional schema properties must be nullable.** Groq validates tool calls
against the JSON Schema server-side and rejects the request with a 400 before the
handler runs. Models represent an omitted optional as explicit `null`, so every
optional property is `type: ["string", "null"]` and every optional enum includes
`null`. Two tests in `lib/chat-tools.test.ts` enforce this. Local validation
cannot catch a violation, because the request never arrives.

**Dates are finance-local throughout.** Tool arguments are `YYYY-MM-DD` keys in
`FINANCE_TIMEZONE`, converted by `getUtcRangeBounds` to half-open UTC bounds
`[start, end)` where the upper bound is midnight the day *after* `endDate`.
Queries must pair `.gte(start)` with `.lt(end)`; `.lte()` would include
transactions from the following day.

**No two-period comparison tool.** The model composes comparisons from two
`aggregate_spending` calls, which it batches into a single step in practice. A
dedicated tool would only have covered the exact two-range case, and the compose
path has to work anyway. `validateComparePeriodsArgs` and `ComparePeriodsResult`
are retained, tested and unrouted, if that judgement needs revisiting.

## Security

`createSupabaseExpenseClient()` uses the service role key and bypasses row-level
security, so the tool whitelist is the only barrier between model output and a
fully privileged connection. Consequences:

- The model never composes SQL. It selects a tool name and fills declared
  arguments.
- Every argument is validated before a query is built. Validation failures return
  a fixed, user-safe message.
- `dispatchToolCall` resolves unknown tool names and malformed argument JSON to
  error results rather than throwing, and uses `hasOwnProperty` so inherited
  properties such as `toString` are not callable.
- Merchant fragments are escaped before becoming a LIKE pattern. `%`, `_`, and
  `\` are escaped; `*` is stripped, because PostgREST rewrites it to `%` while
  parsing, before any escape applies.
- The route rejects `system` and `tool` roles, so a caller cannot inject
  instructions that override the agent's rules or forge a tool result.
- Provider errors are never echoed. Server logs record the error type and HTTP
  status only, because Groq's 401 response quotes the API key back.

## Known limitations

Deferred for the initial version. Each is a deliberate choice, not an oversight.

### Latency, and no streaming

Replies arrive as one block. `gpt-oss` models are reasoning models, and reasoning
tokens dominate latency. Measured against live data:

| Reasoning effort | Simple total | Multi-lookup question |
| --- | --- | --- |
| default | ~2s | up to ~23s |
| `low` (current) | ~0.5–2s | up to ~18s |

`CHAT_REASONING_EFFORT` is `"low"` in `lib/chat-agent.ts`. Picking a tool and
restating a number the tool computed does not need a long reasoning chain.

Revisiting this means either streaming the final reply — note the tool phase has
no tokens to stream, so it only improves the last leg — or accepting the wait.
`runChatTurn` is transport-agnostic precisely so a `streamChatTurn` sibling could
reuse the tool layer and its tests unchanged.

### Rate limiting

Groq's free tier (`service tier on_demand`) allows **8,000 tokens per minute**.
Each model call spends roughly 2,100 — mostly the fixed system prompt and tool
schemas — so a turn costs 4,000-plus and sustained questioning hits a 429 after
one or two questions per minute. The client is configured with `maxRetries: 3`,
which absorbs the sub-second 429s Groq clears itself, but not the ceiling.

Three ways out, in increasing cost: trim the system prompt and tool descriptions
to cut per-call overhead, switch `CHAT_GROQ_MODEL` to `openai/gpt-oss-20b`, or
move to Groq's Dev Tier.

### No sorting by amount

Neither tool sorts by amount, so "show me my three biggest transactions" is not
answerable. On `low` reasoning effort the model correctly says so. On default
effort it fetched 50 rows and ranked them itself, which produces a wrong answer
once a window holds more than 50 transactions — the more capable behaviour is
also the less trustworthy one.

Fixing this means a `sortBy: "timestamp" | "amount"` parameter on
`search_transactions`, roughly 40 lines including tests.

### Read-only

No tool can correct a category or delete a transaction. Adding writes would need
transaction ids in the search projection (currently omitted, since they cost
tokens and enable nothing today) and a confirmation step, so a misread cannot
mutate data.

### Answers can be wrong even when queries are right

The tools return correct numbers; the model restates them. In one live run it
wrote `2024-07-14` in prose while the tool argument correctly said `2026-07-14`.
It did not recur, and the prompt requires stating the measured period, but this
is why the panel renders the lookups beneath each answer — a misstatement is
visible next to the query that produced it.

### Not exposed to merchant ranking beyond the top 10

`includeMerchantBreakdown` returns the top 10 merchants plus
`otherMerchantCount` and `otherMerchantTotal`. The tail is reported so a
truncated ranking is not mistaken for the full list, but a question about the
30th-largest merchant cannot be answered.

### Scaling

Merchant containment uses a leading wildcard (`ilike '%x%'`), so that filter
cannot use the btree index on `normalized_merchant` and falls back to a
sequential scan; the timestamp and `(category, timestamp)` indexes are used.
Merchant grouping also happens in TypeScript rather than Postgres, so a wide
range transfers every matching row rather than ten. Both are irrelevant at
single-user volume and both have known fixes — a `pg_trgm` index and a
`group by normalized_merchant` RPC.

### No rate limiting of our own

`POST /api/chat` has no throttle. It is gated to the single address in
`AUTH_ALLOWED_EMAIL`, so the practical exposure is one authenticated user, but
anything wider would need a limiter.

## Testing

| File | Covers |
| --- | --- |
| `lib/chat-tools.test.ts` | Argument validators, schema invariants including nullability |
| `lib/chat-handlers.test.ts` | Query construction, UTC bounds, cent-exact totals, merchant grouping |
| `lib/chat-agent.test.ts` | System prompt, tool loop, batched and sequential calls, step cap, error mapping |
| `app/api/chat/route.test.ts` | Session gate, body validation, forged-role rejection |
| `components/finance/chat-panel.test.tsx` | Send, receive, error, pending state, accessibility |

Groq and Supabase are mocked at the module boundary throughout, so the suite runs
with no network access and no API keys.
