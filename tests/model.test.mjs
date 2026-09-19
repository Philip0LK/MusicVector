import {boot} from '../src/localApi.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {flatten,rhythmOf,normalizedRange,nextIndex,playbackPlan,normalizeRate,readPreferences,BASE_TEMPO} from '../src/training.js';
import {buildRhythmPlaybackPlan} from '../src/lib/rhythmPlayback.js';
import {FIXTURE_SKIP, optionalLocalFixture} from './helpers/local-fixtures.mjs';
const draftPath=optionalLocalFixture('legacy-public/song/corrected-draft.json');
const bytes=draftPath?fs.readFileSync(draftPath):null;
const doc=bytes?JSON.parse(bytes).document:null,notes=doc?flatten(doc):[],rhythm=doc?rhythmOf(doc):null;
test('人工草稿完整且来源文件一致',{skip:FIXTURE_SKIP},()=>{
 assert.equal(doc.rows.length,18);assert.equal(notes.length,473);assert.equal(notes.filter(n=>!(n.annotation.durationTicks>0)).length,0);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'a2775a2957a200bd28a9091bfc34a168204750db8662284af18a4d94218b80ad');
 assert.equal(new Set(notes.map(n=>n.id)).size,473);
});
test('反向跨行选段规范化，端点包含在范围内',()=>{assert.deepEqual(normalizedRange(37,8,473),{startIndex:8,endIndex:37});assert.deepEqual(normalizedRange(-5,999,473),{startIndex:0,endIndex:472})});
test('逐音在全曲边界停留，在片段边界循环',()=>{assert.equal(nextIndex(472,1,473,null),472);assert.equal(nextIndex(0,-1,473,null),0);assert.equal(nextIndex(8,1,473,{startIndex:5,endIndex:8}),5);assert.equal(nextIndex(5,-1,473,{startIndex:5,endIndex:8}),8)});
test('选段暂停续播从当前音开始，从头播放单独回范围起点',{skip:FIXTURE_SKIP},()=>{const range={startIndex:5,endIndex:20};const plan=playbackPlan(notes,rhythm,12,range,80);assert.equal(plan.startIndex,12);assert.equal(plan.endIndex,20);assert.equal(playbackPlan(notes,rhythm,5,range,80).startIndex,5)});
test('全曲和选段播放都不修改歌曲，速度加倍时总时长减半',{skip:FIXTURE_SKIP},()=>{const before=JSON.stringify(doc),a=playbackPlan(notes,rhythm,0,null,80),b=playbackPlan(notes,rhythm,0,null,160);assert.equal(a.steps.length,473);assert.equal(a.missingIndexes.length,0);assert.equal(a.totalSeconds,2*b.totalSeconds);assert.equal(JSON.stringify(doc),before)});
test('同音延音只触发一次，选区截断不越界发声，休止符不触发',()=>{
 const ns=[{degree:1,octave:0},{degree:1,octave:0},{degree:0,octave:0}];
 const r={ticksPerQuarter:24,annotations:[{durationTicks:24,tieToNext:true},{durationTicks:24},{durationTicks:24}]};
 const full=buildRhythmPlaybackPlan(ns,r);assert.equal(full.steps[0].soundDurationTicks,48);assert.equal(full.steps[1].trigger,false);assert.equal(full.steps[2].trigger,false);
 assert.equal(buildRhythmPlaybackPlan(ns,r,{endIndex:0}).steps[0].soundDurationTicks,24);
 assert.equal(buildRhythmPlaybackPlan(ns,r,{startIndex:1}).steps[0].trigger,true);
});

test('倍速真实作用于时长，不受旧的 30–240 BPM 上下限与整数取整影响',{skip:FIXTURE_SKIP},()=>{
 const baseline=playbackPlan(notes,rhythm,18,{startIndex:18,endIndex:20},80);
 for(const rate of [.25,.5,.75,.9,1,1.1,1.25]){const p=playbackPlan(notes,rhythm,18,{startIndex:18,endIndex:20},80*rate);assert(Math.abs(p.totalSeconds*rate-baseline.totalSeconds)<1e-9);assert.equal(p.tempo,80*rate)}
 assert.equal(playbackPlan(notes,rhythm,18,null,22.5).tempo,22.5);
 assert.equal(playbackPlan(notes,rhythm,18,null,300).tempo,300);
});
test('微调范围、旧拍速迁移与每首歌原速相互独立',()=>{
 assert.equal(normalizeRate(.71),.7);assert.equal(normalizeRate(0),.25);assert.equal(normalizeRate(2),1.25);
 const previous=boot.practice;
 try{boot.practice={tempo:60};assert.equal(readPreferences(473).tempo,60);
 boot.practice={rate:.75};assert.equal(readPreferences(473,0,120).tempo,90);assert.equal(BASE_TEMPO,80);
 }finally{boot.practice=previous}
});
