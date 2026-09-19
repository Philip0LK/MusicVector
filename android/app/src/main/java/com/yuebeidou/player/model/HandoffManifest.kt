package com.yuebeidou.player.model

/** 精确分数。电脑端的时值是 BigInt 分数，这里用 Long —— 拍数不会超过几万。 */
data class Rational(val n: Long, val d: Long) {
    operator fun plus(other: Rational) = of(n * other.d + other.n * d, d * other.d)
    fun toDouble(): Double = n.toDouble() / d.toDouble()
    override fun toString(): String = if (d == 1L) n.toString() else "$n/$d"

    companion object {
        val ZERO = Rational(0, 1)

        fun of(numerator: Long, denominator: Long): Rational {
            require(denominator != 0L) { "分母不能为 0" }
            var n = numerator
            var d = denominator
            if (d < 0) {
                n = -n
                d = -d
            }
            val g = gcd(if (n < 0) -n else n, d)
            return Rational(n / g, d / g)
        }

        fun parse(text: String?): Rational? {
            if (text == null || text.isEmpty()) return null
            val index = text.indexOf('/')
            return if (index < 0) of(text.trim().toLong(), 1) else of(
                text.substring(0, index).trim().toLong(),
                text.substring(index + 1).trim().toLong(),
            )
        }

        private fun gcd(a: Long, b: Long): Long {
            var x = a
            var y = b
            while (y != 0L) {
                val next = x % y
                x = y
                y = next
            }
            return if (x == 0L) 1L else x
        }
    }
}

data class Meter(val beats: Int, val beatUnit: Int)

data class TempoEvent(val atIndex: Int?, val bpm: Double?, val beatTicks: Double?)

data class SongInfo(
    val id: String,
    val title: String,
    val key: String,
    val octave: Int,
    val bpm: Double,
    val meter: Meter,
    val pickup: Boolean,
    val ticksPerQuarter: Double,
    val baseBpm: Double,
    val baseBeatTicks: Double,
    val tempoEvents: List<TempoEvent>,
)

data class NoteInfo(
    val id: String,
    val degree: Int,
    val accidental: String?,
    val octave: Int,
    /** 电脑端算好的还原号/临时升降偏移；与基准音区无关。 */
    val pitchOffset: Int,
    val isRest: Boolean,
    /** 附点、连音组折算后的有效时值（播放用），null 表示未标注。 */
    val durationTicks: Rational?,
    /** 延音合并后的实际发声时值（电脑端算好），用来决定采样要解码多长。 */
    val soundDurationTicks: Rational?,
    /** 标注基值时值 6/12/24/48/96（排版用），未标注时为 null。 */
    val baseTicks: Int?,
    val tieToNext: Boolean,
    val measureEnd: Boolean,
    val missingDuration: Boolean,
    val dots: Int,
    val dotted: Boolean,
    val beamGroup: Int?,
)

data class CropSpec(
    val kind: String,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val top: Double,
    val bottom: Double,
    val quad: List<Pair<Double, Double>>,
    val rectifiedWidth: Double,
    val rectifiedHeight: Double,
    val originalWidth: Double,
    val originalHeight: Double,
    val fromOriginal: List<Double>,
    val rectifiedRect: RectSpec,
)

data class RectSpec(val x: Double, val y: Double, val width: Double, val height: Double)

data class RowArc(
    val id: String,
    val number: Int?,
    val start: Int?,
    val end: Int?,
    val level: Int,
    val typeSegment: String,
    val span: Int,
)

data class RowInfo(
    val index: Int,
    val page: Int,
    val line: Int,
    val text: String,
    val imageIndex: Int,
    val crop: CropSpec,
    val startNoteIndex: Int,
    val noteCount: Int,
    val seamNeedsReview: Boolean,
    val arcs: List<RowArc>,
)

data class MeasureInfo(
    val index: Int,
    val startIndex: Int,
    val endIndex: Int,
    val noteCount: Int,
    val beats: Double,
    val expectedBeats: Double,
    val totalTicks: Double,
    val expectedTicks: Double,
    val status: String,
    val meter: Meter,
    val meterChange: Boolean,
    val pickup: Boolean,
)

data class ImageInfo(val index: Int, val id: String, val name: String, val mime: String, val path: String)

data class HandoffManifest(
    val version: Int,
    val generatedAt: String,
    val song: SongInfo,
    val notes: List<NoteInfo>,
    val rows: List<RowInfo>,
    val measures: List<MeasureInfo>,
    val images: List<ImageInfo>,
)
