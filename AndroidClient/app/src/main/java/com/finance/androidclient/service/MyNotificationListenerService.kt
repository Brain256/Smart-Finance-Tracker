package com.finance.androidclient.service

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.finance.androidclient.data.AppDatabase
import com.finance.androidclient.data.FailedNotification
import com.finance.androidclient.network.NetworkClient
import com.finance.androidclient.worker.NotificationSyncWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class MyNotificationListenerService : NotificationListenerService() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val packageName = sbn.packageName
        
        // Strictly only allow Google Wallet and ADB Shell for testing
        val allowedPackages = setOf(
            "com.google.android.apps.walletnfcrel", 
            "com.android.shell"
        )
        
        if (!allowedPackages.contains(packageName)) return

        val extras = sbn.notification.extras
        val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
        
        val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_TEXT)
            ?: "").toString()

        // Financial Filter: Ensure there's a dollar sign (optional but prevents noise)
        if (!text.contains("$") && packageName != "com.android.shell") return

        android.util.Log.d("NotificationListener", "Processing from $packageName: Title=\"$title\", Text=\"$text\"")

        val timestamp = sbn.postTime

        val notification = FailedNotification(
            packageName = packageName,
            title = title,
            text = text,
            timestamp = timestamp
        )

        serviceScope.launch {
            val success = NetworkClient.sendNotification(notification)
            if (!success) {
                // Persistent failure, store for later sync
                AppDatabase.getDatabase(applicationContext).notificationDao().insert(notification)
                scheduleSync()
            }
        }
    }

    private fun scheduleSync() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val syncRequest = OneTimeWorkRequestBuilder<NotificationSyncWorker>()
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(applicationContext).enqueue(syncRequest)
    }
}
