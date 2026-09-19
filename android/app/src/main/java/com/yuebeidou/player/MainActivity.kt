package com.yuebeidou.player

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import com.yuebeidou.player.audio.PianoPlayer
import com.yuebeidou.player.settings.SettingsRepository
import com.yuebeidou.player.storage.SongStore
import com.yuebeidou.player.ui.YueBeiDouApp

class MainActivity : ComponentActivity() {
    private lateinit var player: PianoPlayer

    /** 由 Intent 带进来的曲目地址；消费后清空，避免重组时重复接收。 */
    private var handoffUrl by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 练习时不希望屏幕自动熄灭。
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        player = PianoPlayer(applicationContext)
        val store = SongStore(applicationContext)
        val settings = SettingsRepository(applicationContext)
        handoffUrl = handoffUrlFrom(intent)
        setContent {
            MaterialTheme(
                colorScheme = lightColorScheme(
                    primary = Color(0xFF252725),
                    background = Color(0xFFFCFCFC),
                    surface = Color.White,
                ),
            ) {
                YueBeiDouApp(
                    player = player,
                    store = store,
                    settings = settings,
                    handoffUrl = handoffUrl,
                    onHandoffConsumed = { handoffUrl = null },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handoffUrl = handoffUrlFrom(intent)
    }

    override fun onDestroy() {
        player.dispose()
        super.onDestroy()
    }

    private fun handoffUrlFrom(intent: Intent?): String? {
        val data = intent?.dataString ?: return null
        return data.takeIf { it.isNotBlank() }
    }
}
