// 一个音的增益包络。产品要的是**精确的时值比例**，所以可听窗口正好等于时值本身，
// 淡入淡出按时值比例缩放（不超过时值的 20% / 30%），比例不会被淡出破坏。
//
// 以前这里是「时值 + 固定 35ms 收尾」，那个固定尾巴会把比例压歪：
// 8 分 455+35=490ms、16 分 227+35=262ms，比值 1.87 而不是 2。
//
// 手机端 android/ 的 PcmMixer.kt 是同一份规则的另一语言实现，两边改动要同步。

/** 淡入时长上限（很短的音按比例缩短）。 */
export const ATTACK_SECONDS = 0.008;
/** 淡入最多占时值的这个比例。 */
export const ATTACK_FRACTION = 0.2;
/** 收尾淡出时长上限。 */
export const RELEASE_SECONDS = 0.035;
/** 收尾最多占时值的这个比例。 */
export const RELEASE_FRACTION = 0.3;
/** 包络归零之后再留一点点才停掉音源，避免在斜坡末端硬切。 */
export const STOP_PADDING_SECONDS = 0.005;

/** 包络的四个时间点（秒，相对起声）。 */
export function envelopePoints(durationSeconds) {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const attack = Math.min(ATTACK_SECONDS, duration * ATTACK_FRACTION);
  const release = Math.min(RELEASE_SECONDS, duration * RELEASE_FRACTION);
  return {
    duration,
    attack,
    sustainUntil: duration - release,
    release,
    end: duration,
  };
}

/** 任一时间点的增益（0–1）。测试与实现用同一份描述，避免两处各写一遍。 */
export function envelopeGain(t, durationSeconds) {
  const {attack, sustainUntil, release, end} = envelopePoints(durationSeconds);
  const time = Number(t);
  if (!Number.isFinite(time) || time < 0 || time >= end) return 0;
  const value = time < attack
    ? (attack > 0 ? time / attack : 0)
    : time < sustainUntil
      ? 1
      : (release > 0 ? (end - time) / release : 0);
  // 浮点在接缝处会给出 1.0000000000000009 这类值，夹一下保证不会超过峰值。
  return Math.min(1, Math.max(0, value));
}
