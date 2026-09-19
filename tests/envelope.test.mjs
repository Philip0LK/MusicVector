// 电脑端发声的比例测试。
//
// 产品要求所有时值的音符**比例精确**：8 分正好是 16 分的两倍、附点正好 1.5 倍、
// 全音符正好是 2 分的两倍。任何"固定的额外时长"（以前是 +35ms 收尾）或"被固定扣掉的时长"
// 都会破坏比例，这一组就是钉住它。
//
// 手机端 SoundLengthTest 是同一份规则的另一语言实现，两边都必须通过。
import test from 'node:test';
import assert from 'node:assert/strict';
import {ATTACK_FRACTION, ATTACK_SECONDS, RELEASE_FRACTION, RELEASE_SECONDS, envelopeGain, envelopePoints} from '../src/lib/envelope.js';

/** 简谱时值：24 tick = 四分音符。BPM 66 下每 tick 的秒数。 */
const TICK_SECONDS = 60 / (66 * 24);
const seconds = (ticks) => ticks * TICK_SECONDS;

test('可听窗口正好等于时值本身', () => {
  for (const ticks of [6, 12, 18, 24, 36, 48, 72, 96]) {
    const duration = seconds(ticks);
    const shape = envelopePoints(duration);
    assert.equal(shape.end, duration, `${ticks} tick 的收尾不在时值处`);
    assert.equal(envelopeGain(duration, duration), 0);
    assert.ok(envelopeGain(duration - 1e-6, duration) < 1e-3);
    assert.ok(envelopeGain(duration / 2, duration) > 0.99);
  }
});

test('各时值之间正好成整倍数', () => {
  const audible = (ticks) => envelopePoints(seconds(ticks)).end;
  assert.equal(audible(12) / audible(6), 2, '16 分 : 8 分');
  assert.equal(audible(24) / audible(12), 2, '8 分 : 4 分');
  assert.equal(audible(48) / audible(24), 2, '4 分 : 2 分');
  assert.equal(audible(96) / audible(48), 2, '2 分 : 全音符');
  assert.equal(audible(18) / audible(12), 1.5, '附点');
  assert.equal(audible(36) / audible(24), 1.5, '附点二分');
});

test('淡入淡出按比例缩放，且不会吃掉一半以上的时值', () => {
  for (const ticks of [6, 12, 24, 96]) {
    const duration = seconds(ticks);
    const shape = envelopePoints(duration);
    assert.ok(shape.attack <= duration * ATTACK_FRACTION + 1e-12, `${ticks} tick 淡入超比例`);
    assert.ok(shape.release <= duration * RELEASE_FRACTION + 1e-12, `${ticks} tick 收尾超比例`);
    assert.ok(shape.sustainUntil > shape.attack, `${ticks} tick 没有保持段`);
  }
  // 长音的淡入淡出取上限，很短音按比例缩短（0.02 秒的音：淡入 4ms、收尾 6ms）。
  assert.equal(envelopePoints(1).attack, ATTACK_SECONDS);
  assert.equal(envelopePoints(1).release, RELEASE_SECONDS);
  assert.ok(Math.abs(envelopePoints(0.02).attack - 0.004) < 1e-12);
  assert.ok(Math.abs(envelopePoints(0.02).release - 0.006) < 1e-12);
});

test('包络形状：起声为 0、淡入到位、保持、末尾归零', () => {
  const duration = 1;
  const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1e-9, `${label}: ${actual} != ${expected}`);
  assert.equal(envelopeGain(0, duration), 0);
  close(envelopeGain(ATTACK_SECONDS / 2, duration), 0.5, '淡入中点');
  close(envelopeGain(ATTACK_SECONDS, duration), 1, '淡入到位');
  assert.equal(envelopeGain(0.6, duration), 1);
  close(envelopeGain(1 - RELEASE_SECONDS, duration), 1, '收尾起点');
  close(envelopeGain(1 - RELEASE_SECONDS / 2, duration), 0.5, '收尾中点');
  assert.equal(envelopeGain(1, duration), 0);
  assert.equal(envelopeGain(1.5, duration), 0);
  assert.equal(envelopeGain(-0.001, duration), 0);
});
