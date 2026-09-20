package com.yuebeidou.player.ui

import android.graphics.Paint
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.yuebeidou.player.model.HandoffManifest
import com.yuebeidou.player.model.NoteInfo
import com.yuebeidou.player.model.RowInfo
import com.yuebeidou.player.score.CropGeometry
import com.yuebeidou.player.score.EngraveGeometry

private val INK = Color(0xFF242424)
private val ACCENT = Color(0xFFB88612)
private val RANGE_FILL = Color(0xFFFFF1BF)
private val SELECT_FILL = Color(0xFFF2CE65)
private val BAND_BACKGROUND = Color(0xFFF7F7F5)
private val ROW_BACKGROUND = Color(0xFFFFFFFF)
private val METER_COLOR = Color(0xFF806119)
private val MISSING_COLOR = Color(0xFFB03A2E)
private val SEPARATOR = Color(0xFFE8E8E4)

/** 24 单位空间的纵向尺寸，与电脑端 SVG 的 viewBox 高度一致。 */
private const val MEASURE_UNIT_HEIGHT = 91f

/** 图片比例无法计算时的退路高度；正常情况下条带高度由图片自身比例决定。 */
private const val BAND_HEIGHT_DP = 44

/**
 * 一行谱：上面是原谱裁切图片带，下面是简谱。
 *
 * 条带按屏宽铺满：高度由裁切图自身比例算出来，不再固定 44dp。
 * 固定高度时图片只能按高度装进去，横向只占屏宽的一半左右并居中，
 * 与铺满整行的简谱对不齐；铺满后两者共用同一条左右边界。
 * 代价是原图分辨率低的页面会被放大得更多（放大由 Android 的双线性插值完成）。
 *
 * 排版数字来自 EngraveGeometry（与电脑端 lib/engraveGeometry.js 同源），
 * 绘制坐标沿用电脑端 SVG 的同一套数值（24 单位空间 × scale）。
 */
@Composable
fun ScoreRowItem(
    manifest: HandoffManifest,
    row: RowInfo,
    image: ImageBitmap?,
    fontSizePx: Float,
    activeIndex: Int,
    range: IntRange?,
    onNoteTap: (Int) -> Unit,
) {
    Column(Modifier.fillMaxWidth().background(ROW_BACKGROUND)) {
        ImageBand(image = image, row = row)
        if (row.noteCount > 0) {
            NotationRow(
                manifest = manifest,
                row = row,
                fontSizePx = fontSizePx,
                activeIndex = activeIndex,
                range = range,
                onNoteTap = onNoteTap,
            )
        }
    }
}

@Composable
private fun ImageBand(image: ImageBitmap?, row: RowInfo) {
    BoxWithConstraints(Modifier.fillMaxWidth().background(BAND_BACKGROUND)) {
        if (image == null) {
            Box(Modifier.fillMaxWidth().height(BAND_HEIGHT_DP.dp))
            return@BoxWithConstraints
        }
        val density = LocalDensity.current
        val widthPx = with(density) { maxWidth.toPx() }
        // 按屏宽铺满：条带高度 = 屏宽 ÷ 裁切图宽高比，图片与简谱因此左右对齐。
        val bandHeight = remember(image, row.index, widthPx) {
            val aspect = bandAspect(image, row)
            with(density) { CropGeometry.bandHeightPx(aspect.toDouble(), widthPx, BAND_HEIGHT_DP.dp.toPx()).toDp() }
        }
        Canvas(Modifier.fillMaxWidth().height(bandHeight)) {
            drawBandImage(image, row)
            drawLine(SEPARATOR, Offset(0f, size.height - 1f), Offset(size.width, size.height - 1f), 1f)
        }
    }
}

/** 裁切区域自身的宽高比；取数与 drawBandImage 完全一致，保证条带高度刚好装下整幅裁切图。 */
private fun bandAspect(image: ImageBitmap, row: RowInfo): Float {
    val naturalWidth = image.width.toFloat()
    val naturalHeight = image.height.toFloat()
    if (naturalWidth <= 0f || naturalHeight <= 0f) return 0f
    if (row.crop.kind == "rectified" && row.crop.fromOriginal.size >= 9 &&
        row.crop.rectifiedWidth > 0.0 && row.crop.rectifiedHeight > 0.0
    ) {
        val width = row.crop.rectifiedRect.width * row.crop.rectifiedWidth
        val height = row.crop.rectifiedRect.height * row.crop.rectifiedHeight
        if (width > 0.0 && height > 0.0) return (width / height).toFloat()
    }
    val box = CropGeometry.rect(row.crop, naturalWidth.toDouble(), naturalHeight.toDouble())
    val width = (box.width * naturalWidth).toFloat()
    val height = ((box.bottom - box.top) * naturalWidth).toFloat()
    if (width <= 0f || height <= 0f) return 0f
    return width / height
}

private fun DrawScope.drawBandImage(image: ImageBitmap, row: RowInfo) {
    val naturalWidth = image.width.toFloat()
    val naturalHeight = image.height.toFloat()
    if (naturalWidth <= 0f || naturalHeight <= 0f) return
    if (row.crop.kind == "rectified" && drawRectified(image, row)) return
    val box = CropGeometry.rect(row.crop, naturalWidth.toDouble(), naturalHeight.toDouble())
    val sourceWidth = (box.width * naturalWidth).toFloat()
    val sourceHeight = ((box.bottom - box.top) * naturalWidth).toFloat()
    if (sourceWidth <= 0f || sourceHeight <= 0f) return
    val left = (box.x * naturalWidth).toInt().coerceIn(0, (image.width - 1).coerceAtLeast(0))
    val top = (box.top * naturalWidth).toInt().coerceIn(0, (image.height - 1).coerceAtLeast(0))
    val scale = minOf(size.width / sourceWidth, size.height / sourceHeight)
    val drawWidth = sourceWidth * scale
    val drawHeight = sourceHeight * scale
    drawImage(
        image = image,
        srcOffset = IntOffset(left, top),
        srcSize = IntSize(
            sourceWidth.toInt().coerceIn(1, image.width - left),
            sourceHeight.toInt().coerceIn(1, image.height - top),
        ),
        dstOffset = IntOffset(((size.width - drawWidth) / 2f).toInt(), ((size.height - drawHeight) / 2f).toInt()),
        dstSize = IntSize(drawWidth.toInt().coerceAtLeast(1), drawHeight.toInt().coerceAtLeast(1)),
    )
}

/**
 * 透视校正裁切（在校对界面手动改过四边的谱行）。
 * 与电脑端 CropPreview 一致：rectified 空间取 rect 作为窗口，用 fromOriginal 把原图投影进来。
 *
 * @return 是否绘制成功；几何不完整时返回 false，由调用方退回矩形裁切。
 */
private fun DrawScope.drawRectified(image: ImageBitmap, row: RowInfo): Boolean {
    val rect = row.crop.rectifiedRect
    val rectifiedWidth = row.crop.rectifiedWidth
    val rectifiedHeight = row.crop.rectifiedHeight
    val values = row.crop.fromOriginal
    if (rectifiedWidth <= 0.0 || rectifiedHeight <= 0.0 || values.size < 9) return false
    val windowWidth = (rect.width * rectifiedWidth).toFloat()
    val windowHeight = (rect.height * rectifiedHeight).toFloat()
    if (windowWidth <= 0f || windowHeight <= 0f) return false
    val scale = minOf(size.width / windowWidth, size.height / windowHeight)
    val drawWidth = windowWidth * scale
    val drawHeight = windowHeight * scale
    val offsetX = (size.width - drawWidth) / 2f
    val offsetY = (size.height - drawHeight) / 2f
    val matrix = android.graphics.Matrix()
    matrix.setValues(
        floatArrayOf(
            values[0].toFloat(), values[1].toFloat(), values[2].toFloat(),
            values[3].toFloat(), values[4].toFloat(), values[5].toFloat(),
            values[6].toFloat(), values[7].toFloat(), values[8].toFloat(),
        ),
    )
    val outer = android.graphics.Matrix()
    outer.postScale(scale, scale)
    outer.postTranslate(
        offsetX - (rect.x * rectifiedWidth * scale).toFloat(),
        offsetY - (rect.y * rectifiedHeight * scale).toFloat(),
    )
    matrix.postConcat(outer)
    val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    drawIntoCanvas { canvas ->
        val native = canvas.nativeCanvas
        val checkpoint = native.save()
        native.clipRect(offsetX, offsetY, offsetX + drawWidth, offsetY + drawHeight)
        native.concat(matrix)
        native.drawBitmap(image.asAndroidBitmap(), 0f, 0f, paint)
        native.restoreToCount(checkpoint)
    }
    return true
}

private data class HitArea(val noteIndex: Int, val rect: Rect)

/** 几何量都是 Double，绘制接口要 Float：统一在这里换算。 */
private fun Double.px(scale: Float): Float = (this * scale).toFloat()

@Composable
private fun NotationRow(
    manifest: HandoffManifest,
    row: RowInfo,
    fontSizePx: Float,
    activeIndex: Int,
    range: IntRange?,
    onNoteTap: (Int) -> Unit,
) {
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    var widthPx by remember { mutableFloatStateOf(0f) }
    val rowNotes = manifest.notes.subList(row.startNoteIndex, row.startNoteIndex + row.noteCount)
    val scale = fontSizePx / EngraveGeometry.BASE_FONT_SIZE.toFloat()
    val available = if (widthPx > 0f) Math.max(1f, widthPx / scale) else 1000f
    val segments = remember(row.index, manifest.measures) {
        EngraveGeometry.measureSegments(rowNotes, row.startNoteIndex, manifest.measures)
    }
    val widths = remember(segments, available) {
        EngraveGeometry.allocateWidths(segments.map { it.minimum }, available.toDouble())
    }
    val layouts = remember(segments, widths) {
        segments.mapIndexed { index, segment ->
            EngraveGeometry.measureLayout(segment.notes, segment.minimum, widths[index])
        }
    }
    val arcSpace = remember(row.arcs, scale) {
        if (row.arcs.isEmpty()) 0f else (12 + row.arcs.maxOf { it.level } * 10) * scale
    }
    val heightPx = arcSpace + MEASURE_UNIT_HEIGHT * scale + 6f * scale
    val hitAreas = remember(segments, layouts, widths, scale) {
        buildHitAreas(segments, layouts, widths, row.startNoteIndex, scale)
    }
    val measureOffsets = remember(widths, scale) {
        val offsets = ArrayList<Float>(widths.size + 1)
        var x = 0f
        offsets.add(0f)
        widths.forEach { x += it.px(scale); offsets.add(x) }
        offsets
    }

    Canvas(
        Modifier
            .fillMaxWidth()
            .height(with(density) { heightPx.toDp() })
            .onSizeChanged { widthPx = it.width.toFloat() }
            .pointerInput(row.index, hitAreas) {
                detectTapGestures { position ->
                    hitAreas.firstOrNull { it.rect.contains(position) }?.let { onNoteTap(it.noteIndex) }
                }
            },
    ) {
        val baseY = arcSpace
        segments.forEachIndexed { index, segment ->
            val layout = layouts[index]
            val measureX = measureOffsets[index]
            val local = activeIndex - row.startNoteIndex - segment.start
            if (segment.measure.meterChange) {
                drawTextAt(
                    measurer = measurer,
                    text = "${segment.measure.meter.beats}/${segment.measure.meter.beatUnit}",
                    x = measureX + 4f * scale,
                    baselineY = baseY + 16f * scale,
                    sizePx = 14f * scale,
                    color = METER_COLOR,
                )
            }
            drawRangeFill(range, segment, layout, measureX, baseY, scale, row.startNoteIndex)
            if (local in segment.notes.indices) {
                val position = layout.positions[local]
                drawRoundRect(
                    color = SELECT_FILL,
                    topLeft = Offset(measureX + position.x.px(scale) - 3f * scale, baseY + 29f * scale),
                    size = Size(layout.items[local].width.px(scale) + 6f * scale, 44f * scale),
                    cornerRadius = CornerRadius(12f * scale, 12f * scale),
                )
            }
            segment.notes.forEachIndexed { noteIndex, note ->
                drawNote(measurer, note, layout, noteIndex, measureX, baseY, scale, fontSizePx)
            }
            drawBeams(segment, layout, measureX, baseY, scale, manifest, row.startNoteIndex)
            if (segment.notes.last().measureEnd) {
                val contentX = measureX + layout.content.px(scale)
                drawLine(
                    INK,
                    Offset(contentX - 2f * scale, baseY + 28f * scale),
                    Offset(contentX - 2f * scale, baseY + 80f * scale),
                    1f * scale,
                )
            }
        }
        drawRangeHandles(range, segments, layouts, measureOffsets, scale, arcSpace, row.startNoteIndex)
        drawArcs(row, segments, layouts, scale, arcSpace, measureOffsets)
    }
}

private fun DrawScope.drawNote(
    measurer: TextMeasurer,
    note: NoteInfo,
    layout: EngraveGeometry.MeasureLayout,
    noteIndex: Int,
    measureX: Float,
    baseY: Float,
    scale: Float,
    fontSizePx: Float,
) {
    val glyph = layout.items[noteIndex]
    val position = layout.positions[noteIndex]
    val x = measureX + position.x.px(scale)
    val cx = measureX + position.cx.px(scale)
    val accidental = when (note.accidental) {
        "natural" -> "♮"
        null -> null
        else -> note.accidental
    }
    if (glyph.acc > 0 && accidental != null) {
        drawTextAt(measurer, accidental, x, baseY + 56f * scale, 16f * scale, INK)
    }
    drawTextAt(measurer, note.degree.toString(), x + glyph.acc.px(scale), baseY + 57f * scale, fontSizePx, INK)
    if (note.octave > 0 && !glyph.rest) {
        repeat(minOf(2, note.octave)) { level ->
            drawCircle(INK, 1.7f * scale, Offset(cx, baseY + (31 - level * 5) * scale))
        }
    }
    if (note.octave < 0 && !glyph.rest) {
        val baseDot = if (glyph.lines > 0) 77f else 67f
        repeat(minOf(2, -note.octave)) { level ->
            drawCircle(INK, 1.7f * scale, Offset(cx, baseY + (baseDot + level * 5) * scale))
        }
    }
    if (glyph.dot) {
        drawCircle(INK, 1.7f * scale, Offset(x + (glyph.acc + 18.0).px(scale), baseY + 48f * scale))
    }
    repeat(glyph.tail) { tailIndex ->
        if (glyph.rest) {
            drawTextAt(
                measurer,
                "0",
                x + (17.0 * (tailIndex + 1)).px(scale),
                baseY + 57f * scale,
                fontSizePx,
                INK,
            )
        } else {
            val tailStart = x + (glyph.acc + 17.0 + tailIndex * 10).px(scale)
            val tailEnd = x + (glyph.acc + 24.0 + tailIndex * 10).px(scale)
            drawLine(INK, Offset(tailStart, baseY + 49f * scale), Offset(tailEnd, baseY + 49f * scale), 1f * scale)
        }
    }
    if (note.missingDuration) {
        drawTextAt(measurer, "?", cx - 4f * scale, baseY + 83f * scale, 12f * scale, MISSING_COLOR)
    }
}

private fun buildHitAreas(
    segments: List<EngraveGeometry.Segment>,
    layouts: List<EngraveGeometry.MeasureLayout>,
    widths: List<Double>,
    rowStartNoteIndex: Int,
    scale: Float,
): List<HitArea> {
    val areas = mutableListOf<HitArea>()
    var measureX = 0f
    segments.forEachIndexed { index, segment ->
        val layout = layouts[index]
        segment.notes.forEachIndexed { noteIndex, _ ->
            val position = layout.positions[noteIndex]
            val left = if (noteIndex == 0) 0f else ((position.x + layout.positions[noteIndex - 1].end) / 2.0).px(scale)
            val right = if (noteIndex + 1 < segment.notes.size) {
                ((position.end + layout.positions[noteIndex + 1].x) / 2.0).px(scale)
            } else {
                layout.content.px(scale)
            }
            areas.add(
                HitArea(
                    noteIndex = rowStartNoteIndex + segment.start + noteIndex,
                    rect = Rect(measureX + left, 23f * scale, measureX + right, 85f * scale),
                ),
            )
        }
        measureX += widths[index].px(scale)
    }
    return areas
}

private fun DrawScope.drawBeams(
    segment: EngraveGeometry.Segment,
    layout: EngraveGeometry.MeasureLayout,
    measureX: Float,
    baseY: Float,
    scale: Float,
    manifest: HandoffManifest,
    rowStartNoteIndex: Int,
) {
    layout.items.forEachIndexed { index, glyph ->
        repeat(glyph.lines) { level ->
            val position = layout.positions[index]
            val next = layout.items.getOrNull(index + 1)
            val global = rowStartNoteIndex + segment.start + index
            val group = manifest.notes.getOrNull(global)?.beamGroup
            val nextGroup = manifest.notes.getOrNull(global + 1)?.beamGroup
            val connected = next != null && next.lines > level && group != null && group == nextGroup
            val startX = measureX + position.cx.px(scale) - 7f * scale
            val endX = if (connected) {
                measureX + layout.positions[index + 1].cx.px(scale) + 7f * scale
            } else {
                measureX + position.cx.px(scale) + 7f * scale
            }
            val y = baseY + (64 + level * 5) * scale
            drawLine(INK, Offset(startX, y), Offset(endX, y), 1f * scale)
        }
    }
}

private fun DrawScope.drawRangeFill(
    range: IntRange?,
    segment: EngraveGeometry.Segment,
    layout: EngraveGeometry.MeasureLayout,
    measureX: Float,
    baseY: Float,
    scale: Float,
    rowStartNoteIndex: Int,
) {
    if (range == null) return
    segment.notes.forEachIndexed { index, _ ->
        val global = rowStartNoteIndex + segment.start + index
        if (global < range.first || global > range.last) return@forEachIndexed
        val left = if (index == 0) 0f else ((layout.positions[index - 1].end + layout.positions[index].x) / 2.0).px(scale)
        val right = if (index + 1 < segment.notes.size) {
            ((layout.positions[index].end + layout.positions[index + 1].x) / 2.0).px(scale)
        } else {
            layout.content.px(scale)
        }
        drawRect(
            color = RANGE_FILL,
            topLeft = Offset(measureX + left, baseY + 23f * scale),
            size = Size(right - left + 0.5f, 60f * scale),
        )
    }
}

private fun DrawScope.drawRangeHandles(
    range: IntRange?,
    segments: List<EngraveGeometry.Segment>,
    layouts: List<EngraveGeometry.MeasureLayout>,
    measureOffsets: List<Float>,
    scale: Float,
    arcSpace: Float,
    rowStartNoteIndex: Int,
) {
    if (range == null) return
    segments.forEachIndexed { index, segment ->
        val layout = layouts[index]
        val measureX = measureOffsets[index]
        segment.notes.forEachIndexed { noteIndex, _ ->
            val global = rowStartNoteIndex + segment.start + noteIndex
            val isStart = global == range.first
            val isEnd = global == range.last
            if (isStart || isEnd) {
                val position = layout.positions[noteIndex]
                val x = measureX + (if (isStart) position.x.px(scale) - 5f * scale else position.end.px(scale) + 4f * scale)
                drawLine(ACCENT, Offset(x, arcSpace + 26f * scale), Offset(x, arcSpace + 79f * scale), 2.5f * scale)
                drawCircle(ACCENT, 3.5f * scale, Offset(x, arcSpace + (if (isStart) 26f else 79f) * scale))
            }
        }
    }
}

private fun DrawScope.drawArcs(
    row: RowInfo,
    segments: List<EngraveGeometry.Segment>,
    layouts: List<EngraveGeometry.MeasureLayout>,
    scale: Float,
    arcSpace: Float,
    measureOffsets: List<Float>,
) {
    if (row.arcs.isEmpty()) return
    val centers = HashMap<Int, Float>()
    segments.forEachIndexed { index, segment ->
        val layout = layouts[index]
        val measureX = measureOffsets[index]
        segment.notes.forEachIndexed { noteIndex, _ ->
            centers[segment.start + noteIndex] = measureX + layout.positions[noteIndex].cx.px(scale)
        }
    }
    val rowWidth = measureOffsets.lastOrNull() ?: 0f
    for (arc in row.arcs) {
        val x1 = arc.start?.let { centers[it] } ?: 0f
        val x2 = arc.end?.let { centers[it] } ?: rowWidth
        val y = arcSpace + 22f * scale - arc.level * 6f * scale
        val height = (12 + arc.level * 10) * scale
        val path = Path()
        path.moveTo(x1, y)
        path.quadraticTo((x1 + x2) / 2f, y - height * 2f, x2, y)
        drawPath(path, INK, style = Stroke(width = 1.4f * scale))
    }
}

private fun DrawScope.drawTextAt(
    measurer: TextMeasurer,
    text: String,
    x: Float,
    baselineY: Float,
    sizePx: Float,
    color: Color,
    bold: Boolean = false,
) {
    val layout = measurer.measure(
        AnnotatedString(text),
        TextStyle(
            color = color,
            fontSize = sizePx.toSp(),
            fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
        ),
    )
    drawText(layout, topLeft = Offset(x, baselineY - layout.firstBaseline))
}
