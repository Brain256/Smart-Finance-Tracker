package com.finance.androidclient.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "failed_notifications")
data class FailedNotification(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val packageName: String,
    val title: String,
    val text: String,
    val timestamp: Long
)
