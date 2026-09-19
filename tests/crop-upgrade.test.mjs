import test from 'node:test';import assert from 'node:assert/strict';
import {applyCropUpgrade,needsCropUpgrade,CROP_ALGORITHM} from '../src/cropUpgrade.js';
const crop=(y,source='auto')=>({version:2,space:'image-normalized',x:0,y,width:1,height:.1,source,algorithm:'image-only-row-v1'});
const image=()=>({status:'done',src:'original',result:{raw:{untouched:true},rows:[{id:'a',crop:crop(.2),notes:[{id:'n',annotation:{duration:1}}]},{id:'b',crop:crop(.5,'manual'),notes:[]} ]}});
const slices=()=>[{digitBand:[.23,.25],crop:{...crop(.21),algorithm:CROP_ALGORITHM}},{digitBand:[.53,.55],crop:{...crop(.51),algorithm:CROP_ALGORITHM}}];
test('old automatic bounds update while manual bounds, note data and raw recognition stay identical',()=>{const im=image(),before=structuredClone(im);const next=applyCropUpgrade(im,slices());assert.notEqual(next,im);assert.deepEqual(im,before);assert.deepEqual(next.result.rows[0].crop,slices()[0].crop);assert.equal(next.result.rows[1],im.result.rows[1]);assert.equal(next.result.rows[0].notes,im.result.rows[0].notes);assert.equal(next.result.raw,im.result.raw);assert.equal(needsCropUpgrade(next),false)});
test('row-count or spatial mismatch never silently reassigns an existing row',()=>{const im=image();assert.equal(applyCropUpgrade(im,slices().slice(1)),im);assert.equal(applyCropUpgrade(im,slices().reverse()),im);const wrong=slices();wrong[0].digitBand=[.36,.38];assert.equal(applyCropUpgrade(im,wrong),im)});
test('legacy and unknown coordinates do not opt into the new algorithm',()=>{const im=image();im.result.rows[0].crop.algorithm='legacy-estimate';assert.equal(needsCropUpgrade(im),false);assert.equal(applyCropUpgrade(im,slices()),im)});

test('completed songs and reviewed unchanged automatic boxes are protected',()=>{
 const im=image();assert.equal(needsCropUpgrade(im,{completed:true}),false);
 im.result.rows[0].crop.reviewed=true;assert.equal(needsCropUpgrade(im),false);assert.equal(applyCropUpgrade(im,slices()),im);
 im.result.rows[0].crop.reviewed=false;im.result.rows[0].reviewStatus='manually-saved';assert.equal(needsCropUpgrade(im),false);assert.equal(applyCropUpgrade(im,slices()),im);
});
test('v2 pending boxes can upgrade but large, invalid or clipped changes never migrate',()=>{
 const im=image();im.result.rows[0].crop.algorithm='image-only-row-v2-content-gaps';assert.equal(needsCropUpgrade(im),true);
 assert.notEqual(applyCropUpgrade(im,slices()),im);
 const large=slices();large[0].crop.y=.23;assert.equal(applyCropUpgrade(im,large),im);
 const invalid=slices();invalid[0].crop.height=-.1;assert.equal(applyCropUpgrade(im,invalid),im);
 const clipped=slices();clipped[0].digitBands=[[.23,.25],[.30,.34]];assert.equal(applyCropUpgrade(im,clipped),im);
});

test('v3 incorrect row structures cannot silently replace existing recognition',()=>{
 const im=image();im.result.rows[0].crop.algorithm='image-only-row-v3-consensus';assert.equal(needsCropUpgrade(im),true);
 assert.notEqual(applyCropUpgrade(im,slices()),im,'small one-to-one pending update remains supported');
 assert.equal(applyCropUpgrade(im,[...slices(),{...slices()[1],digitBand:[.8,.82]}]),im,'additional melody rows require explicit recognition');
 assert.equal(needsCropUpgrade(im,{completed:true}),false);
});
