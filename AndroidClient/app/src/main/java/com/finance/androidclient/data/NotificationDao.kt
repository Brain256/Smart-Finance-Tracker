package com.finance.androidclient.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface NotificationDao {
    @Insert
    suspend fun insert(notification: FailedNotification)

    @Query("SELECT * FROM failed_notifications")
    suspend fun getAllFailed(): List<FailedNotification>

    @Query("DELETE FROM failed_notifications WHERE id = :id")
    suspend fun delete(id: Long)
}
