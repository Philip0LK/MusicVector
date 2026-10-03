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
 // 跨行连音标记（写在行末音与下一行首音上的同一字母）：每两条相邻行之间最多只可能有一条跨行连接，
 // "位置"本身已经确定了连的是哪两个音，所以字母不参与配对，只用来核对两端写的是否同一组。
 // 只有一端写了标记时，两端同音高才补齐（连音通常连在同一个音上）；音高不同说明这一端可能不属于这条连接，
 // 记为待确认而不猜。本页第一行之前的、最后一行之后的跨行标记在本页内无从判定，同样记为待确认，不新造跨页机制。
 // 标记附着在实际音符上，休止和读不出的占位不充当弧线端点。
 const pitchedNotes=result.map(row=>row.notes.filter(note=>note.degree>0));
 const firstNoteOf=pitchedNotes.map(notes=>notes[0]??null),lastNoteOf=pitchedNotes.map(notes=>notes[notes.length-1]??null);
 const samePitch=(a,b)=>Boolean(a&&b)&&a.degree!==null&&b.degree!==null&&a.degree===b.degree&&a.octave===b.octave&&a.accidental===b.accidental;
 const crossIssue=(index,code,note,detail)=>result[index].recognitionIssues.push({code,targetId:note?.recognitionEventId??null,field:'symbols',detail:detail+'，待人工确认'});
 // 旧归档曾把单音符行一律记成 openGroups；复算时重判方向，不修改保存的归档。
 const undirected=rawRows.map(row=>row.undirectedGroups?.[0]??(row.events.filter(event=>event.kind==='note').length===1&&!row.incomingGroups?.length?row.openGroups?.[0]??null:null));
 const tails=rawRows.map((row,index)=>undirected[index]?null:row.openGroups?.[0]??null),heads=rawRows.map((row,index)=>undirected[index]?null:row.incomingGroups?.[0]??null);
 if(undirected.some(Boolean)){
  // 候选只在相邻行之间产生；缺一个标记时仍须同音高。一个待定标记最多参与一次连接。
  // 优先解释更多已有标记，再优先完整的两端和同字母证据。多种同分方向都成立时不强行选择。
  const base=rawRows.length+1;
  const weights=rawRows.slice(0,-1).map((_,index)=>{
   const tail=tails[index]??undirected[index],head=heads[index+1]??undirected[index+1];
   if(!lastNoteOf[index]||!firstNoteOf[index+1]||(!tail&&!head))return 0;
   if(tail&&head)return 2*base*base+base+Number(tail===head);
   return samePitch(lastNoteOf[index],firstNoteOf[index+1])?base*base:0;
  });
  // 状态分别为上一条边未选/已选；只有共享单音符待定标记的相邻边互斥。
  const bestWithout=excluded=>{
   let skipped=0,taken=-Infinity;
   for(const [index,weight] of weights.entries()){
    const nextSkipped=Math.max(skipped,taken);
    const nextTaken=weight&&index!==excluded?weight+(undirected[index]?skipped:Math.max(skipped,taken)):-Infinity;
    skipped=nextSkipped;taken=nextTaken;
   }
   return Math.max(skipped,taken);
  };
  const best=bestWithout(-1),resolved=new Set();
  for(const [index,weight] of weights.entries()){
   if(!weight||(!undirected[index]&&!undirected[index+1])||bestWithout(index)===best)continue;
   // 排除这一条连接就变差，说明它出现在所有最优对应中，方向可唯一确认。
   if(undirected[index]){tails[index]=undirected[index];resolved.add(index);}
   if(undirected[index+1]){heads[index+1]=undirected[index+1];resolved.add(index+1);}
  }
  for(const [index,letter] of undirected.entries())if(letter&&!resolved.has(index))crossIssue(index,'group-open-unresolved',firstNoteOf[index],'跨行标记「('+letter+')」在单音符行上无法确定连接上一行或下一行，未连接');
 }
 const crossArc=(from,to)=>{
  const a=lastNoteOf[from],b=firstNoteOf[to];if(!a||!b)return;
  const [fromNoteId,toNoteId]=noteOrder.get(a.id)<=noteOrder.get(b.id)?[a.id,b.id]:[b.id,a.id];
  result[rowOfNote.get(fromNoteId)].recognitionArcs.push({id:runId+':cross:'+rawRows[from].rowId,type:'auto',fromNoteId,toNoteId,number:null});
 };
 rawRows.forEach((raw,index)=>{
  const next=rawRows[index+1],tail=tails[index],head=next?heads[index+1]:null;
  // 本页第一行的首音标记指向上一页的末音：跨页连接超出本页可见范围，留待确认。
  if(index===0&&(raw.incomingGroups||[]).length)crossIssue(0,'group-open-unresolved',firstNoteOf[0],'跨行标记「('+raw.incomingGroups[0]+')」指向上一页的末音，本页内无法连接');
  if(!tail&&!head)return;
  const a=lastNoteOf[index],b=next?firstNoteOf[index+1]:null;
  // 待定标记未分配给此边（含已用于另一边）时，不能再当作“漏标一端”补出第二条连接。
  if((undirected[index]&&!tail)||(undirected[index+1]&&!head)){
   if(tail&&!undirected[index])crossIssue(index,'group-open-unresolved',a,'跨行标记「('+tail+')」的相邻单音符行方向未能确定，未连接');
   if(head&&!undirected[index+1])crossIssue(index+1,'group-open-unresolved',b,'跨行标记「('+head+')」的相邻单音符行方向未能确定，未连接');
   return;
  }
  if(!a||!b){crossIssue(index,'group-open-unresolved',a,'跨行标记「('+(tail??head)+')」缺一端（下一行不存在或该行没有可用音符），无法连接');return;}
  if(tail&&head&&tail!==head)crossIssue(index,'group-letter-mismatch',b,'跨行标记两端字母不一致（'+tail+' 与 '+head+'），已按同一条连接处理');
  if(tail&&head)crossArc(index,index+1);
  else if(samePitch(a,b)){crossArc(index,index+1);crossIssue(index,'group-endpoint-completed',tail?a:b,'跨行标记「('+(tail??head)+')」只写了一端，两端同音高，已补成一条连接');}
  else crossIssue(index,'group-open-unresolved',tail?a:b,'跨行标记「('+(tail??head)+')」只写了一端，另一端不是同音高，未连接');
 });
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
