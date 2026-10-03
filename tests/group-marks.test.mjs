import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSymbols,decodeCompactRows} from '../src/compactNotation.js';
import {convertRows} from '../src/recognitionModel.js';
// 连音标记改造的验收：模型不再数音符序号，只在音符上写组标记（数字=行内组、字母=跨行组），
// 由接收端把标记还原成既有的弧线结构。这里既验证"标对了"的还原，也验证各种标法的容错都只降级、不作废整行。
const response=rows=>({requestId:'req',rows:rows.map(r=>({arcs:[],tuplets:[],lyrics:[],issues:[],...r}))});
const decode=rows=>decodeCompactRows(response(rows),{requestId:'req',rowIds:rows.map(r=>r.rowId)}).rows;
const one=(symbols,extra={})=>decode([{rowId:'row-a',symbols,...extra}])[0];
const crop={version:2,space:'image-normalized',x:0,y:.2,width:1,height:.1};
const convert=rows=>convertRows(rows,rows.map(r=>({id:r.rowId,crop})),{imageId:'img',songId:'s',page:0,runId:'run'});
const codes=(row,list='issues')=>row[list].map(i=>i.code);
const ends=arc=>[arc.start?.eventId??null,arc.end?.eventId??null];

test('组标记不占事件位置，事件编号与没有标记时完全一致',()=>{
 assert.deepEqual(parseSymbols('1 2(1) 3'),parseSymbols('1 2 3'));
 assert.deepEqual(parseSymbols('(1)1 2'),parseSymbols('1 2'));
 assert.deepEqual(parseSymbols('1 2 (1) 3').map(e=>e.id),['e1','e2','e3']);
});

test('同一编号的两个端点连成一组，连音数走 groupNumbers（用户给的例子）',()=>{
 const plain=one('| 1 2(1) 2 3(1) 4(2) 1 3 2 1(2)|');
 assert.equal(plain.arcs.length,2);
 assert.ok(plain.arcs.every(a=>a.number===null),'不写连音数就是普通连接');
 const counted=one('| 1 2(1) 2 3(1) 4(2) 1 3 2 1(2)|',{groupNumbers:[[1,3]]});
 assert.deepEqual(counted.arcs,[
  {id:'g1',start:{rowId:'row-a',eventId:'e3'},end:{rowId:'row-a',eventId:'e5'},number:3},
  {id:'g2',start:{rowId:'row-a',eventId:'e6'},end:{rowId:'row-a',eventId:'e10'},number:null}]);
 assert.deepEqual(codes(counted),[]);
});

test('标记写在哪一侧都读成同一个音上的标记',()=>{
 assert.deepEqual(one('1(1) 2(1)').arcs,one('(1)1 (1)2').arcs);
 assert.equal(one('2/(1) 3(1)').arcs[0].start.eventId,'e1');
});

test('标记与音符之间有空隙：按最近的音符挂上并留档',()=>{
 const row=one('1 (1) 2 (1)');
 assert.deepEqual(ends(row.arcs[0]),['e1','e2']);
 assert.deepEqual(codes(row),['group-mark-detached','group-mark-detached']);
});

test('只标出一端：普通连接补到右边第一个音符，落在行末则待确认',()=>{
 const completed=one('1(1) 2 3');
 assert.deepEqual(ends(completed.arcs[0]),['e1','e2']);
 assert.deepEqual(codes(completed),['group-endpoint-completed']);
 const tail=one('1 2 3(1)');
 assert.deepEqual(tail.arcs,[]);
 assert.deepEqual(codes(tail),['group-open-unresolved']);
});

test('连音数已知但只有一个端点：不猜范围，交给用户重设',()=>{
 const decoded=one('1(1) 2 3',{groupNumbers:[[1,3]]});
 assert.deepEqual(decoded.arcs,[{id:'g1',start:{rowId:'row-a',eventId:'e1'},end:null,number:3}]);
 assert.ok(codes(decoded).includes('group-open-unresolved'));
 const row=convert([decoded])[0];
 assert.equal(row.recognitionArcs.length,0);
 assert.deepEqual(row.recognitionPendingArcs.map(a=>({number:a.number,reason:a.reason})),[{number:3,reason:'连音组范围待确认'}]);
 assert.equal(row.recognitionPendingArcs[0].fromNoteId,row.notes[0].id);
});

test('同一编号标了三处以上：取最左边的两个端点并留档',()=>{
 const row=one('1(1) 2(1) 3(1) 4');
 assert.deepEqual(ends(row.arcs[0]),['e1','e2']);
 assert.deepEqual(codes(row),['group-number-reused']);
});

test('连音数的三种写法都收，组号没有对应标记时留档',()=>{
 const number=groupNumbers=>one('1(1) 2 3(1)',{groupNumbers}).arcs[0].number;
 assert.equal(number([[1,5]]),5);
 assert.equal(number([1,6]),6);
 assert.equal(number({'1':7}),7);
 assert.equal(number([[1,null]]),null);
 const unused=one('1(1) 2 3(1)',{groupNumbers:[[2,3]]});
 assert.deepEqual(codes(unused),['group-number-unmatched']);
});

test('标记落在休止符上、读不出组号、同一音符两个同类标记：只留档不动符号',()=>{
 const rest=one('1 0(1) 2');
 assert.deepEqual(codes(rest),['group-mark-on-rest']);
 assert.deepEqual(parseSymbols('1 0(1) 2').map(e=>e.kind),['note','rest','note']);
 assert.deepEqual(codes(one('1(9x) 2')),['group-mark-invalid']);
 assert.ok(codes(one('1(1) 2(2)(3) 4')).includes('group-mark-duplicated'));
});

test('跨行字母：两行各写一端就连成一条跨行连接',()=>{
 const decoded=decode([{rowId:'r1',symbols:'1 2 3(a)'},{rowId:'r2',symbols:'5(a) 6 7'}]);
 assert.deepEqual(decoded[0].openGroups,['a']);
 assert.deepEqual(decoded[1].incomingGroups,['a']);
 const result=convert(decoded);
 assert.deepEqual(result[0].recognitionArcs,[{id:'run:cross:r1',type:'auto',fromNoteId:'run:r1:e3',toNoteId:'run:r2:e1',number:null}]);
 assert.deepEqual(result[0].recognitionIssues,[]);
});

test('跨行只写一端：两端同音高才补齐，不同音高记为待确认',()=>{
 const same=convert(decode([{rowId:'r1',symbols:'1 2 3(a)'},{rowId:'r2',symbols:'3 6 7'}]));
 assert.equal(same[0].recognitionArcs.length,1);
 assert.deepEqual(codes(same[0],'recognitionIssues'),['group-endpoint-completed']);
 const differ=convert(decode([{rowId:'r1',symbols:'1 2 3(a)'},{rowId:'r2',symbols:'5 6 7'}]));
 assert.equal(differ[0].recognitionArcs.length,0);
 assert.deepEqual(codes(differ[0],'recognitionIssues'),['group-open-unresolved']);
});

test('跨行两端字母不一致、字母写在行中间、本页没有相邻行：都只留档',()=>{
 const mismatch=convert(decode([{rowId:'r1',symbols:'1 2 3(a)'},{rowId:'r2',symbols:'5(b) 6'}]));
 assert.equal(mismatch[0].recognitionArcs.length,1);
 assert.ok(codes(mismatch[0],'recognitionIssues').includes('group-letter-mismatch'));
 const misplaced=one('1 2(a) 3');
 assert.equal(misplaced.openGroups,undefined);
 assert.deepEqual(codes(misplaced),['group-cross-row-misplaced']);
 const last=convert(decode([{rowId:'r1',symbols:'1 2 3(a)'}]));
 assert.deepEqual(codes(last[0],'recognitionIssues'),['group-open-unresolved']);
 const first=convert(decode([{rowId:'r1',symbols:'1(a) 2'},{rowId:'r2',symbols:'3 4'}]));
 assert.deepEqual(codes(first[0],'recognitionIssues'),['group-open-unresolved']);
});

test('字母标在行内成对出现：按行内连接处理，不丢这条弧线',()=>{
 const row=one('1(a) 2(a) 3');
 assert.deepEqual(ends(row.arcs[0]),['e1','e2']);
 assert.deepEqual(codes(row),['group-cross-row-misplaced']);
 const cross=one('1 2 3(a)');
 assert.deepEqual(cross.openGroups,['a']);
 assert.deepEqual(cross.arcs,[]);
});

test('同一行同时给组标记与 arcs：以组标记为准并留档',()=>{
 const row=one('1(1) 2 3(1)',{arcs:[[1,3,null]]});
 assert.deepEqual(row.arcs.map(a=>a.id),['g1']);
 assert.deepEqual(codes(row),['arc-source-conflict']);
});

test('没有标记时 arcs 旧写法照旧生效，历史归档仍可解码',()=>{
 const row=one('1 2 3',{arcs:[[1,3,null]]});
 assert.deepEqual(row.arcs,[{id:'a1',start:{rowId:'row-a',eventId:'e1'},end:{rowId:'row-a',eventId:'e3'},number:null}]);
 assert.equal(one('1 2 3',{arcs:[[1,3,3]]}).arcs[0].number,3);
});

test('模型只给 rowId 与 symbols：空集合字段自动补齐，不作废整页',()=>{
 const rows=decodeCompactRows({requestId:'req',rows:[{rowId:'row-a',symbols:'1 2 3'}]},{requestId:'req',rowIds:['row-a']}).rows;
 assert.deepEqual(rows[0].arcs,[]);
 assert.deepEqual(rows[0].issues,[]);
 assert.deepEqual(rows[0].tuplets,[]);
});
