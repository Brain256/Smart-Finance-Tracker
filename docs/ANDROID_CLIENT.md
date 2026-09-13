# Android Client Setup

The capture layer is a native Kotlin app in
[`AndroidClient/`](../AndroidClient/). A `NotificationListenerService` reads
Google Wallet notifications, POSTs the title, body, and timestamp to
`/api/v1/ingest`, and on failure caches the request in a Room table
(`failed_notifications`) that a `WorkManager` job drains once connectivity
returns.

Application id `com.finance.androidclient`, minimum API 26.

```text
Google Wallet notification
        │
        ▼
MyNotificationListenerService   (title + body + postTime)
        │
        ▼
NetworkClient.sendNotification() ──► POST /api/v1/ingest ──► 202/200 → done
        │
        └── failure (offline / 5xx) → Room cache
                                       └► NotificationSyncWorker (CONNECTED)
```

## 1. Enable Wallet notifications, and know what gets forwarded

Add cards to Google Wallet, make it the default tap-to-pay app, and confirm
purchase notifications are enabled both in Wallet's settings and in Android's
notification settings. Make a tap-to-pay purchase and check that a notification
appears naming the merchant and amount — that title/body pair is exactly what
gets forwarded.

The listener is preconfigured for Wallet, so no code edit is required:

```kotlin
val allowedPackages = setOf(
    "com.google.android.apps.walletnfcrel",
    "com.android.shell"   // kept for adb-driven testing
)
```

Other packages are ignored, and any notification whose text lacks `$` is skipped
as noise. To also forward a bank app's alerts, add its package name (find it with
`adb shell pm list packages`) to that set in
[`MyNotificationListenerService.kt`](../AndroidClient/app/src/main/java/com/finance/androidclient/service/MyNotificationListenerService.kt).
Be aware Wallet and a bank app will both announce the same purchase, and the
ingestion upsert only dedupes on an exact merchant/amount/timestamp match, which
two different wordings generally will not produce.

## 2. Configure the endpoint and token

`BASE_URL` and `API_TOKEN` compile in as `BuildConfig` fields, read from
environment variables or Gradle properties. Keep them out of version control —
simplest is `~/.gradle/gradle.properties`:

```properties
BASE_URL=https://your-vercel-domain.vercel.app
API_TOKEN=YOUR_INBOUND_SECRET_TOKEN
```

`API_TOKEN` must match the backend's `INBOUND_SECRET_TOKEN` exactly, and
`BASE_URL` must not end with a slash — the client appends `/api/v1/ingest`.

## 3. Build, install, grant access

Open `AndroidClient` in Android Studio and hit Run, or:

```powershell
cd AndroidClient
.\gradlew.bat :app:installDebug
```

If Gradle cannot find Java, point it at the Android Studio JDK:
`$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"`.

The app is headless. Launching it opens the system **Notification access**
screen and closes; toggle access on for this app. Android requires this grant
before the listener receives anything.

## 4. Verify end to end

Trigger a matching notification. The backend responds `202 Accepted` for a new
transaction or `200 OK` for a duplicate retry, and a row appears in Supabase.

To check the offline path: enable airplane mode, trigger a notification (the POST
fails and the request lands in `failed_notifications`), then restore
connectivity — `NotificationSyncWorker` drains the cache and the transaction
reaches Supabase. Android Studio's **App Inspection → Database Inspector** shows
the local table live.

## Local network testing

To point the phone at a laptop on the same Wi-Fi, bind Uvicorn to all
interfaces:

```powershell
python -m uvicorn api.index:app --host 0.0.0.0 --port 8000 --reload
```

Use the machine's LAN IPv4 address from `ipconfig`, e.g.
`http://192.168.1.25:8000`. Do not use `127.0.0.1` or `localhost` — on the phone
those resolve to the phone.

Android blocks cleartext HTTP by default, so LAN testing over `http://` also
needs `android:usesCleartextTraffic="true"` temporarily added to the
`<application>` tag in
[`AndroidManifest.xml`](../AndroidClient/app/src/main/AndroidManifest.xml), plus
a firewall rule allowing the Python process. Production over HTTPS works as-is.

## Troubleshooting

- **Nothing captured:** notification access not granted, or the source package
  is not in `allowedPackages`.
- **HTTP 401:** `API_TOKEN` does not match `INBOUND_SECRET_TOKEN`.
- **HTTP 422:** malformed payload; should not happen with the stock client.
