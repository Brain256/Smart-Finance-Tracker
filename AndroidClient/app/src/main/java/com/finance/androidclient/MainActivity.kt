package com.finance.androidclient

import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.finance.androidclient.service.MyNotificationListenerService

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (!isNotificationServiceEnabled()) {
            Toast.makeText(this, "Please enable Notification Access for Smart Finance Tracker", Toast.LENGTH_LONG).show()
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            startActivity(intent)
        } else {
            Toast.makeText(this, "Notification Service is already active", Toast.LENGTH_SHORT).show()
        }

        // Close the activity immediately as requested (headless behavior)
        finish()
    }

    private fun isNotificationServiceEnabled(): Boolean {
        val pkgName = packageName
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        if (flat != null) {
            val names = flat.split(":")
            for (name in names) {
                val cn = ComponentName.unflattenFromString(name)
                if (cn != null && cn.packageName == pkgName) {
                    return true
                }
            }
        }
        return false
    }
}
