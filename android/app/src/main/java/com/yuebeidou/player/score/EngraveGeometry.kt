package com.yuebeidou.player.score

import com.yuebeidou.player.model.MeasureInfo
import com.yuebeidou.player.model.NoteInfo

/** 字形几何的纯计算部分，与电脑端 lib/engraveGeometry.js 同源。 */
object EngraveGeometry {
    const val DIGIT_WIDTH = 14.0
    const val NOTE_ADVANCE = 5.0
    const val MEASURE_PADDING = 16.0
    const val BASE_FONT_SIZE = 24.0
    const val MEASURE_HEIGHT = 91.0

    data class Glyph(
        val acc: Double,
        val tail: Int,
        val rest: Boolean,
        val dot: Boolean,
        val lines: Int,
        val width: Double,
        val weight: Double,
    )

    data class NotePosition(val x: Double, val cx: Double, val end: Double)

    data class MeasureLayout(
        val items: List<Glyph>,
        val positions: List<NotePosition>,
        val content: Double,
        val overflow: Boolean,
    )

    data class Segment(
        val start: Int,
        val notes: List<NoteInfo>,
        val measure: MeasureInfo,
        val minimum: Double,
    )

    fun glyph(note: NoteInfo): Glyph {
        // 注意：这里用的是标注基值时值（6/12/24/48/96），不是附点折算后的有效时值。
        val base = note.baseTicks ?: 24
        val beats = base / 24.0 * (if (note.dotted) 1.5 else 1.0)
        val tail = if (beats >= 2) Math.floor(beats).toInt() - 1 else 0
        val rest = note.isRest
        val acc = if (note.accidental != null && !rest) 12 else 0
        val dot = note.dotted && beats < 2
        return Glyph(
            acc = acc.toDouble(),
            tail = tail,
            rest = rest,
            dot = dot,
            lines = if (base == 6) 2 else if (base == 12) 1 else 0,
            width = (acc + DIGIT_WIDTH + tail * (if (rest) 17.0 else 10.0) + (if (dot) 7.0 else 0.0)),
            weight = 1 + Math.max(0.0, Math.log((base / 6.0)) / Math.log(2.0)) * 0.16,
        )
    }

    fun measureMinimum(notes: List<NoteInfo>): Double =
        notes.sumOf { glyph(it).width + NOTE_ADVANCE } + MEASURE_PADDING

    /** 先按字形下限等比放大铺满，放不下时再等比压缩到统一上限。 */
    fun allocateWidths(minimums: List<Double>, width: Double): List<Double> {
        if (minimums.isEmpty()) return emptyList()
        val total = minimums.sum()
        if (total <= width) return minimums.map { it + (width - total) * it / total }
        var lo = 0.0
        var hi = minimums.max()
        repeat(40) {
            val cap = (lo + hi) / 2
            if (minimums.sumOf { minOf(it, cap) } > width) hi = cap else lo = cap
        }
        return minimums.map { minOf(it, lo) }
    }

    fun measureLayout(notes: List<NoteInfo>, minimum: Double, width: Double): MeasureLayout {
        val items = notes.map { glyph(it) }
        val content = Math.max(minimum, width)
        val sum = items.sumOf { it.weight }
        val extra = Math.max(0.0, content - minimum)
        var x = 9.0
        val positions = items.map { item ->
            val position = NotePosition(x = x, cx = x + item.acc + 7.0, end = x + item.width)
            x += item.width + NOTE_ADVANCE + (if (sum > 0) extra * item.weight / sum else 0.0)
            position
        }
        return MeasureLayout(items, positions, content, minimum > width + 0.5)
    }

    fun measureSegments(
        rowNotes: List<NoteInfo>,
        rowOffset: Int,
        allMeasures: List<MeasureInfo>,
    ): List<Segment> {
        val segments = mutableListOf<Segment>()
        var start = 0
        while (start < rowNotes.size) {
            val global = rowOffset + start
            val measure = allMeasures.firstOrNull { global >= it.startIndex && global <= it.endIndex }
                ?: MeasureInfo(0, rowOffset, rowOffset + rowNotes.size - 1, rowNotes.size, 0.0, 0.0, 0.0, 0.0, "incomplete", com.yuebeidou.player.model.Meter(4, 4), false, false)
            val end = Math.max(start + 1, Math.min(rowNotes.size, measure.endIndex - rowOffset + 1))
            val notes = rowNotes.subList(start, end)
            segments.add(Segment(start, notes, measure, measureMinimum(notes)))
            start = end
        }
        return segments
    }
}
