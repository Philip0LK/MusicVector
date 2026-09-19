import {fuseRow} from './lib/rhythmFusion.js';
const ACCIDENTALS={sharp:'#',flat:'b',natural:'natural',none:null};
const baseTicks=[6,12,24,48,96];
const factor=d=>2-2**(-d);
function duration(total){for(const base of baseTicks)for(let dots=0;dots<=4;dots++)if(Math.abs(base*factor(dots)-total)<1e-8)return {durationTicks:base,dots,dotted:dots>0};return {durationTicks:null,dots:0,dotted:false};}
// 界面只支持一个附点：可显示的时值集合 = 基值 ×{1, 1.5}，升序。
const displayableTicks=baseTicks.flatMap(base=>[base,base*1.5]).sort((a,b)=>a-b);
// 取「不超过 total 的最大可显示时值」并复用它做分解；没有可显示值则返回 null（沿用"无法标注"的既有处理）。
function displayableDuration(total){let best=null;for(const ticks of displayableTicks)if(ticks<=total+1e-8)best=ticks;return best===null?null:duration(best);}
// 时值换算：几何与 AI 走同一条公式（24/2^减时线根数 × 附点因子），保证「改的只是取值来源」。
const ticksOf=(underlines,dots)=>underlines===null||underlines===undefined?null:24/2**underlines*factor(dots??0);
const label=n=>(n.degree===null?'?':(n.octave<0?'.'.repeat(-n.octave):'')+(n.accidental==='natural'?'♮':n.accidental||'')+n.degree+(n.octave>0?"'".repeat(n.octave):''));
const buildNote=({id,degree,octave,accidental,ticks,eventId,evidence,geometryOnly,measureEnd})=>({id,degree,octave,accidental,annotation:{...(ticks===null?{durationTicks:null,dots:0,dotted:false}:duration(ticks)),measureEnd:Boolean(measureEnd),tieToNext:false},recognitionEventId:eventId??null,...(evidence?{durationEvidence:evidence}:{}),...(geometryOnly?{geometryOnly:true}:{})});

export function convertRows(rawRows,slices,{imageId,songId,page,runId,geometry,mode='rows'}){
 const result=[];const mapping=new Map(),droppedKeys=new Set();
 for(let line=0;line<rawRows.length;line++){
  const raw=rawRows[line],slice=slices.find(v=>v.id===raw.rowId);if(!slice)throw Error('切片 ID 不存在');
  // 读不出的音（unknown 事件）直接删除：先删再融合，几何层"块数=音符数"的对齐才成立。
  // 删除必须发生在事件序号解析之后（解析用原始序列，端点序号不错位），这里的 raw.events 已是解析结果。
  const droppedEvents=raw.events.filter(event=>mode!=='page'&&event.kind==='unknown').map(event=>event.id);
  const events=droppedEvents.length?raw.events.filter(event=>event.kind!=='unknown'):raw.events;
  // 几何层未接入（或该行几何不可用）时走原路径 → 行为与改造前完全一致。
  const rowGeometry=geometry?.byRow instanceof Map?geometry.byRow.get(raw.rowId):geometry?.byRow?.[raw.rowId]??null;
  const fusion=rowGeometry?fuseRow(rowGeometry,events):null;
  let notes=[],byEvent=new Map(),issues=[...raw.issues],blocked=false;
  if(droppedEvents.length){issues.push({code:'unknown-note-dropped',targetId:null,field:'symbols',detail:'读不出的音符已删除（事件 '+droppedEvents.join(', ')+'）'});for(const eventId of droppedEvents)droppedKeys.add(raw.rowId+':'+eventId);}
  if(fusion)fusion.issues.forEach(issue=>issues.push(issue));
  // One event interpreter for both AI-only and fused rhythm. Structural events
  // never pass through a filtered note index, and extensions cannot cross a bar.
  const fusedById=new Map(fusion&&!fusion.degraded?fusion.notes.map(n=>[n.eventId,n]):[]);
  let prior=null;
  for(const event of events){
   if(event.kind==='unknown'&&mode==='page'){
    const note=buildNote({id:runId+':'+raw.rowId+':'+event.id,degree:null,octave:null,accidental:null,ticks:null,eventId:event.id});
    notes.push(note);byEvent.set(event.id,note);blocked=true;prior=null;issues.push({code:'unresolved-note',targetId:event.id});
   }else if(event.kind==='note'||event.kind==='rest'){
    const fused=fusedById.get(event.id);
    const underlines=fused?fused.underlines:event.underlines;
    const rawDots=fused?fused.dots:event.dots;
    // 界面只支持一个附点：模型读到两个及以上时按一个处理并留档（不丢音符、不改写原始归档）；读不出（null）仍走"未标注"。
    if(rawDots!=null&&rawDots>1)issues.push({code:'dots-downgraded',targetId:event.id,field:'dots',detail:'模型读到 '+rawDots+' 个附点，界面只支持一个，已按一个处理'});
    const dots=rawDots==null?null:Math.min(rawDots,1);
    const unknown=underlines==null||dots==null||(event.kind==='note'&&(event.degree==null||event.octave==null||event.accidental==null));
    const ticks=unknown?null:ticksOf(underlines,dots);
    const note=buildNote({id:runId+':'+raw.rowId+':'+event.id,degree:event.kind==='rest'?0:event.degree,octave:event.kind==='rest'?0:event.octave,accidental:event.kind==='rest'?null:ACCIDENTALS[event.accidental],ticks,eventId:event.id,evidence:fused?.evidence,measureEnd:event.measureEnd});
    if(unknown){blocked=true;issues.push({code:'unresolved-note',targetId:event.id});}
    notes.push(note);byEvent.set(event.id,note);prior={note,total:ticks};
   }else if(event.kind==='extension'){
    if(!prior||prior.note.annotation.measureEnd){blocked=true;issues.push({code:'orphan-extension',targetId:event.id});prior=null;}
    else{byEvent.set(event.id,prior.note);if(prior.total!==null){
     prior.total+=24;
     const exact=duration(prior.total);
     if(exact.durationTicks!==null&&exact.dots<=1)Object.assign(prior.note.annotation,exact);
     else if(exact.durationTicks!==null){
      // 分解出来是双附点值（如 18+24=42，即双附点四分音符）：界面只支持一个附点，
      // 取不超过它的最大可显示值并留档，避免"画 1.5 倍、算 1.75 倍"的分叉。
      const displayable=displayableDuration(prior.total);
      if(displayable===null)Object.assign(prior.note.annotation,{durationTicks:null,dots:0,dotted:false});
      else{
       Object.assign(prior.note.annotation,displayable);
       issues.push({code:'duration-approximated',targetId:prior.note.recognitionEventId??null,field:'durationTicks',detail:'并入延时横线后时值为 '+prior.total+'，无法用单附点表示，已按 '+(displayable.durationTicks*(displayable.dots>0?1.5:1))+' 处理'});
      }
     }
     // 完全无法表示（如 24+96=120）：沿用既有的"未标注"处理，不在这里做近似。
     else Object.assign(prior.note.annotation,exact);
    }}
   }else if(event.kind==='barline'){
    if(prior){prior.note.annotation.measureEnd=true;if(prior.note.durationEvidence)prior.note.durationEvidence.measureEnd={adopted:true,source:'ai',ai:true,geo:null};}
    prior=null;
   }else{blocked=true;issues.push({code:'unresolved-event',targetId:event.id});prior=null;}
  }
  // 未知事件也要进映射：弧线端点可能指向它，这样 convertRows 才能识别出"这条弧线挂在被删掉的音上"
  // 并把它连同弧线一起丢弃，而不是当成"指不到音符"去记待确认。
  for(const event of droppedEvents)byEvent.set(event,undefined);
  for(const note of notes)mapping.set(raw.rowId+':'+(note.recognitionEventId??note.id.split(':').pop()),note.id);
  for(const note of notes)mapping.set(note.id,note.id);
  // Experimental tuplets never enter active music structure or playback duration.
  for(const group of raw.tuplets){for(const id of group.members||[...byEvent.keys()]){const note=byEvent.get(id);if(note)note.annotation.durationTicks=null;}issues.push({code:'experimental-tuplet',targetId:group.id});}
  for(const note of notes)if(note.annotation.durationTicks===null){blocked=true;if(!issues.some(i=>i.code==='unresolved-note'&&i.targetId===note.recognitionEventId))issues.push({code:'unresolved-note',targetId:note.recognitionEventId});}
  if(!notes.length){blocked=true;issues.push({code:'no-readable-notes',targetId:null});}
  result.push({id:runId+':'+raw.rowId,imageId,page,line,originalRow:page*10000+line,origin:songId,crop:slice.crop,...(mode==='page'?{sourceMapping:'page'}:{}),notes,text:notes.map(n=>label(n)+(n.annotation.measureEnd?' |':'')).join(' '),recognitionBlocked:blocked,recognitionIssues:issues,reviewStatus:'unreviewed',experimental:{tuplets:raw.tuplets,lyrics:raw.lyrics},recognitionArcs:[],recognitionPendingArcs:[],recognitionMeterChanges:[],...(fusion?{geometry:{version:rowGeometry.version,mappingConfidence:rowGeometry.mappingConfidence,scale:rowGeometry.scale??null,digitCount:rowGeometry.blocks?.length??0,alignment:fusion.alignment,degraded:fusion.degraded,reason:fusion.reason??null}}:{})});
 }
 // 弧线是无序的一对端点：入库时按文档顺序摆正，并记在起点所在行（与 SOP 一致）。
 const noteOrder=new Map(),rowOfNote=new Map();let sequence=0;
 for(const [index,row] of result.entries())for(const note of row.notes){noteOrder.set(note.id,sequence++);rowOfNote.set(note.id,index);}
 rawRows.forEach((raw,index)=>{for(const arc of raw.arcs){
  const first=arc.start&&mapping.get(arc.start.rowId+':'+arc.start.eventId),second=arc.end&&mapping.get(arc.end.rowId+':'+arc.end.eventId);
  // 该端点是否指向"因读不出而被删掉"的音：这类弧线无法重设（音符已不存在），只丢弃、不记待确认，
  // 否则一条这样的连音组弧线会让整首因"连音组范围待确认"而不能播放。
  const arcDropped=[arc.start,arc.end].some(end=>end&&droppedKeys.has(end.rowId+':'+end.eventId));
  // 端点指不到音符时：普通弧线直接丢弃；带连音数字的弧线记入"待确认连接"让用户重设。
  if(!first||!second){if(arc.number&&!arcDropped)result[index].recognitionPendingArcs.push({id:runId+':'+arc.id,fromNoteId:first??null,toNoteId:second??null,number:arc.number,reason:'连音组范围待确认'});result[index].recognitionIssues.push(arcDropped?{code:'unknown-arc-dropped',targetId:arc.id}:{code:'clipped-connection',targetId:arc.id});continue;}
  if(first===second){result[index].recognitionIssues.push({code:'degenerate-arc',targetId:arc.id});continue;}
  const [fromNoteId,toNoteId]=noteOrder.get(first)<=noteOrder.get(second)?[first,second]:[second,first];
  result[rowOfNote.get(fromNoteId)].recognitionArcs.push({id:runId+':'+raw.rowId+':'+arc.id,type:'auto',fromNoteId,toNoteId,number:arc.number??null});
 }});
 rawRows.forEach((raw,index)=>{
  let part=0,occupied=false;const starts=[];
  for(const event of raw.events){if(event.kind==='barline'){if(occupied){part++;occupied=false;}}else if(['note','rest'].includes(event.kind)){if(!occupied){starts[part]=mapping.get(raw.rowId+':'+event.id);occupied=true;}}}
  for(const [part,beats,beatUnit] of raw.meterMarks||[]){const noteId=starts[part];if(noteId)result[index].recognitionMeterChanges.push({noteId,meter:{beats,beatUnit},onlyMeasure:false});else result[index].recognitionIssues.push({code:'meter-location-uncertain',detail:'变拍位置待确认'});}
 });
 return result;
}
export function headerSuggestions(header){
 const out={};if(header?.title?.trim())out.title=header.title.trim();
 if(header?.key?.tonic&&header.key.accidental!==null)out.key=header.key.tonic+({sharp:'#',flat:'b'}[header.key.accidental]||'');
 if(header?.meters?.length===1)out.meter={beats:header.meters[0].numerator,beatUnit:header.meters[0].denominator};
 const t=header?.tempo;if(t?.bpm&&t.beatDenominator&&t.beatDots!==null){const bpm=t.bpm*4/t.beatDenominator*factor(t.beatDots);if(bpm>=30&&bpm<=240)out.bpm=Math.round(bpm);}
 return out;
}
