package com.yuebeidou.player.storage

import android.content.Context
import com.yuebeidou.player.model.HandoffManifest
import com.yuebeidou.player.model.ManifestParser
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 手机本地的曲目库。
 *
 * 落盘策略：整首先写进临时目录，全部图片写完再原子改名。中途失败只留下临时目录，
 * 用户不会看到半首歌。重复接收同一首按 id 覆盖。
 */
class SongStore(context: Context) {

    private val root = File(context.filesDir, "songs").apply { mkdirs() }
    private val indexFile = File(root, "index.json")

    data class StoredSong(
        val id: String,
        val title: String,
        val receivedAt: Long,
        val noteCount: Int,
        val rowCount: Int,
        val imageCount: Int,
        val dir: File,
    )

    fun list(): List<StoredSong> {
        if (!indexFile.exists()) return emptyList()
        return try {
            val array = JSONArray(indexFile.readText())
            (0 until array.length()).mapNotNull { index ->
                val item = array.getJSONObject(index)
                val dir = File(root, item.getString("id"))
                if (!dir.isDirectory) null else StoredSong(
                    id = item.getString("id"),
                    title = item.optString("title", item.getString("id")),
                    receivedAt = item.optLong("receivedAt", 0L),
                    noteCount = item.optInt("noteCount", 0),
                    rowCount = item.optInt("rowCount", 0),
                    imageCount = item.optInt("imageCount", 0),
                    dir = dir,
                )
            }.sortedByDescending { it.receivedAt }
        } catch (error: Exception) {
            emptyList()
        }
    }

    fun manifestOf(song: StoredSong): HandoffManifest? = try {
        ManifestParser.parse(File(song.dir, MANIFEST_NAME).readText())
    } catch (error: Exception) {
        null
    }

    fun imageFile(song: StoredSong, path: String): File = File(song.dir, path)

    fun save(
        manifestText: String,
        manifest: HandoffManifest,
        imageBytes: Map<Int, ByteArray>,
    ): StoredSong {
        val id = manifest.song.id.ifBlank { "song" }
        val staged = File(root, "$id.staging")
        val target = File(root, id)
        staged.deleteRecursively()
        staged.mkdirs()
        File(staged, MANIFEST_NAME).writeText(manifestText)
        for (image in manifest.images) {
            val bytes = imageBytes[image.index] ?: error("第 ${image.index + 1} 页图片缺失")
            val file = File(staged, image.path)
            file.parentFile?.mkdirs()
            file.writeBytes(bytes)
        }
        target.deleteRecursively()
        if (!staged.renameTo(target)) {
            staged.copyRecursively(target, overwrite = true)
            staged.deleteRecursively()
        }
        val stored = StoredSong(
            id = id,
            title = manifest.song.title,
            receivedAt = System.currentTimeMillis(),
            noteCount = manifest.notes.size,
            rowCount = manifest.rows.size,
            imageCount = manifest.images.size,
            dir = target,
        )
        writeIndex((list().filterNot { it.id == id } + stored).sortedBy { it.receivedAt })
        return stored
    }

    fun delete(id: String) {
        File(root, id).deleteRecursively()
        writeIndex(list().filterNot { it.id == id })
    }

    private fun writeIndex(songs: List<StoredSong>) {
        val array = JSONArray()
        for (song in songs) {
            array.put(
                JSONObject()
                    .put("id", song.id)
                    .put("title", song.title)
                    .put("receivedAt", song.receivedAt)
                    .put("noteCount", song.noteCount)
                    .put("rowCount", song.rowCount)
                    .put("imageCount", song.imageCount),
            )
        }
        indexFile.writeText(array.toString())
    }

    companion object {
        const val MANIFEST_NAME = "manifest.json"
    }
}
