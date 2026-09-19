import {canonicalArcs,stableTextMatches,retainValidArcs} from '../lib/arcEditing.js';
import {synchronizeMusicEdit} from '../lib/musicEdits.js';
import {normalizeJianpuOcrText,parseJianpuSequenceWithSpans,noteLabel} from './lib/jianpu.js';
import {summarizeMeasures} from './lib/rhythmAnnotation.js';
export const durations=[6,12,24,48,96], names=['十六分','八分','四分','二分','全音符'], fractions=['1/16','1/8','1/4','1/2','1'];
export const bands=[[[.385,.48],[.665,.77],[.95,1.055],[1.23,1.335]],[[.27,.35],[.55,.64],[.835,.93],[1.12,1.22],[1.405,1.5]],[[.27,.35],[.55,.64],[.835,.93],[1.11,1.195],[1.36,1.465]],[[.27,.35],[.55,.64],[.835,.93],[1.12,1.21]]];
export const label=noteLabel;
const parse=t=>parseJianpuSequenceWithSpans(normalizeJianpuOcrText(t));
const empty=()=>({durationTicks:null,dotted:false,tieToNext:false,measureEnd:false});
export function createDocument(s){let offset=0;return {version:1,meter:s.rhythm.meter,pickup:s.rhythm.pickup,rows:s.notation.trim().split(/\n\s*\n/).flatMap((p,page)=>p.split('\n').map((text,line)=>{text=normalizeJianpuOcrText(text);const tokens=parse(text);return {page,line,text,crop:bands[page][line],notes:tokens.map((t,i)=>({...t.note,annotation:{...empty(),...(s.rhythm.annotations[offset++]||{}),measureEnd:s.rhythm.annotations[offset-1]?.measureEnd??text.slice(t.end,tokens[i+1]?.start??text.length).includes('|')}}))}}))}}
export function move(rows,c,d){if(d==='up')return c.row?{row:c.row-1,note:0}:c;if(d==='down')return c.row<rows.length-1?{row:c.row+1,note:0}:c;if(d==='left')return c.note?{...c,note:c.note-1}:c.row?{row:c.row-1,note:rows[c.row-1].notes.length-1}:c;return c.note<rows[c.row].notes.length-1?{...c,note:c.note+1}:c.row<rows.length-1?{row:c.row+1,note:0}:c}
export function edit(doc,c,action){const next=structuredClone(doc),row=next.rows[c.row],n=row.notes[c.note],a=n.annotation;
if(typeof action==='number')a.durationTicks=action;
else if(action==='raise'||action==='lower'){if(n.degree===0)return doc;n.octave=Math.max(-2,Math.min(2,n.octave+(action==='raise'?1:-1)));const t=parse(row.text)[c.note];row.text=row.text.slice(0,t.start)+label(n)+row.text.slice(t.end)}
else {if(action==='dotted'){a.dotted=!(a.dots!==undefined?a.dots>0:a.dotted);a.dots=a.dotted?1:0;}else if(action==='measureEnd'&&next.music?.measures?.length)a.measureEnd=!next.music.measures.some(m=>m.endNoteId===n.id);else if(action==='tieToNext'&&next.music?.arcs?.length){const all=next.rows.flatMap(r=>r.notes),target=all[all.indexOf(n)+1];a.tieToNext=!(a.tieToNext||next.music.arcs.some(arc=>arc.fromNoteId===n.id&&arc.toNoteId===target?.id&&(arc.effectiveType==='tie'||arc.type==='tie')))}else a[action]=!a[action];if(action==='measureEnd'){const ts=parse(row.text),t=ts[c.note],end=ts[c.note+1]?.start??row.text.length;row.text=row.text.slice(0,t.end)+row.text.slice(t.end,end).replace(/\|/g,'')+(a.measureEnd?' | ':' ')+row.text.slice(end)}}
return synchronizeMusicEdit(doc,next,action,n.id)}
export function replaceText(doc,index,input){const text=normalizeJianpuOcrText(input).replace(/\s+/g,' ').trim(),tokens=parse(text);let rest=text;for(const t of [...tokens].reverse())rest=rest.slice(0,t.start)+rest.slice(t.end);if(!tokens.length||/[^\s|·-]/.test(rest)||tokens.some(t=>Math.abs(t.note.octave)>2))throw Error('请使用 0–7、升降号、最多两个高低音符号和小节线。');
const next=canonicalArcs(doc),row=next.rows[index],old=row.notes,matches=stableTextMatches(old,tokens.map(t=>t.note));const structural=matches.size!==old.length||matches.size!==tokens.length;
row.notes=tokens.map((t,i)=>{const previous=matches.has(i)?old[matches.get(i)]:null;return {...t.note,id:previous?.id||crypto.randomUUID(),annotation:{...(previous?.annotation||empty()),tieToNext:false,measureEnd:text.slice(t.end,tokens[i+1]?.start??text.length).includes('|')}}});row.text=text;
const synced=retainValidArcs(next);return {document:synced,structural,pending: synced.music.pendingArcs.length-(doc.music?.pendingArcs?.length||0)}}

export function measures(doc){const annotations=doc.rows.flatMap(r=>r.notes.map(n=>n.annotation));return summarizeMeasures({...doc,annotations},annotations.length)}
// 删除一行：连带清掉引用该行音符的弧线/小节（经 canonicalArcs 归一化），并给出新的光标位置。
// 行的裁切区域随行一起消失——左栏原图高亮与行目标都由 doc.rows 派生，无需另做清理。
export function deleteRow(doc,index){
 const next=structuredClone(doc);
 if(!next.rows[index])return {document:doc,cursor:null};
 next.rows.splice(index,1);
 const document_=canonicalArcs(next);
 if(!document_.rows.length)return {document:document_,cursor:null};
 const row=Math.max(0,Math.min(index,document_.rows.length-1));
 return {document:document_,cursor:{row,note:0}};
}
