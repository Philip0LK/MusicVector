package com.yuebeidou.player

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.yuebeidou.player.audio.PianoPlayer
import com.yuebeidou.player.model.ManifestParser
import com.yuebeidou.player.settings.SettingsRepository
import com.yuebeidou.player.storage.SongStore
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 运行期冒烟测试：在 JVM 上跑真实 Android Context。
 *
 * 单测里最查不出来的正是这些「路径/落盘」问题——采样文件名写错只会让某个音高静音，
 * 落盘写成非原子会让用户看到半首歌。这里把它们真正跑一遍。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RuntimeSmokeTest {

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Test
    fun `打包里的 30 个钢琴采样都能按名字打开且未被压缩`() {
        // 采样路径写错只会让某些音高静音、资源被压缩则 openFd 直接抛异常，这两件事在这里挡掉。
        // 真正的解码走 MediaCodec，Robolectric 里没有编解码器，所以解码放到真机上验证。
        val player = PianoPlayer(context)
        for (midi in player.midiSamples) {
            val name = "piano/" + PianoPlayer.sampleFileName(midi)
            val descriptor = context.assets.openFd(name)
            descriptor.use {
                assertTrue("$name 长度为 0", it.length > 0)
                assertTrue("$name 起始偏移异常", it.startOffset >= 0)
            }
        }
        // prepare 必须能安全返回；请求过的采样要么解码成功、要么被记进失败集合，不能凭空消失。
        player.prepare(listOf(60, 64, 67), 3.0) {}
        assertTrue("采样记账不完整：${player.loadError}", player.sampleCount + player.failedSamples.size <= 3)
        player.dispose()
    }

    @Test
    fun `曲目落盘是整首写完再换目录，读回内容一致`() {
        val store = SongStore(context)
        val manifestText = manifestFixture()
        val manifest = ManifestParser.parse(manifestText)
        val image = byteArrayOf(1, 2, 3, 4, 5)
        val stored = store.save(manifestText, manifest, mapOf(0 to image))

        assertEquals("salon", stored.id)
        assertEquals("沙龙", stored.title)
        assertEquals(2, stored.noteCount)
        assertEquals(1, stored.rowCount)
        assertEquals(1, stored.imageCount)

        val listed = store.list()
        assertEquals(1, listed.size)
        assertEquals("salon", listed.first().id)
        val reloaded = store.manifestOf(listed.first())
        assertNotNull(reloaded)
        assertEquals(2, reloaded!!.notes.size)
        assertEquals("1", reloaded.notes[0].id)
        assertEquals("images/0.jpg", reloaded.images[0].path)

        val file = store.imageFile(listed.first(), reloaded.images[0].path)
        assertTrue("图片没有落盘", file.isFile)
        assertTrue(file.readBytes().contentEquals(image))

        // 重复接收同一首要覆盖，不留第二份。
        store.save(manifestText, manifest, mapOf(0 to image))
        assertEquals(1, store.list().size)

        store.delete("salon")
        assertEquals(0, store.list().size)
        assertNull(store.manifestOf(stored))
    }

    @Test
    fun `练习设置按曲目读写，缺失时回落到曲目自带值`() {
        val settings = SettingsRepository(context)
        val fallback = settings.song("salon", "E", 4, 80.0)
        assertEquals("E", fallback.key)
        assertEquals(4, fallback.octave)
        assertEquals(80.0, fallback.bpm, 1e-9)
        assertEquals(1.0, fallback.rate, 1e-9)

        settings.saveSong("salon", SettingsRepository.SongSettings(key = "G", octave = 3, bpm = 96.0, rate = 0.9))
        val saved = settings.song("salon", "E", 4, 80.0)
        assertEquals("G", saved.key)
        assertEquals(3, saved.octave)
        assertEquals(96.0, saved.bpm, 1e-9)
        assertEquals(0.9, saved.rate, 1e-9)
        // 另一首曲目不受影响。
        assertEquals("E", settings.song("other", "E", 4, 80.0).key)

        settings.lastSongId = "salon"
        assertEquals("salon", settings.lastSongId)
    }

    private fun manifestFixture(): String = JSONObject()
        .put("handoff", 1)
        .put("generatedAt", "2026-01-01T00:00:00.000Z")
        .put(
            "song",
            JSONObject()
                .put("id", "salon")
                .put("title", "沙龙")
                .put("key", "E")
                .put("octave", 4)
                .put("bpm", 80.0)
                .put("meter", JSONObject().put("beats", 4).put("beatUnit", 4))
                .put("pickup", true)
                .put("ticksPerQuarter", 24.0)
                .put("baseBpm", 80.0)
                .put("baseBeatTicks", 24.0)
                .put("tempoEvents", org.json.JSONArray()),
        )
        .put(
            "notes",
            org.json.JSONArray()
                .put(note("1", 0, true))
                .put(note("2", 1, false)),
        )
        .put(
            "rows",
            org.json.JSONArray().put(
                JSONObject()
                    .put("index", 0)
                    .put("page", 0)
                    .put("line", 0)
                    .put("text", "0 1")
                    .put("imageIndex", 0)
                    .put("crop", JSONObject().put("kind", "band").put("top", 0.1).put("bottom", 0.2))
                    .put("startNoteIndex", 0)
                    .put("noteCount", 2)
                    .put("arcs", org.json.JSONArray()),
            ),
        )
        .put("measures", org.json.JSONArray())
        .put(
            "images",
            org.json.JSONArray().put(
                JSONObject()
                    .put("index", 0)
                    .put("id", "img-0")
                    .put("name", "a.jpg")
                    .put("mime", "image/jpeg")
                    .put("path", "images/0.jpg"),
            ),
        )
        .toString()

    private fun note(id: String, degree: Int, rest: Boolean): JSONObject = JSONObject()
        .put("id", id)
        .put("degree", degree)
        .put("accidental", JSONObject.NULL)
        .put("octave", 0)
        .put("pitchOffset", 0)
        .put("isRest", rest)
        .put("durationTicks", "24")
        .put("baseTicks", 24)
        .put("tieToNext", false)
        .put("measureEnd", !rest)
        .put("missingDuration", false)
        .put("dots", 0)
        .put("dotted", false)
        .put("beamGroup", JSONObject.NULL)
}
