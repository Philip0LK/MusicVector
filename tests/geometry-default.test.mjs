// 几何为默认：逐音对应与"没测出来才退回 AI"的边界。
// 判据来源 docs/纯算法时值准确率-全样本-2026-09-15.md：
//   几何读到 0 条时 84.4% 其实是真实的无减时线，所以不能把 0 一律当"没测出来"。
//   真正的"没测出来" = underlineConfidence === 0 且非 unstableUnderlines（该行没标定到带 / 本块没匹配到层）。
import test from 'node:test';import assert from 'node:assert/strict';
import {fuseRow} from '../src/lib/rhythmFusion.js';
import {makeBlock,makeGeometry,makeEvent} from './fixtures/jianpu-image.mjs';

const codes=out=>[...new Set(out.issues.map(i=>i.code))];
const underlines=out=>out.notes.map(n=>n.underlines);
const sources=out=>out.notes.map(n=>n.evidence?.underlines?.source ?? null);

test('几何优先：算法读到就覆盖 AI 的读数',()=>{
 const out=fuseRow(makeGeometry([makeBlock(0,{layerCount:2,underlines:2})]),[makeEvent('e1',{underlines:0})]);
 assert.equal(out.notes[0].underlines,2);
 assert.equal(out.notes[0].evidence.underlines.source,'geometry');
 assert.equal(out.notes[0].evidence.underlines.measured,true);
 assert.equal(out.notes[0].evidence.underlines.conflict,'ai-disagrees');
});

test('真 0 条保留算法读数：测到了"没有减时线"不能改用 AI',()=>{
 const out=fuseRow(makeGeometry([makeBlock(0,{layerCount:0,underlines:0,underlineConfidence:0.8})]),[makeEvent('e1',{underlines:2})]);
 assert.equal(out.notes[0].underlines,0,'本行测到没有减时线 → 取 0');
 assert.equal(out.notes[0].evidence.underlines.source,'geometry-default');
});

test('没测出来（该块没扫到横线）→ 按无减时线取 0，不用 AI 读数',()=>{
 for(const overrides of [{layerCount:0,underlineConfidence:0},{layerCount:0,underlineConfidence:0.8,underlines:0}]){
  const out=fuseRow(makeGeometry([makeBlock(0,{...overrides})]),[makeEvent('e1',{underlines:2})]);
  assert.equal(out.notes[0].underlines,0,'算法未扫到减时线 → 四分音符');
  assert.equal(out.notes[0].evidence.underlines.source,'geometry-default');
  assert.equal(out.notes[0].evidence.underlines.measured,false);
  assert.equal(out.notes[0].evidence.underlines.ai,2,'AI 的读数只留档，不采用');
  assert.ok(codes(out).includes('rhythm-from-default'),'要留档说明按默认值取');
 }
});

test('测到了就用读数：与置信度高低无关',()=>{
 // conf=0 只说明该行没标定出减时线带，不代表这个音没测到
 const out=fuseRow(makeGeometry([makeBlock(0,{layerCount:2,underlines:2,underlineConfidence:0})]),[makeEvent('e1',{underlines:1})]);
 assert.equal(out.notes[0].underlines,2,'扫到 2 条就用 2 条');
 assert.equal(out.notes[0].evidence.underlines.source,'geometry');
 assert.equal(out.notes[0].evidence.underlines.measured,true);
});

test('无减时线的行：全部取 0',()=>{
 const out=fuseRow(makeGeometry([makeBlock(0,{layerCount:0,underlines:0,underlineConfidence:0})]),[makeEvent('e1',{underlines:1})]);
 assert.equal(out.notes[0].underlines,0);
 assert.equal(out.notes[0].evidence.underlines.measured,false);
});

test('块数不等：配对单调、音符身份全来自 AI、未配上的也由算法取 0',()=>{
 // 块多：第三个块不产生音符
 const more=fuseRow(makeGeometry([makeBlock(0,{digit:1,layerCount:2,underlines:2}),makeBlock(1,{digit:2,layerCount:1,underlines:1}),makeBlock(2,{digit:3,underlines:0})]),
   [makeEvent('e1',{degree:1,underlines:0}),makeEvent('e2',{degree:2,underlines:0})]);
 assert.deepEqual(more.notes.map(n=>n.eventId),['e1','e2']);
 assert.deepEqual(underlines(more),[2,1],'配上对的用算法读数');
 assert.deepEqual(more.alignment.skippedBlocks.length,1);
 assert.ok(codes(more).includes('geometry-block-unpaired'));
 // 块少：中间那个音符没有几何读数 → 按 0 条取值，不用 AI
 const fewer=fuseRow(makeGeometry([makeBlock(0,{digit:1,layerCount:2,underlines:2}),makeBlock(1,{digit:3,layerCount:1,underlines:1})]),
   [makeEvent('e1',{degree:1,underlines:7}),makeEvent('e2',{degree:2,underlines:7}),makeEvent('e3',{degree:3,underlines:7})]);
 assert.deepEqual(fewer.notes.map(n=>n.eventId),['e1','e2','e3'],'几何少块不得删除 AI 事件');
 const skipped=fewer.alignment.skippedEvents[0];
 const noteOf=[];
 let k=0;
 [0,1,2].forEach(i=>{ noteOf[i]=fewer.notes[k++]; });
 assert.equal(noteOf[skipped].underlines,0,'没有几何读数的音符按 0 条取值');
 assert.equal(noteOf[skipped].evidence.underlines.source,'geometry-default');
 assert.equal(noteOf[skipped].evidence.underlines.geo,null);
});

test('行级质量偏低只记录，不整行换源',()=>{
 const geo=makeGeometry([makeBlock(0,{layerCount:2,underlines:2}),makeBlock(1,{layerCount:1,underlines:1})],{mappingConfidence:0.2});
 const out=fuseRow(geo,[makeEvent('e1',{underlines:0}),makeEvent('e2',{underlines:0})]);
 assert.equal(out.degraded,false);
 assert.deepEqual(underlines(out),[2,1],'仍逐音取几何读数');
 assert.ok(codes(out).includes('low-row-quality'));
 assert.equal(out.alignment.rowQuality,0.2);
});

test('几何整行测不出（连数字带都没定位到）→ 仍由算法取 0，不用 AI',()=>{
 const out=fuseRow({available:false,reason:'no-row-detected',blocks:[],issues:[]},
   [makeEvent('e1',{underlines:2}),makeEvent('e2',{underlines:1})]);
 assert.equal(out.degraded,true);
 assert.deepEqual(underlines(out),[0,0],'算法给不出读数 → 按无减时线取值');
 assert.deepEqual(out.notes.map(n=>n.evidence.underlines.source),['geometry-default','geometry-default']);
 assert.deepEqual(out.notes.map(n=>n.evidence.underlines.ai),[2,1],'AI 的读数只留档');
 assert.equal(out.geometry,undefined);
 assert.ok(codes(out).includes('geometry-unavailable'));
});

test('未配对块不产生音符：AI 没有音符时几何不凭空生成',()=>{
 const out=fuseRow(makeGeometry([makeBlock(0),makeBlock(1)]),[]);
 assert.deepEqual(out.notes,[]);
});
