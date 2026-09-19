import {normalizeMusicDocument} from './musicStructure.js';
export function canonicalArcs(document,options={}){
 const source=structuredClone(document);
 if(options.key!==undefined)source.key=options.key;
 if(options.octave!==undefined)source.octave=options.octave;
 const doc=normalizeMusicDocument(source,options);
 for(const row of doc.rows)for(const note of row.notes)note.annotation.tieToNext=false;
 return doc;
}
export function putArc(document,arc){
 const next=canonicalArcs(document),notes=next.rows.flatMap(r=>r.notes),a=notes.findIndex(n=>n.id===arc.fromNoteId),b=notes.findIndex(n=>n.id===arc.toNoteId);
 if(a<0||b===a||b<0||(!arc.number&&(!notes[a].degree||!notes[b].degree)))throw Error('请选择两个不同音符');
 if(a>b)arc={...arc,fromNoteId:arc.toNoteId,toNoteId:arc.fromNoteId};
 next.structureDiagnostics=(next.structureDiagnostics||[]).filter(d=>!(d.code==='SEAM_RELATION_CHANGED'&&d.fromNoteId===arc.fromNoteId&&d.toNoteId===arc.toNoteId));
 next.music.arcs=next.music.arcs.filter(v=>v.id!==arc.id&&!(v.fromNoteId===arc.fromNoteId&&v.toNoteId===arc.toNoteId));
 next.music.arcs.push({id:arc.id||'arc:'+crypto.randomUUID(),type:'auto',fromNoteId:arc.fromNoteId,toNoteId:arc.toNoteId,number:arc.number??null,normal:arc.normal??null});
 next.music.pendingArcs=(next.music.pendingArcs||[]).filter(v=>v.id!==arc.id);
 return normalizeMusicDocument(next);
}
export function removeArc(document,id){const next=canonicalArcs(document);next.music.arcs=next.music.arcs.filter(a=>a.id!==id);next.music.pendingArcs=(next.music.pendingArcs||[]).filter(a=>a.id!==id);return normalizeMusicDocument(next);}
export function locateNote(doc,id){for(let row=0;row<doc.rows.length;row++){const note=doc.rows[row].notes.findIndex(n=>n.id===id);if(note>=0)return {row,note};}return null;}
// Exact unchanged edges and uniquely identifiable interior notes retain identity.
// Repeated/edited ambiguous content is deliberately not matched by ordinal position.
export function stableTextMatches(oldNotes,newNotes){
 const signature=n=>JSON.stringify([n.degree,n.octave,n.accidental||null]);
 const a=oldNotes.map(signature),b=newNotes.map(signature),matches=new Map();let left=0,rightA=a.length-1,rightB=b.length-1;
 while(left<a.length&&left<b.length&&a[left]===b[left]){matches.set(left,left);left++;}
 while(rightA>=left&&rightB>=left&&a[rightA]===b[rightB]){matches.set(rightB,rightA);rightA--;rightB--;}
 let last=left-1;
 for(let j=left;j<=rightB;j++){const hits=[];for(let i=left;i<=rightA;i++)if(a[i]===b[j])hits.push(i);if(hits.length===1&&b.slice(left,rightB+1).filter(v=>v===b[j]).length===1&&hits[0]>last){matches.set(j,hits[0]);last=hits[0];}}
 return matches;
}
export function retainValidArcs(document){
 const ids=new Set(document.rows.flatMap(r=>r.notes.map(n=>n.id))),pending=[...(document.music.pendingArcs||[])];
 document.music.arcs=document.music.arcs.filter(a=>{if(ids.has(a.fromNoteId)&&ids.has(a.toNoteId))return true;pending.push({...a,reason:'端点音符已变化，请重设连接'});return false;});
 document.music.pendingArcs=pending;document.music.measures=[];
 return normalizeMusicDocument(document);
}
export function rowArcSegments(doc,rowIndex,arcs=doc.music?.arcs||[]){
 const positions=new Map();let global=0;doc.rows.forEach((r,row)=>r.notes.forEach((n,note)=>positions.set(n.id,{row,note,index:global++})));
 const segments=[];
 for(const arc of arcs){const a=positions.get(arc.fromNoteId),b=positions.get(arc.toNoteId);if(!a||!b||b.index<=a.index||rowIndex<a.row||rowIndex>b.row||arc.reason==='SEAM_RELATION_CHANGED')continue;
  segments.push({...arc,start:a.row===rowIndex?a.note:null,end:b.row===rowIndex?b.note:null,typeSegment:a.row===b.row?'full':a.row===rowIndex?'outgoing':b.row===rowIndex?'incoming':'through',span:b.index-a.index});
 }
 const levels=[];segments.sort((a,b)=>a.span-b.span||a.id.localeCompare(b.id));
 for(const arc of segments){const left=arc.start??-1,right=arc.end??doc.rows[rowIndex].notes.length;let level=0;while(levels[level]?.some(v=>left<=v[1]&&right>=v[0]))level++;(levels[level]??=[]).push([left,right]);arc.level=level;}
 return segments;
}

export function setMeterChange(document,noteId,meter,onlyMeasure=false){
 const next=canonicalArcs(document),measure=next.music.measures.find(m=>m.noteIds.includes(noteId));
 if(!measure)throw Error('没有找到当前小节');
 if(meter&&(!Number.isInteger(meter.beats)||meter.beats<1||meter.beats>32||![2,4,8,16].includes(meter.beatUnit)))throw Error('请输入有效拍号');
 next.music.meterChanges=(next.music.meterChanges||[]).filter(c=>c.noteId!==measure.startNoteId);
 if(meter)next.music.meterChanges.push({noteId:measure.startNoteId,meter,onlyMeasure});
 return normalizeMusicDocument(next);
}
