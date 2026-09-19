import test from 'node:test';
import assert from 'node:assert/strict';
import {validateHeader,validateRows} from '../src/recognitionContract.js';
import {convertRows,headerSuggestions} from '../src/recognitionModel.js';
const note=(id,extra={})=>({id,kind:'note',degree:1,octave:1,accidental:'none',underlines:1,dots:0,...extra});
const row=(events=[note('e1')])=>({rowId:'row-a',events,arcs:[],tuplets:[],lyrics:[],issues:[]});
const response=r=>({requestId:'req',rows:[r]});
const options={requestId:'req',rowIds:['row-a']};
const convert=r=>convertRows([r],[{id:'row-a',crop:{version:2,space:'image-normalized',x:0,y:.2,width:1,height:.1}}],{imageId:'img',songId:'s',page:0,runId:'run'})[0];
test('rejects structural problems; bad references degrade locally',()=>{
 // 索引级仍整页失败：rowId 与请求不一致、重复事件 ID、多余顶层字段
 assert.throws(()=>validateRows(response({...row(),rowId:'wrong'}),options));
 assert.throws(()=>validateRows(response(row([note('e1'),note('e1')])),options));
 assert.throws(()=>validateRows({...response(row()),schemaVersion:'1.0'},options));
 // 内容级只降级：指不到音符的弧线端点置空并留档，不作废整页
 const relaxed=validateRows(response({...row(),arcs:[{id:'a1',start:{rowId:'row-a',eventId:'missing'},end:null}]}),options);
 assert.equal(relaxed.rows[0].arcs[0].start,null);
 assert.ok(relaxed.rows[0].issues.some(i=>i.code==='unsupported-symbol'));
});
test('header keeps flat/sharp and maps tempo beat units',()=>{
 const h={requestId:'req',headerId:'h',title:'BabySong',key:{tonic:'B',accidental:'flat'},meters:[{numerator:4,denominator:4}],tempo:{bpm:80,beatDenominator:8,beatDots:1},issues:[]};
 validateHeader(h,{requestId:'req',headerId:'h'});assert.deepEqual(headerSuggestions(h),{title:'BabySong',key:'Bb',meter:{beats:4,beatUnit:4},bpm:60});
 assert.equal(headerSuggestions({...h,meters:[...h.meters,{numerator:2,denominator:4}]}).meter,undefined);
});
test('extensions are merged arithmetically without guessing meter',()=>{
 const r=convert(row([note('e1',{underlines:0}),{id:'e2',kind:'extension'},{id:'e3',kind:'extension'},{id:'e4',kind:'barline',style:'single'}]));
 assert.equal(r.notes.length,1);assert.equal(r.notes[0].annotation.durationTicks,48);assert.equal(r.notes[0].annotation.dotted,true);assert.equal(r.notes[0].annotation.measureEnd,true);
});
test('tuplets and lyrics stay experimental; tuplet durations require review',()=>{
 const raw={...row([note('e1'),note('e2'),note('e3')]),tuplets:[{id:'t1',displayedNumber:3,displayedNormalNumber:null,members:['e1','e2','e3']}],lyrics:[{id:'ly1',lineIndex:1,units:[{text:'你',eventIds:['e1']}]}]};
 validateRows(response(raw),options);const r=convert(raw);assert.equal(r.experimental.tuplets.length,1);assert.equal(r.experimental.lyrics.length,1);assert.ok(r.notes.every(n=>n.annotation.durationTicks===null));assert.ok(r.notes.every(n=>!n.annotation.tupletId));
});
test('unclear pitches remain unknown and block playback',()=>{const r=convert(row([note('e1',{degree:null})]));assert.equal(r.notes[0].degree,null);assert.equal(r.notes[0].annotation.durationTicks,null);assert.equal(r.recognitionBlocked,true);});

import {parseSymbols,decodeCompactRows} from '../src/compactNotation.js';
import {makeBlock,makeGeometry} from './fixtures/jianpu-image.mjs';
const compact=(symbols,extra={})=>response({rowId:'row-a',symbols,arcs:[],tuplets:[],lyrics:[],issues:[],...extra});
test('compact symbols preserve accidentals, octaves, rhythm and event positions',()=>{
 const events=parseSymbols('#5v/. b3^^// n2 0/ - | || |] ?');
 assert.deepEqual(events[0],{id:'e1',kind:'note',degree:5,octave:-1,accidental:'sharp',underlines:1,dots:1});
 assert.equal(events[1].octave,2);assert.equal(events[1].underlines,2);assert.equal(events[2].accidental,'natural');
 assert.equal(events[3].kind,'rest');assert.equal(events[7].style,'final');assert.equal(events[8].id,'e9');
 // 冲突写法不再作废整页：从左往右第一个标记算数，其余忽略，并留档
 assert.deepEqual(parseSymbols('0^'),[{id:'e1',kind:'rest',underlines:0,dots:0}]);
 assert.deepEqual(parseSymbols('#0'),[{id:'e1',kind:'rest',underlines:0,dots:0}]);
 assert.equal(parseSymbols('6v^')[0].octave,-1);
 assert.equal(parseSymbols('1^^^')[0].octave,2);
});
test('compact references count notes only and preserve whole-line lyrics',()=>{
 const raw=decodeCompactRows(compact('1 0 | 2 3',{arcs:[[1,3]],tuplets:[[3,null,[1,2,3]]],lyrics:['你好世界'],issues:[[2,'待确认']]}),options);
 assert.equal(raw.rows[0].arcs[0].end.eventId,'e5');assert.equal(raw.rows[0].tuplets[0].members[2],'e5');assert.equal(raw.rows[0].issues[0].targetId,'e4');
 assert.equal(raw.rows[0].lyrics[0].units[0].text,'你好世界');
 assert.equal(raw.rows[0].lyrics[0].units[0].eventIds,null);
 const badArc=decodeCompactRows(compact('1 | 2',{arcs:[[1,3]]}),options).rows[0];
 assert.equal(badArc.arcs[0].end,null);assert.equal(badArc.events.length,3);assert.equal(badArc.issues[0].code,'clipped-connection');assert.equal(convert(badArc).recognitionArcs.length,0);
});
test('one unparseable reference never fails the whole response',()=>{
 // 真实故障：跨行端点写成 [1,null]（行标识是数字、序号是 null），整页曾因此作废。
 const row=decodeCompactRows(compact('4. 4 4 | 1 2 2',{arcs:[[1,[1,null]],[4,5],[5,6]]}),options).rows[0];
 assert.equal(row.events.filter(e=>e.kind==='note').length,6);
 assert.equal(row.arcs.length,3);
 assert.equal(row.arcs[0].end,null);assert.equal(row.arcs[1].start.eventId,'e5');assert.equal(row.arcs[1].end.eventId,'e6');assert.equal(row.arcs[2].end.eventId,'e7');
 // 该夹具只请求 row-a，模型也只回 row-a，因此这里不涉及缺行占位
 assert.equal(row.issues.filter(i=>i.code!=='missing-row-placeholder').length,1);
 const cross=row.issues.find(i=>i.code==='unsupported-symbol');assert.equal(cross.targetId,'a1');assert.match(cross.detail,/跨行端点/);
 // 端点、连音组成员、问题目标无法解析时都只记问题：越界记 clipped-connection，写法不合法记 unsupported-symbol
 const other=decodeCompactRows(compact('1 2 3',{arcs:[[1,'x'],[2,9]],tuplets:[[3,null,[1,9]]],issues:[[9,'待确认']]}),options).rows[0];
 assert.equal(other.arcs[0].end,null);assert.equal(other.arcs[1].end,null);
 assert.equal(other.tuplets[0].members,null);
 assert.equal(other.issues.find(i=>i.code==='unclear-symbol').targetId,null);
 assert.deepEqual([...new Set(other.issues.map(i=>i.code))].sort(),['clipped-connection','unclear-symbol','unsupported-symbol']);
 // 弧线本身不是 [起点,终点] 时忽略这一条，其余弧线照旧
 const shape=decodeCompactRows(compact('1 2 3',{arcs:[3,[1,2]]}),options).rows[0];
 assert.equal(shape.arcs.length,1);assert.equal(shape.arcs[0].end.eventId,'e2');assert.equal(shape.issues[0].code,'unsupported-symbol');
 // 仍然硬失败的只有结构性问题：字段结构不符
 assert.equal(decodeCompactRows(compact('2/8/'),options).rows[0].events.length,1);
 assert.throws(()=>decodeCompactRows({requestId:'req',rows:[{rowId:'row-a',symbols:'1',arcs:[]}]},options));
 // 缺行改为补空占位行 + 记录，不再作废整页
 const short=decodeCompactRows(compact('1'),{requestId:'req',rowIds:['row-a','row-b']});
 assert.equal(short.rows.length,2);
 assert.equal(short.rows[1].rowId,'row-b');
 assert.equal(short.rows[1].events.length,0);
 assert.ok(short.rows[0].issues.some(i=>i.code==='missing-row-placeholder'));
});
test('recognized arcs are stored from the earlier endpoint, in the start row',()=>{
 const crop=id=>({id,crop:{version:2,space:'image-normalized',x:0,y:.2,width:1,height:.1}});
 const events=[note('e1'),note('e2')];
 const rows=[{...row(events),rowId:'row-a'},{...row(events),rowId:'row-b'}];
 // 真实故障形态：跨行弧线两端写反，而且记在了后一行
 rows[1].arcs=[{id:'a1',start:{rowId:'row-b',eventId:'e2'},end:{rowId:'row-a',eventId:'e1'}}];
 // 自连（两端同一音符）是退化数据，应丢弃并记录
 rows[0].arcs=[{id:'a2',start:{rowId:'row-a',eventId:'e1'},end:{rowId:'row-a',eventId:'e1'}}];
 const converted=convertRows(rows,[crop('row-a'),crop('row-b')],{imageId:'img',songId:'s',page:0,runId:'run'});
 assert.equal(converted[0].recognitionArcs.length,1);
 assert.equal(converted[1].recognitionArcs.length,0);
 assert.equal(converted[0].recognitionArcs[0].fromNoteId,'run:row-a:e1');
 assert.equal(converted[0].recognitionArcs[0].toNoteId,'run:row-b:e2');
 assert.deepEqual(converted[0].recognitionIssues.map(issue=>issue.code),['degenerate-arc']);
});
test('references skip rests, extensions and barlines when counting notes',()=>{
 const row=decodeCompactRows(compact('0 1/ | 2 - 3',{arcs:[[1,3]]}),options).rows[0];
 assert.equal(row.arcs[0].start.eventId,'e2');assert.equal(row.arcs[0].end.eventId,'e6');
});
test('marks inside one note read by count, in any order',()=>{
 assert.deepEqual(parseSymbols('6/v 6./ 6.v 6/./ 1/^'),parseSymbols('6v/ 6/. 6v. 6//. 1^/'));
 assert.equal(parseSymbols('6/v')[0].octave,-1);assert.equal(parseSymbols('6/v')[0].underlines,1);
});
test('full-width and musical glyph variants read as the same notation',()=>{
 assert.deepEqual(parseSymbols('＃５ｖ／ ７．'),parseSymbols('#5v/ 7.'));
 assert.deepEqual(parseSymbols('♯5 ♭3 ♮2 ‖'),parseSymbols('#5 b3 n2 ||'));
});
test('parentheses are ignored as blanks and never take an event position',()=>{
 // 真实故障：模型把谱面上的提示性括号写进了 symbols（行首孤立括号、成对跨小节）
 assert.deepEqual(parseSymbols('( 1^ 6/ 1^/ | 2 - - ) 1 2'),parseSymbols('1^ 6/ 1^/ | 2 - - 1 2'));
 assert.deepEqual(parseSymbols('（1）2'),parseSymbols('1 2'));
 const events=parseSymbols('( 1 2 3');
 assert.equal(events.length,3);assert.equal(events[0].id,'e1');assert.equal(events[2].id,'e3');
 assert.equal(parseSymbols('2(3').length,2);
});
test('out-of-contract content is ignored in one pass and always recorded',()=>{
 // 反复记号：小节线成了正常 token（小节结构不受影响），冒号按纯记号静默忽略
 const repeat=decodeCompactRows(compact('1 - - - :||'),options).rows[0];
 assert.equal(repeat.events.length,5);
 assert.equal(repeat.events.filter(e=>e.kind==='barline').length,1);
 assert.equal(repeat.events.at(-1).style,'double');
 assert.equal(repeat.events.filter(e=>e.kind==='note').length,1);
 assert.equal(repeat.issues.filter(i=>i.code==='unsupported-symbol').length,0,'反复记号的冒号不再给用户添待确认项');
 // 规定外字符仍逐行记录
 const unknown=decodeCompactRows(compact('1 2 8'),options).rows[0];
 assert.match(unknown.issues.find(i=>i.code==='unsupported-symbol').detail,/规定外内容/);
 // 装饰性标点静默忽略，不产生问题
 const clean=decodeCompactRows(compact('1 , 2、3'),options).rows[0];
 assert.equal(clean.events.length,3);assert.equal(clean.issues.length,0);
 // 规定外字符不得粘连相邻内容，已匹配的 token 一字不动
 assert.deepEqual(parseSymbols('1.5'),parseSymbols('1. 5'));
 assert.deepEqual(parseSymbols('#5_6'),parseSymbols('#5 6'));
 assert.deepEqual(parseSymbols('8'),[]);
 assert.equal(parseSymbols('2/8/').length,1);
 // 冲突写法改为降级（见上），这里确认它不再抛错且仍记录待确认
 assert.equal(parseSymbols('0^')[0].kind,'rest');
 assert.equal(parseSymbols('6v^')[0].octave,-1);
});
test('compact cross-row and clipped arcs use explicit endpoints',()=>{
 const v={requestId:'req',rows:[compact('1',{arcs:[[1,['row-b',1]],[null,1]]}).rows[0],{...compact('2').rows[0],rowId:'row-b'}]};
 assert.equal(decodeCompactRows(v,{requestId:'req',rowIds:['row-a','row-b']}).rows[0].arcs[0].end.rowId,'row-b');
 // 该批只请求 row-a（模型仍回两行）：多出的行被忽略并记录，缺的行补占位；不再作废整页
 const clipped=decodeCompactRows(v,options);
 assert.equal(clipped.rows.length,1);
 assert.ok(clipped.rows[0].issues.some(i=>i.code==='extra-row-ignored'));
 // 缺行的处理是补空占位（不是失败）：返回行数等于请求行数，缺的那行 0 音符且带占位记录
 const padded=decodeCompactRows({requestId:'req',rows:[compact('1').rows[0]]},{requestId:'req',rowIds:['row-a','row-b']});
 assert.equal(padded.rows.length,2);
 assert.equal(padded.rows[1].events.length,0);
 assert.ok(padded.rows.some(r=>r.issues.some(i=>i.code==='missing-row-placeholder')));
});
test('compact and verbose rhythm convert identically',()=>{
 const parsed=decodeCompactRows(compact('1^ - - |'),options).rows[0];
 const old=row([note('e1',{underlines:0}),{id:'e2',kind:'extension'},{id:'e3',kind:'extension'},{id:'e4',kind:'barline',style:'single'}]);
 assert.deepEqual(convert(parsed),convert(old));
 assert.ok(JSON.stringify(compact('1^ - - |')).length<JSON.stringify(response(old)).length*.65);
});

test('missing whitespace is lexically recoverable without inferring music',()=>{assert.deepEqual(parseSymbols('2/1/ 1^6/.'),parseSymbols('2/ 1/ 1^ 6/.'));assert.equal(parseSymbols('12').length,2);assert.equal(parseSymbols('2/8/').length,1);});

// ---- 几何融合接入（混合识别方案）----
const convertWithGeometry=(r,geo)=>convertRows([r],[{id:'row-a',crop:{version:2,space:'image-normalized',x:0,y:.2,width:1,height:.1}}],{imageId:'img',songId:'s',page:0,runId:'run',geometry:{byRow:new Map([['row-a',geo]])}})[0];
test('不传 geometry 时行为与改造前完全一致',()=>{
 const r=row([note('e1',{underlines:1}),note('e2',{degree:2,underlines:2})]);
 assert.deepEqual(convert(r).notes.map(n=>n.annotation.durationTicks),[12,6]);
 assert.equal('durationEvidence' in convert(r).notes[0],false);
});
test('几何说两条减时线、AI 只写一条 → 时值按几何纠正',()=>{
 // AI: 1/ 2/  （两条八分）  几何: 两条减时线、两条减时线（两条十六分）
 const ai=row([note('e1',{underlines:1}),note('e2',{degree:2,underlines:1})]);
 const geo=makeGeometry([makeBlock(0,{digit:1,underlines:2}),makeBlock(1,{digit:2,underlines:2})]);
 const out=convertWithGeometry(ai,geo);
 assert.deepEqual(out.notes.map(n=>n.annotation.durationTicks),[6,6],'时值应由几何决定');
 assert.equal(out.notes[0].durationEvidence.underlines.source,'geometry');
 assert.equal(out.notes[0].durationEvidence.underlines.ai,1);
 assert.equal(out.notes[0].durationEvidence.underlines.geo,2);
 assert.equal(out.geometry.digitCount,2);
});
test('附点仍由 AI 决定，几何只留证据',()=>{
 const ai=row([note('e1',{underlines:1,dots:1})]);
 const geo=makeGeometry([makeBlock(0,{digit:1,underlines:1,rightDot:false})]);
 const out=convertWithGeometry(ai,geo);
 assert.equal(out.notes[0].annotation.durationTicks,12);
 assert.equal(out.notes[0].annotation.dots,1,'附点取 AI');
 assert.equal(out.notes[0].durationEvidence.dots.conflict,'geo-disagrees');
});
test('几何多块：不添加音符，配上的音符取几何读数，未配上的留待确认',()=>{
 const ai=row([note('e1',{degree:1,underlines:1}),note('e2',{degree:2,underlines:0})]);
 const out=convertWithGeometry(ai,makeGeometry([makeBlock(0,{digit:1,underlines:2}),makeBlock(1,{digit:2,underlines:1}),makeBlock(2,{digit:5,underlines:0})]));
 assert.deepEqual(out.notes.map(n=>n.recognitionEventId),convert(ai).notes.map(n=>n.recognitionEventId),'音符数量与身份来自 AI');
 assert.deepEqual(out.notes.map(n=>n.annotation.durationTicks),[6,12],'配上对的音符采用几何读数（2 条=十六分、1 条=八分）');
 assert.ok(out.recognitionIssues.some(i=>i.code==='geometry-block-unpaired'));
});

test('几何少块：不能删除 AI 事件',()=>{
 const ai=row([note('e1',{degree:1}),note('e2',{degree:2}),note('e3',{degree:3})]);
 const out=convertWithGeometry(ai,makeGeometry([makeBlock(0),makeBlock(1)]));
 assert.deepEqual(out.notes.map(n=>n.recognitionEventId),convert(ai).notes.map(n=>n.recognitionEventId));
 assert.equal(out.notes.length,3,'几何少块不得删除 AI 事件');
 assert.ok(out.recognitionIssues.some(i=>i.code==='geometry-block-unpaired'));
});

test('几何可用即参与融合，不再按"是否多排"跳过（第一层策略）',()=>{
 const ai=row([note('e1',{underlines:1}),note('e2',{degree:2,underlines:1})]);
 const out=convertWithGeometry(ai,makeGeometry([makeBlock(0,{digit:1,underlines:2}),makeBlock(1,{digit:2,underlines:2})]));
 assert.equal('geometry' in out,true,'只要 byRow 给出该行的几何就必须用上');
 assert.deepEqual(out.notes.map(n=>n.annotation.durationTicks),[6,6]);
});

test('几何不可用时整行降级，全部沿用 AI',()=>{
 const ai=row([note('e1',{underlines:2}),note('e2',{degree:2,underlines:1})]);
 const out=convertWithGeometry(ai,{available:false,reason:'no-row-detected',blocks:[],issues:[]});
 assert.deepEqual(out.notes.map(n=>n.annotation.durationTicks),[6,12]);
 assert.equal(out.geometry.degraded,true);
 assert.equal(out.geometry.reason,'no-row-detected');
 assert.ok(out.recognitionIssues.some(i=>i.code==='geometry-unavailable'));
});
test('几何融合产出的 issue 码能通过接收校验',()=>{
 const ai=row([note('e1',{degree:1}),note('e2',{degree:2})]);
 const geo=makeGeometry([makeBlock(0,{digit:1}),makeBlock(1,{digit:2}),makeBlock(2,{digit:3})]);
 const out=convertWithGeometry(ai,geo);
 for(const issue of out.recognitionIssues){if(issue.code==='experimental-tuplet'||issue.code==='unresolved-note'||issue.code==='orphan-extension'||issue.code==='degenerate-arc'||issue.code==='no-readable-notes')continue;
  assert.ok(['note-count-mismatch','ai-missed-note','ai-extra-note','low-dot-overridden','degree-disagree','degree-unverified','geometry-unavailable','unclear-symbol','clipped-connection','geometry-block-unpaired','low-row-quality'].includes(issue.code),'未登记的 issue 码 '+issue.code);}
});
