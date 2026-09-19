package com.yuebeidou.player.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.yuebeidou.player.audio.PianoPlayer
import com.yuebeidou.player.model.HandoffManifest
import com.yuebeidou.player.model.Pitch
import com.yuebeidou.player.model.PlaybackPlan
import com.yuebeidou.player.model.PlaybackPlanner
import com.yuebeidou.player.settings.SettingsRepository

/**
 * 一次练习的全部状态与操作。
 *
 * 与电脑端 App.jsx / training.js 对齐的要点：
 * - 当前音未播放过时，上一音/下一音第一次只试听当前音，第二次才换音；
 * - 播放真正到达某个音才算「已播放」，定位或切行后重置；
 * - 选中片段后自动循环，每轮间隔 1 秒；
 * - 播放中调速会从当前音按新速度重新调度。
 */
class PracticeSession(
    val manifest: HandoffManifest,
    private val player: PianoPlayer,
    private val settings: SettingsRepository,
) {
    enum class Status { Paused, Loading, Playing, Waiting, Ended, Audition }

    private val stored = settings.song(
        songId = manifest.song.id,
        fallbackKey = manifest.song.key,
        fallbackOctave = manifest.song.octave,
        fallbackBpm = manifest.song.bpm,
    )

    private var playbackToken = 0
    private var playedIndex = 0
    private var playedValue = false

    var key by mutableStateOf(stored.key)
        private set
    var octave by mutableStateOf(stored.octave)
        private set
    var baseBpm by mutableStateOf(stored.bpm)
        private set
    var rate by mutableStateOf(PracticeRules.rateFrom(stored.rate))
        private set

    var cursor by mutableStateOf(manifest.notes.indexOfFirst { !it.isRest }.coerceAtLeast(0))
        private set
    var hasPlayed by mutableStateOf(false)
        private set
    var range by mutableStateOf<IntRange?>(null)
        private set
    var status by mutableStateOf(Status.Paused)
        private set
    var selecting by mutableStateOf(false)
        private set
    var anchor by mutableStateOf<Int?>(null)
        private set
    var follow by mutableStateOf(true)
    var notice by mutableStateOf("")
        private set
    var noticeToken by mutableStateOf(0)
        private set
    var revealRow by mutableStateOf<Int?>(null)
        private set
    var loops by mutableStateOf(0)
        private set

    init {
        playedIndex = cursor
    }

    val isActive: Boolean
        get() = status == Status.Playing || status == Status.Waiting ||
            status == Status.Loading || status == Status.Audition

    val noteCount: Int get() = manifest.notes.size

    val keyLabel: String get() = Pitch.label(key, octave)

    fun midiAt(index: Int): Int? = Pitch.midiForNoteIndex(manifest, index, key, octave)

    fun message(text: String) {
        notice = text
        noticeToken += 1
    }

    fun clearNotice() {
        notice = ""
    }

    /** 「回到当前音」：恢复自动跟随并定位当前音所在行（不改变当前音、选区与播放状态）。 */
    fun followCurrent() {
        follow = true
        revealRow = PracticeRules.rowOfNote(manifest, cursor)
    }

    fun choose(index: Int, keepRange: Boolean = true, reveal: Boolean = true) {
        pause()
        if (!keepRange && range?.contains(index) == false) range = null
        setCursor(index, false)
        if (reveal) revealRow = PracticeRules.rowOfNote(manifest, index)
    }

    fun setCursor(index: Int, didPlay: Boolean) {
        val safe = PracticeRules.clampIndex(index, noteCount)
        playedIndex = safe
        playedValue = didPlay
        cursor = safe
        hasPlayed = didPlay
    }

    fun startSelection() {
        pause()
        selecting = !selecting
        anchor = null
    }

    fun clearRange() {
        pause()
        range = null
        selecting = false
        anchor = null
    }

    fun tapNote(index: Int) {
        if (selecting) {
            val start = anchor
            if (start == null) {
                anchor = index
                setCursor(index, false)
            } else {
                range = PracticeRules.normalizedRange(start, index, noteCount)
                setCursor(minOf(start, index), false)
                anchor = null
                selecting = false
            }
            return
        }
        choose(index, keepRange = false, reveal = false)
        revealRow = PracticeRules.rowOfNote(manifest, index)
    }

    fun step(direction: Int) {
        val next = if (playedIndex == cursor && playedValue) {
            PracticeRules.nextIndex(cursor, direction, noteCount, range)
        } else {
            cursor
        }
        audition(next)
    }

    fun audition(index: Int = cursor) {
        if (noteCount == 0) return
        val start = PracticeRules.clampIndex(index, noteCount)
        val end = PracticeRules.auditionEnd(manifest, start, range)
        val plan = PlaybackPlanner.plan(manifest, start, end, baseBpm, rate)
        pause()
        status = Status.Audition
        setCursor(start, false)
        revealRow = PracticeRules.rowOfNote(manifest, start)
        startPlayback(plan, fullLength = true) { if (status == Status.Audition) status = Status.Paused }
    }

    fun play(start: Int = cursor, activeRange: IntRange? = range) {
        if (noteCount == 0) return
        val plan = PlaybackPlanner.plan(manifest, start, activeRange?.last, baseBpm, rate)
        if (plan.missingIndexes.isNotEmpty()) {
            message("选段中有未标注时值")
            return
        }
        pause()
        selecting = false
        anchor = null
        status = Status.Loading
        follow = true
        revealRow = PracticeRules.rowOfNote(manifest, plan.startIndex)
        startPlayback(plan) { onPlaybackDone(activeRange) }
    }

    private fun onPlaybackDone(activeRange: IntRange?) {
        if (activeRange == null) {
            status = Status.Ended
            return
        }
        status = Status.Waiting
        // player.later 与电脑端的 later 一样绑定 generation：暂停会顺手取消这一轮循环。
        player.later(1000) {
            loops += 1
            play(activeRange.first, activeRange)
        }
    }

    private fun startPlayback(plan: PlaybackPlan, fullLength: Boolean = false, onDone: () -> Unit) {
        playbackToken += 1
        val token = playbackToken
        val ready: () -> Unit = {
            if (token == playbackToken) {
                if (status == Status.Loading) status = Status.Playing
                player.play(
                    plan = plan,
                    midiForIndex = { index -> midiAt(index) },
                    onNote = { index ->
                        setCursor(index, true)
                        if (follow) revealRow = PracticeRules.rowOfNote(manifest, index)
                    },
                    onDone = { if (token == playbackToken) onDone() },
                    fullLength = fullLength,
                )
            }
        }
        if (fullLength) {
            // 试听要把音听全：按需解码整段采样（只影响被点到的音高）。
            val midis = plan.steps.filter { it.trigger }.mapNotNull { midiAt(it.index) }.distinct()
            player.prepareFull(midis, ready)
        } else {
            prepareSamples(ready)
        }
    }

    /** 提前把本曲要用的采样解码好；换调号后需要的采样会变，所以可以重复调用（已解码的不会重复做）。 */
    fun prepareSamples(onReady: () -> Unit = {}) {
        val (midis, longest) = PracticeRules.sampleRequest(manifest, key, octave)
        player.prepare(midis, longest, onReady)
    }

    fun pause() {
        playbackToken += 1
        player.stop()
        status = Status.Paused
    }

    fun togglePlay() {
        if (isActive) {
            pause()
            return
        }
        val start = if (status == Status.Ended) (range?.first ?: 0) else cursor
        play(start, range)
    }

    fun restart() {
        play(range?.first ?: 0, range)
    }

    fun changeRate(value: Double) {
        rate = PracticeRules.rateFrom(value)
        persist()
        if (isActive && status != Status.Audition) play(cursor, range)
    }

    fun changeKeyAndOctave(nextKey: String, nextOctave: Int) {
        key = nextKey
        octave = nextOctave.coerceIn(0, 8)
        persist()
        // 换了音区就会用到别的采样，后台补解码；已解码的不会重复做。
        prepareSamples()
    }

    fun changeBaseBpm(value: Double) {
        baseBpm = value.coerceIn(20.0, 240.0)
        persist()
    }

    private fun persist() {
        settings.saveSong(
            manifest.song.id,
            SettingsRepository.SongSettings(key = key, octave = octave, bpm = baseBpm, rate = rate),
        )
    }

    fun dispose() {
        player.stop()
    }
}
