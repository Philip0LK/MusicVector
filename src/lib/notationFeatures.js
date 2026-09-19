// Notation relations keep stable note identities, never display indexes.
// 首版明确支持的比例，按 n:m（实际个数 : 占几个同类音）书写。
// 默认值与候选都由它推出，避免 UI 造出引擎判为无效的连音（normal 为空）。
const KNOWN_RATIOS=[[2,3],[3,2],[4,3],[5,4],[6,4],[7,4]];
export function inferredNormal(actual,meter){
 const compound=meter?.beatUnit===8&&meter.beats>3&&meter.beats%3===0;
 if(actual===2)return compound?3:2;
 if(actual===3)return 2;
 if(compound&&[4].includes(actual))return 3;
 if(!compound&&[5,6,7].includes(actual))return 4;
 return null;
}
// 「占几个同类音的时长」的合法候选：已知比例 + 推导值；两者都没有时（8、9 连音）补一个常见写法 n/2。
export function normalOptions(actual,meter){
 const n=Number(actual);
 if(!Number.isInteger(n)||n<2)return [];
 const known=KNOWN_RATIOS.filter(([count])=>count===n).map(([,normal])=>normal);
 const inferred=inferredNormal(n,meter);
 const usual=[...known,...(inferred?[inferred]:[])].length?[]:[n%2===0?n/2:n-1];
 return [...new Set([...known,...(inferred?[inferred]:[]),...usual])].filter(m=>m>0).sort((a,b)=>a-b);
}
export function defaultNormal(actual,meter){
 const n=Number(actual);
 const options=normalOptions(n,meter);
 const inferred=inferredNormal(n,meter);
 if(inferred&&options.includes(inferred))return inferred;
 // 没有推导值也没有已知比例时用常见写法兜底，避免出现 8:1 这种无意义比例。
 const fallback=n%2===0?n/2:n-1;
 return options.includes(fallback)?fallback:options.at(-1)??1;
}
export function stepNormal(actual,meter,current,direction){
 const options=normalOptions(actual,meter);
 if(!options.length)return current??null;
 const index=options.indexOf(Number(current));
 if(index<0)return defaultNormal(actual,meter);
 const next=index+(direction==='up'?1:-1);
 return options[Math.max(0,Math.min(options.length-1,next))];
}
export function meterAt(noteId,entries,changes,base){
 let current=base;for(const entry of entries){const change=changes.find(c=>c.noteId===entry.id);if(change&&!change.onlyMeasure)current=change.meter;if(entry.id===noteId)return change?.meter||current;}return current;
}
export function connectionTuplets(source,entries,base){
 const groups=(source.tuplets||[]).filter(t=>!String(t.id).startsWith('connection-tuplet:'));
 for(const a of source.arcs||[]){if(!a.number)continue;const x=entries.findIndex(n=>n.id===a.fromNoteId),y=entries.findIndex(n=>n.id===a.toNoteId);
 const ids=x<0||y<0?[a.fromNoteId,a.toNoteId]:entries.slice(Math.min(x,y),Math.max(x,y)+1).map(n=>n.id);
 const meter=meterAt(ids[0],entries,source.meterChanges||[],base);
 groups.push({id:'connection-tuplet:'+a.id,actual:a.number,normal:a.normal??inferredNormal(a.number,meter),memberIds:ids});}
 return groups;
}
