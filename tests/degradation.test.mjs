// 单点降级：任何一处异常都不得作废整页。用真实归档形态与本地构造覆盖六类降级。
import test from 'node:test';import assert from 'node:assert/strict';
import {decodeCompactRows} from '../src/compactNotation.js';
import {convertRows} from '../src/recognitionModel.js';
import {normalizeMusicDocument} from '../src/lib/musicStructure.js';
import {flatten,rhythmOf,playbackPlan} from '../src/training.js';

const UUID='8b231a4c-ecef-4dec-b073-f51b240d1ec3';
const row=(rowId,symbols='1 2',extra={})=>({rowId,symbols,arcs:[],tuplets:[],lyrics:[],issues:[],...extra});
const decode=(rows,rowIds=['a','b'])=>decodeCompactRows({requestId:UUID,rows},{requestId:UUID,rowIds});
const codes=rows=>[...new Set(rows.flatMap(r=>r.issues.map(i=>i.code)))];
const convert=(decoded,rowIds=['a','b'])=>convertRows(decoded.rows,rowIds.map(id=>({id,crop:[0,1]})),{runId:'r',songId:'s',imageId:'i',page:0});

test('真实归档形态：requestId 被粘连成 q3rowId=b 时不再作废整页',()=>{
 // 09-15 17:44 那次失败的原始形态（模型把第一行的 rowId 标签粘进了 requestId）
 const value={requestId:'q3rowId=b',rows:[row('b','5. 1 2 - |')]};
 const decoded=decodeCompactRows(value,{requestId:UUID,rowIds:['b']});
 assert.equal(decoded.rows.length,1);
 assert.ok(codes(decoded.rows).includes('requestId-mismatch'));
 assert.equal(decoded.rows[0].events.filter(e=>e.kind==='note').length,3,'行内容照常收下');
});

test('标记冲突按从左往右第一个算数，并记录降级',()=>{
 const cases=[['6v^',{octave:-1}],['6^v',{octave:1}],['1^^^',{octave:2}],['1vvv',{octave:-2}],['1^v^',{octave:2}]];
 for(const [token,expected] of cases){
  const decoded=decode([row('a',`1 2 ${token}`)]);
  const note=decoded.rows[0].events.find(e=>e.id==='e3');
  assert.equal(note.kind,'note',token);
  assert.equal(note.octave,expected.octave,token);
  assert.ok(codes(decoded.rows).includes('unknown-note-token'),token+' 要留档');
 }
 // 休止符带音区/变音：丢掉标记，读成普通休止符
 for(const token of ['0^','#0','0v']){
  const decoded=decode([row('a',`1 ${token}`)]);
  assert.equal(decoded.rows[0].events[1].kind,'rest',token);
 }
});

test('读不出的音被删除，同行其余音符照常可用',()=>{
 const decoded=decode([row('a','1 2 ? 4')],['a']);
 assert.equal(decoded.rows[0].events.filter(e=>e.kind==='unknown').length,1,'解码阶段先保留位置');
 const out=convert(decoded,['a']);
 assert.equal(out[0].notes.length,3,'未知音被删除');
 assert.deepEqual(out[0].notes.map(n=>n.degree),[1,2,4]);
 assert.equal(out[0].recognitionBlocked,false,'删掉读不出的音后该行可用');
 assert.ok(out[0].recognitionIssues.some(i=>i.code==='unknown-note-dropped'));
});

test('指向读不出的音的弧线一并删除，且不因此拦住整首播放',()=>{
 // 位置序号只数音符，正常路径下读不出的音不会被弧线指到；这里直接构造"端点确实指向被删音符"的输入，
 // 覆盖 convertRows 的安全网：弧线与该音一起丢弃，且不得进入"待确认连接"（否则整首不能播）。
 const decoded=decode([row('a','1 2 ? 4')],['a']);
 decoded.rows[0].arcs=[{id:'a1',start:{rowId:'a',eventId:'e3'},end:{rowId:'a',eventId:'e2'},number:3}];
 const out=convert(decoded,['a']);
 assert.equal(out[0].recognitionArcs.length,0,'弧线被删除');
 assert.equal(out[0].recognitionPendingArcs.length,0,'不得进入待确认连接');
 assert.ok(out[0].recognitionIssues.some(i=>i.code==='unknown-arc-dropped'));
 assert.equal(out[0].notes.length,3);
 const doc=normalizeMusicDocument({meter:{beats:4,beatUnit:4},rows:out,music:{arcs:[],pendingArcs:out.flatMap(r=>r.recognitionPendingArcs),meterChanges:[]}});
 assert.doesNotThrow(()=>playbackPlan(flatten(doc),rhythmOf(doc),0,null,80),'不得因连音组范围待确认而拦住播放');
});

test('读不出的音之后的弧线端点不错位',()=>{
 // 位置序号只数音符（与 SOP 一致）：符号 1 2 ? 4 5 里序号 3、4 对应第 3、4 个音符（即 4 与 5）
 const decoded=decode([row('a','1 2 ? 4 5',{arcs:[[3,4,null]]})],['a']);
 const out=convert(decoded,['a']);
 assert.equal(out[0].recognitionArcs.length,1);
 assert.equal(out[0].recognitionArcs[0].fromNoteId,'r:a:e4');
 assert.equal(out[0].recognitionArcs[0].toNoteId,'r:a:e5');
});

test('缺行补空占位；内容冲突的重复行保留第一份',()=>{
 const short=decode([row('a','1 2')]);
 assert.equal(short.rows.length,2);
 assert.equal(short.rows[1].rowId,'b');
 assert.equal(short.rows[1].events.length,0);
 assert.ok(codes(short.rows).includes('missing-row-placeholder'));
 assert.equal(convert(short)[1].recognitionBlocked,true,'占位行没有音符，标为待修正');

 const dup=decode([row('a','1 2'),row('a','3 4'),row('b','5 6')]);
 assert.equal(dup.rows[0].events.length,2,'保留第一份');
 assert.ok(codes(dup.rows).includes('duplicate-row-conflict'));
});

test('请求外有内容的行被忽略并记录',()=>{
 const out=decode([row('a','1 2'),row('b','3 4'),row('c','5 6 7')]);
 assert.deepEqual(out.rows.map(r=>r.rowId),['a','b']);
 assert.ok(codes(out.rows).includes('extra-row-ignored'));
});

test('缺时值用几何读数兜底：AI 没给 + 几何置信度低也填上',()=>{
 const decoded=decode([row('a','1 2')],['a']);
 // AI 未给减时线（等同 ? 的读法），几何给出 2 条，但置信度很低
 decoded.rows[0].events[0].underlines=null;
 const geometry={byRow:new Map([['a',{
   available:true,version:'test',mappingConfidence:1,scale:20,analyzedWidth:1440,
   blocks:[
     {index:0,bbox:{x:0,y:0,width:10,height:10},centerX:0,digit:1,underlines:2,underlineConfidence:0.4,rightDot:false,lowDot:false,measureEnd:false,evidence:null,signature:null},
     {index:1,bbox:{x:20,y:0,width:10,height:10},centerX:20,digit:2,underlines:0,underlineConfidence:0.4,rightDot:false,lowDot:false,measureEnd:false,evidence:null,signature:null},
   ],issues:[]}]])};
 const out=convertRows(decoded.rows,['a'].map(id=>({id,crop:[0,1]})),{runId:'r',songId:'s',imageId:'i',page:0,geometry});
 assert.equal(out[0].notes[0].annotation.durationTicks,6,'几何测到 2 条 → 十六分（几何为默认）');
 assert.equal(out[0].notes[1].annotation.durationTicks,24,'几何测到 0 条且是测量值 → 四分');
 assert.equal(out[0].notes[0].durationEvidence.underlines.source,'geometry');
 assert.equal(out[0].notes[0].durationEvidence.underlines.measured,true);
});

test('索引级仍整页失败：字段结构不符',()=>{
 assert.throws(()=>decode([row('a'),{...row('b'),melody:['single',[]]}]),/紧凑格式字段/);
 assert.throws(()=>decodeCompactRows({requestId:UUID,rows:[{rowId:'a',symbols:'1',arcs:[]}]},{requestId:UUID,rowIds:['a']}),/紧凑格式字段/);
});
