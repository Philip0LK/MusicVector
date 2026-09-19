package com.yuebeidou.player

import com.yuebeidou.player.model.HandoffManifest
import com.yuebeidou.player.model.PlaybackPlanner
import com.yuebeidou.player.model.Pitch
import com.yuebeidou.player.score.CropGeometry
import com.yuebeidou.player.score.EngraveGeometry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * 安卓端与电脑端的对齐测试。
 *
 * 期望值全部来自电脑端正在运行的算法（node tools/mobile-fixtures.mjs 生成）。
 * 这里任何一条失败都意味着手机上的播放/排版会和电脑端不一致，必须先查清原因。
 *
 * 个人曲谱夹具 salon.json 不随仓库提供，缺少时相关断言自动跳过。
 */
class DesktopParityTest {
    private fun close(expected: Double, actual: Double, label: String) {
        val tolerance = 1e-9 * Math.max(1.0, Math.abs(expected))
        assertTrue("$label：期望 $expected，实际 $actual", Math.abs(expected - actual) <= tolerance)
    }

    /** 有个人曲谱夹具时一并对照《沙龙》，否则只对照合成曲。 */
    private fun parityCases(): List<Pair<String, HandoffManifest>> = buildList {
        if (Fixtures.hasSalon()) add("沙龙" to Fixtures.salon())
        add("合成曲" to Fixtures.synthetic())
    }

    @Test
    fun `曲目包解析出与电脑端一致的规模`() {
        if (Fixtures.hasSalon()) {
            val salon = Fixtures.salon()
            assertEquals(1, salon.version)
            assertEquals("沙龙", salon.song.title)
            assertEquals("E", salon.song.key)
            assertEquals(4, salon.song.octave)
            assertEquals(80.0, salon.song.bpm, 1e-9)
            assertEquals(4, salon.song.meter.beats)
            assertEquals(4, salon.song.meter.beatUnit)
            assertTrue(salon.song.pickup)
            assertEquals(473, salon.notes.size)
            assertEquals(18, salon.rows.size)
            assertEquals(4, salon.images.size)
            assertEquals(74, salon.measures.size)
            assertEquals("pickup", salon.measures[0].status)
            // README：开头 18 个休止符，第一个有声旋律音是第 19 个音。
            assertEquals(18, salon.notes.indexOfFirst { !it.isRest })
            assertEquals(0, salon.notes.count { it.missingDuration })
            assertEquals(0, salon.rows[0].startNoteIndex)
            assertEquals(20, salon.rows[0].noteCount)
            assertEquals("band", salon.rows[0].crop.kind)
            close(0.385, salon.rows[0].crop.top, "band top")
            close(0.48, salon.rows[0].crop.bottom, "band bottom")
        }
        // 合成曲必须真的带延音，否则延音合并这条路没有被覆盖。
        assertEquals(3, Fixtures.synthetic().notes.count { it.tieToNext })
    }

    @Test
    fun `播放计划逐字段复算电脑端（含延音合并、附点、休止、区间与倍速）`() {
        for ((name, manifest) in parityCases()) {
            val root = Fixtures.root(if (name == "沙龙") "salon.json" else "synthetic.json")
            val plans = root.getJSONArray("plans")
            for (index in 0 until plans.length()) {
                val expected = plans.getJSONObject(index)
                val label = "$name/${expected.getString("name")}"
                val plan = PlaybackPlanner.plan(
                    manifest = manifest,
                    startIndex = expected.getInt("startIndex"),
                    endIndex = expected.getInt("endIndex"),
                    settingBpm = expected.getDouble("settingBpm"),
                    rate = expected.getDouble("rate"),
                )
                close(expected.getDouble("tempo"), plan.tempo, "$label tempo")
                close(expected.getDouble("practiceRate"), plan.practiceRate, "$label practiceRate")
                assertEquals("$label startIndex", expected.getInt("startIndex"), plan.startIndex)
                assertEquals("$label endIndex", expected.getInt("endIndex"), plan.endIndex)
                close(expected.getDouble("totalSeconds"), plan.totalSeconds, "$label totalSeconds")

                val expectedSteps = expected.getJSONArray("steps")
                assertEquals("$label 步数", expectedSteps.length(), plan.steps.size)
                for (stepIndex in 0 until expectedSteps.length()) {
                    val want = expectedSteps.getJSONObject(stepIndex)
                    val step = plan.steps[stepIndex]
                    val where = "$label 第 $stepIndex 步"
                    assertEquals("$where index", want.getInt("index"), step.index)
                    assertEquals("$where startTicks", want.getString("startTicksExact"), step.startTicks.toString())
                    assertEquals(
                        "$where durationTicks",
                        if (want.isNull("durationTicksExact")) null else want.getString("durationTicksExact"),
                        step.durationTicks?.toString(),
                    )
                    assertEquals("$where soundDurationTicks", want.getString("soundDurationTicksExact"), step.soundDurationTicks.toString())
                    assertEquals("$where trigger", want.getBoolean("trigger"), step.trigger)
                    assertEquals("$where isRest", want.getBoolean("isRest"), step.isRest)
                    assertEquals("$where tieContinuation", want.getBoolean("tieContinuation"), step.tieContinuation)
                    close(want.getDouble("startSeconds"), step.startSeconds, "$where startSeconds")
                    close(want.getDouble("durationSeconds"), step.durationSeconds, "$where durationSeconds")
                    close(want.getDouble("soundDurationSeconds"), step.soundDurationSeconds, "$where soundDurationSeconds")
                }
            }
        }
    }

    @Test
    fun `换基准音区只改主音 MIDI，音高偏移沿用电脑端`() {
        for ((name, manifest) in parityCases()) {
            val root = Fixtures.root(if (name == "沙龙") "salon.json" else "synthetic.json")
            val cases = root.getJSONObject("pitch").getJSONArray("cases")
            for (caseIndex in 0 until cases.length()) {
                val entry = cases.getJSONObject(caseIndex)
                val key = entry.getString("key")
                val octave = entry.getInt("octave")
                val midis = entry.getJSONArray("midis")
                assertEquals("$name 音数", manifest.notes.size, midis.length())
                for (noteIndex in 0 until midis.length()) {
                    val expected = if (midis.isNull(noteIndex)) null else midis.getInt(noteIndex)
                    val actual = Pitch.midiForNoteIndex(manifest, noteIndex, key, octave)
                    assertEquals("$name $key$octave 第 $noteIndex 音", expected, actual)
                }
            }
        }
    }

    @Test
    fun `基准音区解析覆盖各种写法`() {
        assertEquals(64, Pitch.tonicMidi("E", 4))
        assertEquals(60, Pitch.tonicMidi("C", 4))
        assertEquals(55, Pitch.tonicMidi("G", 3))
        assertEquals(78, Pitch.tonicMidi("F#", 5))
        assertEquals(58, Pitch.tonicMidi("Bb", 3))
        assertEquals("1=E4", Pitch.label("1=E4", 4))
        assertEquals(64, Pitch.tonicMidi("1=E4", 4))
        assertEquals(55, Pitch.tonicMidi("1=G3", 4))
        assertEquals(60, Pitch.tonicMidi("", 4))
        assertEquals(58, Pitch.tonicMidi("1=Bb3", 4))
        if (Fixtures.hasSalon()) assertNull(Pitch.midiForNoteIndex(Fixtures.salon(), 0, "E", 4))
    }

    @Test
    fun `小节排版与电脑端同宽同高`() {
        for ((name, manifest) in parityCases()) {
            val file = if (name == "沙龙") "salon.json" else "synthetic.json"
            val layouts = Fixtures.root(file).getJSONArray("layout")
            for (layoutIndex in 0 until layouts.length()) {
                val layout = layouts.getJSONObject(layoutIndex)
                val containerWidth = layout.getDouble("containerWidth")
                val fontSize = layout.getDouble("fontSize")
                val scale = fontSize / EngraveGeometry.BASE_FONT_SIZE
                val available = Math.max(1.0, containerWidth / scale)
                val rows = layout.getJSONArray("rows")
                assertEquals("$name 行数", manifest.rows.size, rows.length())
                for (rowIndex in 0 until rows.length()) {
                    val wantRow = rows.getJSONObject(rowIndex)
                    val info = manifest.rows[rowIndex]
                    val notes = manifest.notes.subList(info.startNoteIndex, info.startNoteIndex + info.noteCount)
                    val segments = EngraveGeometry.measureSegments(notes, wantRow.getInt("offset"), manifest.measures)
                    val widths = EngraveGeometry.allocateWidths(segments.map { it.minimum }, available)
                    val wantMeasures = wantRow.getJSONArray("measures")
                    assertEquals("$name 行 $rowIndex 小节数", wantMeasures.length(), segments.size)
                    for (measureIndex in 0 until wantMeasures.length()) {
                        val want = wantMeasures.getJSONObject(measureIndex)
                        val segment = segments[measureIndex]
                        val where = "$name $containerWidth/$fontSize 行 $rowIndex 小节 $measureIndex"
                        assertEquals("$where start", want.getInt("start"), segment.start)
                        assertEquals("$where measureIndex", want.getInt("measureIndex"), segment.measure.index)
                        close(want.getDouble("minimum"), segment.minimum, "$where minimum")
                        close(want.getDouble("width"), widths[measureIndex], "$where width")
                        val textLayout = EngraveGeometry.measureLayout(segment.notes, segment.minimum, widths[measureIndex])
                        close(want.getDouble("content"), textLayout.content, "$where content")
                        assertEquals("$where overflow", want.getBoolean("overflow"), textLayout.overflow)
                        val wantItems = want.getJSONArray("items")
                        assertEquals("$where 字形数", wantItems.length(), textLayout.items.size)
                        for (itemIndex in 0 until wantItems.length()) {
                            val wantItem = wantItems.getJSONObject(itemIndex)
                            val item = textLayout.items[itemIndex]
                            close(wantItem.getDouble("acc"), item.acc, "$where 字形 $itemIndex acc")
                            assertEquals("$where 字形 $itemIndex tail", wantItem.getInt("tail"), item.tail)
                            assertEquals("$where 字形 $itemIndex rest", wantItem.getBoolean("rest"), item.rest)
                            assertEquals("$where 字形 $itemIndex dot", wantItem.getBoolean("dot"), item.dot)
                            assertEquals("$where 字形 $itemIndex lines", wantItem.getInt("lines"), item.lines)
                            close(wantItem.getDouble("width"), item.width, "$where 字形 $itemIndex width")
                            close(wantItem.getDouble("weight"), item.weight, "$where 字形 $itemIndex weight")
                        }
                        val wantPositions = want.getJSONArray("positions")
                        for (positionIndex in 0 until wantPositions.length()) {
                            val wantPosition = wantPositions.getJSONObject(positionIndex)
                            val position = textLayout.positions[positionIndex]
                            close(wantPosition.getDouble("x"), position.x, "$where 位置 $positionIndex x")
                            close(wantPosition.getDouble("cx"), position.cx, "$where 位置 $positionIndex cx")
                            close(wantPosition.getDouble("end"), position.end, "$where 位置 $positionIndex end")
                        }
                    }
                }
            }
        }
    }

    @Test
    fun `裁切矩形按原图尺寸推导`() {
        assumeTrue("需要本机 local/fixtures 生成的 salon.json", Fixtures.hasSalon())
        val crops = Fixtures.root("salon.json").getJSONArray("crops")
        val specs = Fixtures.salon().rows.associateBy { it.index }
        assertTrue(crops.length() >= 3)
        for (index in 0 until crops.length()) {
            val entry = crops.getJSONObject(index)
            val want = entry.getJSONObject("rect")
            val spec = when (entry.getString("name")) {
                "band-jpeg-1500x2000" -> specs.getValue(0).crop
                "band-wide-2400x1400" -> com.yuebeidou.player.model.CropSpec(
                    kind = "band", x = 0.0, y = 0.0, width = 1.0, height = 1.0, top = 0.12, bottom = 0.3,
                    quad = emptyList(), rectifiedWidth = 0.0, rectifiedHeight = 0.0,
                    originalWidth = 0.0, originalHeight = 0.0, fromOriginal = emptyList(),
                    rectifiedRect = com.yuebeidou.player.model.RectSpec(0.0, 0.0, 1.0, 1.0),
                )
                else -> com.yuebeidou.player.model.CropSpec(
                    kind = "box", x = 0.05, y = 0.2, width = 0.9, height = 0.12, top = 0.0, bottom = 0.0,
                    quad = emptyList(), rectifiedWidth = 0.0, rectifiedHeight = 0.0,
                    originalWidth = 0.0, originalHeight = 0.0, fromOriginal = emptyList(),
                    rectifiedRect = com.yuebeidou.player.model.RectSpec(0.0, 0.0, 1.0, 1.0),
                )
            }
            val actual = CropGeometry.rect(spec, entry.getDouble("width"), entry.getDouble("height"))
            val label = entry.getString("name")
            close(want.getDouble("x"), actual.x, "$label x")
            close(want.getDouble("y"), actual.y, "$label y")
            close(want.getDouble("width"), actual.width, "$label width")
            close(want.getDouble("height"), actual.height, "$label height")
            close(want.getDouble("top"), actual.top, "$label top")
            close(want.getDouble("bottom"), actual.bottom, "$label bottom")
        }
    }
}
