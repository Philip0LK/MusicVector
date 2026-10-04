package com.yuebeidou.player.ui

data class NotationArea(val top: Float, val height: Float)

/** The same safe-region rule as the desktop player; oversized targets have a stable anchor. */
object FollowGeometry {
    fun scrollDelta(start: Float, end: Float, low: Float, high: Float, force: Boolean = false): Float {
        if (!start.isFinite() || !end.isFinite() || !low.isFinite() || !high.isFinite() || high <= low) return 0f
        if (end - start > high - low) {
            val center = (start + end) / 2f
            return if (!force && center in low..high) 0f else center - (low + high) / 2f
        }
        return if (!force && start >= low && end <= high) 0f else start - low
    }
}
