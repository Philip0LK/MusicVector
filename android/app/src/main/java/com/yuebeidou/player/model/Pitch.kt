package com.yuebeidou.player.model

/**
 * 音高换算。与电脑端等价，但这里只做「基准音区 + 已算好的音高偏移」这一步：
 * 还原号的作用范围（小节内状态）在电脑端就已经折算进 pitchOffset，手机端不重算。
 */
object Pitch {
    private val DEGREE_STEPS = intArrayOf(0, 0, 2, 4, 5, 7, 9, 11)

    private val NATURAL_STEPS = mapOf(
        'C' to 0, 'D' to 2, 'E' to 4, 'F' to 5, 'G' to 7, 'A' to 9, 'B' to 11,
    )

    // Cb is below C and B# crosses into the next octave; do not wrap modulo 12.
    private fun tonicOffset(tonic: String): Int? {
        if (!Regex("[A-G](?:#|b)?").matches(tonic)) return null
        val accidental = when (tonic.last()) { '#' -> 1; 'b' -> -1; else -> 0 }
        return NATURAL_STEPS.getValue(tonic.first()) + accidental
    }

    /** 与电脑端 parsePitchKey 同源：接受 "1=E4"、"E4"、"E" 三种写法。 */
    fun parseKey(key: String, fallbackOctave: Int = 4): Pair<String, Int> {
        val text = key.trim()
        val explicit = Regex("1\\s*=\\s*([A-Ga-g](?:#|b)?)(-?\\d+)?").find(text)
        val match = explicit ?: Regex("([A-Ga-g](?:#|b)?)(-?\\d+)?").find(text)
        if (match == null) return "C" to fallbackOctave
        val tonic = match.groupValues[1].let { if (it.isEmpty()) "C" else it[0].uppercase() + it.substring(1) }
        val octave = match.groupValues[2].takeIf { it.isNotEmpty() }?.toIntOrNull() ?: fallbackOctave
        return (if (tonicOffset(tonic) != null) tonic else "C") to octave
    }

    fun label(key: String, octave: Int): String {
        val (tonic, safeOctave) = parseKey(key, octave)
        return "1=$tonic$safeOctave"
    }

    fun tonicMidi(key: String, octave: Int): Int {
        val (tonic, safeOctave) = parseKey(key, octave)
        return (safeOctave + 1) * 12 + (tonicOffset(tonic) ?: 0)
    }

    /** 休止符返回 null（电脑端 pitchep[midi] = null 时不发声）。 */
    fun midiFor(note: NoteInfo, key: String, octave: Int): Int? {
        if (note.isRest || note.degree <= 0 || note.degree > 7) return null
        return tonicMidi(key, octave) + DEGREE_STEPS[note.degree] + note.octave * 12 + note.pitchOffset
    }

    fun midiForNoteIndex(manifest: HandoffManifest, index: Int, key: String, octave: Int): Int? {
        val note = manifest.notes.getOrNull(index) ?: return null
        return midiFor(note, key, octave)
    }
}
