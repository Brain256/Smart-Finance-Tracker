package com.finance.androidclient.network

import com.finance.androidclient.BuildConfig
import com.finance.androidclient.data.FailedNotification
import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object NetworkClient {
    private val BASE_URL = BuildConfig.BASE_URL
    private val API_TOKEN = BuildConfig.API_TOKEN
    private val client = OkHttpClient()
    private val gson = Gson()
    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    data class TransactionWebhook(
        val notification_title: String,
        val notification_text: String,
        val timestamp: String
    )

    fun sendNotification(notification: FailedNotification): Boolean {
        val payload = TransactionWebhook(
            notification_title = notification.title,
            notification_text = notification.text,
            timestamp = isoFormat.format(Date(notification.timestamp))
        )

        val json = gson.toJson(payload)
        val body = json.toRequestBody("application/json; charset=utf-8".toMediaType())
        
        val request = Request.Builder()
            .url("$BASE_URL/api/v1/ingest")
            .post(body)
            .addHeader("Authorization", "Bearer $API_TOKEN")
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                response.isSuccessful
            }
        } catch (e: Exception) {
            false
        }
    }
}
