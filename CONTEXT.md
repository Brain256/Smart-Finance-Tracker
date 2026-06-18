# Product Context: Smart Bank Transaction Tracker (Personal OS)

## 1. System Core Intent
An event-driven, low-latency transaction ingestion pipeline that intercepts real-time banking push notifications from a physical Android device, extracts structured financial entities using high-speed AI inference, and commits the records into an idempotent relational database state.

---

## 2. Comprehensive System Architecture & Lifecycle

The entire lifecycle of a transaction execution maps out through four clear architectural phases:



### Phase 1: Mobile Interception (Android Hardware)
- **Source:** User makes a purchase using a physical BMO Credit or Debit Card. 
- **Trigger:** The BMO Mobile App pushes a native notification to the Android OS banner system.
- **Capture:** MacroDroid detects the notification event, extracts the raw string text content body, and initiates an asynchronous HTTP POST request to the cloud gateway.

### Phase 2: Gateway Ingest & Security Gate (FastAPI Serverless)
- **Endpoint:** Hosted publicly at `/api/v1/ingest` via Vercel Serverless.
- **Security Guard:** A strict pre-shared static Bearer Token validation layer interceptor blocks execution unless an identical token matches the environment configuration.
- **Validation:** Raw JSON is immediately dropped into a Pydantic v2 engine to assert format conformity, dropping broken or malicious data blobs before processing.

### Phase 3: AI Inference & Entity Normalization (Groq LPU Engine)
- **Transmission:** The FastAPI server packages the unstructured text string and streams it via an OpenAI-compatible SDK call to Groq's high-speed Llama-3 compiler instances.
- **Extraction:** The AI forces structured JSON mapping using the `instructor` library to output strict schemas:
  - `merchant_name`: Normalized string (e.g., "Tim Hortons", not "TIM HORTONS #4920").
  - `amount`: Floating numeric value representing the localized dollar amount.
  - `category`: Strict categorical value matched directly to a predefined system enum.

### Phase 4: Storage Tier Commit (Supabase PostgreSQL)
- **Persistence:** The structured record object transfers to a permanent Postgres cluster.
- **Idempotency Guard:** An `UPSERT` operation executes against a composite unique index constraint defined as `(merchant_name, amount, timestamp)`. 
- **Conflict Handling:** If duplicate notifications hit the server due to cellular retries, the database drops the duplicate without modifying historical charts.

---

## 3. Explicit Data Contracts (JSON Layouts)

Codex must strictly follow these schemas when building inputs and outputs. No variations or extra fields are permitted.

### Inbound Ingestion Payload (From Phone to Webhook)
```json
{
  "notification_text": "BMO Credit Card: Approved $14.50 at Tim Hortons",
  "timestamp": "2026-06-17T20:55:00Z"
}