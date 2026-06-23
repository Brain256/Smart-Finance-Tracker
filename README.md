# Smart Finance Tracker

Smart Finance Tracker is a FastAPI ingestion pipeline for banking push
notifications. It accepts authenticated MacroDroid webhook payloads, validates
their shape with Pydantic, extracts clean transaction data through an
Instructor/Groq AI layer, and stores idempotent records in Supabase Postgres.

## Current Functionality

- `GET /api/v1/health`
  - Returns `{"status": "healthy"}` when the API is reachable.
- `POST /api/v1/ingest`
  - Requires `Authorization: Bearer <INBOUND_SECRET_TOKEN>`.
  - Accepts this payload shape:
    ```json
    {
      "notification_text": "BMO Credit Card: Approved $14.50 at Tim Hortons",
      "timestamp": "1782057637417"
    }
    ```
  - `timestamp` may be an ISO 8601 datetime, a Unix timestamp in seconds, or a
    Unix timestamp in milliseconds.
  - Extracts a `merchant_name`, `amount`, and strict `category`.
  - Upserts the clean transaction into Supabase table `expenses`.
  - Returns HTTP `202 Accepted` when a transaction is processed and stored.
  - Returns HTTP `200 OK` if a duplicate transaction collision is treated as a
    successful retry.
  - Logs extracted transaction JSON in the Uvicorn server terminal.

Successful response shape:

```json
{
  "status": "accepted",
  "timestamp": "2026-06-17T20:55:00Z",
  "transaction": {
    "merchant_name": "Tim Hortons",
    "amount": 14.5,
    "category": "Food"
  }
}
```

## Local Setup

Create and activate a virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Install runtime and test dependencies:

```powershell
python -m pip install -e .[dev]
```

Create your local environment file:

```powershell
Copy-Item .env.example .env
```

Generate a strong inbound token:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Paste that value into `.env`:

```text
INBOUND_SECRET_TOKEN=your-generated-token
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=llama-3.3-70b-versatile
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

`GROQ_MODEL` is optional; the app defaults to `llama-3.3-70b-versatile`.

## Supabase Setup

Create a Supabase project, then configure the `expenses` table.

1. Open your Supabase project dashboard.
2. Go to **SQL Editor**.
3. Run the SQL in [supabase/expenses.sql](supabase/expenses.sql):

```sql
create table if not exists public.expenses (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  merchant_name varchar not null,
  amount numeric(10, 2) not null,
  category varchar not null,
  timestamp timestamptz not null,
  constraint unique_transaction_signature unique (
    merchant_name,
    amount,
    timestamp
  )
);
```

4. Go to **Project Settings -> API**.
5. Copy the **Project URL** into `.env` as `SUPABASE_URL`.
6. Copy the **service_role** key into `.env` as
   `SUPABASE_SERVICE_ROLE_KEY`.

Keep the service role key private. It bypasses row-level security and should
only be used by this backend server, never by a frontend client or MacroDroid.

The unique constraint on `(merchant_name, amount, timestamp)` is what makes
phone retry delivery idempotent.

Start the API locally:

```powershell
python -m uvicorn api.index:app --reload
```

For phone-to-laptop testing over the same Wi-Fi network, bind the server to all
local interfaces instead:

```powershell
python -m uvicorn api.index:app --host 0.0.0.0 --port 8000 --reload
```

Then find your computer's LAN IP:

```powershell
ipconfig
```

Use the IPv4 address on your Wi-Fi adapter, for example:

```text
http://192.168.1.25:8000/api/v1/ingest
```

Do not use `127.0.0.1` or `localhost` from MacroDroid. On the phone, those
addresses point back to the phone, not your computer.

## Automated Tests

Run the regression suite:

```powershell
python -m pytest
```

Expected result:

```text
18 passed
```

The suite verifies health checks, bearer-token rejection, invalid payload
rejection, timezone validation, Unix timestamp normalization, AI extraction
service calls, DTO validation, Supabase upsert payloads, duplicate collision
handling, and valid ingestion acceptance.

The automated tests mock Groq and Supabase, so they do not require network
access or real API keys.

## Manual Local Verification

Start the API:

```powershell
python -m uvicorn api.index:app --reload
```

Send a test request:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/api/v1/ingest" `
  -Method Post `
  -Headers @{ Authorization = "Bearer YOUR_INBOUND_SECRET_TOKEN" } `
  -ContentType "application/json" `
  -Body '{
    "notification_text": "BMO Credit Card: Approved $14.50 at TIM HORTONS #4920",
    "timestamp": "2026-06-17T20:55:00Z"
  }'
```

The Uvicorn terminal should log a normalized transaction:

```text
Extracted transaction: {"merchant_name":"Tim Hortons","amount":14.5,"category":"Food"}
```

Then open Supabase **Table Editor -> expenses** and confirm a row was inserted.

## MacroDroid Setup

### 1. Enable BMO Notifications

On your Android phone:

1. Install and sign in to the BMO mobile app.
2. Enable card transaction alerts inside the BMO app.
3. In Android settings, allow notifications from BMO.
4. Confirm a real transaction notification appears on the phone.

The notification should contain useful transaction text, such as:

```text
BMO Credit Card: Approved $14.50 at Tim Hortons
```

### 2. Give MacroDroid Notification Access

On Android:

1. Open **Settings**.
2. Search for **Notification access**.
3. Enable notification access for **MacroDroid**.

MacroDroid needs this permission so it can read the BMO notification title/body.

### 3. Create The Macro

In MacroDroid:

1. Tap **Add Macro**.
2. Add a trigger:
   ```text
   Triggers -> Device Events -> Notification -> Notification Received
   ```
3. Select the BMO app as the notification source.
4. If MacroDroid offers text filtering, start broad:
   ```text
   Contains: BMO
   ```
   or:
   ```text
   Contains: Approved
   ```

Keep the filter broad at first, then tighten it after you see the real BMO
notification format.

### 4. Add The HTTP POST Action

Add an action:

```text
Actions -> Web Interactions -> HTTP Request
```

Configure it as:

```text
Method: POST
Content-Type: application/json
```

Use one of these URLs:

```text
https://your-vercel-domain.vercel.app/api/v1/ingest
```

or, for same-Wi-Fi local testing:

```text
http://YOUR_COMPUTER_IPV4:8000/api/v1/ingest
```

Add this header:

```http
Authorization: Bearer YOUR_INBOUND_SECRET_TOKEN
```

Set the request body to JSON:

```json
{
  "notification_text": "[not_text]",
  "timestamp": "[not_timestamp]"
}
```

Use MacroDroid's **Magic Text** picker to replace `[not_text]` with the actual
notification body variable for your version of MacroDroid. The exact name may be
shown as notification text, notification body, notification content, or similar.

Use MacroDroid's **Magic Text** picker to replace `[not_timestamp]` with the
notification timestamp value. MacroDroid may emit this as Unix milliseconds:

```text
1782057637417
```

or Unix seconds:

```text
1782057883
```

The backend accepts both formats and normalizes them into a UTC datetime. As a
rule of thumb, 13 digits means milliseconds and 10 digits means seconds.

The backend also accepts ISO 8601 timezone-aware timestamps, such as
`2026-06-17T20:55:00Z`. A value like `2026-06-17T20:55:00` will still be
rejected because it has no timezone.

### 5. Debug MacroDroid Before Using Real Purchases

Add a temporary MacroDroid action before the HTTP request:

```text
Actions -> Device Actions -> Display Notification
```

Set the debug notification body to the same notification magic text you plan to
send:

```text
Captured: [not_text]
```

Trigger the macro and confirm the displayed text contains the transaction
message you expect.

### 6. Confirm The End-To-End Result

When MacroDroid sends a valid request, the API should respond with HTTP
`202 Accepted` for a newly stored transaction, or `200 OK` for a duplicate retry:

```json
{
  "status": "accepted",
  "timestamp": "2026-06-21T16:00:37.417000Z",
  "transaction": {
    "merchant_name": "Tim Hortons",
    "amount": 14.5,
    "category": "Food"
  }
}
```

If it fails:

- HTTP `401` means the bearer token is missing or wrong.
- HTTP `422` means the JSON body does not match the required schema.
- HTTP `500` usually means Groq or Supabase configuration is missing or invalid.
- A connection error usually means the phone cannot reach the server URL.

For local testing, make sure:

- The phone and computer are on the same Wi-Fi network.
- Uvicorn is running with `--host 0.0.0.0`.
- Windows Firewall allows the Python/Uvicorn process.
- MacroDroid is using the computer's LAN IP, not `localhost`.
- `.env` contains valid `GROQ_API_KEY`, `SUPABASE_URL`, and
  `SUPABASE_SERVICE_ROLE_KEY` values.
