package com.yuebeidou.player.settings

import android.content.Context
import org.json.JSONObject

/** 练习设置：按曲目存基准音区、速度，另存上次打开的曲目。全是本机状态，不回写电脑端。 */
class SettingsRepository(context: Context) {

    private val prefs = context.getSharedPreferences("yuebeidou-practice", Context.MODE_PRIVATE)

    data class SongSettings(
        val key: String,
        val octave: Int,
        val bpm: Double,
        val rate: Double,
    )

    fun song(songId: String, fallbackKey: String, fallbackOctave: Int, fallbackBpm: Double): SongSettings {
        val raw = prefs.getString(songPrefix + songId, null) ?: return SongSettings(fallbackKey, fallbackOctave, fallbackBpm, 1.0)
        return try {
            val json = JSONObject(raw)
            SongSettings(
                key = json.optString("key", fallbackKey),
                octave = json.optInt("octave", fallbackOctave),
                bpm = json.optDouble("bpm", fallbackBpm),
                rate = json.optDouble("rate", 1.0),
            )
        } catch (error: Exception) {
            SongSettings(fallbackKey, fallbackOctave, fallbackBpm, 1.0)
        }
    }

    fun saveSong(songId: String, settings: SongSettings) {
        prefs.edit().putString(
            songPrefix + songId,
            JSONObject()
                .put("key", settings.key)
                .put("octave", settings.octave)
                .put("bpm", settings.bpm)
                .put("rate", settings.rate)
                .toString(),
        ).apply()
    }

    var lastSongId: String?
        get() = prefs.getString("lastSongId", null)
        set(value) {
            prefs.edit().putString("lastSongId", value).apply()
        }

    private companion object {
        const val songPrefix = "song."
    }
}
