package com.yuebeidou.player

import com.yuebeidou.player.audio.PianoPlayer
import com.yuebeidou.player.handoff.HandoffClient
import com.yuebeidou.player.ui.PracticeRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** 练习规则、采样命名与扫码地址解析的单元测试。 */
class RulesAndParsingTest {

    @Test
    fun `编号夹取与环绕规则和电脑端一致`() {
        assertEquals(0, PracticeRules.clampIndex(-3, 10))
        assertEquals(9, PracticeRules.clampIndex(99, 10))
        assertEquals(5, PracticeRules.clampIndex(5, 10))
        // 无选段：到边界停住（电脑端 clampIndex）。
        assertEquals(0, PracticeRules.nextIndex(0, -1, 10, null))
        assertEquals(9, PracticeRules.nextIndex(9, 1, 10, null))
        assertEquals(3, PracticeRules.nextIndex(2, 1, 10, null))
        // 有选段：片段内首尾环绕。
        assertEquals(3, PracticeRules.nextIndex(6, 1, 10, 3..6))
        assertEquals(6, PracticeRules.nextIndex(3, -1, 10, 3..6))
        assertEquals(5, PracticeRules.nextIndex(4, 1, 10, 3..6))
    }

    @Test
    fun `选区规范化总是取较小到较大`() {
        assertEquals(3..7, PracticeRules.normalizedRange(7, 3, 20))
        assertEquals(3..7, PracticeRules.normalizedRange(3, 7, 20))
        assertEquals(0..0, PracticeRules.normalizedRange(-5, -9, 20))
        assertEquals(19..19, PracticeRules.normalizedRange(50, 80, 20))
    }

    @Test
    fun `倍速按 0_05 步进取整并夹在 0_25 到 1_25`() {
        assertEquals(1.0, PracticeRules.rateFrom(1.0), 1e-9)
        assertEquals(1.05, PracticeRules.rateFrom(1.03), 1e-9)
        assertEquals(1.25, PracticeRules.rateFrom(9.9), 1e-9)
        assertEquals(0.25, PracticeRules.rateFrom(-1.0), 1e-9)
        assertEquals(0.9, PracticeRules.rateFrom(0.9), 1e-9)
    }

    @Test
    fun `试听延音会连着响完但不越过选段末尾`() {
        val manifest = Fixtures.synthetic()
        // 合成曲第 1、6、9 个音带延音，试听第一音要连到第二个音。
        assertTrue(manifest.notes[0].tieToNext)
        assertEquals(1, PracticeRules.auditionEnd(manifest, 0, null))
        assertEquals(6, PracticeRules.auditionEnd(manifest, 5, null))
        assertEquals(5, PracticeRules.auditionEnd(manifest, 5, 0..5))
        assertEquals(0, PracticeRules.auditionEnd(manifest, 0, 0..0))
    }

    @Test
    fun `行号换算忽略没有音符的行`() {
        assumeTrue("需要本机 local/fixtures 生成的 salon.json", Fixtures.hasSalon())
        val manifest = Fixtures.salon()
        assertEquals(0, PracticeRules.rowOfNote(manifest, 0))
        assertEquals(0, PracticeRules.rowOfNote(manifest, 19))
        assertEquals(1, PracticeRules.rowOfNote(manifest, 20))
        assertEquals(listOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17), PracticeRules.visibleRows(manifest))
    }

    @Test
    fun `采样文件名与电脑端 pianoSampleForMidi 一致`() {
        assertEquals("A0v6.ogg", PianoPlayer.sampleFileName(21))
        assertEquals("Ds1v6.ogg", PianoPlayer.sampleFileName(27))
        assertEquals("Fs1v6.ogg", PianoPlayer.sampleFileName(30))
        // 电脑端 midiToNoteName 用 floor(midi/12)-1 命名，midi 48 落在 C3。
        assertEquals("C3v6.ogg", PianoPlayer.sampleFileName(48))
        assertEquals("C8v6.ogg", PianoPlayer.sampleFileName(108))
        val names = (0 until PianoPlayer.SAMPLE_COUNT).map { PianoPlayer.sampleFileName(PianoPlayer.LOWEST_MIDI + it * 3) }
        assertEquals(PianoPlayer.SAMPLE_COUNT, names.toSet().size)
        assertTrue(names.none { it.contains('#') })
        // 打包里必须真的存在这些采样，否则对应音高在手机上会静音。
        val assets = java.io.File("src/main/assets/piano")
        assertTrue("找不到采样目录，测试工作目录应为 app/", assets.isDirectory)
        val missing = names.filterNot { java.io.File(assets, it).isFile }
        assertEquals("缺少采样：$missing", emptyList<String>(), missing)
    }

    @Test
    fun `扫码结果解析出曲目包地址`() {
        val direct = "http://192.168.1.9:4176/handoff/abc123"
        assertEquals(direct, HandoffClient.baseUrl(direct))
        assertEquals(direct, HandoffClient.baseUrl("$direct/"))
        assertEquals(
            direct,
            HandoffClient.baseUrl("yuebeidou://receive?u=" + java.net.URLEncoder.encode(direct, "UTF-8")),
        )
        assertThrows(HandoffClient.HandoffException::class.java) { HandoffClient.baseUrl("https://example.com/hello") }
        assertThrows(HandoffClient.HandoffException::class.java) { HandoffClient.baseUrl("随便一段文字") }
    }
}
