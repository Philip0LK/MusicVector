package com.yuebeidou.player

import com.yuebeidou.player.model.HandoffManifest
import com.yuebeidou.player.model.ManifestParser
import org.json.JSONObject

/** 读取电脑端生成的金标准 fixture。 */
object Fixtures {
    /**
     * 个人曲谱夹具 salon.json 不随仓库提供，放在本机 local/fixtures 下由
     * `node tools/mobile-fixtures.mjs` 生成；没有它时相关断言跳过。
     */
    fun hasSalon(): Boolean = Fixtures::class.java.getResourceAsStream("/fixtures/salon.json") != null

    fun salon(): HandoffManifest = manifest("salon.json")

    fun synthetic(): HandoffManifest = manifest("synthetic.json")

    fun root(name: String): JSONObject = JSONObject(text(name))

    fun text(name: String): String =
        Fixtures::class.java.getResourceAsStream("/fixtures/$name")?.bufferedReader()?.use { it.readText() }
            ?: error("缺少 fixture：$name（请先运行 node tools/mobile-fixtures.mjs）")

    private fun manifest(name: String): HandoffManifest =
        ManifestParser.parse(root(name).getJSONObject("manifest"))
}
