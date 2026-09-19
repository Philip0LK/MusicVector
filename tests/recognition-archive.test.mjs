import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {archiveRecordPath,recognitionArchiveMiddleware,safeSegment,writeArchive} from '../server/recognitionArchive.mjs';
const payload=extra=>({status:'failed',error:'识别结果格式错误：无法解析符号 v 6/v',songId:'2c320483-ec20-401b-9995-f5c0bf85e8f1',songTitle:'Baby Song',page:1,imageId:'ede13f36-2808-4265-8bb0-1af977efefd7',image:{id:'ede13f36-2808-4265-8bb0-1af977efefd7',name:'babySonghP2.jpg',src:'data:image/png;base64,'+Buffer.from('fake-image').toString('base64')},request:{provider:'qwen',model:'qwen3.8-max',promptVersion:'2.1-notes-index-2026-09-13',promptHash:'abc',runId:'05474ff3-7b7c-4506-9277-e62451635d67',startedAt:new Date('2026-09-13T10:11:12').getTime()},task:{calls:[{kind:'rows',error:'格式错误',outputText:'{"requestId":"x"}'}]},result:null,...extra});
test('record name identifies song, page, image, status and run',()=>{
 const {day,name}=archiveRecordPath(payload());
 assert.equal(day,'2026-09-13');
 assert.equal(name,'p02__Baby-Song__2c320483__ede13f36__failed__101112-05474ff3.json');
});
test('unsafe characters are replaced and length is capped',()=>{
 assert.equal(safeSegment('a/b\\c:d*e?f"g<h>i|j'),'a-b-c-d-e-f-g-h-i-j');
 assert.equal(safeSegment('   '),'untitled');
 assert.equal(safeSegment('x'.repeat(40)).length,24);
});
test('archive writes identified record, dedupes image by content and appends index',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'recognition-archive-'));
 const first=await writeArchive(root,payload());
 const second=await writeArchive(root,payload({status:'ok',result:{rows:[{id:'row-1'}]}}));
 const record=JSON.parse(await readFile(path.join(root,first.file),'utf8'));
 assert.equal(record.origin,'live');assert.equal(record.status,'failed');assert.equal(record.song.title,'Baby Song');assert.equal(record.song.id,'2c320483-ec20-401b-9995-f5c0bf85e8f1');
 assert.equal(record.page,1);assert.equal(record.request.model,'qwen3.8-max');assert.equal(record.request.promptVersion,'2.1-notes-index-2026-09-13');
 assert.match(record.image.sourceFile,/^images\/[0-9a-f]{16}\.png$/);assert.equal(record.image.byteLength,10);assert.equal(record.image.name,'babySonghP2.jpg');
 assert.equal(record.task.calls[0].outputText,'{"requestId":"x"}');assert.equal(record.result,null);assert.match(record.error,/无法解析符号/);
 assert.equal(second.image,first.image);
 assert.equal((await readdir(path.join(root,'images'))).length,1);
 const index=(await readFile(path.join(root,'index.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(index.length,2);assert.equal(index[0].status,'failed');assert.equal(index[1].status,'ok');assert.equal(index[1].rows,1);assert.equal(index[1].file,second.file);
 assert.notEqual(first.file,second.file);
 await assert.doesNotReject(access(path.join(root,'README.md')));
});
test('backfilled records stay distinguishable from live ones',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'recognition-archive-'));
 const {file}=await writeArchive(root,payload({origin:'backfill'}));
 assert.equal(JSON.parse(await readFile(path.join(root,file),'utf8')).origin,'backfill');
 assert.equal(JSON.parse((await readFile(path.join(root,'index.jsonl'),'utf8')).trim()).origin,'backfill');
});
test('non data-url sources are referenced instead of copied',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'recognition-archive-'));
 const {file}=await writeArchive(root,payload({image:{id:'x',name:'legacy.jpg',src:'/legacy/x/001.jpg'}}));
 const record=JSON.parse(await readFile(path.join(root,file),'utf8'));
 assert.equal(record.image.sourceFile,null);assert.equal(record.image.source,'/legacy/x/001.jpg');
});
const run=middleware=>async({method='POST',body,origin})=>{
 const chunks=[body];
 const req={method,url:'/api/recognition-archive',headers:{origin,host:'127.0.0.1:4176'},async *[Symbol.asyncIterator](){for(const chunk of chunks)yield Buffer.from(chunk);}};
 let status=0,payload='',nexted=false;
 const res={writeHead(code){status=code;},end(text){if(text)payload=text;}};
 await middleware(req,res,()=>{nexted=true;});
 return {status,payload,nexted};
};
test('middleware writes over http semantics and guards the endpoint',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'recognition-archive-'));
 const handle=run(recognitionArchiveMiddleware({root}));
 const ok=await handle({body:JSON.stringify(payload())});
 assert.equal(ok.status,200);
 const written=JSON.parse(ok.payload);
 assert.equal(written.file,'2026-09-13/p02__Baby-Song__2c320483__ede13f36__failed__101112-05474ff3.json');
 assert.match(written.image,/^images\/[0-9a-f]{16}\.png$/);
 assert.equal((await handle({method:'GET'})).status,405);
 assert.equal((await handle({body:'{',origin:'http://evil.test'})).status,403);
 assert.equal((await handle({body:'{'})).status,400);
 assert.equal((await handle({body:'x'.repeat(8*1024*1024+1)})).status,413);
 const other=await handle({body:JSON.stringify(payload())});
 assert.equal(other.status,200);
 assert.notEqual(JSON.parse(other.payload).file,written.file);
});
test('unrelated requests fall through to the rest of the dev server',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'recognition-archive-'));
 const middleware=recognitionArchiveMiddleware({root});
 let nexted=false;
 await middleware({method:'GET',url:'/index.html',headers:{}},{writeHead(){},end(){}},()=>{nexted=true;});
 assert.equal(nexted,true);
});
