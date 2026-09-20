package com.yuebeidou.player.score

import com.yuebeidou.player.model.CropSpec

/** 归一化裁切 → 原图上的矩形。与电脑端 cropGeometry.js 的 cropRect 同源。 */
object CropGeometry {
    /** 宽高比小于这个值就当作「算不出来」，退回固定高度。 */
    const val MIN_BAND_ASPECT = 0.01

    data class CropBox(val x: Double, val y: Double, val width: Double, val height: Double, val top: Double, val bottom: Double)

    /**
     * 原谱条带按屏宽铺满时的高度（px）：屏宽 ÷ 裁切图宽高比。
     *
     * 图片横向铺满后高度由比例决定，条带与简谱因此共用同一条左右边界。
     * 比例缺失或退化（0、负数、NaN）时返回退路高度，绝不返回非正的高度。
     */
    fun bandHeightPx(aspect: Double, widthPx: Float, fallbackPx: Float): Float {
        if (!aspect.isFinite() || aspect <= MIN_BAND_ASPECT) return fallbackPx
        val height = (widthPx / aspect).toFloat()
        return if (height.isFinite() && height > 0f) height else fallbackPx
    }

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
