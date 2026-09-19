package com.yuebeidou.player

import com.yuebeidou.player.audio.PcmMixer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 发声时长的定量测试。
 *
 * 产品要求的是**精确的时值比例**：八分正好是十六分的两倍，附点、二分、全音符同样成比例。
 * 这一组把这条件钉死——任何"固定的额外时长"或"被固定扣掉的时长"都会让比例偏离而在这里失败。
 */
class SoundLengthTest {
    private val rate = 48000

    private fun note(durationSeconds: Double, startFrame: Long = 0) = PcmMixer.Note(
        startFrame = startFrame,
        source = ShortArray(rate * 4) { 1000 },
        sourceRate = rate,
        pitchRate = 1.0,
        durationSeconds = durationSeconds,
    )

    private fun audibleSeconds(durationSeconds: Double): Double =
        (PcmMixer.lastAudibleFrame(note(durationSeconds), rate) + 1).toDouble() / rate

    /** Baby Song 的实际拍速：BPM 66、每四分音符 24 tick。 */
    private val tick = 60.0 / (66.0 * 24.0)

    private fun ticks(value: Int): Double = value * tick

    @Test
    fun `可听窗口正好等于时值本身`() {
        for (value in listOf(6, 12, 18, 24, 36, 48, 72, 96)) {
            val duration = ticks(value)
            assertEquals("${value} tick 的发声长度不对", duration, audibleSeconds(duration), 1.5 / rate)
        }
    }

    @Test
    fun `各时值之间正好成整倍数（用户要的精确比例）`() {
        val sixteenth = audibleSeconds(ticks(6))
        val eighth = audibleSeconds(ticks(12))
        val quarter = audibleSeconds(ticks(24))
        val half = audibleSeconds(ticks(48))
        val whole = audibleSeconds(ticks(96))
        assertRatio(2.0, eighth, sixteenth, "16 分 : 8 分")
        assertRatio(2.0, quarter, eighth, "8 分 : 4 分")
        assertRatio(2.0, half, quarter, "4 分 : 2 分")
        assertRatio(2.0, whole, half, "2 分 : 全音符")
        // 附点 = 基础时值 ×1.5（18 tick 对 12 tick）。
        assertRatio(1.5, audibleSeconds(ticks(18)), eighth, "附点")
    }

    /**
     * 输出是离散采样，两个时值各自取整到帧后比值必然带一点误差；
     * 允许的误差就是「短的那个音上下各一帧」，语义清楚且远小于听觉可辨范围。
     */
    private fun assertRatio(expected: Double, longer: Double, shorter: Double, label: String) {
        val tolerance = 2.0 / rate / shorter
        assertEquals("$label 必须正好是 $expected 倍", expected, longer / shorter, tolerance)
    }

    @Test
    fun `包络按比例收尾：淡入不超过时值的两成、收尾不超过三成`() {
        val duration = 1.0
        val release = Math.min(PcmMixer.RELEASE_SECONDS, duration * PcmMixer.RELEASE_FRACTION)
        val sustainUntil = duration - release
        assertEquals(0.0, PcmMixer.envelopeGain(0.0, duration), 1e-9)
        assertEquals(0.5, PcmMixer.envelopeGain(0.004, duration), 1e-6)
        assertEquals(1.0, PcmMixer.envelopeGain(0.008, duration), 1e-6)
        assertEquals(1.0, PcmMixer.envelopeGain(sustainUntil, duration), 1e-9)
        assertEquals(0.5, PcmMixer.envelopeGain(sustainUntil + release / 2, duration), 1e-6)
        assertTrue(PcmMixer.envelopeGain(duration - 1e-4, duration) < 0.01)
        // 时值之外一律无声——这正是比例精确的前提。
        assertEquals(0.0, PcmMixer.envelopeGain(duration, duration), 1e-9)
        assertEquals(0.0, PcmMixer.envelopeGain(-0.001, duration), 1e-9)
        assertTrue(
            "淡入+收尾不应吃掉一半以上的时值",
            Math.min(PcmMixer.ATTACK_SECONDS, duration * PcmMixer.ATTACK_FRACTION) +
                release <= duration * 0.5,
        )
    }

    @Test
    fun `很短的音也按比例收尾，不会被固定收尾吃掉`() {
        val veryShort = 0.05
        assertTrue(PcmMixer.envelopeGain(0.03, veryShort) > 0.4)
        assertEquals(0.0, PcmMixer.envelopeGain(veryShort, veryShort), 1e-9)
        // 淡入与收尾相加不超过时值一半，保证中间仍有保持段。
        assertTrue(PcmMixer.envelopeGain(veryShort * 0.25, veryShort) >= 1.0 - 1e-9)
    }

    @Test
    fun `混音把音放在正确的帧上，并按包络衰减`() {
        val buffer = ShortArray(rate)
        val event = note(0.5, startFrame = 0)
        PcmMixer.mix(event, buffer, 0, rate, 0L, rate)
        // 起声处按 8ms 淡入：第 0 帧为 0，第 4ms（半程）约为峰值一半。
        assertEquals(0, buffer[0].toInt())
        val peak = (1000 * PcmMixer.PEAK_GAIN)
        assertTrue(Math.abs(buffer[(0.004 * rate).toInt()].toInt() - peak / 2) <= 6)
        // 到了保持段就是满增益。
        assertEquals(peak.toInt(), buffer[rate / 10].toInt())
        // 收尾之后不再有声音：可听窗口就是时值本身。
        assertEquals(0, buffer[(0.5 * rate).toInt()].toInt())
    }

    @Test
    fun `片段时间轴独立：只在属于本段的位置写入`() {
        val event = note(0.5, startFrame = 0)
        val buffer = ShortArray(1024)
        // 这一段落在音结束之后，不应该有任何输出。
        PcmMixer.mix(event, buffer, 0, 1024, (0.8 * rate).toLong(), rate)
        assertTrue(buffer.all { it.toInt() == 0 })
        // 落在起声处则要有输出。
        PcmMixer.mix(event, buffer, 0, 1024, 0L, rate)
        assertTrue(buffer.any { it.toInt() != 0 })
    }

    @Test
    fun `音高倍率决定消耗源采样的速度`() {
        val fast = PcmMixer.Note(0, ShortArray(rate * 2) { 1000 }, rate, pitchRate = 2.0, durationSeconds = 0.1)
        val slow = PcmMixer.Note(0, ShortArray(rate * 2) { 1000 }, rate, pitchRate = 0.5, durationSeconds = 0.1)
        assertEquals(2.0, fast.step(rate), 1e-9)
        assertEquals(0.5, slow.step(rate), 1e-9)
    }

    @Test
    fun `试听让采样自然响完，不按谱面时值切`() {
        // 两份都是 2 秒的采样；谱面音只响 0.227 秒，试听音要响满整段。
        val source = ShortArray(rate * 2) { 1000 }
        val scored = PcmMixer.Note(0, source, rate, 1.0, durationSeconds = 0.227)
        val audition = PcmMixer.Note(0, source, rate, 1.0, durationSeconds = null)
        assertEquals(0.227, (PcmMixer.lastAudibleFrame(scored, rate) + 1).toDouble() / rate, 1.5 / rate)
        val auditioned = (PcmMixer.lastAudibleFrame(audition, rate) + 1).toDouble() / rate
        assertTrue("试听只响了 ${auditioned}s，应当接近整段 2 秒", auditioned > 1.9)
        assertEquals(2.0, audition.totalSeconds(rate), 1e-3)
    }

    @Test
    fun `试听按音高倍率消耗采样：变速后长度随之变化`() {
        val source = ShortArray(rate * 4) { 1000 }
        val fast = PcmMixer.Note(0, source, rate, pitchRate = 2.0, durationSeconds = null)
        val normal = PcmMixer.Note(0, source, rate, pitchRate = 1.0, durationSeconds = null)
        assertEquals("升八度后采样长度减半", 2.0, fast.totalSeconds(rate), 1e-3)
        assertEquals("原速时采样长度不变", 4.0, normal.totalSeconds(rate), 1e-3)
    }

    @Test
    fun `试听包络：淡入后一直保持，只在采样末尾淡出`() {
        val total = 10.0
        assertEquals(0.0, PcmMixer.auditionEnvelopeGain(0.0, total), 1e-9)
        assertEquals(0.5, PcmMixer.auditionEnvelopeGain(PcmMixer.ATTACK_SECONDS / 2, total), 1e-6)
        assertEquals(1.0, PcmMixer.auditionEnvelopeGain(5.0, total), 1e-6)
        assertEquals(1.0, PcmMixer.auditionEnvelopeGain(total - 1.0, total), 1e-6)
        // 末尾按比例淡出（10 秒的音是 30ms），到点归零。
        assertEquals(0.5, PcmMixer.auditionEnvelopeGain(total - 0.015, total), 1e-6)
        assertEquals(0.0, PcmMixer.auditionEnvelopeGain(total, total), 1e-9)
    }

    @Test
    fun `采样解码长度按最慢倍速取，够最长的音响完`() {
        val manifest = Fixtures.synthetic()
        val (midis, seconds) = com.yuebeidou.player.ui.PracticeRules.sampleRequest(manifest, "C", 4)
        assertTrue("要解码的音高不应为空", midis.isNotEmpty())
        // 合成曲 BPM 90、最长音 96 tick（含 1 秒收尾余量后约 2.9 秒）。
        assertTrue("解码长度 $seconds 秒过短", seconds > 2.0)
        assertTrue("解码长度 $seconds 秒不应超过上限", seconds <= 12.0)
    }
}
