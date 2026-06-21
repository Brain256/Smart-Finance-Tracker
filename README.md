# Smart Finance Tracker

Smart Finance Tracker is a FastAPI ingestion gateway for banking push
notifications. In Phase 1, the API accepts authenticated MacroDroid webhook
payloads, validates their shape with Pydantic, and returns an acceptance
response. Later phases will add AI extraction, Supabase persistence, and a
dashboard.

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
  - Returns HTTP `202 Accepted` when the token and payload are valid.

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
```

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

Run the Phase 1 regression suite:

```powershell
python -m pytest
```

Expected result:

```text
6 passed
```

The suite verifies health checks, bearer-token rejection, invalid payload
rejection, timezone validation, Unix timestamp normalization, and valid
ingestion acceptance.

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
`202 Accepted`:

```json
{
  "status": "accepted",
  "timestamp": "2026-06-21T16:00:37.417000Z"
}
```

If it fails:

- HTTP `401` means the bearer token is missing or wrong.
- HTTP `422` means the JSON body does not match the required schema.
- A connection error usually means the phone cannot reach the server URL.

For local testing, make sure:

- The phone and computer are on the same Wi-Fi network.
- Uvicorn is running with `--host 0.0.0.0`.
- Windows Firewall allows the Python/Uvicorn process.
- MacroDroid is using the computer's LAN IP, not `localhost`.
