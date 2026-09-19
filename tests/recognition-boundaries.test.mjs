import test from 'node:test';import assert from 'node:assert/strict';import {decodeCompactRows} from '../src/compactNotation.js';import {geometryOptions} from '../src/lib/recognitionGeometry.js';
const row=(rowId,symbols='1 2')=>({rowId,symbols,arcs:[],tuplets:[],lyrics:[],issues:[],meterMarks:[]});
const decode=rows=>decodeCompactRows({requestId:'x',rows},{requestId:'x',rowIds:['r1','r2']});
test('unsolicited empty row is ignored, requested rows kept by ID and warning retained',()=>{const r=decode([row('r2'),row('r1'),row('r3','')]);assert.deepEqual(r.rows.map(r=>r.rowId),['r1','r2']);assert.equal(r.rows[0].events.length,2);assert.equal(r.rows[0].issues[0].code,'extra-row-ignored');});
test('缺行、请求外行都不再作废整页（补占位/忽略并记录）',()=>{
 // 缺行 → 补空占位 + 记录
 const short=decode([row('r1')]);
 assert.equal(short.rows.length,2);assert.equal(short.rows[1].events.length,0);
 assert.ok(short.rows.some(r=>r.issues.some(i=>i.code==='missing-row-placeholder')));
 // 请求外有内容/空行 → 忽略 + 记录
 assert.ok(decode([row('r1'),row('r2'),row('r3')]).rows[0].issues.some(i=>i.code==='extra-row-ignored'));
 assert.ok(decode([row('r1'),row('r2'),{...row('r3',''),other:'content'}]).rows[0].issues.some(i=>i.code==='extra-row-ignored'));
 // 带未知键的请求外空行：按"形状未知"处理 → 不丢弃、但只忽略并记录，仍不作废整页
 const unknownKey=decode([row('r1'),row('r2'),{...row('r3',''),variant:[]}]);
 assert.equal(unknownKey.rows.length,2);
 assert.ok(unknownKey.rows[0].issues.some(i=>i.code==='extra-row-ignored'));
});
test('已移除的 melody 字段不再被接受：回传即在接收端被拒',()=>{assert.throws(()=>decode([row('r1'),{...row('r2'),melody:['single',[]]}]),/紧凑格式字段/);});
test('inverted geometry band is rejected, never treated as a negative glyph height',()=>{assert.deepEqual(geometryOptions({crop:{y:.1,height:.3},digitBand:[.22,.20]}),{digitBand:[-1,-1]});assert.deepEqual(geometryOptions({crop:{y:0,height:1},digitBand:[.2,.3],digitBands:[[.1,.15],[.2,.3]]}),{digitBand:[.2,.3]});});

// 短 ID：模型回传短名，翻译后进契约；错误文案要同时给出短名与长名（决策：不加宽松兜底）。
import {buildAliases,aliasLabel,shortenResponse} from '../src/lib/shortIds.js';
const longSlices=[{id:'img-1:row-1'},{id:'img-1:row-2'}];
const decodeAliased=rows=>{const aliases=buildAliases(longSlices);return decodeCompactRows(shortenResponse({requestId:'q1',rows},aliases),{requestId:'q1',rowIds:longSlices.map(s=>s.id),aliasLabel:aliasLabel(aliases)});};
test('短名回传：翻译成长 ID 后正常收下，行的 id 必须是长 ID',()=>{const r=decodeAliased([row('r2'),row('r1')]);assert.deepEqual(r.rows.map(r=>r.rowId),['img-1:row-1','img-1:row-2']);});
test('短名 + 请求外空壳行：仍然只告警不失败',()=>{const r=decodeAliased([row('r1'),row('r2'),row('r3','')]);assert.equal(r.rows.length,2);assert.equal(r.rows[0].issues[0].code,'extra-row-ignored');});
test('短名 + 缺行：补空占位并记录（占位行的 rowId 是长 ID）',()=>{const r=decodeAliased([row('r1')]);assert.equal(r.rows.length,2);assert.equal(r.rows[1].rowId,'img-1:row-2');assert.equal(r.rows[1].events.length,0);assert.ok(r.rows.some(x=>x.issues.some(i=>i.code==='missing-row-placeholder')));});
test('模型重复输出逐字节相同的行：丢弃冗余副本、正常收下、并记录重复事实',()=>{
  // 第 3 批实测形态：r1,r2,r1,r2 —— 副本与本尊逐字节相同
  const r=decode([row('r1'),row('r2'),row('r1'),row('r2')]);
  assert.deepEqual(r.rows.map(x=>x.rowId),['r1','r2'],'重复副本被丢弃，保留首份');
  assert.equal(r.rows.length,2,'不会因为重复而多出行');
  const note=r.rows[0].issues.find(i=>i.code==='duplicate-row-dropped');
  assert.ok(note,'必须留下重复输出的记录，不能静默丢弃');
  assert.match(note.detail,/r1×2/,'要能看出哪一行重复了几次');
  assert.match(note.detail,/r2×2/);
});
test('同一 rowId 出现但内容不同：保留第一份并记录冲突',()=>{
  const r=decode([row('r1'),row('r2'),row('r2','1 2 3')]);
  assert.deepEqual(r.rows.map(x=>x.rowId),['r1','r2']);
  assert.equal(r.rows[1].events.length,2,'保留第一份（符号已解析成事件）');
  assert.ok(r.rows.some(x=>x.issues.some(i=>i.code==='duplicate-row-conflict')),'必须记录冲突');
});
test('内容相同但 rowId 不同：不当作重复删除（同一段旋律合法重复出现）',()=>{
  const r=decode([row('r1','1 2'),row('r2','1 2')]);
  assert.deepEqual(r.rows.map(x=>x.rowId),['r1','r2']);
  assert.equal(r.rows[0].issues.length,0,'内容相同不足以判定为冗余副本');
});
test('短名 + 请求外带内容的行：忽略并记录，不因短名而放行',()=>{const r=decodeAliased([row('r1'),row('r2'),row('r3')]);assert.equal(r.rows.length,2);assert.ok(r.rows[0].issues.some(i=>i.code==='extra-row-ignored'));});
test('模型回传长 ID（没按短名回）：原样通过，不猜测',()=>{const r=decodeAliased([row('img-1:row-1'),row('img-1:row-2')]);assert.deepEqual(r.rows.map(r=>r.rowId),['img-1:row-1','img-1:row-2']);});
