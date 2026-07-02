# Smart Finance Tracker — Expansion Roadmap

Implementation checklist for extending the notification → FastAPI → AI classification → Supabase → Next.js pipeline. Each item lists what to build and what it adds to the product. Check items off as implemented.

---

## 1. Pipeline Reliability

### [ ] 1.1 Idempotent ingestion
- **What to build:** In the FastAPI ingestion endpoint, compute a dedup key as a hash of `(notification_text + timestamp rounded to nearest minute)`. Before inserting, check Supabase for an existing row with that key; if found, return 200 without re-inserting. Store the key as a unique-indexed column on the transactions table.
- **What it adds:** Safe retries from the phone macro (network blips, app restarts) no longer create duplicate transactions. Removes a class of silent data-corruption bugs.

### [ ] 1.2 Classification confidence field
- **What to build:** Extend the Pydantic output schema with a `confidence: float` field (0–1) that the LLM must emit alongside merchant/category/location. Store it on the transaction row.
- **What it adds:** A machine-readable signal for which transactions need human review, and the foundation for the accuracy-eval loop (1.4) and UI flagging (4.2).

### [ ] 1.3 Merchant cache table
- **What to build:** New `merchants` table: `id, normalized_name, category, place_id, lat, lng, confidence, last_verified_at`. On ingestion, normalize the merchant string (strip store numbers, uppercase/trim), look up the cache first. Cache hit with confidence above threshold → skip AI/agent call entirely, reuse stored classification. Cache miss or stale/low-confidence entry → run full classification, then upsert result back into `merchants`.
- **What it adds:** Cuts LLM/API calls dramatically for repeat merchants (T&T, Zehrs, etc. already show up multiple times). Keeps steady-state cost and latency low even as the agent (section 2) gets more expensive per call.

### [ ] 1.4 Corrections table + accuracy metric
- **What to build:** New `corrections` table: `transaction_id, original_category, corrected_category, original_location, corrected_location, corrected_at`. Add a UI action (section 4.2) to edit a transaction's category/location, writing to this table and updating the live transaction row + merchant cache. Build a small script or dashboard stat that computes `1 - (correction_count / total_classified)` over a trailing window.
- **What it adds:** Turns "I used AI to classify transactions" into a measurable claim: "X% classification accuracy across N transactions." This is the single highest-leverage addition for making the project resume/interview-worthy — it demonstrates evaluation, not just usage.

---

## 2. Smarter Classification (Agent + Tool Use)

### [ ] 2.1 Places API tool-use agent
- **What to build:** Add a tool-calling step to the classification pipeline: when the merchant is unrecognized (cache miss) or the model's confidence is low, invoke a `search_places(query, lat, lng)` tool backed by Google Places API (or equivalent). Feed the returned place type, formatted address, and coordinates back to the model to finalize the Pydantic-validated output (category, location, lat/lng).
- **What it adds:** Replaces guesswork on ambiguous merchant strings with grounded, structured real-world data. Higher classification accuracy on new/unusual merchants, and real geographic coordinates instead of merchant-name-only grouping.

### [ ] 2.2 GPS capture in the phone macro
- **What to build:** Modify the notification-listener macro (Tasker/MacroDroid) to grab device GPS coordinates at the moment the notification fires and include them in the POST payload to FastAPI.
- **What it adds:** Location bias for the Places API search (disambiguates "which Zehrs location"), and real per-transaction coordinates for a future map view (4.4).

### [ ] 2.3 Merchant normalization / dedup pass
- **What to build:** A normalization function (or scheduled job) that reconciles near-duplicate merchant entries in the `merchants` cache — e.g. "T&T SUPERMARKET #1234" and "T & T Supermarket" mapped to one canonical entity via string similarity or shared `place_id`.
- **What it adds:** Keeps "Spending by location" clean and accurate as transaction volume grows, instead of fragmenting into near-duplicate slices.

---

## 3. Analytical Features

### [ ] 3.1 Spending trend chart
- **What to build:** A line or bar chart on the Overview tab showing daily or weekly totals over a rolling window (e.g. last 90 days), pulled from an aggregation query on the transactions table.
- **What it adds:** Shows trajectory over time, which the current snapshot cards (today/week/month) can't — answers "am I spending more than last month," not just "how much today."

### [ ] 3.2 Category budgets
- **What to build:** A `budgets` table (`category, monthly_limit`). Add progress bars under the existing category donut chart showing spend vs. limit, with a color state (green/yellow/red) based on percentage consumed.
- **What it adds:** Turns passive tracking into an actionable tool — surfaces overspending in real time rather than only in hindsight.

### [ ] 3.3 Recurring transaction detection
- **What to build:** A scheduled job or query that flags merchants appearing on a regular cadence (e.g. same merchant + similar amount within a ±3 day window across 3+ months). Tag matching transactions as `recurring: true`.
- **What it adds:** Separates fixed/recurring spend (subscriptions, memberships) from discretionary spend in the category breakdown — a more useful split than category alone.

### [ ] 3.4 Net cash flow
- **What to build:** Currently income is excluded from spending allocation entirely. Add a top-level "Net this month" stat = income − spend, using the existing income-tagged transactions.
- **What it adds:** A single number answering "am I actually saving," which the current dashboard doesn't surface at all.

---

## 4. UI Features

### [ ] 4.1 Transaction search/filter
- **What to build:** Add filter controls to the Transactions tab: text search by merchant, dropdown filter by category, date range picker. Client-side filter is fine at current volume; move to a Supabase query filter once transaction count grows.
- **What it adds:** Usability at scale — the current flat list of 11 rows won't stay browsable as data accumulates.

### [ ] 4.2 Inline transaction editing
- **What to build:** Click-to-edit category and location fields directly in the Transactions table. On save, write to the `corrections` table (1.4) and update the live row + merchant cache (1.3).
- **What it adds:** Closes the human-in-the-loop feedback cycle — this is the actual data-entry point that feeds the accuracy metric and improves future classifications of the same merchant.

### [ ] 4.3 Low-confidence badge
- **What to build:** On the Transactions tab, show a small "unverified" or warning badge on any transaction whose `confidence` (1.2) is below a set threshold.
- **What it adds:** Directs your attention to the transactions most likely to need correction, instead of manually auditing everything.

### [ ] 4.4 Map view
- **What to build:** New tab or panel using the lat/lng captured in 2.1/2.2, plotting transactions as markers on a map (e.g. Mapbox or Google Maps embed), colored by category.
- **What it adds:** A visually distinctive feature that most personal-finance dashboards don't have — makes the project noticeably more impressive to look at, and is a direct payoff of the location-grounding work in section 2.

### [ ] 4.5 Calendar heatmap
- **What to build:** Replace the current single-highlight calendar cell styling with a heatmap intensity scale (e.g. shades of the existing teal) based on relative daily spend within the visible month.
- **What it adds:** Makes spending patterns (weekday vs weekend, spikes) visible at a glance instead of requiring you to read every cell's dollar amount.

---

## Suggested Build Order

1. **1.1 Idempotent ingestion** — cheap, prevents data corruption, do first.
2. **1.3 Merchant cache** — needed before 2.1, since the agent should only run on cache misses.
3. **2.2 GPS capture** — small macro change, needed before 2.1 can use location bias.
4. **2.1 Places API agent** — the core "smarter classification" feature.
5. **1.2 Confidence field** — comes naturally out of 2.1's tool-use output.
6. **4.2 Inline editing + 1.4 Corrections table** — closes the feedback loop, unlocks the accuracy metric.
7. **4.3 Low-confidence badge** — trivial once 1.2 exists.
8. **2.3 Merchant normalization** — cleanup pass once cache has enough entries to show duplicates.
9. Remaining analytical/UI features (3.x, 4.1, 4.4, 4.5) — any order, based on what's most useful to you day-to-day.
