package com.yuebeidou.player.model

import org.json.JSONArray
import org.json.JSONObject

/** 曲目包解析。字段缺失一律给出安全默认值，并把「无法播放」交给上层提示。 */
object ManifestParser {
    const val SUPPORTED_VERSION = 1

    fun parse(text: String): HandoffManifest = parse(JSONObject(text))

    fun parse(root: JSONObject): HandoffManifest {
        val version = root.optInt("handoff", 0)
        require(version == SUPPORTED_VERSION) { "曲目包版本不支持（$version）" }
        val song = root.getJSONObject("song")
        return HandoffManifest(
            version = version,
            generatedAt = root.optString("generatedAt", ""),
            song = SongInfo(
                id = song.optString("id", "song"),
                title = song.optString("title", "未命名"),
                key = song.optString("key", "C"),
                octave = song.optInt("octave", 4),
                bpm = song.optDouble("bpm", 80.0),
                meter = meter(song.optJSONObject("meter")),
                pickup = song.optBoolean("pickup", false),
                ticksPerQuarter = song.optDouble("ticksPerQuarter", 24.0),
                baseBpm = song.optDouble("baseBpm", song.optDouble("bpm", 80.0)),
                baseBeatTicks = song.optDouble("baseBeatTicks", 24.0),
                tempoEvents = listOfArray(song.optJSONArray("tempoEvents")) { event ->
                    TempoEvent(
                        atIndex = if (event.isNull("atIndex")) null else event.optInt("atIndex"),
                        bpm = if (event.isNull("bpm")) null else event.optDouble("bpm"),
                        beatTicks = if (event.isNull("beatTicks")) null else event.optDouble("beatTicks"),
                    )
                },
            ),
            notes = listOfArray(root.optJSONArray("notes")) { note ->
                NoteInfo(
                    id = note.optString("id", ""),
                    degree = note.optInt("degree", 0),
                    accidental = if (note.isNull("accidental")) null else note.optString("accidental"),
                    octave = note.optInt("octave", 0),
                    pitchOffset = note.optInt("pitchOffset", 0),
                    isRest = note.optBoolean("isRest", note.optInt("degree", 0) == 0),
                    durationTicks = if (note.isNull("durationTicks")) null else Rational.parse(note.optString("durationTicks")),
                    soundDurationTicks = if (note.isNull("soundDurationTicks")) null else Rational.parse(note.optString("soundDurationTicks")),
                    baseTicks = if (note.isNull("baseTicks")) null else note.optInt("baseTicks"),
                    tieToNext = note.optBoolean("tieToNext", false),
                    measureEnd = note.optBoolean("measureEnd", false),
                    missingDuration = note.optBoolean("missingDuration", false),
                    dots = note.optInt("dots", 0),
                    dotted = note.optBoolean("dotted", false),
                    beamGroup = if (note.isNull("beamGroup")) null else note.optInt("beamGroup"),
                )
            },
            rows = listOfArray(root.optJSONArray("rows")) { row ->
                RowInfo(
                    index = row.optInt("index", 0),
                    page = row.optInt("page", 0),
                    line = row.optInt("line", 0),
                    text = row.optString("text", ""),
                    imageIndex = row.optInt("imageIndex", row.optInt("page", 0)),
                    crop = crop(row.optJSONObject("crop")),
                    startNoteIndex = row.optInt("startNoteIndex", 0),
                    noteCount = row.optInt("noteCount", 0),
                    seamNeedsReview = row.optBoolean("seamNeedsReview", false),
                    arcs = listOfArray(row.optJSONArray("arcs")) { arc ->
                        RowArc(
                            id = arc.optString("id", ""),
                            number = if (arc.isNull("number")) null else arc.optInt("number"),
                            start = if (arc.isNull("start")) null else arc.optInt("start"),
                            end = if (arc.isNull("end")) null else arc.optInt("end"),
                            level = arc.optInt("level", 0),
                            typeSegment = arc.optString("typeSegment", "full"),
                            span = arc.optInt("span", 0),
                        )
                    },
                )
            },
            measures = listOfArray(root.optJSONArray("measures")) { measure ->
                MeasureInfo(
                    index = measure.optInt("index", 0),
                    startIndex = measure.optInt("startIndex", 0),
                    endIndex = measure.optInt("endIndex", 0),
                    noteCount = measure.optInt("noteCount", 0),
                    beats = measure.optDouble("beats", 0.0),
                    expectedBeats = measure.optDouble("expectedBeats", 0.0),
                    totalTicks = measure.optDouble("totalTicks", 0.0),
                    expectedTicks = measure.optDouble("expectedTicks", 0.0),
                    status = measure.optString("status", "incomplete"),
                    meter = meter(measure.optJSONObject("meter")),
                    meterChange = measure.optBoolean("meterChange", false),
                    pickup = measure.optBoolean("pickup", false),
                )
            },
            images = listOfArray(root.optJSONArray("images")) { image ->
                ImageInfo(
                    index = image.optInt("index", 0),
                    id = image.optString("id", ""),
                    name = image.optString("name", ""),
                    mime = image.optString("mime", "image/jpeg"),
                    path = image.optString("path", ""),
                )
            },
        )
    }

    private fun meter(value: JSONObject?): Meter = Meter(
        beats = value?.optInt("beats", 4) ?: 4,
        beatUnit = value?.optInt("beatUnit", 4) ?: 4,
    )

    private fun crop(value: JSONObject?): CropSpec {
        val kind = value?.optString("kind", "full") ?: "full"
        val rectified = value?.optJSONObject("rectified")
        val rect = rectified?.optJSONObject("rect")
        val matrix = rectified?.optJSONArray("fromOriginal")
        return CropSpec(
            kind = kind,
            x = value?.optDouble("x", 0.0) ?: 0.0,
            y = value?.optDouble("y", 0.0) ?: 0.0,
            width = value?.optDouble("width", 1.0) ?: 1.0,
            height = value?.optDouble("height", 1.0) ?: 1.0,
            top = value?.optDouble("top", 0.0) ?: 0.0,
            bottom = value?.optDouble("bottom", 0.0) ?: 0.0,
            quad = points(value?.optJSONArray("quad")),
            rectifiedWidth = rectified?.optDouble("width", 0.0) ?: 0.0,
            rectifiedHeight = rectified?.optDouble("height", 0.0) ?: 0.0,
            originalWidth = rectified?.optDouble("originalWidth", 0.0) ?: 0.0,
            originalHeight = rectified?.optDouble("originalHeight", 0.0) ?: 0.0,
            fromOriginal = if (matrix == null) emptyList() else (0 until 3).flatMap { row ->
                (0 until 3).map { column -> matrix.optJSONArray(row)?.optDouble(column, 0.0) ?: 0.0 }
            },
            rectifiedRect = RectSpec(
                x = rect?.optDouble("x", 0.0) ?: 0.0,
                y = rect?.optDouble("y", 0.0) ?: 0.0,
                width = rect?.optDouble("width", 1.0) ?: 1.0,
                height = rect?.optDouble("height", 1.0) ?: 1.0,
            ),
        )
    }

    private fun points(array: JSONArray?): List<Pair<Double, Double>> {
        if (array == null) return emptyList()
        return (0 until array.length()).map { index ->
            val point = array.optJSONArray(index)
            (point?.optDouble(0, 0.0) ?: 0.0) to (point?.optDouble(1, 0.0) ?: 0.0)
        }
    }

    private fun <T> listOfArray(array: JSONArray?, map: (JSONObject) -> T): List<T> {
        if (array == null) return emptyList()
        return (0 until array.length()).map { map(array.getJSONObject(it)) }
    }
}
