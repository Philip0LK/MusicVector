import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DataStore,atomic} from '../server/dataStore.mjs';
import {Vault} from '../server/vault.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'yuebeidou-test-'));
test.after(()=>fs.rm(root,{recursive:true,force:true}));
test('file storage preserves images, rejects stale revisions, and never seeds empty libraries',async()=>{
 const store=new DataStore(path.join(root,'library'));await store.init();
 assert.equal((await store.state()).songs.length,0);
 const value={songs:[{id:'test',images:[{src:'data:image/png;base64,aGVsbG8='}]}],settings:{apiKey:'secret'}};
 assert.equal((await store.save(value,0)).revision,1);
 const saved=await store.state();assert.equal(saved.settings.apiKey,undefined);
 assert.equal(await fs.readFile(store.file(saved.songs[0].images[0].src.slice(7)),'utf8'),'hello');
 assert.equal((await store.save(value,1)).revision,1);
 const outcomes=await Promise.allSettled([store.save({...value,settings:{a:1}},1),store.save({...value,settings:{a:2}},1)]);
 assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
 await store.save({songs:[],settings:{}},2);await store.init();assert.equal((await store.state()).songs.length,0);
});
test('committed transaction interruption blocks new writes and rolls forward on restart',async()=>{
 const dir=path.join(root,'crash'),store=new DataStore(dir);await store.init();
 store.recover=async()=>{throw Error('simulated disk failure')};
 await assert.rejects(store.save({songs:[{id:'a',title:'complete'}],settings:{}},0),/disk failure/);
 await assert.rejects(store.save({songs:[],settings:{}},0),/重启/);
 const reopened=new DataStore(dir);await reopened.init();assert.equal((await reopened.state()).songs[0].title,'complete');
 await assert.rejects(fs.access(reopened.file('_transaction/manifest.json')));
});
test('unfinished recognition is retained and marked interrupted; draft writes use revisions',async()=>{
 const store=new DataStore(path.join(root,'draft'));await store.init();await store.save({songs:[{id:'a'}],settings:{}},0);
 const record=await store.archive('a',{status:'running',input:{text:'original'}});await store.init();
 assert.equal(JSON.parse(await fs.readFile(store.file(record.file))).status,'interrupted');
 await store.writeDocument('songs/a/draft.json',{document:{rows:[]}},0);
 await assert.rejects(store.writeDocument('songs/a/draft.json',null,0),e=>e.status===409);
});
test('Windows credential vault encrypts at rest and only exposes masked metadata',async()=>{
 const vault=new Vault(path.join(root,'vault'),path.resolve('runtime/python/python.exe'),path.resolve('server/dpapi.py'));
 const key='test-product-secret-12345';await vault.save('glm','http://localhost/test',key);
 assert.equal((await vault.get('glm','http://localhost/test')).apiKey,key);
 assert.equal(JSON.stringify(await vault.describe('glm','http://localhost/test')).includes(key),false);
 assert.equal((await fs.readFile(vault.file('glm','http://localhost/test'),'utf8')).includes(key),false);
});
