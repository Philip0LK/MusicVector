package com.yuebeidou.player.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import com.yuebeidou.player.audio.PianoPlayer
import com.yuebeidou.player.model.HandoffManifest
import com.yuebeidou.player.settings.SettingsRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.first
import java.io.File

private val SPEED_PRESETS = listOf(0.5, 0.75, 0.9, 1.0, 1.1)
private val TONICS = listOf("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
private val INK = Color(0xFF242424)
private val SUBTLE = Color(0xFF737370)
private val HINT = Color(0xFF8A8A82)
private val GOLD = Color(0xFFB88612)

/**
 * 练习页（横屏）：顶栏 + 整首谱面 + 底部播放栏。
 *
 * 电脑端有而手机端不做的东西：歌曲导航、整页原谱、修正乐谱入口、键盘快捷键。
 * 播放与操作（试听 / 上一音下一音 / 选段循环 / 倍速 / 从头播放）与电脑端逐条对齐。
 */
@Composable
fun PracticeScreen(
    manifest: HandoffManifest,
    songDir: File,
    player: PianoPlayer,
    settings: SettingsRepository,
    onBack: () -> Unit,
) {
    val session = remember(manifest.song.id) { PracticeSession(manifest, player, settings) }
    DisposableEffect(manifest.song.id) {
        session.prepareSamples()
        onDispose { session.dispose() }
    }
    val listState = rememberLazyListState()
    var showSpeed by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    val notationAreas = remember(manifest) { mutableStateMapOf<Int, NotationArea>() }
    val visibleRows = remember(manifest) { PracticeRules.visibleRows(manifest) }
    val pages = rememberSongImages(manifest, songDir)
    val density = LocalDensity.current
    val screenWidthDp = LocalConfiguration.current.screenWidthDp
    val fontSizePx = remember(screenWidthDp, density) {
        val sizeSp = (19.0 + (screenWidthDp - 600) / 150.0).coerceIn(19.0, 26.0)
        with(density) { sizeSp.sp.toPx() }
    }

    LaunchedEffect(session.noticeToken) {
        if (session.notice.isNotEmpty()) {
            delay(3200)
            session.clearNotice()
        }
    }

    val currentRow = PracticeRules.rowOfNote(manifest, session.cursor)
    val viewportHeight = listState.layoutInfo.viewportSize.height
    val browseConnection = remember(listState, session) {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source == NestedScrollSource.UserInput &&
                    (available.y < 0 && listState.canScrollForward || available.y > 0 && listState.canScrollBackward)
                ) session.browse()
                return Offset.Zero
            }
        }
    }
    // A reveal is either an explicit one-shot request or continuous playback follow.
    // Direct, cancellable movement avoids queued animations fighting a new gesture.
    LaunchedEffect(currentRow, session.follow, session.isAutoPlaying, session.revealToken,
        session.revealIndex, viewportHeight, notationAreas[currentRow]) {
        val token = session.revealToken
        val explicit = session.revealIndex != null
        if (!explicit && (!session.follow || !session.isAutoPlaying)) return@LaunchedEffect
        val row = if (explicit) PracticeRules.rowOfNote(manifest, session.revealIndex!!) else currentRow
        val position = visibleRows.indexOf(row)
        if (position < 0) return@LaunchedEffect
        fun allowed() = if (explicit) session.revealToken == token && session.revealIndex == session.cursor &&
            PracticeRules.rowOfNote(manifest, session.cursor) == row
            else session.follow && session.isAutoPlaying && PracticeRules.rowOfNote(manifest, session.cursor) == row
        if (!allowed()) return@LaunchedEffect
        var item = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == position }
        if (item == null) {
            listState.scrollToItem(position)
            withFrameNanos { }
        }
        val area = notationAreas[row] ?: snapshotFlow { notationAreas[row] }.first { it != null }!!
        if (!allowed()) return@LaunchedEffect
        item = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == position }
        val info = listState.layoutInfo
        if (item != null && info.viewportEndOffset > info.viewportStartOffset) {
            val margin = with(density) { 12.dp.toPx() }
            val delta = FollowGeometry.scrollDelta(item.offset + area.top, item.offset + area.top + area.height,
                info.viewportStartOffset + margin, info.viewportEndOffset - margin, explicit)
            if (kotlin.math.abs(delta) > 1f && allowed()) {
                // scrollToItem uses a positive offset to move further down within this row.
                val offset = (info.viewportStartOffset + delta - item.offset).toInt().coerceAtLeast(0)
                listState.scrollToItem(position, offset)
            }
        }
    }

    Column(Modifier.fillMaxSize().background(Color(0xFFFCFCFC))) {
        PracticeTopBar(
            title = manifest.song.title,
            keyLabel = session.keyLabel,
            meter = "${manifest.song.meter.beats}/${manifest.song.meter.beatUnit}",
            status = dockStatus(session),
            highlightStatus = session.range != null,
            clearRange = session.range != null && !session.selecting,
            onClearRange = { session.clearRange() },
            onBack = onBack,
            onSettings = { showSettings = true },
        )
        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(state = listState, modifier = Modifier.fillMaxSize().nestedScroll(browseConnection)) {
                items(visibleRows.size, key = { manifest.rows[visibleRows[it]].index }) { position ->
                    val row = manifest.rows[visibleRows[position]]
                    ScoreRowItem(
                        manifest = manifest,
                        row = row,
                        image = pages.getOrNull(row.imageIndex),
                        fontSizePx = fontSizePx,
                        activeIndex = if (currentRow == row.index) session.cursor else -1,
                        range = session.range,
                        onNoteTap = { session.tapNote(it) },
                        follow = session.follow && session.isAutoPlaying,
                        revealToken = session.revealToken,
                        revealIndex = session.revealIndex,
                        onBrowse = { session.browse() },
                        onNotationArea = { notationAreas[row.index] = it },
                    )
                }
            }
            if (!session.follow) {
                Surface(
                    color = Color(0xFF252725),
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp),
                ) {
                    Text(
                        "回到当前音",
                        color = Color.White,
                        fontSize = 13.sp,
                        modifier = Modifier
                            .clickable { session.followCurrent() }
                            .defaultMinSize(minHeight = 48.dp)
                            .padding(horizontal = 12.dp, vertical = 14.dp),
                    )
                }
            }
            if (session.notice.isNotEmpty()) {
                Surface(
                    color = Color(0xE620201C),
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 10.dp),
                ) {
                    Text(
                        session.notice,
                        color = Color.White,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
                    )
                }
            }
        }
        PlaybackDock(
            session = session,
            onToggleSpeed = { showSpeed = true },
            onToggleSettings = { showSettings = true },
        )
    }

    if (showSpeed) SpeedDialog(session = session, onDismiss = { showSpeed = false })
    if (showSettings) SettingsDialog(session = session, onDismiss = { showSettings = false })
}

@Composable
private fun PracticeTopBar(
    title: String,
    keyLabel: String,
    meter: String,
    status: String,
    highlightStatus: Boolean,
    clearRange: Boolean,
    onClearRange: () -> Unit,
    onBack: () -> Unit,
    onSettings: () -> Unit,
) {
    Surface(color = Color.White, tonalElevation = 2.dp) {
        Row(
            Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(
                onClick = onBack,
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
            ) { Text("曲目", fontSize = 13.sp) }
            Text(title, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = INK)
            Spacer(Modifier.width(12.dp))
            Text(keyLabel, fontSize = 13.sp, color = SUBTLE)
            Spacer(Modifier.width(10.dp))
            Text(meter, fontSize = 13.sp, color = SUBTLE)
            Spacer(Modifier.width(14.dp))
            Text(status, fontSize = 12.sp, color = if (highlightStatus) GOLD else SUBTLE)
            Spacer(Modifier.weight(1f))
            if (clearRange) {
                // 「取消选段」放在顶栏：底栏按钮位置不随有无选段变化，播放键永远在同一处。
                TextButton(
                    onClick = onClearRange,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                ) { Text("取消选段", fontSize = 13.sp) }
            }
            TextButton(
                onClick = onSettings,
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
            ) { Text("设置", fontSize = 13.sp) }
        }
    }
}

@Composable
private fun PlaybackDock(
    session: PracticeSession,
    onToggleSpeed: () -> Unit,
    onToggleSettings: () -> Unit,
) {
    Surface(color = Color.White, tonalElevation = 3.dp) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Button(
                onClick = { session.startSelection() },
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (session.selecting) Color(0xFFF2CE65) else Color(0xFFEFEFEA),
                    contentColor = INK,
                ),
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                modifier = Modifier.height(36.dp),
            ) { Text(if (session.selecting) "取消选段" else "选段", fontSize = 12.sp) }
            CompactTextButton("‹ 上一音") { session.step(-1) }
            CompactTextButton("试听当前音") { session.audition() }
            CompactTextButton("下一音 ›") { session.step(1) }
            Button(
                onClick = { session.togglePlay() },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF252725)),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 0.dp),
                modifier = Modifier.height(36.dp),
            ) {
                Text(
                    if (session.status == PracticeSession.Status.Loading) {
                        "准备中"
                    } else if (session.isActive) {
                        "暂停"
                    } else {
                        "播放"
                    },
                    color = Color.White,
                    fontSize = 14.sp,
                )
            }
            CompactTextButton("从头播放") { session.restart() }
            CompactTextButton("速度 ${formatRate(session.rate)}×") { onToggleSpeed() }
            Spacer(Modifier.weight(1f))
            CompactTextButton("设置") { onToggleSettings() }
        }
    }
}

@Composable
private fun CompactTextButton(label: String, onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        contentPadding = PaddingValues(horizontal = 7.dp, vertical = 0.dp),
        modifier = Modifier.defaultMinSize(minWidth = 0.dp, minHeight = 0.dp).height(36.dp),
    ) { Text(label, fontSize = 12.sp) }
}

private fun dockStatus(session: PracticeSession): String {
    val scope = when {
        session.selecting && session.anchor == null -> "点选起音，再点选止音"
        session.selecting -> "请选择片段的止音"
        session.range != null -> "片段循环 · 第 ${PracticeRules.rowOfNote(session.manifest, session.range!!.first) + 1} 行"
        else -> "全曲演奏"
    }
    // 电脑端把「范围」和「播放到哪一步」分两句显示，这里同样两个都留着。
    val state = when (session.status) {
        PracticeSession.Status.Ended -> "已播放完毕"
        PracticeSession.Status.Waiting -> "稍后重复"
        PracticeSession.Status.Loading -> "准备中"
        else -> ""
    }
    return if (state.isEmpty()) scope else "$scope · $state"
}

private fun formatRate(value: Double): String {
    val rounded = Math.round(value * 100) / 100.0
    return if (rounded == Math.floor(rounded)) rounded.toInt().toString() else rounded.toString()
}

@Composable
private fun SpeedDialog(session: PracticeSession, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("演奏速度", fontSize = 16.sp) },
        text = {
            Column {
                Text("${formatRate(session.baseBpm * session.rate)} 拍/分钟", fontSize = 13.sp, color = SUBTLE)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    SPEED_PRESETS.forEach { preset ->
                        val selected = Math.abs(session.rate - preset) < 0.001
                        TextButton(onClick = { session.changeRate(preset) }) {
                            Text(
                                "${formatRate(preset)}×",
                                fontSize = 12.sp,
                                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                                color = if (selected) GOLD else INK,
                            )
                        }
                    }
                }
                Slider(
                    value = session.rate.toFloat(),
                    onValueChange = { session.changeRate(it.toDouble()) },
                    valueRange = 0.25f..1.25f,
                    steps = 19,
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("0.25× 慢", fontSize = 11.sp, color = HINT)
                    Text("快 1.25×", fontSize = 11.sp, color = HINT)
                }
                Spacer(Modifier.height(6.dp))
                Text("原速 ${formatRate(session.baseBpm)} 拍/分钟", fontSize = 12.sp, color = HINT)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("完成") } },
    )
}

@Composable
private fun SettingsDialog(session: PracticeSession, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        // AlertDialog 默认吃平台宽度上限，不关掉的话 Modifier.width 不生效、音名会被裁掉。
        properties = DialogProperties(usePlatformDefaultWidth = false),
        modifier = Modifier.width(580.dp),
        title = { Text("设置", fontSize = 16.sp) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("调号", fontSize = 13.sp, color = SUBTLE, modifier = Modifier.width(64.dp))
                    Text("1 = ${session.key}", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                }
                TONICS.chunked(6).forEach { chunk ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        chunk.forEach { tonic ->
                            val selected = session.key == tonic
                            TextButton(
                                onClick = { session.changeKeyAndOctave(tonic, session.octave) },
                                contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp),
                                modifier = Modifier.defaultMinSize(minWidth = 0.dp, minHeight = 0.dp).height(38.dp),
                            ) {
                                Text(
                                    tonic,
                                    fontSize = 15.sp,
                                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                                    color = if (selected) GOLD else INK,
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("基准音区", fontSize = 13.sp, color = SUBTLE, modifier = Modifier.width(64.dp))
                    Text(session.keyLabel.removePrefix("1="), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.width(8.dp))
                    CompactTextButton("−") { session.changeKeyAndOctave(session.key, session.octave - 1) }
                    Text(session.octave.toString(), fontSize = 16.sp)
                    CompactTextButton("＋") { session.changeKeyAndOctave(session.key, session.octave + 1) }
                    Spacer(Modifier.width(10.dp))
                    Text("同一个调号换成 C3 / C4 这样不同音区，整首就整体变高或变低", fontSize = 11.sp, color = HINT)
                }
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("速度", fontSize = 13.sp, color = SUBTLE, modifier = Modifier.width(64.dp))
                    Text(formatRate(session.baseBpm), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                    Text(" 拍/分钟", fontSize = 12.sp, color = SUBTLE)
                    Spacer(Modifier.width(10.dp))
                    CompactTextButton("−5") { session.changeBaseBpm(session.baseBpm - 5) }
                    CompactTextButton("−1") { session.changeBaseBpm(session.baseBpm - 1) }
                    CompactTextButton("＋1") { session.changeBaseBpm(session.baseBpm + 1) }
                    CompactTextButton("＋5") { session.changeBaseBpm(session.baseBpm + 5) }
                    Spacer(Modifier.width(10.dp))
                    Text("1× 就是它", fontSize = 11.sp, color = HINT)
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    "这两项只影响手机上这一首的练习（播放时显示为 ${session.keyLabel}），不会回写电脑端。",
                    fontSize = 11.sp,
                    color = HINT,
                )
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("完成") } },
    )
}

/** 原谱图片按行裁切显示；整页解码时按最大边 1600 降采样，避免手机上占太多内存。 */
@Composable
private fun rememberSongImages(manifest: HandoffManifest, songDir: File): List<ImageBitmap?> =
    produceState(initialValue = List<ImageBitmap?>(manifest.images.size) { null }, manifest.song.id) {
        value = withContext(Dispatchers.IO) {
            manifest.images.map { image ->
                val file = File(songDir, image.path)
                if (!file.exists()) null else decodeDownsampled(file)?.asImageBitmap()
            }
        }
    }.value

private fun decodeDownsampled(file: File): android.graphics.Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (bounds.outWidth / sample > 1600 || bounds.outHeight / sample > 1600) sample *= 2
    return BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })
}
