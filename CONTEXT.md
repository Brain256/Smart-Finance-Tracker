# Product Context: Smart Bank Transaction Tracker (Personal OS)

## 1. System Core Intent
An event-driven, low-latency transaction ingestion pipeline that intercepts real-time banking push notifications from a physical Android device, extracts structured financial entities using high-speed AI inference, and commits the records into an idempotent relational database state.

---

## 2. Comprehensive System Architecture & Lifecycle

The entire lifecycle of a transaction execution maps out through four clear architectural phases:



### Phase 1: Mobile Interception (Android Hardware)
- **Source:** User makes a purchase using a physical BMO Credit or Debit Card. 
- **Trigger:** The BMO Mobile App pushes a native notification to the Android OS banner system.
- **Capture:** MacroDroid detects the notification event, extracts the notification title and body text, and initiates an asynchronous HTTP POST request to the cloud gateway.

### Phase 2: Gateway Ingest & Security Gate (FastAPI Serverless)
- **Endpoint:** Hosted publicly at `/api/v1/ingest` via Vercel Serverless.
- **Security Guard:** A strict pre-shared static Bearer Token validation layer interceptor blocks execution unless an identical token matches the environment configuration.
- **Validation:** Raw JSON is immediately dropped into a Pydantic v2 engine to assert format conformity, dropping broken or malicious data blobs before processing.

### Phase 3: AI Inference & Entity Normalization (Groq LPU Engine)
- **Transmission:** The FastAPI server packages the notification title/body pair and streams it via an OpenAI-compatible SDK call to Groq's high-speed Llama-3 compiler instances.
- **Extraction:** The AI forces structured JSON mapping using the `instructor` library to output strict schemas:
  - `merchant_name`: Normalized string from the notification title (e.g., "Tim Hortons", not "TIM HORTONS #4920").
  - `amount`: Floating numeric value representing the localized dollar amount from the notification body.
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
  "notification_title": "Tim Hortons",
  "notification_text": "BMO Credit Card ending in 1234: Approved $14.50",
  "timestamp": "1782057637417"
}
```

`timestamp` accepts any of the following formats:
- ISO 8601 timezone-aware datetime string, e.g. `"2026-06-17T20:55:00Z"`.
- Unix timestamp in seconds, e.g. `"1782057883"`.
- Unix timestamp in milliseconds, e.g. `"1782057637417"`.

The ingestion schema normalizes all accepted timestamp formats into a
timezone-aware UTC datetime before downstream processing.
