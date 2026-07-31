# Android Client Setup

The capture layer is a native Kotlin Android app in
[`AndroidClient/`](../AndroidClient/). It:

- Runs a `NotificationListenerService` that reads posted notifications from
  Google Wallet (`com.google.android.apps.walletnfcrel`), which announces every
  tap-to-pay transaction across the cards added to the wallet.
- Extracts the notification title, body, and timestamp and POSTs them to
  `/api/v1/ingest` with the `Authorization: Bearer <token>` header.
- On a failed POST (no internet, server error), caches the request in a local
  SQLite (Room) table `failed_notifications`.
- Retries cached requests automatically once connectivity is restored, via a
  `WorkManager` job constrained to `NetworkType.CONNECTED`.

Application id: `com.finance.androidclient`. Minimum Android version: API 26.

## Architecture

```text
Google Wallet notification
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

## 1. Enable Google Wallet notifications on the phone

1. Add your cards to Google Wallet and make it the default tap-to-pay app.
2. In Wallet's settings, make sure purchase/transaction notifications are on.
3. In Android settings, allow notifications from Google Wallet.
4. Make a tap-to-pay purchase and confirm a notification appears naming the
   merchant and the amount. That title/body pair is exactly what gets forwarded.

## 2. Which notifications get forwarded

The listener is already configured for Google Wallet — no edit required:

```kotlin
// Strictly only allow Google Wallet and ADB Shell for testing
val allowedPackages = setOf(
    "com.google.android.apps.walletnfcrel",
    "com.android.shell"
)
```

Notifications from any other package are ignored, and any notification whose text
does not contain `$` is skipped as noise (except `com.android.shell`, kept for
adb-driven testing).

To forward a bank app's own alerts in addition to Wallet, add its package name to
that set in
[`MyNotificationListenerService.kt`](../AndroidClient/app/src/main/java/com/finance/androidclient/service/MyNotificationListenerService.kt).
Find the exact name with `adb shell pm list packages`. Be aware that Wallet and a
bank app will both announce the same purchase; the ingestion upsert dedupes only
when merchant, amount, and timestamp match exactly, which two different wordings
of the same transaction generally will not.

## 3. Configure the endpoint and token

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
  `http://192.168.1.25:8000` (see [local network testing](#local-network-testing)
  below about cleartext HTTP).

## 4. Build and install

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

## 5. Grant notification access

Launch the app once. It is headless: it opens the system **Notification access**
screen and then closes. Toggle access **on** for this app. Android needs this
special grant before the listener receives any notifications.

To verify it later: **Settings -> Notification access** should show this app
enabled.

## 6. Confirm the end-to-end result

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

## Local network testing

To point the phone at a laptop running the API on the same Wi-Fi network, bind
Uvicorn to all local interfaces:

```powershell
python -m uvicorn api.index:app --host 0.0.0.0 --port 8000 --reload
```

Find your computer's LAN IP with `ipconfig` and use the IPv4 address on your
Wi-Fi adapter, for example `http://192.168.1.25:8000`.

Do not use `127.0.0.1` or `localhost` from the Android client. On the phone,
those addresses point back to the phone, not your computer.

## Troubleshooting

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
  [`AndroidClient/app/src/main/AndroidManifest.xml`](../AndroidClient/app/src/main/AndroidManifest.xml),
  and make sure the phone and computer share a Wi-Fi network, Uvicorn runs with
  `--host 0.0.0.0`, and Windows Firewall allows the Python process.
