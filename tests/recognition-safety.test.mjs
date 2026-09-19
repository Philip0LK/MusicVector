import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSymbols} from '../src/compactNotation.js';
import {convertRows} from '../src/recognitionModel.js';
import {fuseRow,alignBlocksToEvents,buildClassifierSamples} from '../src/lib/rhythmFusion.js';
import {analyzeRowGeometry,detectRowBand} from '../src/lib/rhythmGeometry.js';
import {geometryOptions,validateGeometryStability} from '../src/lib/recognitionGeometry.js';
import {makeBlock,makeGeometry,renderRow} from './fixtures/jianpu-image.mjs';
const raw=symbols=>({rowId:'r',events:parseSymbols(symbols),arcs:[],tuplets:[],lyrics:[],issues:[]});
const convert=(r,geo)=>convertRows([r],[{id:'r',crop:{}}],{runId:'run',imageId:'i',songId:'s',page:0,geometry:geo?{byRow:new Map([['r',geo]])}:null})[0];
const geometryFor=r=>makeGeometry(r.events.filter(e=>['note','rest'].includes(e.kind)).map((e,i)=>makeBlock(i,{digit:e.degree??0,underlines:e.underlines})));

test('mixed events retain note IDs, dots, barlines and extension totals on both conversion paths',()=>{
 for(const symbols of ['1 | 2 3 |','1 - 2. | 0/ 3// - |','1 - - | 2 3 -','0 - | 1/ 2/. 3// |']){
  const r=raw(symbols);const before=JSON.stringify(r);const fused=convert(r,geometryFor(r)),pure=convert(r);
  assert.deepEqual(fused.notes.map(({durationEvidence,...n})=>n),pure.notes,symbols);
  assert.equal(fused.recognitionBlocked,pure.recognitionBlocked);
  assert.equal(JSON.stringify(r),before,'does not mutate AI archive');
 }
});

test('DP indexes always reference the unfiltered event array, including rests',()=>{
 for(const symbols of ['1 | 2 3','1 - 2 3','1 ? 2 3','0 | 2 3']){
  const r=raw(symbols);const blocks=[makeBlock(0,{digit:symbols[0]==='0'?0:1,underlines:0}),makeBlock(1,{digit:3,underlines:0})];
  const aligned=alignBlocksToEvents(blocks,r.events);
  assert.deepEqual(aligned.pairs.map(p=>r.events[p.event].id),['e1','e4']);
  const fused=convert(r,makeGeometry(blocks));
  // 计数不一致不再整行换源：配上对的音符按几何读数，未配上的音符保留 AI 时值；音符数量与身份不变
  assert.deepEqual(fused.notes.map(n=>n.recognitionEventId),convert(r).notes.map(n=>n.recognitionEventId));
  assert.deepEqual(fused.notes.filter(n=>!n.evidence).map(n=>n.annotation),convert(r).notes.filter((_,i)=>!fused.notes[i].evidence).map(n=>n.annotation));
  assert.deepEqual(aligned.pairs.map(p=>r.events[p.event].id),['e1','e4']);
 }
});

test('音数相等但字形序列有分歧时按逐位对应取几何读数，不顺移',()=>{
 const r=raw('1// 2// 3//');const geo=makeGeometry([1,3,4].map((digit,i)=>makeBlock(i,{digit,underlines:2})));
 const out=convert(r,geo);
 assert.equal(out.geometry.degraded,false);
 assert.deepEqual(out.notes.map(n=>n.annotation.durationTicks),[6,6,6],'音数相等即逐位对应，不因字形分歧整行换源');
});

test('行级置信度异常不放行计数大幅不一致时的臆测映射',()=>{
 for(const count of [0,1,2,8,40]){
  const r=raw('1/ 2//. | 3 - 4 5 6 7 1^ |');const geo=makeGeometry(Array.from({length:count},(_,i)=>makeBlock(i)),{mappingConfidence:1});
  if(count===8)continue;
  const out=convert(r,geo);
  assert.deepEqual(out.notes.map(n=>n.recognitionEventId),convert(r).notes.map(n=>n.recognitionEventId),'音符数量与身份始终来自 AI');
 }
});

test('算法测不到减时线时按无减时线取值（不用 AI）；附点为 null 仍置空',()=>{
 // 该块没扫到横线（layerCount=0）→ 算法认为没有减时线 = 四分音符，与 AI 写的 1/2 条无关
 for(const confidence of [0,undefined,NaN]){
  const r=raw('1//. 2/');const geo=geometryFor(r);geo.blocks.forEach(b=>Object.assign(b,{layerCount:0,underlines:0,underlineConfidence:confidence}));
  const out=convert(r,geo);
  assert.ok(out.notes.every(n=>!n.durationEvidence||n.durationEvidence.underlines.measured===false),'都走默认值');
  assert.ok(out.recognitionIssues.some(i=>i.code==='rhythm-from-default'));
 }
 const r=raw('1 2');r.events[0].dots=null;
 assert.equal(convert(r,geometryFor(r)).notes[0].annotation.durationTicks,null);
 assert.equal(convert(r,geometryFor(r)).recognitionBlocked,true);
});

test('读不出的音与其弧线被删除，同行其余照常；孤立延时线仍不作废整行',()=>{
 // 读不出的音（?）不再阻断整行：它自己与挂在它身上的弧线一起被删除，其余音符照常可用。
 const q=raw('1 ? 2');const qa=convert(q),qb=convert(q,geometryFor(q));
 assert.equal(qb.recognitionBlocked,false,'删掉读不出的音后该行可用');
 assert.deepEqual(qb.notes.map(n=>n.degree),[1,2]);
 assert.deepEqual(qb.notes.map(n=>n.annotation),qa.notes.map(n=>n.annotation),'几何与无几何两条路径结果一致');
 assert.ok(qb.recognitionIssues.some(i=>i.code==='unknown-note-dropped'));
 // 孤立延时线仍要标记（它没有被"删除"的语义，只能待修正）
 for(const symbols of ['- 1 2','1 | - 2']){
  const r=raw(symbols);const a=convert(r),b=convert(r,geometryFor(r));
  assert.equal(b.recognitionBlocked,true,symbols);assert.deepEqual(b.notes.map(n=>n.annotation),a.notes.map(n=>n.annotation));
  assert.ok(b.recognitionIssues.some(i=>i.code.startsWith('orphan')));
 }
});

test('tuplets and unrepresentable final durations block both paths',()=>{
 const r=raw('1 2');r.tuplets=[{id:'t',members:['e1']}];assert.equal(convert(r,geometryFor(r)).recognitionBlocked,true);
 const long=raw('1 - - - - 2');assert.equal(convert(long,geometryFor(long)).recognitionBlocked,true);
 assert.equal(convert(long).recognitionBlocked,true);
});

test('same-row and cross-row arc identities survive geometry fallback and correction',()=>{
 const rows=[raw('1 | 2 3'),{...raw('3/ 4/'),rowId:'s'}];rows[0].arcs=[{id:'a',start:{rowId:'r',eventId:'e1'},end:{rowId:'r',eventId:'e4'}},{id:'b',start:{rowId:'r',eventId:'e4'},end:{rowId:'s',eventId:'e1'}}];
 const slices=rows.map(r=>({id:r.rowId,crop:{}}));const opts={runId:'x',imageId:'i',songId:'s',page:0};
 const a=convertRows(rows,slices,opts),b=convertRows(rows,slices,{...opts,geometry:{byRow:new Map([['r',makeGeometry([makeBlock(0)])],['s',geometryFor(rows[1])]])}});
 assert.deepEqual(b.map(r=>r.recognitionArcs),a.map(r=>r.recognitionArcs));
});

test('mismatched, degraded, or conflicting rows cannot teach the digit classifier',()=>{
 const geo=makeGeometry([makeBlock(0,{digit:null,signature:[1,0]})]);
 assert.deepEqual(buildClassifierSamples([{geometry:geo,fused:fuseRow(geo,parseSymbols('1 2 3'))}]),[]);
 const conflicting=makeGeometry([makeBlock(0,{digit:3,signature:[1,0]})]);
 assert.deepEqual(buildClassifierSamples([{geometry:conflicting,fused:fuseRow(conflicting,parseSymbols('1'))}]),[]);
});

const component=(x,y,width,height,area=width*height)=>({x,y,width,height,area,bottom:y+height-1,centerX:x+width/2});
test('scale-independent digit bands exclude upper dots, arcs, tall bars and lower lyrics',()=>{
 for(const scale of [.5,1,2]){
  const c=(x,y,w,h,a)=>component(x*scale,y*scale,w*scale,h*scale,a===undefined?undefined:a*scale*scale);
  const notes=Array.from({length:8},(_,i)=>c(30+i*55,50,18,32));
  const dots=Array.from({length:12},(_,i)=>c(20+i*35,20,6,6));
  const lyrics=Array.from({length:10},(_,i)=>c(25+i*42,105,25,30));
  const extras=[c(80,5,55,25,100),c(260,30,5,68),...dots,...lyrics];
  const row=detectRowBand([...extras,...notes],{digitBand:[48*scale,84*scale]});
  assert.equal(row.digits.length,8);assert.deepEqual(row.digits,notes);
 }
});

test('multiple comparable rows without reliable band metadata abstain',()=>{
 const rows=[45,110].flatMap(y=>Array.from({length:8},(_,i)=>component(20+i*50,y,18,32)));
 assert.equal(detectRowBand(rows),null);
});

test('invalid or off-target band cannot silently select another row',()=>{
 const img=renderRow([{underlines:1},{underlines:1}]);
 for(const digitBand of [[.7,.2],[-1,.5],[.1,2],[NaN,.5]])assert.equal(analyzeRowGeometry(img,{digitBand}).available,false);
 assert.equal(analyzeRowGeometry(img,{digitBand:[.8,.95]}).available,false);
 const opt=geometryOptions({crop:{y:.2,height:.1},digitBand:[.22,.25]});
 assert.ok(Math.abs(opt.digitBand[0]-.2)<1e-12);assert.ok(Math.abs(opt.digitBand[1]-.5)<1e-12);
});

test('scale stability rejects skeleton splits but only downgrades uncertain rhythm fields',()=>{
 const base=makeGeometry([makeBlock(0),makeBlock(1)],{analyzedWidth:1440,scale:28});
 const same={...base,analyzedWidth:1080,blocks:base.blocks.map(b=>({...b,centerX:b.centerX*.75}))};
 assert.equal(validateGeometryStability(base,same).available,true);
 const split={...same,blocks:[...same.blocks,same.blocks[0]]};
 assert.equal(validateGeometryStability(base,split).reason,'unstable-geometry');
 const changed={...same,blocks:same.blocks.map((b,i)=>({...b,underlines:i?2:1}))};
 const out=validateGeometryStability(base,changed);
 assert.equal(out.available,true);assert.equal(out.blocks[0].underlineConfidence,.9);assert.equal(out.blocks[1].underlineConfidence,0);
 assert.equal(base.blocks[1].underlineConfidence,.9,'input remains immutable');
});

test('界面只支持一个附点：模型读到两个及以上按一个处理并留档，归档不被改写',()=>{
 const r=raw('1.. 2/.. | 3');
 const before=JSON.stringify(r);
 const pure=convert(r),fused=convert(r,geometryFor(r));
 assert.deepEqual(r.events.slice(0,2).map(e=>e.dots),[2,2],'原始归档保留模型读数');
 assert.deepEqual(pure.notes.map(n=>n.annotation.dots),[1,1,0],'一律按一个附点取值');
 assert.deepEqual(pure.notes.map(n=>n.annotation.durationTicks),[24,12,24],'四分附点=36、八分附点=18');
 assert.equal(pure.recognitionIssues.filter(i=>i.code==='dots-downgraded').length,2,'两条降级记录');
 assert.deepEqual(fused.notes.map(({durationEvidence,...n})=>n),pure.notes,'几何与无几何两条路径口径一致');
 assert.equal(JSON.stringify(r),before,'不改写 AI 归档');
});

test('延时横线并入后无法用单附点表示时，取不超过它的最大可显示值并留档',()=>{
 const approximated=convert(raw('1/. -'));       // 八分附点 18 + 一条延时横线 24 = 42（双附点值）
 assert.deepEqual(approximated.notes[0].annotation,{durationTicks:24,dots:1,dotted:true,measureEnd:false,tieToNext:false});
 assert.ok(approximated.recognitionIssues.some(i=>i.code==='duration-approximated'));
 const exact=convert(raw('1 -'));                // 24 + 24 = 48 仍可精确表示
 assert.equal(exact.notes[0].annotation.durationTicks,48);
 assert.equal(exact.notes[0].annotation.dots,0);
 assert.ok(!exact.recognitionIssues.some(i=>['duration-approximated','dots-downgraded'].includes(i.code)),'可表示时不产生留档');
});

test('行级置信度非有限值时仍逐音取几何读数，并记录行级质量',()=>{
 const events=parseSymbols('1/ 2//');
 for(const mappingConfidence of [undefined,NaN,Infinity]){
  const out=fuseRow(makeGeometry([makeBlock(0,{underlines:1}),makeBlock(1,{underlines:2})],{mappingConfidence}),events);
  assert.equal(out.degraded,false);
  assert.deepEqual(out.notes.map(n=>n.underlines),[1,2],'几何测到就用几何');
  assert.ok(out.issues.some(i=>i.code==='low-row-quality'),'行级质量异常要留档');
 }
});
