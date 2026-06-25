# Comprehensive Implementation Progress Log & Technical Checklist

## Phase 1: Core Foundation, Environment, & Ingestion Gate
- [x] **1.1 Configure Project Workspace & Tooling**
  - Created `pyproject.toml` at the root folder specifying Python >= 3.11.
  - Defined dependencies array: `fastapi`, `pydantic`, `instructor`, `supabase`, `python-dotenv`, and `uvicorn`.
  - Defined `dev` optional dependencies for automated testing with `pytest`.
  - Configured `tool.ruff` code formatting boundaries to 88-character lines.
- [x] **1.2 Establish Environmental Secrets Engine**
  - Created `.gitignore` to exclude the local `.env` file and Python cache artifacts.
  - Created `.env.example` containing placeholder values for:
    - `INBOUND_SECRET_TOKEN` (Generated 32-byte cryptographically secure random string)
    - `GROQ_API_KEY` or `GEMINI_API_KEY`
    - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- [x] **1.3 Construct Base FastAPI App Gateway Wrapper**
  - Target Path: `api/index.py` exposes the application layer instance as `app` to conform with Vercel serverless specifications.
  - Added root health check endpoint GET `/api/v1/health` returning a strict `HealthResponse` schema with `{"status": "healthy"}`.
- [x] **1.4 Architect Stateless Pre-Shared Bearer Security Gate**
  - Target Path: `src/core/security.py`
  - Leveraged FastAPI's native `HTTPBearer` and `HTTPAuthorizationCredentials` dependencies.
  - Implemented asynchronous validator function `async def verify_api_key()` to match headers with `INBOUND_SECRET_TOKEN`.
  - Ensured missing or failing keys raise a strict `HTTP_401_UNAUTHORIZED` exception instantly.
- [x] **1.5 Create Minimal Validated Ingestion Gate**
  - Target Path: `api/index.py`
  - Added POST `/api/v1/ingest` protected with `Depends(verify_api_key)`.
  - Target Path: `src/schemas/transaction.py`
  - Added strict Pydantic v2 `TransactionWebhook` schema matching the inbound contract exactly:
    - `notification_title: str`
    - `notification_text: str`
    - `timestamp: datetime`
  - Accepted ISO 8601 timestamps plus MacroDroid Unix timestamps in seconds or milliseconds, normalized internally to timezone-aware UTC datetimes.
  - Rejected extra inbound fields and timezone-naive ISO timestamps before future AI or database processing can execute.
- [x] **1.6 Add Automated Ingestion Gate Regression Tests**
  - Target Path: `tests/test_gateway.py`
  - Added pytest coverage for:
    - GET `/api/v1/health` healthy response.
    - POST `/api/v1/ingest` missing bearer token rejection.
    - POST `/api/v1/ingest` invalid bearer token rejection.
    - POST `/api/v1/ingest` invalid payload shape rejection.
    - POST `/api/v1/ingest` timezone-naive timestamp rejection.
    - POST `/api/v1/ingest` Unix millisecond timestamp normalization.
    - POST `/api/v1/ingest` Unix second timestamp normalization.
    - POST `/api/v1/ingest` valid MacroDroid-shaped payload acceptance.
  - Verified with `python -m pytest`: `8 passed, 1 warning`.

### Phase 1 Local Setup Guide
1. Create a virtual environment:
   ```powershell
   python -m venv .venv
   ```
2. Activate it:
   ```powershell
   .\.venv\Scripts\Activate.ps1
   ```
3. Install the project dependencies:
   ```powershell
   python -m pip install -e .[dev]
   ```
4. Create the local environment file:
   ```powershell
   Copy-Item .env.example .env
   ```
5. Generate a strong inbound token and place it in `.env` as `INBOUND_SECRET_TOKEN`.
   ```powershell
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```
6. Start the local FastAPI gateway:
   ```powershell
   python -m uvicorn api.index:app --reload
   ```

### Phase 1 Automated Testing Guide
1. Install runtime and test dependencies:
   ```powershell
   python -m pip install -e .[dev]
   ```
2. Run the automated Phase 1 regression suite:
   ```powershell
   python -m pytest
   ```
3. Expected result:
   ```text
   8 passed
   ```
4. The pytest suite verifies the same behavior as the original manual checks:
   - Health endpoint returns HTTP `200` and `{"status": "healthy"}`.
   - Missing bearer token returns HTTP `401`.
   - Invalid bearer token returns HTTP `401`.
   - Invalid payload shape returns HTTP `422`.
   - Timezone-naive timestamp returns HTTP `422`.
   - Unix millisecond timestamp returns HTTP `202` with a normalized UTC timestamp.
   - Unix second timestamp returns HTTP `202` with a normalized UTC timestamp.
   - Valid MacroDroid-shaped payload returns HTTP `202` and the accepted timestamp.
5. Verify MacroDroid integration manually only after the automated suite passes by setting its HTTP request action to POST to:
   ```text
   https://your-vercel-domain.vercel.app/api/v1/ingest
   ```
   Include the header:
   ```http
   Authorization: Bearer YOUR_DEPLOYED_INBOUND_SECRET_TOKEN
   ```
   Use a JSON body matching the exact inbound schema:
   ```json
   {
     "notification_title": "[not_title]",
     "notification_text": "[not_text]",
     "timestamp": "[not_timestamp]"
   }
   ```

## Phase 2: Schema Boundaries, AI Parsing Engine, & Prompt Engineering
- [x] **2.1 Define Data Transfer Objects (DTO) via Pydantic v2 Models**
  - Target Path: `src/schemas/transaction.py`
  - Implement a `CategoryEnum` subclassing `str` and `Enum` restricting options exactly to: `["Food", "Transport", "Entertainment", "Bills", "Shopping", "Income", "Miscellaneous"]`.
  - Construct `CleanTransaction` schema for database insertion matching fields: `merchant_name: str`, `amount: float`, and `category: CategoryEnum`.
- [x] **2.2 Compile Static `schema.json` Blueprint**
  - Execute a configuration script using Pydantic's `.model_json_schema()` to export types into a root level `schema.json` file for Codex context indexing.
- [x] **2.3 Build Async AI Client Wrapper with Instructor Layer Integration**
  - Target Path: `src/services/ai_extractor.py`
  - Patch an async OpenAI/Groq or Google client wrapper instance using `instructor.from_openai()` or `instructor.from_gemini()`.
  - Implement `async def extract_transaction_entities(notification_title: str, notification_text: str) -> CleanTransaction:` executing structural tool completion calls.
  - Hardcode strict linguistic compiler system instructions ensuring merchant names are cleanly normalized from the notification title (e.g., mapping `"TIM HORTONS #4920"` cleanly to `"Tim Hortons"`) and amounts are taken from the notification body.
- [x] **2.4 Add Automated Extraction Regression Tests**
  - Target Path: `tests/test_ai_extractor.py`
  - Target Path: `tests/test_transaction_schemas.py`
  - Extended `tests/test_gateway.py` to verify `/api/v1/ingest` calls the extraction layer and returns the clean transaction payload.
  - Verified with `python -m pytest`: `12 passed, 1 warning`.

## Phase 3: Persistent Data Layer & Idempotency Controls
- [x] **3.1 Prepare Supabase Relational Schema Queries**
  - Access Supabase SQL editor and execute the raw `expenses` data table schema definition:
    - `id` (BIGSERIAL, Primary Key), `created_at` (TIMESTAMPTZ), `merchant_name` (VARCHAR), `amount` (NUMERIC(10,2)), `category` (VARCHAR), `timestamp` (TIMESTAMPTZ).
  - Inject a multi-column composite constraint naming convention rule: `CONSTRAINT unique_transaction_signature UNIQUE (merchant_name, amount, timestamp)`.
  - Added `supabase/expenses.sql` containing the required table and unique constraint SQL for manual execution in the Supabase SQL editor.
- [x] **3.2 Initialize Persistent Client Connectors**
  - Target Path: `src/core/database.py`
  - Instantiate an async-capable Supabase client connection hook pool utilizing the environment URL and service role execution credentials.
- [x] **3.3 Connect Ingestion Handlers to Database Operations with Exception Trapping**
  - Target Path: `api/index.py`
  - Process inbound notification title/body fields through the `ai_extractor` service layer.
  - Execute a Supabase `.upsert()` operation targeting the clean transaction record.
  - Implement an implicit try/except structure: if an integrity exception hits due to duplicate composite signature block violations, suppress the failure quietly and return an HTTP `200 OK` status back to the smartphone client application.
- [x] **3.4 Add Persistent Data Layer Regression Tests**
  - Target Path: `tests/test_database.py`
  - Extended `tests/test_gateway.py` to verify standard storage returns HTTP `202` and duplicate retry handling returns HTTP `200`.
  - Verified with `python -m pytest`: `18 passed, 1 warning`.

## Phase 4: UI Dashboard & Frontend Presentation Tier
- [x] **4.1 Spin Up Next.js Workspace Architecture**
  - Initialize a Next.js workspace folder layout at the root repository directory layer using Tailwind CSS configuration bindings.
  - Added a root-level Next.js App Router workspace with Tailwind CSS configuration bindings.
  - Used local dashboard-oriented UI primitives instead of generated shadcn files to avoid introducing interactive scaffold output into the repo.
  - Use the App Router and create a protected `/dashboard` experience as the primary application surface.
  - Keep the first screen focused on the real finance dashboard rather than a marketing landing page.
  - Use a responsive shell that works well on desktop web and phone widths:
    - Desktop: persistent top navigation or compact sidebar, multi-column dashboard grids, and wide data tables.
    - Mobile: single-column sections, horizontally scrollable tables where necessary, touch-friendly tabs and sort controls, and no overlapping text.
- [x] **4.2 Configure Dashboard Authentication Layer**
  - Replaced Supabase email/password auth and custom credential auth with Auth.js Google OAuth for this personal dashboard.
  - Added `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `AUTH_ALLOWED_EMAIL` placeholders while keeping `SUPABASE_SERVICE_ROLE_KEY` server-only.
- [x] **4.3 Write Next.js Security Middleware**
  - Target Path: `proxy.ts` (Project root directory)
  - Guard all non-API, non-static asset routes.
  - Validate the Auth.js session at the edge and redirect unauthenticated page requests to `/login`.
- [x] **4.4 Assemble Visual Budget Metric UI Dashboards**
  - Installed charting and icon dependencies through the frontend package manifest.
  - Wrote clean server components querying database records directly from the Supabase database.
  - Bound data maps into clear graphical rendering components breaking down current spend cycles by category allocations.
  - Build summary statistic tiles for:
    - **Spending Today:** Sum of all non-income expense transactions whose `timestamp` falls on the current local day.
    - **Spending This Week:** Sum of all non-income expense transactions for the current week.
    - **Spending This Month:** Sum of all non-income expense transactions for the current calendar month.
  - Each statistic tile should include:
    - Currency-formatted spend total.
    - Short period label.
    - Optional supporting comparison text once historical comparison data exists.
  - Exclude `Income` category rows from spending totals unless the dashboard explicitly introduces a separate income metric later.
- [x] **4.5 Build Calendar Spending History Tab**
  - Add a dashboard tab named `Calendar`.
  - Display a month calendar grid for the selected month.
  - Each day cell must show:
    - Day number.
    - Total amount spent on that day.
    - A visual intensity cue based on daily spend size so high-spend days are easy to scan.
  - Provide month navigation controls for previous and next month.
  - Use the transaction `timestamp` as the source of truth for day grouping.
  - Empty days should remain visible with a zero or muted empty state so the calendar shape remains stable.
  - Mobile behavior:
    - Calendar must fit phone width without text collisions.
    - Day cells should maintain stable square or near-square dimensions.
    - Daily amount text may use compact currency formatting when space is tight.
- [x] **4.6 Build Sortable Transaction Table Tab**
  - Add a dashboard tab named `Transactions`.
  - Render every stored transaction in a clean table with these columns:
    - Date/time from `timestamp`.
    - Merchant from `merchant_name`.
    - Category from `category`.
    - Amount from `amount`.
  - Each column header must expose a sort control.
  - Sorting requirements:
    - Clicking a sortable header toggles ascending and descending order for that column.
    - The active sort column should be visually indicated.
    - Date defaults to newest first.
    - Amount sorting must compare numeric values, not currency-formatted strings.
    - Merchant and category sorting should be alphabetical.
  - Table should remain readable on mobile:
    - Prefer horizontal scrolling inside the table region rather than squeezing text until it overlaps.
    - Keep header controls touch-friendly.
    - Use compact row spacing on narrow screens while preserving legibility.
- [x] **4.7 Build Spending By Location Pie Chart**
  - Add a chart section for spending grouped by location.
  - Initial data source can use `merchant_name` as the location-like grouping key because the current persisted schema does not yet include a separate physical location field.
  - If true location data is added later, migrate this chart to group by the dedicated location field.
  - Show top locations by total spend and group small remaining values into an `Other` slice if the chart becomes crowded.
  - Include a legend that remains usable on mobile.
- [x] **4.8 Build Spending By Category Pie Chart**
  - Add a chart section for spending grouped by `category`.
  - Category slices must use the existing enum categories:
    - `Food`
    - `Transport`
    - `Entertainment`
    - `Bills`
    - `Shopping`
    - `Income`
    - `Miscellaneous`
  - For spending-only views, exclude or visually separate `Income` so income does not distort expense allocations.
  - Include tooltip or hover/tap details showing category name, total amount, and percentage of visible spend.
- [x] **4.9 Dashboard Data Query Contract**
  - Use Supabase as the dashboard data source.
  - Expected table: `expenses`.
  - Required fields for the first dashboard version:
    - `id`
    - `created_at`
    - `merchant_name`
    - `amount`
    - `category`
    - `timestamp`
  - Query all records needed for the selected dashboard period and derive UI aggregates from those records unless a dedicated SQL view or RPC is introduced.
  - Currency display should default to Canadian dollars because the ingestion source is BMO card notifications.
  - Date grouping should use the user's local timezone for dashboard presentation while preserving UTC storage semantics.
- [ ] **4.10 Responsive Dashboard Acceptance Criteria**
  - Desktop dashboard should show statistics, charts, calendar, and table with dense but calm spacing.
  - Phone dashboard should stack sections vertically and keep primary actions reachable without horizontal page-level overflow.
  - No text should overlap inside cards, table headers, chart legends, calendar cells, or navigation tabs.
  - Charts must have stable heights and readable legends on both desktop and mobile.
  - Calendar cells and table rows must not resize unpredictably when values change.
  - Verify the finished UI at minimum desktop and mobile viewport sizes before considering Phase 4 complete.
