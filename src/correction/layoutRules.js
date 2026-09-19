import {effectiveDurationFraction,legacyNoteId,normalizeMeter} from '../lib/musicStructure.js';

// Durations use integer ticks (24 per quarter) as the display baseline.
// Beat grouping is resolved per measure so measure-level meter changes do not
// leak their grouping into following measures. Exact tuplet fractions are
// converted to numbers only at the glyph-placement boundary.
export function beatPositions(doc, allMeasures) {
  const notes=[],noteIds=[];
  doc.rows.forEach((row)=>row.notes.forEach((note,noteIndex)=>{notes.push(note);noteIds.push(note.id||legacyNoteId(row,noteIndex));}));
  const starts=Array(notes.length).fill(null);
  const tuplets=Array.isArray(doc.music?.tuplets)?doc.music.tuplets:[];
  const byId=new Map(tuplets.map((group)=>[group.id,group]));
  const byMemberId=new Map();
  tuplets.forEach((group)=>(group.memberIds||[]).forEach((noteId)=>{if(!byMemberId.has(noteId))byMemberId.set(noteId,group);}));
  const durationOf=(note,index)=>{
    let annotation=note.annotation||{};
    const memberGroup=byMemberId.get(noteIds[index]);
    if(memberGroup&&!annotation.tupletId)annotation={...annotation,tupletId:memberGroup.id};
    const value=effectiveDurationFraction(annotation,byId);
    return value===null?null:Number(value.n)/Number(value.d);
  };
  for(const measure of allMeasures){
    const startIndex=measure.startIndex,endIndex=measure.endIndex;
    if(!Number.isInteger(startIndex)||!Number.isInteger(endIndex))continue;
    const meter=normalizeMeter(measure.meter||doc.meter);
    const unit=96/meter.beatUnit;
    const grouping=meter.beatGroups?.length?meter.beatGroups:
      meter.beats>3&&meter.beats%3===0&&meter.beatUnit>=8?Array(meter.beats/3).fill(3):Array(meter.beats).fill(1);
    const boundaries=[0];grouping.forEach(group=>boundaries.push(boundaries.at(-1)+group*unit));
    const cycle=boundaries.at(-1);
    const groupAt=(ticks)=>{const loops=Math.floor(ticks/cycle),rest=ticks-loops*cycle;return loops*grouping.length+boundaries.slice(1).findIndex(value=>rest<value);};
    let ticks=0;
    const pickup=Boolean(measure.pickup??(measure.index===0&&doc.pickup));
    if(pickup)ticks=measure.status==='incomplete'?null:Math.max(0,measure.expectedTicks-(Number.isFinite(measure.actualTicks)?measure.actualTicks:Number(measure.totalTicks)||0));
    for(let index=Math.max(0,startIndex);index<=Math.min(notes.length-1,endIndex);index++){
      starts[index]=ticks===null?null:groupAt(ticks);
      const duration=durationOf(notes[index],index);
      ticks=ticks===null||duration===null?null:ticks+duration;
    }
  }
  return starts;
}

export {cropRect} from '../cropGeometry.js';
export function scoreSize(width,height){
 // Container-driven, not note-count-driven. Stop shrinking at 22px.
 return Math.max(22,Math.min(28,Math.min(22+(width-600)/150,22+(height-650)/65)));
}
