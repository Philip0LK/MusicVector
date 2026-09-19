// 融合层单测：对齐 + 逐字段贴属性 + 降级
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {alignBlocksToEvents, fuseRow, buildClassifierSamples} from '../src/lib/rhythmFusion.js';
import {makeBlock, makeGeometry, makeEvent} from './fixtures/jianpu-image.mjs';

const codes = (result) => result.issues.map((issue) => issue.code);

test('音数与字形序列一致：逐位应用几何时值', () => {
  const blocks = [makeBlock(0, {underlines: 2, digit: 5}), makeBlock(1, {underlines: 1, digit: 6})];
  const events = [makeEvent('e1', {degree: 5, underlines: 1}), makeEvent('e2', {degree: 6, underlines: 1})];
  const result = fuseRow(makeGeometry(blocks), events);
  assert.equal(result.degraded, false);
  assert.equal(result.alignment.exact, true);
  assert.deepEqual(result.notes.map((note) => note.underlines), [2, 1], '时值必须取几何');
  assert.deepEqual(result.notes.map((note) => note.eventId), ['e1', 'e2']);
  assert.deepEqual(result.notes.map((note) => note.degree), [5, 6], '音高取 AI');
  assert.deepEqual(codes(result), [], '音数一致时不应有任何 issue');
});

test('几何少块：保留所有 AI 音符及其身份，未配上的由算法取 0', () => {
 // AI 三音、几何只有两块 —— DP 只能配两对，中间那个音符没有几何读数
 const events=[makeEvent('e1',{degree:1,underlines:7}),makeEvent('e2',{degree:2,underlines:7}),makeEvent('e3',{degree:3,underlines:7})];
 const geo=makeGeometry([makeBlock(0,{digit:1,layerCount:2,underlines:2}),makeBlock(1,{digit:3,layerCount:1,underlines:1})]);
 const out=fuseRow(geo,events);
 assert.deepEqual(out.notes.map(n=>n.eventId),['e1','e2','e3'],'音符身份与数量完全来自 AI');
 assert.ok(!codes(out).includes('ai-extra-note'),'不把差异认定为 AI 多音');
 assert.ok(codes(out).includes('geometry-block-unpaired'),'未配上的音符要留档');
 const skipped=out.alignment.skippedEvents[0];
 const noteOf=[];
 let k=0;
 [0,1,2].forEach(i=>{ noteOf[i]=out.notes[k++]; });
 assert.equal(noteOf[skipped].underlines,0,'没有几何读数的音符按无减时线取值，不用 AI 的 7');
 assert.equal(noteOf[skipped].evidence.underlines.source,'geometry-default');
 assert.deepEqual(out.notes.filter(n=>n.evidence.underlines.geo!==null).map(n=>n.underlines),[2,1],'配上的音符采用算法读数');
});

test('几何多块：不凭未经验证的分类添加音符，也不顺移后续时值', () => {
 // 几何多出一块，但音符只由 AI 产生；配上的音符按算法读数取时值
 const events=[makeEvent('e1',{degree:1,underlines:0}),makeEvent('e2',{degree:3,underlines:0})];
 const out=fuseRow(makeGeometry([makeBlock(0,{digit:1,layerCount:1,underlines:1}),makeBlock(1,{digit:3,layerCount:2,underlines:2}),makeBlock(2,{digit:5,layerCount:1,underlines:1})]),events);
 assert.deepEqual(out.notes.map(n=>n.eventId),['e1','e2'],'几何多出的块不产生音符');
 assert.deepEqual(out.notes.map(n=>n.underlines),[1,2],'配上对的音符采用算法读数');
});

test('几何时值证据充分：纠正少写减时线并记录双方证据', () => {
  const blocks = [makeBlock(0, {digit: 1, underlines: 2})];
  const events = [makeEvent('e1', {degree: 1, underlines: 1})];
  const result = fuseRow(makeGeometry(blocks), events);
  const [note] = result.notes;
  assert.equal(note.underlines, 2);
  assert.equal(note.evidence.underlines.source, 'geometry');
  assert.equal(note.evidence.underlines.ai, 1);
  assert.equal(note.evidence.underlines.geo, 2);
  assert.equal(note.evidence.underlines.conflict, 'ai-disagrees');
});

test('附点与小节线取 AI，几何结论只进证据', () => {
  const blocks = [makeBlock(0, {digit: 1, rightDot: true, measureEnd: false})];
  const events = [makeEvent('e1', {degree: 1, dots: 0, measureEnd: true})];
  const result = fuseRow(makeGeometry(blocks), events);
  const [note] = result.notes;
  assert.equal(note.dots, 0, '附点取 AI');
  assert.equal(note.measureEnd, true, '小节线取 AI');
  assert.equal(note.evidence.dots.geo, 1, '几何说有点，记录在证据里');
  assert.equal(note.evidence.dots.conflict, 'geo-disagrees');
  assert.equal(note.evidence.measureEnd.conflict, 'geo-disagrees');
});

test('低音点漏检不自动否决 AI 八度，只保存双方证据', () => {
 const out=fuseRow(makeGeometry([makeBlock(0,{lowDot:false})]),[makeEvent('e1',{octave:-1})]);
 assert.equal(out.notes[0].octave,-1);assert.equal(out.notes[0].evidence.octave.geoLowDot,false);
 assert.equal(out.notes[0].evidence.octave.overridden,false);
});

test('低音点：几何确实测到圆点 → 保留 AI 的低音', () => {
  const blocks = [makeBlock(0, {digit: 6, lowDot: true})];
  const events = [makeEvent('e1', {degree: 6, octave: -1})];
  const result = fuseRow(makeGeometry(blocks), events);
  assert.equal(result.notes[0].octave, -1);
  assert.equal(result.notes[0].evidence.octave.overridden, false);
  assert.ok(!codes(result).includes('low-dot-overridden'));
});

test('音高分歧：保留 AI 值，记录几何分类', () => {
  const blocks = [makeBlock(0, {digit: 3})];
  const events = [makeEvent('e1', {degree: 5})];
  const result = fuseRow(makeGeometry(blocks), events);
  assert.equal(result.notes[0].degree, 5, '保留 AI');
  assert.equal(result.notes[0].geoDegree, 3);
  assert.ok(codes(result).includes('degree-disagree'));
});

test('几何测不出 → 整行按无减时线取值（不用 AI）；行级质量偏低 → 仍逐音取算法读数', () => {
  const events = [makeEvent('e1', {degree: 1, underlines: 2}), makeEvent('e2', {degree: 2, underlines: 1})];
  // 整行连数字带都没定位到：算法给不出读数 → 全部按 0 条（四分音符）
  const dead = fuseRow({available: false, reason: 'no-row-detected', blocks: [], issues: []}, events);
  assert.equal(dead.degraded, true);
  assert.deepEqual(dead.notes.map((note) => note.underlines), [0, 0]);
  assert.deepEqual(dead.notes.map((note) => note.eventId), ['e1', 'e2']);
  assert.ok(codes(dead).includes('geometry-unavailable'));
  // 行级字形质量偏低：只记录，不换源
  const lowQuality = fuseRow(makeGeometry([makeBlock(0, {layerCount:2, underlines: 2}), makeBlock(1, {layerCount:1, underlines: 1})], {mappingConfidence: 0.3}), events);
  assert.equal(lowQuality.degraded, false);
  assert.deepEqual(lowQuality.notes.map((note) => note.underlines), [2, 1], '算法测到就用算法');
  assert.ok(codes(lowQuality).includes('low-row-quality'));
});

test('AI 没有音符输出时不从未验证字形凭空生成音符', () => {
 const out=fuseRow(makeGeometry([makeBlock(0),makeBlock(1)]),[]);
 assert.deepEqual(out.notes,[]);
});

test('休止符：AI 的 rest 事件按 0 处理，不被当成缺音', () => {
  const blocks = [makeBlock(0, {digit: 0, underlines: 1}), makeBlock(1, {digit: 1, underlines: 1})];
  const events = [
    {id: 'e1', kind: 'rest', underlines: 1, dots: 0, measureEnd: false},
    makeEvent('e2', {degree: 1, underlines: 1}),
  ];
  const result = fuseRow(makeGeometry(blocks), events);
  assert.equal(result.notes[0].degree, 0);
  assert.equal(result.notes[0].kind, 'rest');
  assert.equal(result.notes[1].degree, 1);
  assert.ok(!codes(result).includes('ai-missed-note'));
});

test('alignBlocksToEvents：单调性——不允许交叉配对', () => {
  const blocks = [makeBlock(0, {digit: 1}), makeBlock(1, {digit: 2}), makeBlock(2, {digit: 3})];
  const events = [makeEvent('e1', {degree: 3}), makeEvent('e2', {degree: 2}), makeEvent('e3', {degree: 1})];
  const {pairs} = alignBlocksToEvents(blocks, events);
  for (let index = 1; index < pairs.length; index += 1) {
    assert.ok(pairs[index].block > pairs[index - 1].block, '块序号单调增');
    assert.ok(pairs[index].event > pairs[index - 1].event, '事件序号单调增');
  }
});

test('buildClassifierSamples：只采信「对齐成功且音高来自 AI」的字形', () => {
  const blocks = [makeBlock(0, {digit: 1, signature: new Float32Array([1, 0])}), makeBlock(1, {digit: 2, signature: new Float32Array([0, 1])})];
  const fused = fuseRow(makeGeometry(blocks), [makeEvent('e1', {degree: 1}), makeEvent('e2', {degree: 2})]);
  const samples = buildClassifierSamples([{geometry: makeGeometry(blocks), fused}]);
  assert.equal(samples.length, 2);
  assert.deepEqual(samples.map((sample) => sample.label), [1, 2]);

  const degraded = fuseRow({available: false, reason: 'x', blocks: [], issues: []}, [makeEvent('e1', {degree: 1})]);
  assert.deepEqual(buildClassifierSamples([{geometry: {available: false}, fused: degraded}]), [], '降级行不产生模板');
});

test('契约安全：融合层产出的 note 字段是普通可序列化值', () => {
  const blocks = [makeBlock(0, {digit: 1, signature: new Float32Array([1])})];
  const result = fuseRow(makeGeometry(blocks), [makeEvent('e1', {degree: 1})]);
  const clone = JSON.parse(JSON.stringify({notes: result.notes, issues: result.issues}));
  assert.equal(clone.notes.length, 1);
  assert.equal(clone.notes[0].underlines, 1);
});

test('空块列表：不抛错，返回空骨架', () => {
  const result = fuseRow(makeGeometry([]), []);
  assert.deepEqual(result.notes, []);
  assert.equal(result.degraded, false);
});
