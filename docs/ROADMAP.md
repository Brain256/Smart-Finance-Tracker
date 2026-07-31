# Smart Finance Tracker — Expansion Roadmap

Implementation checklist for extending the notification → FastAPI → AI classification → Supabase → Next.js pipeline. Each item lists what to build and what it adds to the product. Check items off as implemented.

---

## 1. Pipeline Reliability

### [x] 1.2 Classification confidence field
- **What to build:** Extend the Pydantic output schema with a `confidence: float` field (0–1) that the LLM must emit alongside merchant/category. Store it on the expense row.
- **What it adds:** A machine-readable signal for which expenses need manual review — drives the low-confidence flow (2.1), the badge (4.3), and the accuracy-eval loop (1.4).

### [x] 1.4 Corrections table + accuracy metric + correction lookup
- **What to build:** New `corrections` table: `expense_id, original_category, corrected_category, corrected_at`. Add a UI action (section 4.2) to edit an expense's category, writing to this table and updating the live `expenses` row. After classification and before insert, join `corrections` to `expenses` (via `expense_id`) to find the most recent correction matching the new expense's normalized merchant, order by `corrected_at desc`, limit 1, and override the LLM's category if a match exists — no separate merchant cache table needed, this query is the cache. Build a small script or dashboard stat that computes `1 - (correction_count / total_classified)` over a trailing window.
- **What it adds:** Turns "I used AI to classify expenses" into a measurable claim: "X% classification accuracy across N expenses." Also makes corrections persistent — once you fix a merchant's category, it stays fixed for future expenses from that merchant, without a second table to keep in sync.

---

## 2. Classification Fallback (Manual Entry)

### [x] 2.1 Low-confidence manual entry flow
- **What to build:** When the LLM's classification confidence (1.2) falls below a threshold, leave the expense flagged (`reviewed: false`) and surface it via the low-confidence badge (4.3). You manually set the category through inline editing (4.2), which writes to `corrections` (1.4) — the next expense from the same merchant is auto-corrected via the lookup in 1.4.
- **What it adds:** Resolves ambiguous merchants without any external dependency or cost, and without needing to re-correct the same merchant twice.

---

## 3. Analytical Features

### [x] 3.1 Spending trend chart
- **What to build:** A line or bar chart on the Overview tab showing daily or weekly totals over a rolling window (e.g. last 90 days), pulled from an aggregation query on the `expenses` table.
- **What it adds:** Shows trajectory over time, which the current snapshot cards (today/week/month) can't — answers "am I spending more than last month," not just "how much today."

### [x] 3.2 Category budgets
- **What to build:** A `budgets` table (`category, monthly_limit`). Add progress bars under the existing category donut chart showing spend vs. limit, with a color state (green/yellow/red) based on percentage consumed.
- **What it adds:** Turns passive tracking into an actionable tool — surfaces overspending in real time rather than only in hindsight.

### [x] 3.2b Income tracking + derived daily/weekly limits
- **What to build:** A separate `income` table (`id, amount, frequency: weekly/biweekly/monthly, effective_date`), kept independent of `budgets` — income and spending targets are edited separately. Add one setting, `savings_target` (fixed dollar amount or percentage — pick one), used to compute `spendable_this_period = normalized_monthly_income - savings_target`. From that, derive (don't store) `daily_limit = spendable_this_period / days_in_period` and `weekly_limit = spendable_this_period / (days_in_period / 7)`, recalculated on every read so they never go stale if income or the savings target changes mid-period. This is a separate, higher-level number from the per-category budgets in 3.2 — don't merge the two schemas.
- **What it adds:** Turns "how much did I spend" into "how much can I still spend today/this week," grounded in actual income rather than an arbitrary limit. Also gives 3.5's cash-flow projection a real spendable baseline to project against, and pairs naturally with the calendar heatmap (4.4) — each day's box can be colored by under/over the derived daily limit, not just raw spend intensity.

### [ ] 3.3 Recurring expense detection
- **What to build:** A scheduled job or query that flags merchants appearing on a regular cadence (e.g. same merchant + similar amount within a ±3 day window across 3+ months). Tag matching expenses as `recurring: true`.
- **What it adds:** Separates fixed/recurring spend (subscriptions, memberships) from discretionary spend in the category breakdown — a more useful split than category alone. Also a prerequisite for cash-flow projection below.

### [x] 3.4 Net cash flow
- **What to build:** Currently income is excluded from spending allocation entirely. Add a top-level "Net this month" stat = income − spend, using the existing income-tagged expenses.
- **What it adds:** A single number answering "am I actually saving," which the current dashboard doesn't surface at all.

### [x] 3.5 Cash-flow / spend projection
- **What to build:** Using detected recurring expenses (3.3) not yet charged this period, plus remaining budget (3.2) and an average discretionary daily spend rate (trailing 2-4 weeks), project end-of-period balance: `remaining_budget - upcoming_recurring_charges - (avg_daily_discretionary_spend * days_remaining)`. Surface as a single number, not a chart. Keep it linear — don't add seasonality/regression until you have enough data history to validate it.
- **What it adds:** Answers "can I afford X today, given what's still coming" rather than just reporting past spend. Also a stronger notification trigger than a simple threshold crossing, since it accounts for known upcoming charges.
- **As shipped:** Recurring detection (3.3) is still open, so the delivered projection substitutes an *adjusted remaining budget* for upcoming recurring charges: configured budget remainder less every unbudgeted current-month spending cent, then `min(adjusted_remaining_budget, income_remaining) - (28-day average daily spend × inclusive days remaining)`. See [ARCHITECTURE.md](ARCHITECTURE.md) §5.

---

## 4. UI Features

### [x] 4.1 Expense search/filter
- **What to build:** Add filter controls to the Expenses tab: text search by merchant, dropdown filter by category, date range picker. Client-side filter is fine at current volume; move to a Supabase query filter once expense count grows.
- **What it adds:** Usability at scale — the current flat list of 11 rows won't stay browsable as data accumulates.

### [x] 4.2 Inline expense editing
- **What to build:** Click-to-edit category field directly in the Expenses table. On save, write to the `corrections` table (1.4) and update the live row.
- **What it adds:** The core mechanism for resolving low-confidence classifications (2.1) — the actual data-entry point that feeds the accuracy metric and improves future classifications of the same merchant.

### [x] 4.3 Low-confidence badge
- **What to build:** On the Expenses tab, show a small "unverified" or warning badge on any expense whose `confidence` (1.2) is below a set threshold.
- **What it adds:** Directs your attention to the expenses that actually need manual review, instead of manually auditing everything.

### [x] 4.5 Budget & income settings panel
- **What to build:** A dedicated settings view (separate from the Expenses/Overview tabs) with two simple forms: one for income (amount + frequency dropdown, with an editable history if you ever change jobs/pay), and one for the savings target (a toggle between fixed-dollar and percentage, plus the value). Category budgets (3.2) can live in this same panel as a list of category/limit pairs. On save, the daily/weekly limits and category progress bars recalculate immediately elsewhere in the dashboard — this panel only edits the inputs, it doesn't display the derived numbers itself.
- **What it adds:** A single, predictable place to change the numbers that drive every budget-related display, instead of scattering edit controls across the dashboard. Keeps the derived-vs-stored distinction from 3.2b clean: this is the only place you touch stored values.

### [x] 4.4 Calendar heatmap
- **What to build:** Replace the current calendar with a compact GitHub-contributions-style heatmap — small uniform boxes (one per day), colored by intensity (shades of the existing teal) based on relative daily spend, no dollar amounts printed on the grid itself. On hover (desktop) or tap (mobile), show a small tooltip/popover with the date and that day's total spend.
- **What it adds:** Makes spending patterns (weekday vs weekend, spikes) visible at a glance from color alone, while keeping exact figures available on demand instead of cluttering the grid.

---

## Suggested Build Order

1. **1.2 Confidence field** — small schema addition, needed for everything in section 2 and 4.3.
2. **4.3 Low-confidence badge + 4.2 Inline editing + 1.4 Corrections table** — this trio is the core loop (flag → manually fix → learn), build together.
3. **3.2 Category budgets + 3.2b Income tracking + 4.5 Settings panel** — build together, since the settings panel is just the input surface for both.
4. **3.3 Recurring expense detection** — prerequisite for 3.5.
5. **3.5 Cash-flow projection** — depends on 3.3 and 3.2/3.2b.
6. Remaining features (3.1, 3.4, 4.1, 4.4) — any order, based on what's most useful to you day-to-day.

*(Idempotent ingestion was deferred — worth revisiting once retry logic, like the SQLite outbox / WorkManager work, is actually being built, since that's when duplicate-insert risk becomes real.)*