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
  - Implement `async def extract_transaction_entities(raw_text: str) -> CleanTransaction:` executing structural tool completion calls.
  - Hardcode strict linguistic compiler system instructions ensuring merchant names are cleanly normalized (e.g., mapping `"TIM HORTONS #4920"` cleanly to `"Tim Hortons"`).
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
  - Process inbound notification strings through the `ai_extractor` service layer.
  - Execute a Supabase `.upsert()` operation targeting the clean transaction record.
  - Implement an implicit try/except structure: if an integrity exception hits due to duplicate composite signature block violations, suppress the failure quietly and return an HTTP `200 OK` status back to the smartphone client application.
- [x] **3.4 Add Persistent Data Layer Regression Tests**
  - Target Path: `tests/test_database.py`
  - Extended `tests/test_gateway.py` to verify standard storage returns HTTP `202` and duplicate retry handling returns HTTP `200`.
  - Verified with `python -m pytest`: `18 passed, 1 warning`.

## Phase 4: UI Dashboard & Frontend Presentation Tier
- [ ] **4.1 Spin Up Next.js Workspace Architecture**
  - Initialize a Next.js workspace folder layout at the root repository directory layer using Tailwind CSS configuration bindings.
  - Run the `npx shadcn-ui@latest init` boilerplate framework compilation utility.
- [ ] **4.2 Configure Supabase Authentication Layer Isolation**
  - Enable Email/Password registration methods inside the active Supabase project management pane.
  - **Security Mandate:** Toggle user registration visibility to administrative-invite only to explicitly prevent outside access vector exploits.
  - Generate a secure `/login` intercept page mapping credential input parameters straight into Supabase token handling endpoints.
- [ ] **4.3 Write Next.js Server-Side Security Protection Middleware**
  - Target Path: `middleware.ts` (Project root directory)
  - Intercept server-side page requests targeting protected layout routes like `/dashboard`.
  - Query cookies to verify valid session tokens. Redirect unauthenticated requests back to the login gateway routing target.
- [ ] **4.4 Assemble Visual Budget Metric UI Dashboards**
  - Install charts styling modules (`npx shadcn-ui@latest add card` and charting primitives).
  - Write clean server components querying database aggregates directly from the Supabase database.
  - Bind data maps into clear graphical rendering components breaking down current spend cycles by category allocations.
