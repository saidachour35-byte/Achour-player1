package com.achour.player

import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.ImageButton
import android.widget.TextView
import android.widget.ImageView
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AlertDialog
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.C
import androidx.media3.common.Tracks
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.ui.PlayerView
import org.json.JSONObject
import java.net.URL
import kotlin.concurrent.thread
import android.graphics.BitmapFactory

@OptIn(UnstableApi::class)
class PlayerActivity : AppCompatActivity() {

    private var player: ExoPlayer? = null
    private var trackSelector: DefaultTrackSelector? = null
    private lateinit var playerView: PlayerView
    private lateinit var titleView: TextView
    private lateinit var logoView: ImageView
    private lateinit var qualityView: TextView
    private lateinit var btnFavorite: ImageButton
    private lateinit var headerOverlay: View
    
    private var streamUrl: String? = null
    private var metadata: JSONObject? = null
    private var isFavorite: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        window.setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        )
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        
        setContentView(R.layout.activity_player)

        playerView = findViewById(R.id.player_view)
        titleView = findViewById(R.id.player_title)
        logoView = findViewById(R.id.player_logo)
        qualityView = findViewById(R.id.player_quality)
        btnFavorite = findViewById(R.id.btn_player_favorite)
        headerOverlay = findViewById(R.id.player_header)
        val btnBack = findViewById<ImageButton>(R.id.btn_player_back)
        val btnSettings = findViewById<ImageButton>(R.id.btn_player_settings)

        streamUrl = intent.getStringExtra("STREAM_URL")
        val metadataStr = intent.getStringExtra("METADATA")
        
        if (metadataStr != null) {
            metadata = JSONObject(metadataStr)
            titleView.text = metadata?.optString("title", "Achour Player")
            isFavorite = metadata?.optBoolean("isFavorite", false) ?: false
            updateFavoriteIcon()

            val logoUrl = metadata?.optString("logo")
            if (!logoUrl.isNullOrEmpty()) {
                loadLogo(logoUrl)
            }
        }

        btnBack.setOnClickListener { finish() }
        
        btnFavorite.setOnClickListener {
            isFavorite = !isFavorite
            updateFavoriteIcon()
            Toast.makeText(this, if (isFavorite) "Added to Favorites" else "Removed from Favorites", Toast.LENGTH_SHORT).show()
        }

        btnSettings.setOnClickListener {
            showTrackSelectionDialog()
        }

        initializePlayer()
    }

    private fun loadLogo(url: String) {
        thread {
            try {
                val inputStream = URL(url).openStream()
                val bitmap = BitmapFactory.decodeStream(inputStream)
                runOnUiThread {
                    logoView.setImageBitmap(bitmap)
                    logoView.visibility = View.VISIBLE
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun updateFavoriteIcon() {
        btnFavorite.setImageResource(
            if (isFavorite) android.R.drawable.btn_star_big_on 
            else android.R.drawable.btn_star_big_off
        )
    }

    private fun initializePlayer() {
        if (streamUrl == null) {
            finish()
            return
        }

        trackSelector = DefaultTrackSelector(this)
        
        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setUserAgent("AchourPlayer/1.0 (Android)")
            .setAllowCrossProtocolRedirects(true)

        metadata?.optJSONObject("headers")?.let { headers ->
            val headerMap = mutableMapOf<String, String>()
            val keys = headers.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                headerMap[key] = headers.getString(key)
            }
            httpDataSourceFactory.setDefaultRequestProperties(headerMap)
        }

        player = ExoPlayer.Builder(this)
            .setTrackSelector(trackSelector!!)
            .setMediaSourceFactory(DefaultMediaSourceFactory(httpDataSourceFactory))
            .build()
            .also { exoPlayer ->
                playerView.player = exoPlayer
                exoPlayer.setMediaItem(MediaItem.fromUri(Uri.parse(streamUrl)))
                exoPlayer.prepare()
                exoPlayer.playWhenReady = true
                
                exoPlayer.addListener(object : Player.Listener {
                    override fun onPlayerError(error: PlaybackException) {
                        Toast.makeText(this@PlayerActivity, "Playback Error: ${error.message}", Toast.LENGTH_LONG).show()
                    }

                    override fun onTracksChanged(tracks: Tracks) {
                        updateQualityLabel()
                    }

                    override fun onPlaybackStateChanged(state: Int) {
                        if (state == Player.STATE_READY) {
                            updateQualityLabel()
                        }
                    }
                })
            }
    }

    private fun updateQualityLabel() {
        val player = this.player ?: return
        val tracks = player.currentTracks
        var bestWidth = 0
        var bestHeight = 0

        for (group in tracks.groups) {
            if (group.type == C.TRACK_TYPE_VIDEO && group.isSelected) {
                for (i in 0 until group.length) {
                    if (group.isTrackSelected(i)) {
                        val format = group.getTrackFormat(i)
                        bestWidth = Math.max(bestWidth, format.width)
                        bestHeight = Math.max(bestHeight, format.height)
                    }
                }
            }
        }

        if (bestWidth > 0 && bestHeight > 0) {
            val label = when {
                bestWidth >= 3840 -> "4K UHD"
                bestWidth >= 1920 -> "1080p FHD"
                bestWidth >= 1280 -> "720p HD"
                else -> "SD (${bestHeight}p)"
            }
            runOnUiThread {
                qualityView.text = label
                qualityView.visibility = View.VISIBLE
            }
        }
    }

    override fun onKeyDown(keyCode: Int, event: android.view.KeyEvent?): Boolean {
        if (keyCode == android.view.KeyEvent.KEYCODE_DPAD_CENTER || 
            keyCode == android.view.KeyEvent.KEYCODE_ENTER ||
            keyCode == android.view.KeyEvent.KEYCODE_NUMPAD_ENTER) {
            
            if (headerOverlay.visibility == View.GONE) {
                showHeader()
            } else {
                hideHeader()
            }
            return true
        }
        if (keyCode == android.view.KeyEvent.KEYCODE_BACK) {
            if (headerOverlay.visibility == View.VISIBLE) {
                hideHeader()
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun showHeader() {
        headerOverlay.visibility = View.VISIBLE
        playerView.showController()
        // Auto-hide after 5 seconds
        headerOverlay.postDelayed({
            hideHeader()
        }, 5000)
    }

    private fun hideHeader() {
        headerOverlay.visibility = View.GONE
        playerView.hideController()
    }

    private fun showTrackSelectionDialog() {
        val player = this.player ?: return
        val tracks = player.currentTracks
        
        val items = mutableListOf<String>()
        val trackGroups = mutableListOf<Tracks.Group>()
        
        for (group in tracks.groups) {
            if (group.type == C.TRACK_TYPE_VIDEO) {
                for (i in 0 until group.length) {
                    val format = group.getTrackFormat(i)
                    val label = "Quality: ${format.height}p (${format.bitrate / 1000}kbps)"
                    items.add(label)
                    trackGroups.add(group)
                }
            }
        }

        for (group in tracks.groups) {
            if (group.type == C.TRACK_TYPE_AUDIO) {
                for (i in 0 until group.length) {
                    val format = group.getTrackFormat(i)
                    val label = "Audio: ${format.language ?: "Unknown"} (${format.bitrate / 1000}kbps)"
                    items.add(label)
                    trackGroups.add(group)
                }
            }
        }

        for (group in tracks.groups) {
            if (group.type == C.TRACK_TYPE_TEXT) {
                for (i in 0 until group.length) {
                    val format = group.getTrackFormat(i)
                    val label = "Subtitle: ${format.language ?: "Unknown"}"
                    items.add(label)
                    trackGroups.add(group)
                }
            }
        }

        if (items.isEmpty()) {
            Toast.makeText(this, "No alternative tracks available", Toast.LENGTH_SHORT).show()
            return
        }

        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Select Audio or Subtitles")
            .setItems(items.toTypedArray()) { _, which ->
                val group = trackGroups[which]
                player.trackSelectionParameters = player.trackSelectionParameters
                    .buildUpon()
                    .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, which % group.length))
                    .build()
            }
            .show()
    }

    override fun onStop() {
        super.onStop()
        player?.release()
        player = null
    }
}
