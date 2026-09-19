// 第一层识别：反复/跳转只读一层，反复记号在符号层等价小节线；旋律/反复不再阻断训练播放。
import test from 'node:test';import assert from 'node:assert/strict';
import {decodeCompactRows} from '../src/compactNotation.js';
import {convertRows} from '../src/recognitionModel.js';
import {normalizeMusicDocument} from '../src/lib/musicStructure.js';
import {flatten,rhythmOf,playbackPlan} from '../src/training.js';

// 归档实测形态（09-15 10:29 成功批次 r9）：括号备选 + 反复记号
const repeatRow='2^/ 1^/ 1^/ 1^ - - | ( 1/ 6v/ 3/ 1/ 2/ 1^/ ) :|| 2^/ 1^/ 1^/ 1^/ 3^/ 3^/ 3^/ 2^/. 1^/ 6/ 6/ | 1^/ 6/ 1^/ 0/ 1^/ 6/ 1^/ 6/ 5/ 5/ 6/ 5/ 6/ |';
const response=symbols=>({requestId:'x',rows:[{rowId:'r1',symbols,arcs:[],tuplets:[],lyrics:[],issues:[]}]});
const decode=symbols=>decodeCompactRows(response(symbols),{requestId:'x',rowIds:['r1']}).rows[0];
const documentFor=rows=>({meter:{beats:4,beatUnit:4},rows,music:{arcs:[],meterChanges:[]}});
const plan=d=>playbackPlan(flatten(d),rhythmOf(d),0,null,80);

test('反复记号只读一层：:||/‖ 归一为一个小节线，不产生未知事件',()=>{
  const row=decode('2^/ 1^/ | ( 1/ 6v/ ) :|| 2^/ 1^/ |');
  const barlines=row.events.filter(e=>e.kind==='barline');
  // 谱面共三个小节线：| 、反复记号 :|| 、| —— 反复记号只贡献一个小节线，不额外分支
  assert.equal(barlines.length,3);
  assert.deepEqual(barlines.map(e=>e.style),['single','double','single']);
  assert.equal(row.events.some(e=>e.kind==='unknown'),false,'冒号不得变成未知事件');
  assert.equal(row.issues.some(i=>i.code==='unsupported-symbol'),false,'冒号属纯装饰，应静默忽略');
  // 反复记号的两种常见写法都只落成一个小节线
  assert.deepEqual(decode('1 2 :|| 3').events.filter(e=>e.kind==='barline').map(e=>e.style),['double']);
  assert.deepEqual(decode('1 2 ‖ 3').events.filter(e=>e.kind==='barline').map(e=>e.style),['double']);
  const left=decode('1 2 ‖: 3 4');
  assert.deepEqual(left.events.filter(e=>e.kind==='barline').map(e=>e.style),['double']);
});

test('反复记号 ‖: 按双小节线读取；括号只去括号、不丢音符',()=>{
  const row=decode('1 2 ‖: 3 4 ( 5 6 )');
  assert.deepEqual(row.events.filter(e=>e.kind==='barline').map(e=>e.style),['double']);
  assert.equal(row.events.filter(e=>e.kind==='note').length,6,'括号内的音符照常转录，括号本身不占事件位置');
});

test('跳转记号文字不进入符号序列，只留待确认问题',()=>{
  const row=decodeCompactRows({requestId:'x',rows:[{rowId:'r1',symbols:'2^/ 1^/ 1^/ | 1^/ - - - |]',arcs:[],tuplets:[],lyrics:[],issues:[[null,'反复记号 D.S. 未展开']]}]},{requestId:'x',rowIds:['r1']}).rows[0];
  assert.equal(row.events.some(e=>e.kind==='barline'),true);
  assert.equal(row.issues.filter(i=>i.code==='unclear-symbol').length,1);
  assert.match(row.issues[0].detail,/D\.S\./);
});

test('含反复行的谱不再阻断播放，可从第一行播到结尾',()=>{
  const row=decode(repeatRow);
  assert.equal(row.events.some(e=>e.kind==='unknown'),false);
  const doc=normalizeMusicDocument(documentFor(convertRows([row],[{id:'r1',crop:[0,1]}],{runId:'t',songId:'s',imageId:'p',page:0})));
  const played=plan(doc);
  assert.equal(played.startIndex,0);
  assert.equal(played.endIndex,doc.rows[0].notes.length-1);
  assert.equal(played.diagnostics.some(item=>item.severity==='error'),false,JSON.stringify(played.diagnostics));
});

test('识别产出的行不再带 melody / melodyConfirmed',()=>{
  const rows=convertRows([decode('1 2 | 3 4 |')],[{id:'r1',crop:[0,1]}],{runId:'t',songId:'s',imageId:'p',page:0});
  assert.equal('melody' in rows[0],false);
  assert.equal('melodyConfirmed' in rows[0],false);
});
