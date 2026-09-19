import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAliases,prepareRecognitionRequest,restoreBoundRowsResponse,snapshotAliases} from '../src/lib/shortIds.js';
import {decodeCompactPage} from '../src/pageRecognition.js';
import {decodeCompactRows} from '../src/compactNotation.js';
import {convertRows} from '../src/recognitionModel.js';
const pageA='11111111-1111-4111-8111-111111111111',pageB='22222222-2222-4222-8222-222222222222';
const row=(rowId,symbols='1/ 2 |',arcs=[])=>({rowId,symbols,arcs,tuplets:[],meterMarks:[],issues:[]});
function setup(pageId=pageA,includeHeader=false){const aliases=buildAliases([]);const wire=prepareRecognitionRequest(aliases,{kind:'page',requestUuid:pageId+'-request',pageId,images:['data:image/png;base64,AA=='],includeHeader});return {aliases,...wire};}
const response=(rows)=>({requestId:'q1',pageId:'p1',header:null,rows,pageIssues:[]});

test('B/C wire contains only short IDs; mapping is archived before a response',()=>{
 const c=setup();const text=JSON.stringify(c.content);assert(!text.includes(pageA));assert.match(text,/requestId=q1/);assert.match(text,/pageId=p1/);
 assert.equal(snapshotAliases(c.aliases).pages.p1,pageA);assert.equal(snapshotAliases(c.aliases).requestIds.q1,pageA+'-request');
 const b=buildAliases([{id:pageA+':row-1'}]);const wire=prepareRecognitionRequest(b,{kind:'rows',pageId:pageA,requestUuid:pageA+'-request',images:['data:image/png;base64,AA=='],ids:[pageA+':row-1']});
 assert(!JSON.stringify(wire.content).includes(pageA));assert.match(JSON.stringify(wire.content),/rowId=r1/);
});
test('C dynamic rows and forward references map without mutating raw archive',()=>{
 const c=setup(),raw=response([row('r1','1 2',[[2,['r2',1],null]]),row('r2','3')]);const before=structuredClone(raw);
 const out=decodeCompactPage(raw,c.aliases,c.context);assert.deepEqual(raw,before);
 assert.equal(out.rows[0].rowId,pageA+':row-1');assert.equal(out.rows[0].arcs[0].end.rowId,pageA+':row-2');assert.equal(out.rows[0].arcs[0].end.eventId,'e1');
 assert.equal(out.transientIds.rows.r2,pageA+':row-2');assert.deepEqual(out.rows[0].lyrics,[]);
});
test('C copied IDs never route data; header binds to actual page context',()=>{
 const c=setup(pageA,true);const out=decodeCompactPage({...response([row('r1')]),requestId:'q1pageId=p1',pageId:pageB,header:{title:'test',key:null,meters:[],tempo:null,issues:[]}},c.aliases,c.context);
 assert.equal(out.requestId,pageA+'-request');assert.equal(out.pageId,pageA);assert.equal(out.header.headerId,pageA);assert.equal(out.diagnostics.length,2);
});
test('B wrong but registered request ID binds to sending call',()=>{
 const a=buildAliases([{id:pageA+':row-1'}]);const args={kind:'rows',pageId:pageA,images:['data:image/png;base64,AA=='],ids:[pageA+':row-1']};
 const first=prepareRecognitionRequest(a,{...args,requestUuid:'first'});prepareRecognitionRequest(a,{...args,requestUuid:'second'});
 const out=restoreBoundRowsResponse({requestId:'q2',rows:[row('r1')]},a,first.context);assert.equal(out.requestId,'first');
});
test('parallel tasks reuse q1 p1 r1 without sharing identities',async()=>{
 const results=await Promise.all([pageA,pageB].map(async id=>{const c=setup(id);await Promise.resolve();return decodeCompactPage(response([row('r1')]),c.aliases,c.context)}));
 assert.equal(results[0].rows[0].rowId,pageA+':row-1');assert.equal(results[1].rows[0].rowId,pageB+':row-1');
 assert.equal(results[0].transientIds.pages.p1,pageA);assert.equal(results[1].transientIds.pages.p1,pageB);
});
test('conflicting duplicates keep first; ambiguous/missing cross references become null',()=>{
 const c=setup();const out=decodeCompactPage(response([row('r1','1',[[1,['r2',1],null],[1,['r9',1],null]]),row('r2','2'),row('r2','3'),row('r3','2')]),c.aliases,c.context);
 assert.equal(out.rows.length,3);assert.equal(out.rows[1].events[0].degree,2);assert.equal(out.rows[2].events[0].degree,2);
 assert(out.rows[0].arcs.every(a=>a.end===null));assert(out.diagnostics.some(d=>d.code==='duplicate-row-conflict'));
});
test('identical duplicates removed; invalid row IDs rejected without guessing',()=>{
 const c=setup(),r=row('r1');const out=decodeCompactPage(response([r,structuredClone(r)]),c.aliases,c.context);assert.equal(out.rows.length,1);
 for(const bad of ['r0','r1000','row-1',pageA]){const d=setup();assert.throws(()=>decodeCompactPage(response([row(bad)]),d.aliases,d.context),/行标识/);}
});
test('wrong registry cannot decode another call',()=>{
 const a=setup(pageA),b=setup(pageB);assert.throws(()=>decodeCompactPage(response([row('r1')]),a.aliases,b.context),/上下文/);
});
test('no lyrics and historical lyrics both accepted by B decoder',()=>{
 const options={requestId:'q1',rowIds:['r1']};assert.deepEqual(decodeCompactRows({requestId:'q1',rows:[row('r1')]},options).rows[0].lyrics,[]);
 assert.equal(decodeCompactRows({requestId:'q1',rows:[{...row('r1'),lyrics:['old']}]},options).rows[0].lyrics[0].units[0].text,'old');
});
test('page unknown note remains editable, no default rhythm and no extension across it',()=>{
 const c=setup(),out=decodeCompactPage(response([row('r1','1 ? - 2')]),c.aliases,c.context);
 const slices=out.rows.map(r=>({id:r.rowId,crop:null}));const rows=convertRows(out.rows,slices,{imageId:pageA,songId:'s',page:0,runId:'run',mode:'page'});
 assert.equal(rows[0].notes.length,3);assert.equal(rows[0].notes[1].degree,null);assert.equal(rows[0].notes[1].annotation.durationTicks,null);assert.equal(rows[0].notes[0].annotation.durationTicks,24);assert.equal(rows[0].crop,null);assert.equal(rows[0].sourceMapping,'page');
});
