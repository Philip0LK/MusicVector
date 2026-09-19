import test from 'node:test';
import assert from 'node:assert/strict';
import {recognitionTargets,normalizeSaved,makeSong,filterSongs} from '../src/library.js';
test('重新识别：明确勾选优先；不勾选只处理未完成图片',()=>{
 const song={images:[{id:'a',status:'done'},{id:'b',status:'pending'},{id:'c',status:'failed'}]};
 assert.deepEqual(recognitionTargets(song),['b','c']);assert.deepEqual(recognitionTargets(song,['a']),['a']);assert.deepEqual(recognitionTargets(song,['missing']),[]);
 assert.deepEqual(recognitionTargets({images:[{id:'a',status:'done'}]}),[]);
});
test('刷新终止识别并保留图片；空导入不形成草稿',()=>{
 const empty=makeSong(),draft={...makeSong(),images:[{id:'a',status:'processing'},{id:'b',status:'done'}]};
 const restored=normalizeSaved([empty,draft]);assert.equal(restored.length,1);assert.deepEqual(restored[0].images.map(i=>i.status),['failed','done']);assert.equal(draft.images[0].status,'processing');assert.equal(empty.bpm,80);assert.equal(empty.key,'C');
});
test('歌曲搜索：空查询返回全部；多关键词必须全部命中歌名；保持原顺序',()=>{
 const songs=[{title:'沙龙'},{title:'粤语残片'},{title:'兄妹'},{title:'沙龙 现场版'}];
 assert.deepEqual(filterSongs(songs,'').map(s=>s.title),['沙龙','粤语残片','兄妹','沙龙 现场版']);
 assert.deepEqual(filterSongs(songs,'   ').map(s=>s.title),['沙龙','粤语残片','兄妹','沙龙 现场版']);
 assert.deepEqual(filterSongs(songs,'沙龙').map(s=>s.title),['沙龙','沙龙 现场版']);
 assert.deepEqual(filterSongs(songs,'  沙龙  ').map(s=>s.title),['沙龙','沙龙 现场版']);
 assert.deepEqual(filterSongs(songs,'沙龙 现场').map(s=>s.title),['沙龙 现场版']);
 assert.deepEqual(filterSongs(songs,'现场 沙龙').map(s=>s.title),['沙龙 现场版']);
 assert.deepEqual(filterSongs(songs,'不存在'),[]);
});
test('歌曲搜索：大小写不敏感，异常输入不抛错',()=>{
 const songs=[{title:'Baby Song'},{title:'baby  song'},{title:''},{},null,{title:123}];
 assert.equal(filterSongs(songs,'baby').length,2);
 assert.equal(filterSongs(songs,'BABY SONG').length,2);
 assert.deepEqual(filterSongs(undefined,'沙龙'),[]);
 assert.equal(filterSongs(songs,null).length,6);
});
