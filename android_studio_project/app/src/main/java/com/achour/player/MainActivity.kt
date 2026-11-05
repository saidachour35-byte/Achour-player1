package com.achour.player

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Use a simple layout with a WebView
        webView = WebView(this)
        setContentView(webView)

        // Configure WebView settings
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.allowFileAccessFromFileURLs = true
        settings.allowUniversalAccessFromFileURLs = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.userAgentString = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 AchourPlayer/1.0"

        // Add Javascript Interface
        webView.addJavascriptInterface(AchourNativeInterface(this), "AchourNative")

        webView.webChromeClient = object : android.webkit.WebChromeClient() {
            private var customView: View? = null
            private var customViewCallback: CustomViewCallback? = null

            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (customView != null) {
                    onHideCustomView()
                    return
                }
                customView = view
                customViewCallback = callback
                (window.decorView as android.view.ViewGroup).addView(customView, android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT))
                webView.visibility = View.GONE
                
                // Ensure fullscreen for custom view
                window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
            }

            override fun onHideCustomView() {
                (window.decorView as android.view.ViewGroup).removeView(customView)
                customView = null
                customViewCallback?.onCustomViewHidden()
                webView.visibility = View.VISIBLE
                
                // Restore system UI
                window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): android.webkit.WebResourceResponse? {
                val url = request?.url?.toString() ?: return null
                if (url.contains("/api/proxy/") || url.contains("native.achour.proxy")) {
                    val response = handleProxyRequest(url)
                    if (response != null) return response
                }
                return super.shouldInterceptRequest(view, request)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // Inject CSS to ensure focus visibility on TV if needed
                view?.loadUrl("javascript:(function() { " +
                        "var style = document.createElement('style');" +
                        "style.innerHTML = ':focus { outline: 4px solid var(--theme-primary, #D4AF37) !important; box-shadow: 0 0 20px var(--theme-primary, #D4AF37) !important; }';" +
                        "document.head.appendChild(style);" +
                        "})()")
            }
        }

        // Set system UI to immersive for better TV/Phone experience
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)

        // Load the local React app
        webView.loadUrl("file:///android_asset/www/index.html")
    }

    private fun handleProxyRequest(urlStr: String): android.webkit.WebResourceResponse? {
        try {
            val uri = android.net.Uri.parse(urlStr)
            var targetUrlStr = uri.getQueryParameter("url")
            if (targetUrlStr.isNullOrEmpty()) {
                targetUrlStr = uri.getQueryParameter("portal") ?: uri.getQueryParameter("host")
            }
            if (targetUrlStr.isNullOrEmpty()) return null

            var sanitizedUrl = targetUrlStr.trim()
            if (!sanitizedUrl.startsWith("http://") && !sanitizedUrl.startsWith("https://")) {
                sanitizedUrl = "http://$sanitizedUrl"
            }

            val pathType = uri.pathSegments.lastOrNull() ?: "get"
            var finalUrl = sanitizedUrl

            if (pathType == "xtream") {
                var host = sanitizedUrl.replace(Regex("/+(player_api|get|index)\\.php.*$", RegexOption.IGNORE_CASE), "")
                    .replace(Regex("/c/?$", RegexOption.IGNORE_CASE), "")
                    .replace(Regex("\\?.*$"), "")
                    .replace(Regex("/+$"), "")

                val username = uri.getQueryParameter("username") ?: ""
                val password = uri.getQueryParameter("password") ?: ""
                val action = uri.getQueryParameter("action") ?: ""

                var fullTarget = "$host/player_api.php?username=${java.net.URLEncoder.encode(username, "UTF-8")}&password=${java.net.URLEncoder.encode(password, "UTF-8")}"
                if (action.isNotEmpty() && action != "auth" && action != "login") {
                    fullTarget += "&action=${java.net.URLEncoder.encode(action, "UTF-8")}"
                }

                for (paramName in uri.queryParameterNames) {
                    if (paramName != "url" && paramName != "portal" && paramName != "host" && paramName != "username" && paramName != "password" && paramName != "action") {
                        val valStr = uri.getQueryParameter(paramName)
                        if (!valStr.isNullOrEmpty()) {
                            fullTarget += "&$paramName=${java.net.URLEncoder.encode(valStr, "UTF-8")}"
                        }
                    }
                }
                finalUrl = fullTarget
            } else if (pathType == "m3u" || pathType == "get") {
                val queryParams = mutableListOf<String>()
                for (paramName in uri.queryParameterNames) {
                    if (paramName != "url" && paramName != "portal") {
                        val valStr = uri.getQueryParameter(paramName)
                        if (!valStr.isNullOrEmpty()) {
                            queryParams.add("$paramName=${java.net.URLEncoder.encode(valStr, "UTF-8")}")
                        }
                    }
                }
                if (queryParams.isNotEmpty()) {
                    val connChar = if (finalUrl.contains("?")) "&" else "?"
                    finalUrl += connChar + queryParams.joinToString("&")
                }
            } else if (pathType == "stalker") {
                var host = sanitizedUrl.replace(Regex("/+$"), "")
                if (!host.contains("/server/load.php") && !host.contains("load.php")) {
                    host = "$host/server/load.php"
                }
                val action = uri.getQueryParameter("action") ?: "handshake"
                val typeParam = uri.getQueryParameter("type") ?: if (action == "handshake" || action == "get_profile") "stb" else "itv"
                finalUrl = "$host?type=$typeParam&action=$action"
            }

            // Connect with max 5 redirects
            var currUrlStr = finalUrl
            var redirects = 0
            var conn: java.net.HttpURLConnection? = null

            while (redirects < 5) {
                val targetURL = java.net.URL(currUrlStr)
                conn = targetURL.openConnection() as java.net.HttpURLConnection
                conn.instanceFollowRedirects = false
                conn.requestMethod = "GET"
                conn.connectTimeout = 30000
                conn.readTimeout = 30000
                conn.setRequestProperty("User-Agent", "IPTVSmartersPro/2.2.1 (Linux; Android 11)")
                conn.setRequestProperty("Accept", "application/json, text/plain, */*")
                conn.setRequestProperty("Accept-Encoding", "gzip, deflate")
                conn.setRequestProperty("Connection", "keep-alive")
                conn.connect()

                val statusCode = conn.responseCode
                if (statusCode in 301..308) {
                    val loc = conn.getHeaderField("Location")
                    if (!loc.isNullOrEmpty()) {
                        currUrlStr = if (loc.startsWith("http://") || loc.startsWith("https://")) loc else java.net.URL(targetURL, loc).toString()
                        redirects++
                        continue
                    }
                }
                break
            }

            if (conn == null) return null

            val statusCode = conn.responseCode
            val rawContentType = conn.contentType ?: "text/plain"
            val mimeType = if (rawContentType.contains(";")) rawContentType.split(";")[0].trim() else rawContentType

            var inputStream = if (statusCode >= 400) conn.errorStream else conn.inputStream

            val encodingHeader = conn.getHeaderField("Content-Encoding")
            if (encodingHeader != null && encodingHeader.contains("gzip", ignoreCase = true) && inputStream != null) {
                inputStream = java.util.zip.GZIPInputStream(inputStream)
            }

            val headers = mutableMapOf<String, String>(
                "Access-Control-Allow-Origin" to "*",
                "Access-Control-Allow-Methods" to "GET, OPTIONS",
                "Access-Control-Allow-Headers" to "*"
            )

            return android.webkit.WebResourceResponse(
                if (mimeType.isEmpty()) "text/plain" else mimeType,
                "UTF-8",
                if (statusCode in 200..599) statusCode else 200,
                conn.responseMessage ?: "OK",
                headers,
                inputStream
            )
        } catch (e: Exception) {
            e.printStackTrace()
            return null
        }
    }

    override fun onBackPressed() {
        webView.post {
            webView.evaluateJavascript("if(typeof window.handleAndroidBack === 'function'){window.handleAndroidBack();}else{window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true}));}", null)
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            onBackPressed()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onResume() {
        super.onResume()
        // Ensure immersive mode is restored
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
    }
}
