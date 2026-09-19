package com.yuebeidou.player.handoff

import com.yuebeidou.player.model.HandoffManifest
import com.yuebeidou.player.model.ManifestParser
import java.io.BufferedInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder

/**
 * 从电脑端取曲目包。二维码里带的是「http://<内网地址>:<端口>/handoff/<token>」，
 * 手机必须和电脑在同一个 Wi-Fi。
 */
object HandoffClient {

    class HandoffException(message: String) : Exception(message)

    data class FetchProgress(val phase: String, val current: Int, val total: Int)

    data class Fetched(
        val manifestText: String,
        val manifest: HandoffManifest,
        val images: Map<Int, ByteArray>,
    )

    /** 二维码里可能是直连地址，也可能是 yuebeidou://receive?u=... 形式。 */
    fun baseUrl(scanned: String): String {
        val text = scanned.trim()
        if (text.startsWith("yuebeidou://", ignoreCase = true)) {
            val query = text.substringAfter('?', "")
            val value = query.split('&')
                .map { it.split('=', limit = 2) }
                .firstOrNull { it.size == 2 && it[0] == "u" }
                ?.let { URLDecoder.decode(it[1], "UTF-8") }
                ?: throw HandoffException("这不是「发送到手机」生成的二维码")
            return normalize(value)
        }
        return normalize(text)
    }

    private fun normalize(url: String): String {
        val trimmed = url.trim().trimEnd('/')
        if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
            throw HandoffException("这不是「发送到手机」生成的二维码")
        }
        if (!trimmed.contains("/handoff/")) throw HandoffException("这不是「发送到手机」生成的二维码")
        return trimmed
    }

    fun fetch(
        scannedUrl: String,
        onProgress: (FetchProgress) -> Unit = {},
        onManifest: (HandoffManifest) -> Unit = {},
    ): Fetched {
        val base = baseUrl(scannedUrl)
        val manifestText = read(base + "/manifest.json", "读取曲目信息失败")
        val manifest = try {
            ManifestParser.parse(manifestText)
        } catch (error: Exception) {
            throw HandoffException(error.message ?: "曲目包无法解析")
        }
        onManifest(manifest)
        val images = HashMap<Int, ByteArray>()
        val total = manifest.images.size
        manifest.images.forEachIndexed { index, image ->
            onProgress(FetchProgress("正在接收原谱", index, total))
            images[image.index] = readBytes(base + "/" + image.path, "第 ${image.index + 1} 页原谱接收失败")
        }
        onProgress(FetchProgress("正在接收原谱", total, total))
        return Fetched(manifestText, manifest, images)
    }

    private fun read(url: String, failure: String): String =
        String(readBytes(url, failure), Charsets.UTF_8)

    private fun readBytes(url: String, failure: String): ByteArray {
        val connection = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (error: Exception) {
            throw HandoffException("地址无效：$url")
        }
        connection.connectTimeout = 6000
        connection.readTimeout = 20000
        connection.instanceFollowRedirects = true
        try {
            val code = try {
                connection.responseCode
            } catch (error: Exception) {
                throw HandoffException("连不上电脑，请确认手机和电脑连的是同一个 Wi-Fi")
            }
            if (code == HttpURLConnection.HTTP_NOT_FOUND) {
                throw HandoffException("二维码已过期，请在电脑上重新点「发送到手机」")
            }
            if (code != HttpURLConnection.HTTP_OK) throw HandoffException("$failure（HTTP $code）")
            return BufferedInputStream(connection.inputStream).use { it.readBytes() }
        } finally {
            connection.disconnect()
        }
    }
}
