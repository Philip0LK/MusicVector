package com.yuebeidou.player.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.yuebeidou.player.audio.PianoPlayer
import com.yuebeidou.player.handoff.HandoffClient
import com.yuebeidou.player.model.HandoffManifest
import com.yuebeidou.player.settings.SettingsRepository
import com.yuebeidou.player.storage.SongStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * 应用的唯一导航：没有曲目就停在曲目页，有曲目就直接进练习页。
 * 手机端不允许编辑，所以只有「接收 → 练习 → 换一首/删除」这一条线。
 *
 * @param handoffUrl 由 Intent 带进来的曲目地址（yuebeidou://receive?u=... 或 http 地址），
 *                   处理完立即回调 onHandoffConsumed 清掉，避免旋转/重组时重复接收。
 */
@Composable
fun YueBeiDouApp(
    player: PianoPlayer,
    store: SongStore,
    settings: SettingsRepository,
    handoffUrl: String? = null,
    onHandoffConsumed: () -> Unit = {},
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var songs by remember { mutableStateOf(store.list()) }
    var opened by remember { mutableStateOf<SongStore.StoredSong?>(null) }
    var manifest by remember { mutableStateOf<HandoffManifest?>(null) }
    var receiving by remember { mutableStateOf<ReceiveState?>(null) }
    var pendingScan by remember { mutableStateOf(false) }

    fun receive(scanned: String) {
        receiving = ReceiveState(phase = "正在连接电脑…")
        scope.launch {
            try {
                val fetched = withContext(Dispatchers.IO) {
                    HandoffClient.fetch(
                        scannedUrl = scanned,
                        onProgress = { progress ->
                            receiving = ReceiveState(
                                phase = "${progress.phase}…",
                                current = progress.current,
                                total = progress.total,
                            )
                        },
                    )
                }
                val stored = withContext(Dispatchers.IO) {
                    store.save(fetched.manifestText, fetched.manifest, fetched.images)
                }
                songs = store.list()
                receiving = null
                opened = stored
            } catch (error: Exception) {
                receiving = ReceiveState(
                    phase = "接收失败",
                    error = error.message ?: "接收失败，请重试",
                )
            }
        }
    }

    LaunchedEffect(Unit) {
        if (opened == null && songs.size == 1) opened = songs.first()
    }
    LaunchedEffect(opened) {
        val song = opened
        manifest = if (song == null) null else withContext(Dispatchers.IO) { store.manifestOf(song) }
        if (song != null) settings.lastSongId = song.id
    }
    LaunchedEffect(handoffUrl) {
        val url = handoffUrl ?: return@LaunchedEffect
        receive(url)
        onHandoffConsumed()
    }

    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        val content = result.contents
        if (content.isNullOrBlank()) {
            receiving = null
            return@rememberLauncherForActivityResult
        }
        receive(content)
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted && pendingScan) {
            pendingScan = false
            scanLauncher.launch(scanOptions())
        } else {
            pendingScan = false
        }
    }

    fun startScan() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            scanLauncher.launch(scanOptions())
        } else {
            pendingScan = true
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    Surface(color = MaterialTheme.colorScheme.background) {
        // Android 15 起系统强制边到边，状态栏与手势条会盖在内容上，这里统一让出安全区。
        Box(Modifier.fillMaxSize().safeDrawingPadding()) {
            val song = opened
            val current = manifest
            if (song != null && current != null) {
                PracticeScreen(
                    manifest = current,
                    songDir = File(song.dir.absolutePath),
                    player = player,
                    settings = settings,
                    onBack = {
                        player.stop()
                        opened = null
                        manifest = null
                        songs = store.list()
                    },
                )
            } else {
                SongListScreen(
                    songs = songs,
                    receiving = receiving,
                    onScan = { startScan() },
                    onOpen = { opened = it },
                    onDelete = {
                        store.delete(it.id)
                        songs = store.list()
                    },
                    onDismissReceive = { receiving = null },
                    onRetryScan = {
                        receiving = null
                        startScan()
                    },
                )
            }
        }
    }
}

private fun scanOptions() = ScanOptions().apply {
    setDesiredBarcodeFormats(ScanOptions.QR_CODE)
    setPrompt("对准电脑上的二维码")
    setBeepEnabled(false)
    setBarcodeImageEnabled(false)
    setOrientationLocked(false)
}
