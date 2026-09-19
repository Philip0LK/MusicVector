package com.yuebeidou.player.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.yuebeidou.player.model.PlaybackPlan
import java.nio.ByteOrder
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/**
 * 钢琴播放。行为对齐电脑端 audio.js。
 *
 * 为什么不用 SoundPool：它起声有设备输出延迟且不告诉我起声时刻，于是「按计划时刻切音」
 * 必然让每个音少响一个延迟量（短音损失比例更大，16 分会被听成"比两倍还快"）。
 * 这里改成自己解码 PCM、用 AudioTrack 流式混音：起声帧、包络收尾都精确落在采样帧上，
 * 与电脑端 Web Audio 的调度精度同级，也顺带把电脑端的淡入淡出包络补齐（不再有音色差异）。
 */
class PianoPlayer(private val context: Context) {

    private class Pcm(val samples: ShortArray, val sampleRate: Int, val full: Boolean)

    private val cache = HashMap<Int, Pcm>()
    private val failed = HashSet<Int>()
    private val decoder = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "yuebeidou-decode") }
    private val main = Handler(Looper.getMainLooper())
    private val readyListeners = CopyOnWriteArrayList<() -> Unit>()
    private val uiTasks = ArrayList<Runnable>()

    private var track: AudioTrack? = null
    private var writer: Thread? = null
    @Volatile private var generation = 0

    var loaded = false
        private set
    var loops = 0
        private set
    var scheduled = 0
        private set

    /** 已经解码可用的采样数。 */
    val sampleCount: Int get() = synchronized(cache) { cache.size }

    /** 解码失败的音高；只影响对应音高，不阻断时间轴。 */
    val failedSamples: Set<Int> get() = synchronized(failed) { failed.toSet() }

    /** 第一条失败的原始原因（诊断用）。 */
    var loadError: String? = null
        private set

    /** 诊断：写入线程比实时落后多少毫秒（>50 说明混音跟不上，会断音）。 */
    @Volatile var worstWriteLagMillis = 0L
        private set

    /** 诊断：最差落后发生在起播后多少毫秒（判断是启动瞬间还是持续落后）。 */
    @Volatile var worstWriteLagAtMillis = 0L
        private set

    /** 采样表与电脑端 lib/piano.js 完全一致：midi 21 起每 3 个半音一个。 */
    val midiSamples: List<Int> = (0 until SAMPLE_COUNT).map { LOWEST_MIDI + it * 3 }

    private val outputRate: Int = run {
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        val reported = audioManager?.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toIntOrNull()
        if (reported != null && reported > 0) reported else 44100
    }

    /** 与电脑端 pianoSampleForMidi 相同的最近采样选择。 */
    private fun nearestSampleMidi(midi: Int): Int {
        val index = Math.round((midi - LOWEST_MIDI) / 3.0).toInt()
        return (LOWEST_MIDI + index * 3).coerceIn(LOWEST_MIDI, LOWEST_MIDI + (SAMPLE_COUNT - 1) * 3)
    }

    /**
     * 准备这些音高要用到的采样；[maxSoundSeconds] 决定每个采样解码多少。
     * 采样本身很长（低音能响到二十秒），正常播放只需要「最长音 + 收尾」那一段，按需截断。
     */
    fun prepare(neededMidis: Collection<Int>, maxSoundSeconds: Double, onReady: () -> Unit) {
        prepareInternal(neededMidis, maxSoundSeconds, full = false, onReady = onReady)
    }

    /**
     * 试听用：把这些音高解码到**整段采样**（低音会响到二十秒），
     * 试听不按谱面时值切，要让音自然响完。只影响被点的那一两个音高，内存可控。
     */
    fun prepareFull(neededMidis: Collection<Int>, onReady: () -> Unit) {
        prepareInternal(neededMidis, FULL_SAMPLE_SECONDS, full = true, onReady = onReady)
    }

    private fun prepareInternal(
        neededMidis: Collection<Int>,
        maxSoundSeconds: Double,
        full: Boolean,
        onReady: () -> Unit,
    ) {
        val wanted = neededMidis.map { nearestSampleMidi(it) }.toSet()
        val missing = wanted.filter { midi ->
            val cached = synchronized(cache) { cache[midi] }
            cached == null || (full && !cached.full)
        }
        if (missing.isEmpty()) {
            loaded = true
            onReady()
            return
        }
        readyListeners.add(onReady)
        decoder.execute {
            for (midi in missing) {
                val name = sampleFileName(midi)
                try {
                    val pcm = decode("piano/$name", maxSoundSeconds, full)
                    if (pcm == null || pcm.samples.isEmpty()) {
                        synchronized(failed) { failed.add(midi) }
                        if (loadError == null) loadError = "$name: 解码结果为空"
                    } else {
                        synchronized(cache) { cache[midi] = pcm }
                    }
                } catch (error: Exception) {
                    synchronized(failed) { failed.add(midi) }
                    if (loadError == null) {
                        loadError = "$name: ${error.javaClass.simpleName} ${error.message ?: ""}".trim()
                    }
                }
            }
            loaded = true
            warmUpMixer()
            main.post {
                val listeners = readyListeners.toList()
                readyListeners.clear()
                val longest = synchronized(cache) { cache.values.maxOfOrNull { it.samples.size.toDouble() / it.sampleRate } ?: 0.0 }
                android.util.Log.i(
                    "PianoPlayer",
                    "解码完成 采样=${sampleCount} 失败=${failedSamples.size} 最长=${Math.round(longest * 10) / 10.0}s " +
                        "原因=${loadError ?: "无"} 输出采样率=$outputRate",
                )
                listeners.forEach { it() }
            }
        }
    }

    fun stop() {
        generation += 1
        uiTasks.forEach { main.removeCallbacks(it) }
        uiTasks.clear()
        val current = track
        track = null
        if (current != null) {
            runCatching { current.pause() }
            runCatching { current.flush() }
            runCatching { current.release() }
        }
        writer?.let { runCatching { it.join(120) } }
        writer = null
    }

    /**
     * 预热混音路径：写入线程要实时产出，第一次走到混音代码时的类加载与 JIT
     * 会拖慢它（实测能造成上百毫秒的启动落后，撞上开头就有音的歌就会断一下）。
     */
    private fun warmUpMixer() {
        val scratch = ShortArray(CHUNK_FRAMES)
        val dummy = PcmMixer.Note(0, ShortArray(8192) { 1 }, outputRate, 1.0, 0.5)
        repeat(200) {
            java.util.Arrays.fill(scratch, 0)
            PcmMixer.mix(dummy, scratch, 0, CHUNK_FRAMES, 0L, outputRate)
        }
    }

    /** 与电脑端 player.later 同义：只在同一个 generation 内执行。 */
    fun later(delayMillis: Long, action: () -> Unit) {
        val current = generation
        lateinit var task: Runnable
        task = Runnable {
            synchronized(uiTasks) { uiTasks.remove(task) }
            if (current == generation) action()
        }
        synchronized(uiTasks) { uiTasks.add(task) }
        main.postDelayed(task, delayMillis)
    }

    /**
     * 播放一份计划。[fullLength] = true 时不按谱面时值切音，让采样自然响完（试听用）。
     */
    fun play(
        plan: PlaybackPlan,
        midiForIndex: (Int) -> Int?,
        onNote: (Int) -> Unit,
        onDone: () -> Unit,
        fullLength: Boolean = false,
    ) {
        stop()
        val current = generation
        worstWriteLagMillis = 0
        worstWriteLagAtMillis = 0
        scheduled = 0
        if (plan.steps.isEmpty()) {
            onDone()
            return
        }

        // 1) 把计划换算成输出帧上的音符事件；缺失采样只让该音静音，时间轴照旧。
        val notes = ArrayList<PcmMixer.Note>(plan.steps.size)
        val callbacks = ArrayList<Pair<Long, Int>>(plan.steps.size)
        var maxEndFrame = 0L
        for (step in plan.steps) {
            val startFrame = Math.round(step.startSeconds * outputRate)
            callbacks.add(startFrame to step.index)
            if (!step.trigger) continue
            val midi = midiForIndex(step.index) ?: continue
            val sampleMidi = nearestSampleMidi(midi)
            val pcm = synchronized(cache) { cache[sampleMidi] } ?: continue
            val note = PcmMixer.Note(
                startFrame = startFrame,
                source = pcm.samples,
                sourceRate = pcm.sampleRate,
                pitchRate = Math.pow(2.0, (midi - sampleMidi) / 12.0),
                // 试听不按谱面时值切，让采样自然响完。
                durationSeconds = if (fullLength) null else step.soundDurationSeconds,
            )
            notes.add(note)
            scheduled += 1
            maxEndFrame = Math.max(maxEndFrame, startFrame + note.frames(outputRate))
        }
        val tailFrames = Math.max(1, Math.round(END_PADDING_MILLIS / 1000.0 * outputRate))
        val totalFrames = maxEndFrame + tailFrames

        // 2) 起流：输出单声道 16 位，缓冲区尽量小以压低延迟（高亮延迟补偿也用它）。
        val minBytes = AudioTrack.getMinBufferSize(outputRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val bufferFrames = (minBytes / 2).coerceIn(CHUNK_FRAMES, MAX_BUFFER_FRAMES)
        val audioTrack = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(outputRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setBufferSizeInBytes(bufferFrames * 2)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
            .build()
        track = audioTrack
        val latencyMillis = bufferFrames * 1000L / outputRate
        val beganAt = SystemClock.uptimeMillis()
        startedAt = beganAt
        audioTrack.play()

        // 3) 写入线程：按帧把音符混进缓冲；高亮回调按「音频真正被听到的时刻」发回主线程。
        val thread = Thread({
            // 音频写入必须抢在界面渲染前面，否则会被主线程挤到断音。
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
            val buffer = ShortArray(CHUNK_FRAMES)
            var cursor = 0L
            var callbackCursor = 0
            try {
                while (current == generation && cursor < totalFrames) {
                    java.util.Arrays.fill(buffer, 0)
                    for (note in notes) {
                        if (note.startFrame + note.frames(outputRate) <= cursor) continue
                        if (note.startFrame >= cursor + CHUNK_FRAMES) break
                        PcmMixer.mix(note, buffer, 0, CHUNK_FRAMES, cursor, outputRate)
                    }
                    while (callbackCursor < callbacks.size && callbacks[callbackCursor].first < cursor + CHUNK_FRAMES) {
                        val (frame, index) = callbacks[callbackCursor]
                        val delay = latencyMillis + Math.max(0L, (frame - cursor) * 1000L / outputRate)
                        main.postDelayed(uiTask { if (current == generation) onNote(index) }, delay)
                        callbackCursor += 1
                    }
                    val written = audioTrack.write(buffer, 0, CHUNK_FRAMES)
                    if (written <= 0) break
                    cursor += written
                    val elapsed = SystemClock.uptimeMillis() - beganAt
                    val produced = cursor * 1000L / outputRate
                    val lag = elapsed - produced
                    if (lag > worstWriteLagMillis) {
                        worstWriteLagMillis = lag
                        worstWriteLagAtMillis = elapsed
                    }
                }
                val remaining = Math.max(0L, (totalFrames - cursor) * 1000L / outputRate + latencyMillis)
                android.util.Log.i(
                    "PianoPlayer",
                    "播放完成 混音音符=$scheduled 缓冲延迟=${latencyMillis}ms 最大落后=${worstWriteLagMillis}ms@${worstWriteLagAtMillis}ms " +
                        "欠载=${audioTrack.underrunCount} 产出=${cursor * 1000L / outputRate}ms 用时=${SystemClock.uptimeMillis() - beganAt}ms " +
                        "首批可听长度=" + notes.take(4).joinToString(",") {
                            "${Math.round(it.frames(outputRate) * 1000.0 / outputRate)}ms"
                        },
                )
                main.postDelayed(uiTask { if (current == generation) onDone() }, remaining)
            } catch (error: Exception) {
                android.util.Log.w("PianoPlayer", "写入线程异常：${error.message}")
            }
        }, "yuebeidou-audio")
        thread.isDaemon = true
        writer = thread
        thread.start()
    }

    private var startedAt = SystemClock.uptimeMillis()

    /** 注册一个可被 stop() 取消的主线程任务。 */
    private fun uiTask(action: () -> Unit): Runnable {
        lateinit var task: Runnable
        task = Runnable {
            synchronized(uiTasks) { uiTasks.remove(task) }
            action()
        }
        synchronized(uiTasks) { uiTasks.add(task) }
        return task
    }

    fun dispose() {
        stop()
        decoder.shutdownNow()
        synchronized(cache) { cache.clear() }
    }

    private fun decode(assetName: String, maxSeconds: Double, full: Boolean): Pcm? {
        val extractor = MediaExtractor()
        context.assets.openFd(assetName).use { descriptor ->
            extractor.setDataSource(descriptor.fileDescriptor, descriptor.startOffset, descriptor.length)
        }
        var trackIndex = -1
        var format: MediaFormat? = null
        for (index in 0 until extractor.trackCount) {
            val candidate = extractor.getTrackFormat(index)
            val mime = candidate.getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("audio/")) {
                trackIndex = index
                format = candidate
                break
            }
        }
        if (trackIndex < 0 || format == null) {
            extractor.release()
            return null
        }
        extractor.selectTrack(trackIndex)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: return null
        var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT).coerceAtLeast(1)
        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()
        var pcm = ShortArray(1 shl 16)
        var written = 0
        var inputDone = false
        var outputDone = false
        val info = MediaCodec.BufferInfo()
        try {
            while (!outputDone) {
                if (!inputDone) {
                    val inIndex = codec.dequeueInputBuffer(10_000)
                    if (inIndex >= 0) {
                        val input = codec.getInputBuffer(inIndex)!!
                        val size = extractor.readSampleData(input, 0)
                        if (size < 0) {
                            codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                when (val outIndex = codec.dequeueOutputBuffer(info, 10_000)) {
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val changed = codec.outputFormat
                        sampleRate = changed.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = changed.getInteger(MediaFormat.KEY_CHANNEL_COUNT).coerceAtLeast(1)
                    }
                    MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                    else -> if (outIndex >= 0) {
                        val output = codec.getOutputBuffer(outIndex)!!
                        output.position(info.offset)
                        output.limit(info.offset + info.size)
                        val shorts = output.order(ByteOrder.nativeOrder()).asShortBuffer()
                        val frames = info.size / 2 / channels
                        val limit = Math.min(frames, Math.round(maxSeconds * sampleRate).toInt() - written)
                        for (frame in 0 until limit) {
                            var sum = 0
                            for (channel in 0 until channels) sum += shorts.get(frame * channels + channel).toInt()
                            if (written >= pcm.size) pcm = pcm.copyOf(pcm.size * 2)
                            pcm[written++] = (sum / channels).toShort()
                        }
                        codec.releaseOutputBuffer(outIndex, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                        if (written >= Math.round(maxSeconds * sampleRate).toInt()) outputDone = true
                    }
                }
            }
        } finally {
            runCatching { codec.stop() }
            runCatching { codec.release() }
            runCatching { extractor.release() }
        }
        return Pcm(pcm.copyOf(written), sampleRate, full)
    }

    companion object {
        const val SAMPLE_COUNT = 30
        const val LOWEST_MIDI = 21
        const val CHUNK_FRAMES = 1024
        const val MAX_BUFFER_FRAMES = 4096
        const val END_PADDING_MILLIS = 110L

        /** 试听时解码整段采样的上限；最长的一份是 A0 的 24.7 秒，留出余量。 */
        const val FULL_SAMPLE_SECONDS = 30.0

        private val NOTE_NAMES = arrayOf(
            "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
        )

        /** 与电脑端 pianoSampleForMidi 的 URL 命名同源：# 编码为 s。 */
        fun sampleFileName(sampleMidi: Int): String {
            val octave = Math.floorDiv(sampleMidi, 12) - 1
            val name = NOTE_NAMES[Math.floorMod(sampleMidi, 12)].replace('#', 's')
            return "$name${octave}v6.ogg"
        }
    }
}
