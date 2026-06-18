# Comprehensive Implementation Progress Log & Technical Checklist

## Phase 1: Core Foundation, Environment, & Ingestion Gate
- [ ] **1.1 Configure Project Workspace & Tooling**
  - Create `pyproject.toml` at the root folder specifying Python >= 3.11.
  - Define dependencies array: `fastapi`, `pydantic`, `instructor`, `supabase`, `python-dotenv`, and `uvicorn`.
  - Configure `tool.ruff` code formatting boundaries to 88-character lines.
- [ ] **1.2 Establish Environmental Secrets Engine**
  - Create a localized, git-ignored `.env` template file containing placeholder values for:
    - `INBOUND_SECRET_TOKEN` (Generated 32-byte cryptographically secure random string)
    - `GROQ_API_KEY` or `GEMINI_API_KEY`
    - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- [ ] **1.3 Construct Base FastAPI App Gateway Wrapper**
  - Target Path: `api/index.py` (Expose application layer instance as `app` to conform with Vercel serverless specifications).
  - Write a root health check endpoint GET `/api/v1/health` returning `{"status": "healthy"}`.
- [ ] **1.4 Architect Stateless Pre-Shared Bearer Security Gate**
  - Target Path: `src/core/security.py`
  - Leverage FastAPI’s native `HTTPBearer` and `HTTPAuthorizationCredentials` dependencies.
  - Implement an asynchronous validator function `async def verify_api_key()` to match headers with `INBOUND_SECRET_TOKEN`.
  - Ensure missing or failing keys raise a strict `HTTP_401_UNAUTHORIZED` exception instantly.

## Phase 2: Schema Boundaries, AI Parsing Engine, & Prompt Engineering
- [ ] **2.1 Define Data Transfer Objects (DTO) via Pydantic v2 Models**
  - Target Path: `src/schemas/transaction.py`
  - Implement a `CategoryEnum` subclassing `str` and `Enum` restricting options exactly to: `["Food", "Transport", "Entertainment", "Bills", "Shopping", "Income", "Miscellaneous"]`.
  - Construct `TransactionWebhook` schema checking incoming fields: `notification_text: str` and `timestamp: datetime`.
  - Construct `CleanTransaction` schema for database insertion matching fields: `merchant_name: str`, `amount: float`, and `category: CategoryEnum`.
- [ ] **2.2 Compile Static `schema.json` Blueprint**
  - Execute a configuration script using Pydantic's `.model_json_schema()` to export types into a root level `schema.json` file for Codex context indexing.
- [ ] **2.3 Build Async AI Client Wrapper with Instructor Layer Integration**
  - Target Path: `src/services/ai_extractor.py`
  - Patch an async OpenAI/Groq or Google client wrapper instance using `instructor.from_openai()` or `instructor.from_gemini()`.
  - Implement `async def extract_transaction_entities(raw_text: str) -> CleanTransaction:` executing structural tool completion calls.
  - Hardcode strict linguistic compiler system instructions ensuring merchant names are cleanly normalized (e.g., mapping `"TIM HORTONS #4920"` cleanly to `"Tim Hortons"`).

## Phase 3: Persistent Data Layer & Idempotency Controls
- [ ] **3.1 Execute Supabase Relational Schema Queries**
  - Access Supabase SQL editor and execute the raw `expenses` data table schema definition:
    - `id` (BIGSERIAL, Primary Key), `created_at` (TIMESTAMPTZ), `merchant_name` (VARCHAR), `amount` (NUMERIC(10,2)), `category` (VARCHAR), `timestamp` (TIMESTAMPTZ).
  - Inject a multi-column composite constraint naming convention rule: `CONSTRAINT unique_transaction_signature UNIQUE (merchant_name, amount, timestamp)`.
- [ ] **3.2 Initialize Persistent Client Connectors**
  - Target Path: `src/core/database.py`
  - Instantiate an async-capable Supabase client connection hook pool utilizing the environment URL and service role execution credentials.
- [ ] **3.3 Connect Ingestion Handlers to Database Operations with Exception Trapping**
  - Target Path: `api/index.py`
  - Bind `Depends(verify_api_key)` directly into the route signature of `POST /api/v1/ingest`.
  - Process inbound notification strings through the `ai_extractor` service layer.
  - Execute a Supabase `.upsert()` operation targeting the clean transaction record.
  - Implement an implicit try/except structure: if an integrity exception hits due to duplicate composite signature block violations, suppress the failure quietly and return an HTTP `200 OK` status back to the smartphone client application.

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