import {normalizeMusicDocument} from './musicStructure.js';

// Update the authoritative structure at the edit boundary, not during loading.
// Loading must keep broken references for diagnostics/recovery.
export function synchronizeMusicEdit(before, next, action, noteId) {
 if (action === 'dotted') {
  const note = next.rows.flatMap(r=>r.notes).find(n=>n.id===noteId);
  if(note) note.annotation.dots=note.annotation.dotted?1:0;
 }
 if (!next.music) return next;
 if(action==='tieToNext') {
  const notes=next.rows.flatMap(r=>r.notes),index=notes.findIndex(n=>n.id===noteId),target=notes[index+1];
  if(target) next.music.arcs=(next.music.arcs||[]).filter(a=>!(a.fromNoteId===noteId&&a.toNoteId===target.id));
 }
 if(action==='measureEnd') {
  const notes=next.rows.flatMap(r=>r.notes),note=notes.find(n=>n.id===noteId),list=next.music.measures||[];
  const index=list.findIndex(m=>m.noteIds?.includes(noteId));
  if(index>=0&&note) {
   const measure=list[index],position=measure.noteIds.indexOf(noteId);
   const changed=(source,ids,id=source.id)=>({...source,id,noteIds:ids,startNoteId:ids[0],endNoteId:ids.at(-1),expectedIsExplicit:false,expectedTicks:undefined});
   if(note.annotation.measureEnd&&position<measure.noteIds.length-1) {
    const left=measure.noteIds.slice(0,position+1),right=measure.noteIds.slice(position+1);
    list.splice(index,1,changed(measure,left),{...changed(measure,right,'measure:'+crypto.randomUUID()),pickup:false});
   } else if(!note.annotation.measureEnd&&position===measure.noteIds.length-1&&list[index+1]) {
    list.splice(index,2,changed(measure,[...measure.noteIds,...list[index+1].noteIds]));
   }
  }
 }
 return normalizeMusicDocument(next);
}
