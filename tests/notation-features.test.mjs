import test from 'node:test';import assert from 'node:assert/strict';
import {putArc,removeArc,setMeterChange} from '../src/lib/arcEditing.js';
import {normalizeMusicDocument} from '../src/lib/musicStructure.js';
import {decodeCompactRows} from '../src/compactNotation.js';
import {convertRows} from '../src/recognitionModel.js';
import {flatten,rhythmOf,playbackPlan} from '../src/training.js';
const fixture=()=>({meter:{beats:4,beatUnit:4},rows:[0,1,2].map(r=>({page:0,line:r,id:'r'+r,notes:[0,1,2,3].map(i=>({id:`n${r}${i}`,degree:i===1?0:3,octave:0,annotation:{durationTicks:12,measureEnd:i===3}}))})),music:{arcs:[]}});
const plan=d=>playbackPlan(flatten(d),rhythmOf(d),0,null,80);
import {defaultNormal,normalOptions,stepNormal} from '../src/lib/notationFeatures.js';
const simpleMeter={beats:4,beatUnit:4},compoundMeter={beats:6,beatUnit:8};
test('连音默认「占几个同类音」都有合法值，候选只含合法比例',()=>{
 for(const [actual,expected] of [[2,2],[3,2],[4,3],[5,4],[6,4],[7,4],[8,4],[9,8]])assert.equal(defaultNormal(actual,simpleMeter),expected,`${actual}连音默认值`);
 assert.equal(defaultNormal(2,compoundMeter),3);
 assert.deepEqual(normalOptions(2,simpleMeter),[2,3]);assert.deepEqual(normalOptions(3,simpleMeter),[2]);
 assert.deepEqual(normalOptions(4,simpleMeter),[3]);assert.deepEqual(normalOptions(9,simpleMeter),[8]);
 assert.equal(normalOptions(1,simpleMeter).length,0);
});
test('2 连音可在两种合法比例间切换，其余连音的推导值不在候选里时不动',()=>{
 assert.equal(stepNormal(2,simpleMeter,2,'up'),3);assert.equal(stepNormal(2,simpleMeter,3,'down'),2);
 assert.equal(stepNormal(3,simpleMeter,2,'up'),2);assert.equal(stepNormal(3,simpleMeter,2,'down'),2);
 assert.equal(stepNormal(8,simpleMeter,4,'up'),4);assert.equal(stepNormal(8,simpleMeter,null,'up'),4);
});
test('用默认值建出的 2–9 连音比例都合法（不再出现空 normal 的坏连音）',()=>{
 const fixture=()=>({meter:{beats:4,beatUnit:4},rows:[{page:0,line:0,id:'r0',notes:Array.from({length:9},(_,i)=>({id:'n'+i,degree:3,octave:0,annotation:{durationTicks:12}}))}],music:{arcs:[]}});
 for(const actual of [2,3,4,5,6,7,8,9]){
  const d=putArc(fixture(),{id:'t'+actual,fromNoteId:'n0',toNoteId:'n'+(actual-1),number:actual,normal:defaultNormal(actual,simpleMeter)});
  const group=d.music.tuplets[0];
  assert.equal(group.invalid,false,`${actual}连音不应无效`);
  assert.equal(group.ratio,`${actual}:${defaultNormal(actual,simpleMeter)}`);
  assert.deepEqual(d.music.diagnostics.filter(x=>x.severity==='error').map(x=>x.code),[],`${actual}连音不应有 error 诊断`);
 }
});
test('numbered connection includes rests, changes duration and never merges same pitches',()=>{let d=putArc(fixture(),{id:'triplet',fromNoteId:'n00',toNoteId:'n02',number:3});assert.equal(d.music.tuplets[0].normal,2);assert.deepEqual(d.music.tuplets[0].memberIds,['n00','n01','n02']);assert.equal(plan(d).steps[0].durationTicks,8);assert.equal(plan(d).steps[2].trigger,true);assert.equal(plan(removeArc(d,'triplet')).steps[0].durationTicks,12);assert.equal(normalizeMusicDocument(d).music.tuplets.length,1);});
test('meter inheritance, one-measure override, removal and serialization',()=>{let d=setMeterChange(fixture(),'n10',{beats:2,beatUnit:4});assert.deepEqual(d.music.measures.map(m=>m.meter.beats),[4,2,2]);d=setMeterChange(d,'n10',{beats:3,beatUnit:4},true);assert.deepEqual(d.music.measures.map(m=>m.meter.beats),[4,3,4]);assert.deepEqual(normalizeMusicDocument(JSON.parse(JSON.stringify(d))).music.measures,d.music.measures);d=setMeterChange(d,'n10',null);assert.deepEqual(d.music.measures.map(m=>m.meter.beats),[4,4,4]);});
const response=()=>({requestId:'x',rows:[{rowId:'r',symbols:'| 3/ 0/ 3/ | 5 6 |',arcs:[[1,2,3]],tuplets:[],lyrics:[],issues:[],meterMarks:[[1,2,4]]}]});
test('new protocol retains pitched-only indexes, maps meters, keeps first-layer notes playable',()=>{const raw=decodeCompactRows(response(),{requestId:'x',rowIds:['r']}).rows;assert.equal(raw[0].arcs[0].end.eventId,'e4');const rows=convertRows(raw,[{id:'r',crop:[0,1]}],{runId:'test',songId:'s',imageId:'p',page:0});assert.equal(rows[0].notes[0].annotation.durationTicks,12);assert.equal(rows[0].recognitionArcs[0].number,3);assert.equal(rows[0].recognitionMeterChanges[0].noteId,rows[0].notes[3].id);assert.equal(rows[0].melody,undefined);assert.equal(rows[0].melodyConfirmed,undefined);const doc=normalizeMusicDocument({meter:{beats:4,beatUnit:4},rows,music:{arcs:rows[0].recognitionArcs,meterChanges:rows[0].recognitionMeterChanges}});assert.equal(doc.rows[0].notes[2].degree,3);const played=plan(doc);assert.equal(played.missingIndexes.length,0);assert.equal(played.diagnostics.some(item=>item.severity==='error'),false);});
