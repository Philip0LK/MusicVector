package com.yuebeidou.player.audio

/**
 * 发声的纯计算层：把一个音混进输出缓冲。
 *
 * 这里没有 Android 依赖，因此可以在 JVM 上直接验证「一个音到底响多久」。
 *
 * 两种发声方式：
 * - 谱面音（[Note.durationSeconds] 非空）：可听窗口**正好等于它自己的时值**，八分正好是十六分的两倍。
 *   收尾淡出按比例取（不超过时值 30%），所以比例不会被淡出破坏，也不会出现硬切的爆音。
 *   这里**故意不照抄**旧电脑端的「时值 + 固定 35ms 收尾」——那个固定尾巴会把比例压成 1.87 而不是 2。
 * - 试听音（[Note.durationSeconds] 为空）：不按谱面时值切，让采样自然响完，只在末尾按比例淡出。
 *   试听是为了听清一个音，截成十六分的 227ms 反而不方便判断。
 */
object PcmMixer {
    /** 淡入时长上限（很短音会按比例缩短）。 */
    const val ATTACK_SECONDS = 0.008
    /** 淡入最多占时值的这个比例。 */
    const val ATTACK_FRACTION = 0.2
    /** 收尾淡出时长上限。 */
    const val RELEASE_SECONDS = 0.035
    /** 收尾最多占时值的这个比例——长短音同比例，比值恒定时值比。 */
    const val RELEASE_FRACTION = 0.3
    /** 试听时末尾淡出上限（采样数据总要有个头，不能硬切）。 */
    const val AUDITION_RELEASE_SECONDS = 0.03
    /** 电脑端 medium 力度采样增益 0.84 × 主增益 0.65。 */
    const val PEAK_GAIN = 0.84 * 0.65

    data class Note(
        /** 在输出流里的起声帧。 */
        val startFrame: Long,
        /** 源采样的单声道 PCM。 */
        val source: ShortArray,
        val sourceRate: Int,
        /** 音高倍率 2^((midi-sampleMidi)/12)。 */
        val pitchRate: Double,
        /** 音符本身的时长（秒）；null = 试听，让采样自然响完。 */
        val durationSeconds: Double?,
        val gain: Double = PEAK_GAIN,
    ) {
        /** 每个输出帧消耗多少源帧。 */
        fun step(outputRate: Int): Double = sourceRate.toDouble() / outputRate * pitchRate

        /** 这个音在输出里占多少帧：按时值切，或者把整段采样用完。 */
        fun frames(outputRate: Int): Long {
            val duration = durationSeconds
            if (duration != null) return Math.round(duration * outputRate).coerceAtLeast(1)
            return Math.floor((source.size - 1) / step(outputRate)).toLong().coerceAtLeast(1)
        }

        /** 实际占用的秒数（试听时等于整段采样的长度）。 */
        fun totalSeconds(outputRate: Int): Double = frames(outputRate).toDouble() / outputRate
    }

    /** 谱面音的包络：可听窗口正好是时值本身。 */
    fun envelopeGain(t: Double, durationSeconds: Double): Double {
        if (t < 0.0 || t >= durationSeconds) return 0.0
        val attack = Math.min(ATTACK_SECONDS, durationSeconds * ATTACK_FRACTION)
        val release = Math.min(RELEASE_SECONDS, durationSeconds * RELEASE_FRACTION)
        val sustainUntil = durationSeconds - release
        return when {
            t < attack -> t / attack
            t < sustainUntil -> 1.0
            else -> (durationSeconds - t) / release
        }.coerceIn(0.0, 1.0)
    }

    /** 试听音的包络：淡入后一直保持，只在整段采样的末尾淡出。 */
    fun auditionEnvelopeGain(t: Double, totalSeconds: Double): Double {
        if (t < 0.0 || t >= totalSeconds) return 0.0
        val attack = Math.min(ATTACK_SECONDS, totalSeconds * ATTACK_FRACTION)
        val release = Math.min(AUDITION_RELEASE_SECONDS, totalSeconds * RELEASE_FRACTION)
        val sustainUntil = totalSeconds - release
        return when {
            t < attack -> t / attack
            t < sustainUntil -> 1.0
            else -> (totalSeconds - t) / release
        }.coerceIn(0.0, 1.0)
    }

    /** 任一时间点的增益（按这个音是谱面音还是试听音自动选规则）。 */
    fun gainAt(note: Note, t: Double, outputRate: Int): Double {
        val duration = note.durationSeconds
        return if (duration != null) envelopeGain(t, duration) else auditionEnvelopeGain(t, note.totalSeconds(outputRate))
    }

    /**
     * 把一个音混进 [out] 的 [chunkStartFrame, chunkStartFrame+frames) 这一段。
     * 越界与包络外一律跳过；相加后夹到 16 位范围（和普通数字混音一样）。
     */
    fun mix(note: Note, out: ShortArray, outOffset: Int, frames: Int, chunkStartFrame: Long, outputRate: Int) {
        val step = note.step(outputRate)
        val eventEnd = note.startFrame + note.frames(outputRate)
        val from = Math.max(note.startFrame, chunkStartFrame)
        val to = Math.min(eventEnd, chunkStartFrame + frames)
        if (to <= from) return
        for (frame in from until to) {
            val gain = gainAt(note, (frame - note.startFrame).toDouble() / outputRate, outputRate) * note.gain
            if (gain <= 0.0) continue
            val position = (frame - note.startFrame) * step
            val index = position.toInt()
            if (index < 0 || index + 1 >= note.source.size) continue
            val fraction = position - index
            val value = note.source[index] * (1 - fraction) + note.source[index + 1] * fraction
            val slot = outOffset + (frame - chunkStartFrame).toInt()
            val mixed = out[slot] + value * gain
            out[slot] = mixed.coerceIn(-32768.0, 32767.0).toInt().toShort()
        }
    }

    /** 输出流里最后一个还会发声的帧——测试用它验证"一个音到底响多久"。 */
    fun lastAudibleFrame(note: Note, outputRate: Int): Long {
        val eventEnd = note.startFrame + note.frames(outputRate)
        var last = -1L
        var frame = note.startFrame
        while (frame < eventEnd) {
            if (gainAt(note, (frame - note.startFrame).toDouble() / outputRate, outputRate) > 0.0) last = frame
            frame += 1
        }
        return last
    }
}
