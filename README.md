# Smart Finance Tracker

Smart Finance Tracker is a FastAPI ingestion pipeline for banking push
notifications. It accepts authenticated webhook payloads from a companion native
Android client app (`AndroidClient/`), validates their shape with Pydantic,
extracts clean transaction data through an Instructor/Groq AI layer, and stores
idempotent records in Supabase Postgres.

> **Note:** The capture layer is now the custom Android client in
> [`AndroidClient/`](AndroidClient/). The previous MacroDroid-based setup is
> deprecated and has been replaced — see [Android Client Setup](#android-client-setup).

## Current Functionality

- `GET /api/v1/health`
  - Returns `{"status": "healthy"}` when the API is reachable.
- `POST /api/v1/ingest`
  - Requires `Authorization: Bearer <INBOUND_SECRET_TOKEN>`.
  - Accepts this payload shape:
    ```json
    {
      "notification_title": "Tim Hortons",
      "notification_text": "BMO Credit Card ending in 1234: Approved $14.50",
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
- `GET /dashboard`
  - Displays a private Next.js dashboard for stored Supabase transactions.
  - Protected by Auth.js Google OAuth and an `AUTH_ALLOWED_EMAIL` allowlist.
  - Shows spending totals for today, this week, and this month.
  - Includes overview, calendar, and transactions tabs.
  - Renders pie charts for spending by merchant/location and category.
  - Provides sortable transaction columns for date, merchant, category, and amount.

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
AUTH_SECRET=your-generated-auth-secret
AUTH_GOOGLE_ID=your-google-oauth-client-id
AUTH_GOOGLE_SECRET=your-google-oauth-client-secret
AUTH_ALLOWED_EMAIL=your.email@gmail.com
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

`GROQ_MODEL` is optional; the app defaults to `llama-3.3-70b-versatile`.
`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and
`AUTH_ALLOWED_EMAIL` protect the dashboard login and should be set locally and
in Vercel Project Settings. Generate `AUTH_SECRET` with:

```powershell
npx auth secret
```

In Google Cloud Console, configure this authorized redirect URI for production:

```text
https://your-vercel-domain.vercel.app/api/auth/callback/google
```

For local OAuth testing, add:

```text
http://localhost:3000/api/auth/callback/google
```

Install frontend dependencies:

```powershell
npm.cmd install
```

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
only be used by this backend server, never by a frontend client or the Android
app. The Next.js dashboard uses that key only in server-side code.

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

Do not use `127.0.0.1` or `localhost` from the Android client. On the phone,
those addresses point back to the phone, not your computer.

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

Start the dashboard locally:

```powershell
npm.cmd run dev
```

Then open:

```text
http://localhost:3000/dashboard
```

If Supabase service credentials are not configured, the dashboard can still
render with sample transactions for layout verification. `/dashboard` is
protected by Google OAuth when `AUTH_SECRET`, `AUTH_GOOGLE_ID`,
`AUTH_GOOGLE_SECRET`, and `AUTH_ALLOWED_EMAIL` are configured.

Send a test request:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/api/v1/ingest" `
  -Method Post `
  -Headers @{ Authorization = "Bearer YOUR_INBOUND_SECRET_TOKEN" } `
  -ContentType "application/json" `
  -Body '{
    "notification_title": "TIM HORTONS #4920",
    "notification_text": "BMO Credit Card ending in 1234: Approved $14.50",
    "timestamp": "2026-06-17T20:55:00Z"
  }'
```

The Uvicorn terminal should log a normalized transaction:

```text
Extracted transaction: {"merchant_name":"Tim Hortons","amount":14.5,"category":"Food"}
```

Then open Supabase **Table Editor -> expenses** and confirm a row was inserted.

## Android Client Setup

The capture layer is a native Kotlin Android app in
[`AndroidClient/`](AndroidClient/) that replaces MacroDroid. It:

- Runs a `NotificationListenerService` that reads posted notifications from your
  bank/payment app.
- Extracts the notification title, body, and timestamp and POSTs them to
  `/api/v1/ingest` with the `Authorization: Bearer <token>` header.
- On a failed POST (no internet, server error), caches the request in a local
  SQLite (Room) table `failed_notifications`.
- Retries cached requests automatically once connectivity is restored, via a
  `WorkManager` job constrained to `NetworkType.CONNECTED`.

Application id: `com.finance.androidclient`. Minimum Android version: API 26.

### Architecture

```
Bank/Wallet notification
        │
        ▼
MyNotificationListenerService   (reads title + body + postTime)
        │
        ▼
NetworkClient.sendNotification() ──► POST /api/v1/ingest  ──► 202/200  → done
        │
        └── failure (offline / 5xx) → Room cache (failed_notifications)
                                       └► NotificationSyncWorker (CONNECTED)
                                          drains the cache when internet returns
```

### 1. Enable Bank Notifications On The Phone

1. Install and sign in to your bank/payment app (e.g. BMO, Google Wallet).
2. Enable card transaction alerts inside that app.
3. In Android settings, allow notifications from that app.
4. Confirm a real transaction notification appears, for example:

   ```text
   Title: Tim Hortons
   Body: BMO Credit Card ending in 1234: Approved $14.50
   ```

### 2. Choose Which App's Notifications To Forward

Open
[`AndroidClient/app/src/main/java/com/finance/androidclient/service/MyNotificationListenerService.kt`](AndroidClient/app/src/main/java/com/finance/androidclient/service/MyNotificationListenerService.kt)
and edit the `allowedPackages` set to include your bank app's package name:

```kotlin
val allowedPackages = setOf(
    "com.google.android.apps.walletnfcrel", // Google Wallet
    "com.android.shell"                     // adb-driven test notifications
    // add your bank app package, e.g. "com.bmo.mobile.banking"
)
```

To find an app's exact package name, run `adb shell pm list packages` (or use an
app-info viewer). Notifications from any package not in this set are ignored. The
listener also skips any notification whose text does not contain `$` (except
`com.android.shell`, kept for testing).

### 3. Configure The Endpoint And Token

`BASE_URL` and `API_TOKEN` are compiled into the app as `BuildConfig` fields.
The build reads them from environment variables **or** Gradle properties, so put
them where they stay out of version control — the simplest is your user-level
Gradle properties file at `~/.gradle/gradle.properties`:

```properties
BASE_URL=https://your-vercel-domain.vercel.app
API_TOKEN=YOUR_INBOUND_SECRET_TOKEN
```

Notes:

- `API_TOKEN` must exactly match `INBOUND_SECRET_TOKEN` from the backend `.env`.
- `BASE_URL` must **not** end with a slash; the client appends `/api/v1/ingest`.
- For same-Wi-Fi local testing, use your computer's LAN IP, e.g.
  `http://192.168.1.25:8000` (see the local-testing note below about cleartext).

### 4. Build And Install

Open the `AndroidClient` folder in Android Studio and click **Run**, or build
from the command line (Android Studio's bundled JDK works well):

```powershell
cd AndroidClient
.\gradlew.bat :app:installDebug
```

If Gradle reports it cannot find Java, point `JAVA_HOME` at the Android Studio
JDK first, for example:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

### 5. Grant Notification Access

Launch the app once. It is headless: it opens the system **Notification access**
screen and then closes. Toggle access **on** for this app. Android needs this
special grant before the listener receives any notifications.

To verify it later: **Settings -> Notification access** should show this app
enabled.

### 6. Confirm The End-To-End Result

Trigger a matching transaction notification. On success the backend responds
`202 Accepted` (new) or `200 OK` (duplicate retry), and a row appears in Supabase
**Table Editor -> expenses**.

To verify the offline fallback:

1. Put the phone in airplane mode.
2. Trigger a matching notification. The POST fails and the request is stored in
   the `failed_notifications` table.
3. Turn connectivity back on. `NotificationSyncWorker` runs and drains the cache;
   the row disappears and the transaction lands in Supabase.

You can inspect the local SQLite table live with Android Studio's
**App Inspection -> Database Inspector** while the app is running.

### Troubleshooting

- **Nothing is captured:** notification access is not granted, or the source
  app's package is not in `allowedPackages`.
- **HTTP `401`:** `API_TOKEN` does not match the backend `INBOUND_SECRET_TOKEN`.
- **HTTP `422`:** the payload shape is wrong (should not happen with the stock
  client).
- **Offline items never send / the cache never fills:** confirm the Room KSP
  wiring is intact — `app/build.gradle.kts` must apply the `kotlin.android` and
  `ksp` plugins and use `ksp(libs.room.compiler)` (not `annotationProcessor`),
  otherwise the database classes are not generated and the offline insert fails.
- **Local (`http://`) testing does nothing:** Android blocks cleartext HTTP by
  default. Production Vercel uses HTTPS and works as-is. For LAN `http://`
  testing only, temporarily add `android:usesCleartextTraffic="true"` to the
  `<application>` tag in
  [`AndroidClient/app/src/main/AndroidManifest.xml`](AndroidClient/app/src/main/AndroidManifest.xml),
  and make sure the phone and computer share a Wi-Fi network, Uvicorn runs with
  `--host 0.0.0.0`, and Windows Firewall allows the Python process.
