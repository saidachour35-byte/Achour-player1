package com.achour.player

import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * JavaScript Bridge for Achour Player
 * Connects React Frontend to Native Android Media3 (ExoPlayer)
 */
class AchourNativeInterface(private val context: Context) {

    @JavascriptInterface
    fun playMedia(url: String, metadataJson: String) {
        try {
            val intent = Intent(context, PlayerActivity::class.java).apply {
                putExtra("STREAM_URL", url)
                putExtra("METADATA", metadataJson)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @JavascriptInterface
    fun toggleFavorite(streamId: String, isFavorite: Boolean) {
        // This is a placeholder for the native side to notify the WebView if needed
        // but typically we'll call a JS function from the Native Activity.
    }

    @JavascriptInterface
    fun getAppVersion(): String {
        return "1.0.0-media3-native"
    }
}
