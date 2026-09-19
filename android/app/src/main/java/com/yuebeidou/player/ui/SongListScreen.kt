package com.yuebeidou.player.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yuebeidou.player.storage.SongStore

private val INK = Color(0xFF242424)
private val SUBTLE = Color(0xFF737370)

data class ReceiveState(
    val phase: String,
    val current: Int = 0,
    val total: Int = 0,
    val error: String? = null,
)

/**
 * 曲目页。手机端没有编辑模式，所以这里只有三件事：扫码收曲目、打开已收曲目、删掉不要的。
 */
@Composable
fun SongListScreen(
    songs: List<SongStore.StoredSong>,
    receiving: ReceiveState?,
    onScan: () -> Unit,
    onOpen: (SongStore.StoredSong) -> Unit,
    onDelete: (SongStore.StoredSong) -> Unit,
    onDismissReceive: () -> Unit,
    onRetryScan: () -> Unit,
) {
    var pendingDelete by remember { mutableStateOf<SongStore.StoredSong?>(null) }
    Column(Modifier.fillMaxSize().background(Color(0xFFFCFCFC))) {
        Row(
            Modifier.fillMaxWidth().height(46.dp).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("乐北斗", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = INK)
            Spacer(Modifier.width(10.dp))
            Text("手机练习端", fontSize = 12.sp, color = SUBTLE)
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (songs.isEmpty()) {
                Column(
                    Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("还没有收到曲目", fontSize = 15.sp, color = SUBTLE)
                    Spacer(Modifier.height(8.dp))
                    Text("在电脑上打开这首曲子，点拍号旁边的「发送到手机」", fontSize = 12.sp, color = Color(0xFF9A9A92))
                }
            } else {
                LazyColumn(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
                    items(songs, key = { it.id }) { song ->
                        Surface(
                            color = Color.White,
                            tonalElevation = 1.dp,
                            shape = androidx.compose.material3.MaterialTheme.shapes.medium,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp)
                                .clickable { onOpen(song) },
                        ) {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(song.title, fontSize = 16.sp, fontWeight = FontWeight.Medium, color = INK)
                                    Text(
                                        "${song.noteCount} 个音 · ${song.rowCount} 行 · 收到 ${formatTime(song.receivedAt)}",
                                        fontSize = 12.sp,
                                        color = SUBTLE,
                                    )
                                }
                                TextButton(onClick = { pendingDelete = song }) { Text("删除", fontSize = 12.sp) }
                            }
                        }
                    }
                }
            }
            if (receiving != null) {
                Surface(color = Color(0xE6FFFFFF), modifier = Modifier.fillMaxSize()) {
                    Column(
                        Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        if (receiving.error != null) {
                            Text("接收失败", fontSize = 16.sp, fontWeight = FontWeight.Medium, color = Color(0xFFB03A2E))
                            Spacer(Modifier.height(6.dp))
                            Text(receiving.error, fontSize = 13.sp, color = SUBTLE)
                            Spacer(Modifier.height(16.dp))
                            Button(
                                onClick = onRetryScan,
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF252725)),
                            ) { Text("重新扫码", color = Color.White, fontSize = 14.sp) }
                            TextButton(onClick = onDismissReceive) { Text("返回", fontSize = 13.sp) }
                        } else {
                            CircularProgressIndicator()
                            Spacer(Modifier.height(12.dp))
                            Text(receiving.phase, fontSize = 14.sp, color = INK)
                            if (receiving.total > 0) {
                                Spacer(Modifier.height(8.dp))
                                LinearProgressIndicator(
                                    progress = { receiving.current.toFloat() / receiving.total },
                                    modifier = Modifier.width(220.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
        Surface(color = Color.White, tonalElevation = 3.dp) {
            Button(
                onClick = onScan,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF252725)),
                modifier = Modifier.fillMaxWidth().padding(14.dp).height(46.dp),
            ) {
                Text("扫描二维码接收曲目", color = Color.White, fontSize = 15.sp)
            }
        }
    }
    val target = pendingDelete
    if (target != null) {
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("删除这首曲目？") },
            text = { Text("「${target.title}」的原谱与乐谱会从手机上移除，电脑端不受影响。") },
            confirmButton = {
                TextButton(onClick = {
                    pendingDelete = null
                    onDelete(target)
                }) { Text("删除") }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("返回") } },
        )
    }
}

private fun formatTime(stamp: Long): String {
    if (stamp <= 0) return "未知时间"
    val format = java.text.SimpleDateFormat("M月d日 HH:mm", java.util.Locale.CHINA)
    return format.format(java.util.Date(stamp))
}
