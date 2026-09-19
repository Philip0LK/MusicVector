package com.yuebeidou.player.score

import com.yuebeidou.player.model.CropSpec

/** 归一化裁切 → 原图上的矩形。与电脑端 cropGeometry.js 的 cropRect 同源。 */
object CropGeometry {
    data class CropBox(val x: Double, val y: Double, val width: Double, val height: Double, val top: Double, val bottom: Double)

    fun rect(crop: CropSpec, imageWidth: Double, imageHeight: Double): CropBox {
        if (!imageWidth.isFinite() || imageWidth <= 0) return full(1.0)
        val ratio = imageHeight / imageWidth
        if (!ratio.isFinite() || ratio <= 0) return full(1.0)
        return when (crop.kind) {
            "band" -> {
                val top = crop.top.coerceIn(0.0, Math.max(0.0, ratio - 0.01))
                val bottom = crop.bottom.coerceIn(top + 0.01, ratio)
                CropBox(
                    x = 0.065,
                    y = top / ratio,
                    width = 0.925,
                    height = (bottom - top) / ratio,
                    top = top,
                    bottom = bottom,
                )
            }
            "rectified" -> box(crop, ratio)
            else -> box(crop, ratio)
        }
    }

    private fun box(crop: CropSpec, ratio: Double) = CropBox(
        x = crop.x,
        y = crop.y,
        width = crop.width,
        height = crop.height,
        top = crop.y * ratio,
        bottom = (crop.y + crop.height) * ratio,
    )

    private fun full(ratio: Double) = CropBox(0.0, 0.0, 1.0, 1.0, 0.0, ratio)
}
