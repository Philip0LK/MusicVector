import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {cropRect,validateCrop,cropFromRegions,manualCrop,upgradeLegacyCrops,reconcileCropDraft} from '../src/cropGeometry.js';
import {FIXTURE_SKIP, optionalLocalFixture} from './helpers/local-fixtures.mjs';
const referencePath=optionalLocalFixture('legacy-public/legacy/library.json');
const reference=referencePath?JSON.parse(fs.readFileSync(referencePath)):[];
test('V2 transforms analysis pixel coordinates through scale and offset to the original image',()=>{const c=cropFromRegions([{x:10,y:20,width:100,height:40}],{width:500,height:500,originalWidth:2000,originalHeight:3000,toOriginal:[2,0,0,3,100,200]});assert.equal(c.x,.06);assert.equal(c.y,260/3000);assert.equal(c.width,.1);assert.equal(c.height,.04);assert.deepEqual(cropRect(c,400,600).x,cropRect(c,2000,3000).x);assert.throws(()=>cropFromRegions([{x:0,y:0,width:10,height:10}],{width:100,height:100,originalWidth:100,originalHeight:100,toOriginal:[]}));});
test('Rotation and clipping are explicit, invalid rectangles rejected',()=>{const c=cropFromRegions([{x:10,y:20,width:30,height:40}],{width:100,height:100,originalWidth:100,originalHeight:100,toOriginal:[0,1,-1,0,100,0]});assert.equal(c.x,.4);assert.equal(c.y,.1);assert.equal(c.width,.4);assert.equal(c.height,.3);assert(!validateCrop({...c,x:NaN}));assert(!validateCrop({...c,width:2}));});
test('Legacy salon bands retain exactly the original geometry',()=>{const c=cropRect([.385,.48],1000,1500);assert.equal(c.x,.065);assert.equal(c.width,.925);assert.equal(c.y,.385/1.5);assert.equal(c.height,(.48-.385)/1.5);const manual=manualCrop([.385,.48],1000,1500);assert(validateCrop(manual));assert.equal(manual.y,c.y);});
test('Only known automatic crops upgrade; manual crops, notes, order and backups protected',{skip:FIXTURE_SKIP},()=>{const old=structuredClone(reference[0]);for(const image of old.images)for(const row of image.result.rows){row.crop=row.previousAutoCrops[1];row.cropNeedsReview=true;}old.images[0].result.rows[1].crop=[.11,.22];old.images[0].result.rows[2].cropNeedsReview=false;old.deletedImages=[{image:structuredClone(old.images[1]),expiresAt:Date.now()+9999}];const before=structuredClone(old);const result=upgradeLegacyCrops([old],reference)[0];assert.equal(result.images[0].result.rows[0].crop.version,2);assert.deepEqual(result.images[0].result.rows[1].crop,[.11,.22]);assert.deepEqual(result.images[0].result.rows[2].crop,before.images[0].result.rows[2].crop);assert.equal(result.deletedImages[0].image.result.rows[0].crop.version,2);assert.deepEqual(result.images.flatMap(i=>i.result.rows.flatMap(r=>r.notes)),before.images.flatMap(i=>i.result.rows.flatMap(r=>r.notes)));assert.deepEqual(old,before);assert.deepEqual(upgradeLegacyCrops([result],reference),[result]);});
test('All 38 imported score rows have valid image-normalized crops and stable row IDs',{skip:FIXTURE_SKIP},()=>{let count=0;for(const song of reference)for(const image of song.images){assert(image.geometry.sha256);let y=-1;for(const row of image.result.rows){assert(validateCrop(row.crop));assert(row.id);assert(row.crop.y>=y);y=row.crop.y;assert.equal(row.crop.x,0);assert.equal(row.crop.width,1);count++;}}assert.equal(count,38);});

test('Crop-only upgrade preserves unsaved notation and manual crop edits',()=>{
 const base={rows:[{id:'a',crop:[.1,.2],cropNeedsReview:true,notes:[1]}]};const incoming=structuredClone(base);incoming.rows[0].crop={version:2,x:0,y:.1,width:1,height:.1,space:'image-normalized'};
 const saved={base:JSON.stringify(base),document:structuredClone(base),cursor:{row:0,note:0}};saved.document.rows[0].notes=[2];
 const result=reconcileCropDraft(saved,incoming);assert.deepEqual(result.document.rows[0].notes,[2]);assert.deepEqual(result.document.rows[0].crop,incoming.rows[0].crop);
 saved.document.rows[0].crop=[.12,.23];assert.deepEqual(reconcileCropDraft(saved,incoming).document.rows[0].crop,[.12,.23]);
 const changed=structuredClone(incoming);changed.rows[0].notes=[3];assert.equal(reconcileCropDraft(saved,changed),null);
 assert.throws(()=>cropFromRegions([{x:0,y:0,width:2,height:2}],{width:10,height:10,originalWidth:10,originalHeight:10,toOriginal:[1,1,1,1,0,0]}));
});
import {editingCropRect,adjustCropEdge,projectedPoint} from '../src/cropGeometry.js';
test('Rectified crops edit in corrected space and preserve inverse mapping',()=>{
 const rect={version:2,space:'image-normalized',x:.1,y:.2,width:.5,height:.1};
 const crop={...rect,version:3,quad:[[.1,.2],[.6,.2],[.6,.3],[.1,.3]],rectified:{width:1000,height:2000,originalWidth:1000,originalHeight:2000,fromOriginal:[[1,0,0],[0,1,0],[0,0,1]],toOriginal:[[1,0,0],[0,1,0],[0,0,1]],rect}};
 assert(validateCrop(crop));const next=adjustCropEdge(crop,0,.18);assert(validateCrop(next));assert.equal(next.source,'manual');assert.equal(next.reviewed,true);assert.equal(editingCropRect(next).y,.18);assert.equal(next.quad[0][1],.18);assert.equal(crop.y,.2);
 assert.deepEqual(projectedPoint([[1,0,10],[0,1,20],[0,0,1]],5,8),[15,28]);assert(!validateCrop({...crop,rectified:{...crop.rectified,toOriginal:[[0,0,0],[0,0,0],[0,0,0]]}}));
});
