package com.finance.androidclient.worker

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.finance.androidclient.data.AppDatabase
import com.finance.androidclient.network.NetworkClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class NotificationSyncWorker(
    context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val database = AppDatabase.getDatabase(applicationContext)
        val dao = database.notificationDao()
        val failedNotifications = dao.getAllFailed()

        var allSuccessful = true
        for (notification in failedNotifications) {
            val success = NetworkClient.sendNotification(notification)
            if (success) {
                dao.delete(notification.id)
            } else {
                allSuccessful = false
            }
        }

        if (allSuccessful) Result.success() else Result.retry()
    }
}
