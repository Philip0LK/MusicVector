package com.yuebeidou.player.ui

import com.yuebeidou.player.model.HandoffManifest
import com.yuebeidou.player.model.Pitch

/** 练习操作的纯规则。与电脑端 training.js 的 clampIndex / nextIndex / normalizedRange 同义。 */
object PracticeRules {
    fun clampIndex(index: Int, count: Int): Int {
        if (count <= 0) return 0
        return index.coerceIn(0, count - 1)
    }

    /** 有选段时在片段内环绕；没有选段时到边界就停住（电脑端同款）。 */
    fun nextIndex(index: Int, direction: Int, count: Int, range: IntRange?): Int {
        if (range == null) return clampIndex(index + direction, count)
        return when {
            index + direction > range.last -> range.first
            index + direction < range.first -> range.last
            else -> index + direction
        }
    }

    fun normalizedRange(a: Int, b: Int, count: Int): IntRange {
        val first = clampIndex(a, count)
        val second = clampIndex(b, count)
        return if (first <= second) first..second else second..first
    }

    fun rateFrom(value: Double): Double {
        val clamped = value.coerceIn(0.25, 1.25)
        return Math.round(clamped * 20) / 20.0
    }

    /**
     * 试听一个音时，延音要连着响完：向后延伸到延音链条的末端，但不越过选段末尾。
     * 对应电脑端 audition() 里的 while (end < limit && tieLinks[end]) end++。
     */
    fun auditionEnd(manifest: HandoffManifest, index: Int, range: IntRange?): Int {
        val limit = range?.last ?: (manifest.notes.size - 1)
        var end = index
        while (end < limit && manifest.notes.getOrNull(end)?.tieToNext == true) end += 1
        return end
    }

    fun rowOfNote(manifest: HandoffManifest, index: Int): Int {
        val note = index.coerceIn(0, (manifest.notes.size - 1).coerceAtLeast(0))
        return manifest.rows.lastOrNull { it.startNoteIndex <= note }?.index ?: 0
    }

    /** 训练页忽略没有音符的行，行号要按「有音符的行」换算。 */
    fun visibleRows(manifest: HandoffManifest): List<Int> =
        manifest.rows.filter { it.noteCount > 0 }.map { it.index }

    /**
     * 本次练习要解码哪些采样、每个采样解码多长。
     *
     * 采样文件本身很长（最长二十多秒），整段解码会占几十 MB；而一个音最多只响
     * 「它自己的时长 + 收尾」，所以按最慢倍速下的最长音截断就够。
     */
    fun sampleRequest(
        manifest: HandoffManifest,
        key: String,
        octave: Int,
        slowestRate: Double = 0.25,
        capSeconds: Double = 12.0,
    ): Pair<List<Int>, Double> {
        val midis = manifest.notes.filter { !it.isRest }.mapNotNull { Pitch.midiFor(it, key, octave) }.distinct()
        val ticks = manifest.notes.mapNotNull { it.soundDurationTicks?.toDouble() }.maxOrNull() ?: 24.0
        val beatTicks = if (manifest.song.baseBeatTicks > 0) manifest.song.baseBeatTicks else 24.0
        val bpm = if (manifest.song.baseBpm > 0) manifest.song.baseBpm else 80.0
        val secondsPerTick = 60.0 / (bpm * slowestRate * beatTicks)
        return midis to (ticks * secondsPerTick + 0.2).coerceAtMost(capSeconds)
    }
}
