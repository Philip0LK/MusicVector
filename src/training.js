import {boot} from './localApi.js';
import {buildRhythmPlaybackPlan} from './lib/rhythmPlayback.js';
// This snapshot has no imported tempo override; use the import flow default.
export const BASE_TEMPO=80;
export const SPEED_PRESETS=[0.5,0.75,0.9,1,1.1];
export function normalizeRate(value){const n=Number(value);return Number.isFinite(n)?Math.round(Math.min(1.25,Math.max(.25,n))*20)/20:1;}
export function flatten(document){return document.rows.flatMap((r,row)=>r.notes.map((n,note)=>({...n,row,note,id:n.id||`p${r.page+1}r${r.line+1}n${note+1}`})));}
export function rhythmOf(document,{baseTempo=undefined,key=undefined,octave=undefined}={}){const annotations=document.rows.flatMap(r=>r.notes.map(n=>n.annotation));return {meter:document.meter,pickup:document.pickup,ticksPerQuarter:24,annotations,music:document.music,baseTempo,key:key??document.key,octave:octave??document.octave};}
export function clampIndex(i,count){return Math.max(0,Math.min(count-1,Number.isFinite(Number(i))?Math.trunc(Number(i)):0));}
export function normalizedRange(a,b,count){return {startIndex:Math.min(clampIndex(a,count),clampIndex(b,count)),endIndex:Math.max(clampIndex(a,count),clampIndex(b,count))};}
export function nextIndex(index,direction,count,range){const lo=range?.startIndex??0,hi=range?.endIndex??count-1;if(range)return index+direction>hi?lo:index+direction<lo?hi:index+direction;return clampIndex(index+direction,count);}
export function playbackPlan(notes,rhythm,current,range,tempo){if(rhythm.music?.pendingArcs?.some(a=>a.number))throw Error('连音组范围待确认，请修正连接');return buildRhythmPlaybackPlan(notes,rhythm,{startIndex:range?Math.min(range.endIndex,Math.max(range.startIndex,current)):current,endIndex:range?.endIndex,tempo,baseTempo:rhythm?.baseTempo});}
export function readPreferences(count,fallback=0,baseTempo=BASE_TEMPO){try{const v=boot.practice;const r=v.range;return {cursor:clampIndex(v.cursor??fallback,count),tempo:baseTempo*normalizeRate(v.rate??((Number(v.tempo)||baseTempo)/baseTempo)),navClosed:!!v.navClosed,sourceClosed:!!v.sourceClosed,range:r&&Number.isInteger(r.startIndex)&&Number.isInteger(r.endIndex)&&r.startIndex>=0&&r.endIndex<count&&r.startIndex<=r.endIndex?r:null};}catch{return {cursor:fallback,tempo:baseTempo,navClosed:false,sourceClosed:false,range:null};}}
