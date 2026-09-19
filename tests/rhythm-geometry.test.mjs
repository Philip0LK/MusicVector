// 几何测量层单测：合成图上量减时线 / 低音点 / 行定位 / 缩放不变性
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeRowGeometry,
  createDigitClassifier,
  detectRowBand,
  binarize,
  connectedComponents,
} from '../src/lib/rhythmGeometry.js';
import {renderRow, makeBlock, makeGeometry} from './fixtures/jianpu-image.mjs';

const measure = (specs, layout) => analyzeRowGeometry(renderRow(specs, layout));

test('减时线：0/1/2 条分别量对', () => {
  const specs = [
    {underlines: 0}, {underlines: 1}, {underlines: 2},
    {underlines: 2}, {underlines: 1}, {underlines: 0},
  ];
  const result = measure(specs);
  assert.equal(result.available, true, '行应被定位');
  assert.deepEqual(result.blocks.map((block) => block.underlines), [0, 1, 2, 2, 1, 0]);
});

test('减时线：整行全为 2 条时不退化成 1 条（band 标定不能只找到一条带）', () => {
  const specs = Array.from({length: 8}, () => ({underlines: 2}));
  const result = measure(specs);
  assert.deepEqual(result.blocks.map((block) => block.underlines), Array(8).fill(2));
});

test('减时线：整行全为 0 条时不误报', () => {
  const specs = Array.from({length: 8}, () => ({underlines: 0}));
  const result = measure(specs);
  assert.deepEqual(result.blocks.map((block) => block.underlines), Array(8).fill(0));
});

test('数字个数：块数等于画了几个数字', () => {
  for (const count of [4, 7, 12]) {
    const specs = Array.from({length: count}, (_, i) => ({underlines: i % 3}));
    const result = measure(specs);
    assert.equal(result.blocks.length, count, `${count} 个数字`);
    // 从左到右单调
    const xs = result.blocks.map((block) => block.centerX);
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b));
  }
});

test('低音点：有/无分别判对，且不影响字高', () => {
  const specs = [{lowDot: true}, {lowDot: false}, {lowDot: true}, {lowDot: false}];
  const result = measure(specs);
  assert.deepEqual(result.blocks.map((block) => block.lowDot), [true, false, true, false]);
  const heights = result.blocks.map((block) => block.bbox.height);
  const spread = Math.max(...heights) - Math.min(...heights);
  assert.ok(spread <= 2, `低音点不应粘进数字字高（实测极差 ${spread}）`);
});

test('低音点 + 减时线共存：两条线、一条线、无线时都判得出', () => {
  for (const underlines of [0, 1, 2]) {
    const specs = [{underlines, lowDot: true}, {underlines, lowDot: false}, {underlines, lowDot: true}];
    const result = measure(specs);
    assert.deepEqual(
      result.blocks.map((block) => block.lowDot),
      [true, false, true],
      `${underlines} 条减时线时`,
    );
    assert.deepEqual(result.blocks.map((block) => block.underlines), Array(3).fill(underlines));
  }
});

test('附点：数字右侧的点被检出（仅作证据）', () => {
  const specs = [{rightDot: true, underlines: 0}, {rightDot: false, underlines: 0}];
  const result = measure(specs);
  assert.deepEqual(result.blocks.map((block) => block.rightDot), [true, false]);
});

test('行置信度：正常行高于融合层门控 0.45', () => {
  const result = measure(Array.from({length: 10}, () => ({underlines: 1})));
  assert.ok(result.mappingConfidence >= 0.45, `实际 ${result.mappingConfidence}`);
});

test('空白图 / 空输入 → available=false 且带原因', () => {
  const blank = analyzeRowGeometry({data: new Uint8ClampedArray(100 * 40 * 4).fill(255), width: 100, height: 40});
  assert.equal(blank.available, false);
  assert.equal(blank.reason, 'no-row-detected');
  assert.equal(analyzeRowGeometry(null).available, false);
  assert.equal(analyzeRowGeometry({data: new Uint8ClampedArray(0), width: 0, height: 0}).reason, 'empty-image');
});

test('缩放不变性：字高放大 2 倍，减时线根数结论不变', () => {
  const specs = [{underlines: 0}, {underlines: 1}, {underlines: 2}, {underlines: 1}];
  const small = measure(specs, {scale: 20, baseline: 44, noteWidth: 46, height: 100});
  const large = measure(specs, {scale: 40, baseline: 84, noteWidth: 92, height: 170});
  assert.deepEqual(large.blocks.map((b) => b.underlines), small.blocks.map((b) => b.underlines));
});

test('数字分类器：无模板时不猜（digit=null）', () => {
  const result = measure([{underlines: 0}, {underlines: 0}, {underlines: 0}]);
  assert.deepEqual(result.blocks.map((block) => block.digit), [null, null, null]);
});

test('数字分类器：注入模板后可分类，样本不足的类别不参与', () => {
  const specs = [{underlines: 1}, {underlines: 1}, {underlines: 2}];
  const raw = measure(specs);
  const signatures = raw.blocks.map((block) => block.signature);
  // 用第 1 个块的签名当 "5" 的模板（同图同字形，相似度必然最高）
  const classifier = createDigitClassifier([
    {signature: signatures[0], label: 5},
    {signature: signatures[1], label: 5},
  ]);
  assert.deepEqual(classifier.labels, ['5']);
  const withClassifier = analyzeRowGeometry(renderRow(specs), {classifier});
  assert.deepEqual(withClassifier.blocks.map((block) => block.digit), [5, 5, 5]);
});

test('数字分类器：相似度低于阈值时拒绝分类', () => {
  const a = new Float32Array(140).fill(0);
  a[0] = 1;
  const b = new Float32Array(140).fill(0);
  b[139] = 1;
  const classifier = createDigitClassifier([
    {signature: a, label: 3}, {signature: a, label: 3},
  ]);
  const verdict = classifier.classify(b);
  assert.equal(verdict.digit, null);
  assert.equal(verdict.rejected, true);
});

test('detectRowBand：歌词块（更矮的字）不会被选中', () => {
  const image = renderRow(Array.from({length: 8}, () => ({underlines: 1})), {height: 160, baseline: 60});
  // 在下方再画一行更矮的字形（模拟歌词）
  for (let index = 0; index < 10; index += 1) {
    const left = 30 + index * 50;
    for (let y = 100; y < 114; y += 1) {
      for (let x = left; x < left + 10; x += 1) {
        const offset = (y * image.width + x) * 4;
        image.data[offset] = 0; image.data[offset + 1] = 0; image.data[offset + 2] = 0;
      }
    }
  }
  const binary = binarize(image.data, image.width, image.height);
  const components = connectedComponents(binary, image.width, image.height);
  const row = detectRowBand(components);
  assert.ok(row, '应找到行');
  assert.ok(row.scale >= 24, `应选中较高的旋律行（实际 scale=${row.scale}）`);
});

test('几何结果结构完整：块字段齐全，可用于融合层', () => {
  const result = measure([
    {underlines: 1, lowDot: true}, {underlines: 0}, {underlines: 2}, {underlines: 1},
  ]);
  assert.equal(result.available, true);
  const [block] = result.blocks;
  for (const key of ['index', 'bbox', 'centerX', 'underlines', 'lowDot', 'rightDot', 'measureEnd', 'digit', 'signature']) {
    assert.ok(key in block, `块缺少字段 ${key}`);
  }
  assert.equal(typeof result.mappingConfidence, 'number');
  assert.equal(typeof result.scale, 'number');
  assert.equal(typeof result.analyzedWidth, 'number');
});

test('makeGeometry 夹具与几何层输出同构（防止融合层单测与真实结构脱节）', () => {
  const real = measure([
    {underlines: 1}, {underlines: 0}, {underlines: 2}, {underlines: 1},
  ]);
  const fixture = makeGeometry([makeBlock(0)]);
  for (const key of Object.keys(fixture)) {
    assert.ok(key in real, `夹具字段 ${key} 在真实输出里不存在`);
  }
  for (const key of Object.keys(fixture.blocks[0])) {
    assert.ok(key in real.blocks[0], `夹具块字段 ${key} 在真实块里不存在`);
  }
});
