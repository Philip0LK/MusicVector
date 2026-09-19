package com.yuebeidou.player.model

/** 一次播放里某个音的调度信息。字段与电脑端 buildRhythmPlaybackPlan 的 steps 一一对应。 */
data class PlaybackStep(
    val index: Int,
    val startTicks: Rational,
    val durationTicks: Rational?,
    val trigger: Boolean,
    val isRest: Boolean,
    val tieContinuation: Boolean,
    val soundDurationTicks: Rational,
    val startSeconds: Double,
    val durationSeconds: Double,
    val soundDurationSeconds: Double,
)

data class PlaybackPlan(
    val tempo: Double,
    val baseTempo: Double,
    val practiceRate: Double,
    val startIndex: Int,
    val endIndex: Int,
    val steps: List<PlaybackStep>,
    val missingIndexes: List<Int>,
    val totalSeconds: Double,
)

/**
 * 播放计划：只吃曲目包，不重写音乐结构。
 *
 * 与电脑端 lib/rhythmPlayback.js 的对应关系：
 * - 时值来自曲目包（含附点/连音组折算），延音关系来自逐音 tieToNext；
 * - 首个音永远不是延音延续（电脑端用 index > firstIndex 判定），从区间头开始播就要重新起声；
 * - ticks→秒 用电脑端导出的 baseBpm/baseBeatTicks + 本次计划速度，逐音查 tempoEvents。
 */
object PlaybackPlanner {
    fun plan(
        manifest: HandoffManifest,
        startIndex: Int = 0,
        endIndex: Int? = null,
        settingBpm: Double = manifest.song.bpm,
        rate: Double = 1.0,
    ): PlaybackPlan {
        val notes = manifest.notes
        val count = notes.size
        if (count == 0) {
            return PlaybackPlan(settingBpm * rate, manifest.song.bpm, rate, 0, 0, emptyList(), emptyList(), 0.0)
        }
        val first = startIndex.coerceIn(0, count - 1)
        val last = if (endIndex == null) count - 1 else endIndex.coerceIn(first, count - 1)
        val songBpm = manifest.song.bpm
        val tempo = settingBpm * rate
        val practiceRate = if (songBpm > 0) tempo / songBpm else 1.0
        val secondsPerTickAt = secondsPerTick(manifest, practiceRate)

        val missing = mutableListOf<Int>()
        val steps = mutableListOf<PlaybackStep>()
        var startTicks = Rational.ZERO
        var startSeconds = 0.0

        for (index in first..last) {
            val duration = notes[index].durationTicks
            if (duration == null) missing.add(index)
            val previousTiesHere = index > first && notes[index - 1].tieToNext
            val isRest = notes[index].isRest
            val durationSeconds = if (duration == null) 0.0 else duration.toDouble() * secondsPerTickAt(index)
            var soundDuration = duration ?: Rational.ZERO
            var soundDurationSeconds = durationSeconds
            var tiedIndex = index
            if (!isRest && !previousTiesHere && duration != null) {
                while (tiedIndex < last && notes[tiedIndex].tieToNext) {
                    val next = notes[tiedIndex + 1].durationTicks ?: break
                    soundDuration += next
                    soundDurationSeconds += next.toDouble() * secondsPerTickAt(tiedIndex + 1)
                    tiedIndex += 1
                }
            }
            steps.add(
                PlaybackStep(
                    index = index,
                    startTicks = startTicks,
                    durationTicks = duration,
                    trigger = !isRest && !previousTiesHere && duration != null,
                    isRest = isRest,
                    tieContinuation = previousTiesHere,
                    soundDurationTicks = soundDuration,
                    startSeconds = startSeconds,
                    durationSeconds = durationSeconds,
                    soundDurationSeconds = soundDurationSeconds,
                ),
            )
            startTicks += duration ?: Rational.ZERO
            startSeconds += durationSeconds
        }
        return PlaybackPlan(
            tempo = tempo,
            baseTempo = songBpm,
            practiceRate = practiceRate,
            startIndex = first,
            endIndex = last,
            steps = steps,
            missingIndexes = missing,
            totalSeconds = startSeconds,
        )
    }

    private fun secondsPerTick(manifest: HandoffManifest, practiceRate: Double): (Int) -> Double {
        val events = manifest.song.tempoEvents
        val baseBpm = manifest.song.baseBpm
        val baseBeatTicks = manifest.song.baseBeatTicks
        val safeRate = if (practiceRate > 0) practiceRate else 1.0
        return { index ->
            var bpm = baseBpm
            var beatTicks = baseBeatTicks
            for (event in events) {
                val at = event.atIndex ?: break
                if (at > index) break
                val eventBpm = event.bpm
                val eventBeat = event.beatTicks
                if (eventBpm != null && eventBpm > 0 && eventBeat != null && eventBeat > 0) {
                    bpm = eventBpm
                    beatTicks = eventBeat
                }
            }
            60.0 / (bpm * safeRate * beatTicks)
        }
    }
}
