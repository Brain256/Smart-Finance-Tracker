# Roadmap

What is built, what was deliberately left out, and why. Design rationale for
shipped work lives in [ARCHITECTURE.md](ARCHITECTURE.md) and
[ASSISTANT.md](ASSISTANT.md).

## Shipped

**Pipeline reliability.** Ingestion upserts against a composite unique
constraint on `(merchant_name, amount, timestamp)`, so a replayed notification
returns `200` instead of creating a duplicate row — necessary once the Android
client began retrying from a local queue. See ARCHITECTURE.md §8.

**Classification confidence and review.** The LLM emits a `confidence` value
stored on the expense row. Anything below `REVIEW_THRESHOLD` stays flagged and
surfaces as an Unverified badge in Transactions.

**Corrections as the learning mechanism.** Correcting a category writes to an
immutable `corrections` table and updates the live row. Before each insert,
`resolve_latest_correction` looks up the newest correction for the same canonical
merchant and overrides the model. There is no separate merchant cache — the
corrections table is the cache, and also the audit log behind the accuracy
metric. See ARCHITECTURE.md §2.

**Planning.** Income history, a singleton savings target, and per-category
budgets, edited in Settings. Spendable-this-period and the derived daily and
weekly limits are recalculated on every read rather than stored, so they cannot
go stale mid-period. See ARCHITECTURE.md §3.

**Analytics.** Zero-filled 90-day spending trend, category budget progress with
pacing, a cash-flow projection, a GitHub-style calendar heatmap with per-day
detail, and merchant/category allocation charts. All aggregation runs in integer
cents. See ARCHITECTURE.md §4 and §5.

**Transaction search and filtering.** Merchant text search, category filter, and
an inclusive date range, intersected client-side and validated so a
half-specified range reports rather than silently applies.

**Chat assistant.** An Assistant tab answering natural-language questions through
a Groq model that calls two whitelisted, parameterized read-only tools —
`search_transactions` for rows, `aggregate_spending` for totals. The model never
composes SQL. Shipped as an MVP: read-only and non-streaming.

## Deliberately deferred

**Recurring expense detection.** Flagging merchants that recur on a cadence would
separate fixed from discretionary spend and give the projection real upcoming
charges to subtract. Without it, the projection substitutes an *adjusted remaining
budget* — configured budget remainder less all unbudgeted current-month spending
— which keeps a partial budget honest. Documented in ARCHITECTURE.md §5.

**Net cash flow as a surfaced metric.** `getNetCashFlow` computes monthly income
minus spend in the analytics layer, but no panel renders it yet. The calculation
is tested; the presentation is missing.

**Assistant follow-ups.** Each closes a specific gap listed in ASSISTANT.md, and
none is required for the assistant to be useful:

- `sortBy: "timestamp" | "amount"` on `search_transactions`, so "my three biggest
  transactions" becomes a database-side answer rather than an honest refusal.
- Streaming the final reply. The tool phase has no tokens to stream, so this only
  improves the last leg of a multi-lookup question.
- Cutting per-call token overhead, or moving off Groq's free 8,000 TPM tier,
  which caps sustained use at roughly one or two questions per minute.
- Write tools for correction and deletion through chat, which would need
  transaction ids in the search projection and a confirmation step.
- A `group by normalized_merchant` RPC, so merchant ranking aggregates in
  Postgres instead of transferring every matching row.
