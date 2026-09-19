import React,{useLayoutEffect,useRef,useState} from 'react';
import {label} from './model.js';
import {rowArcSegments} from './lib/arcEditing.js';
import {allocateWidths,glyph,measureLayout,measureSegments} from './lib/engraveGeometry.js';
// 字形几何唯一实现在 lib/engraveGeometry.js；这里保留同名导出，校对入口继续可用。
export {allocateWidths,glyph};
const fontSize=24;
const explanation=m=>m.status==='incomplete'?'待标注':m.status==='pickup'?'弱起':m.status==='valid'?'满拍':m.status==='over'?'多 '+Number((m.beats-m.expectedBeats).toFixed(3))+' 拍':'少 '+Number((m.expectedBeats-m.beats).toFixed(3))+' 拍';
function Measure({segment,width,active,onSelect,row,passive,onInspect,previousTie,nextExists,scale,beamGroups,offset,range,editing,endpointIds}){
 const scroll=useRef(),[edges,setEdges]=useState({left:false,right:false});
 const {items,positions,content,overflow}=measureLayout(segment.notes,segment.minimum,width);
 const selected=active>=segment.start&&active<segment.start+items.length;
 const check=()=>{const s=scroll.current;if(s)setEdges({left:s.scrollLeft>2,right:s.scrollWidth-s.clientWidth-s.scrollLeft>2})};
 useLayoutEffect(()=>{const s=scroll.current;if(!s)return;if(selected){const raw=positions[active-segment.start],p={x:raw.x*scale,end:raw.end*scale};if(p.x<s.scrollLeft+6)s.scrollLeft=p.x-6;else if(p.end>s.scrollLeft+s.clientWidth-6)s.scrollLeft=p.end-s.clientWidth+6;}if(!overflow)s.scrollLeft=0;check()},[active,width,segment.minimum,overflow,scale]);
 useLayoutEffect(()=>{const el=scroll.current;if(!overflow||!el)return;const wheel=e=>{if(e.ctrlKey)return;e.preventDefault();e.stopPropagation();el.scrollLeft+=e.deltaX||e.deltaY;};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel)},[overflow]);
 const bad=editing&&['under','over'].includes(segment.measure.status);
 return <div className={'measure '+(bad?'invalid ':'')+(overflow?'overflowing':'')} style={{width:width*scale}} onMouseEnter={()=>onInspect(segment.measure)} onMouseLeave={()=>onInspect(null)} data-measure={segment.measure.index}>
 <div className="measure-scroll" ref={scroll} onScroll={check} aria-label={'第'+(segment.measure.index+1)+'小节'+(overflow?'，内容超宽，可横向浏览':'')}>
 <svg width={content*scale} height={91*scale} viewBox={"0 0 "+content+" 91"} className="engraved-svg" aria-label={'第'+(segment.measure.index+1)+'小节'}>
 {range&&segment.notes.map((n,i)=>{const idx=offset+segment.start+i;if(idx<range.startIndex||idx>range.endIndex)return null;const left=i?(positions[i-1].end+positions[i].x)/2:0,right=i+1<items.length?(positions[i].end+positions[i+1].x)/2:content;return <rect key={'range'+i} className="range-fill" x={left} y="23" width={right-left+.5} height="60" fill="#fff1bf"/>})}
 {selected&&<rect className="selection-marker" x={positions[active-segment.start].x-3} y="29" width={items[active-segment.start].width+6} height="44" rx="12" fill="#f2ce65"/>}
 {segment.notes.map((n,i)=>{const m=items[i],p=positions[i],a=n.annotation;
 return <g key={i} className="engraved-note" data-global-index={offset+segment.start+i} data-note-index={segment.start+i} role={passive?undefined:'button'} tabIndex="-1" aria-pressed={!passive&&active===segment.start+i} aria-label={'第'+(row.page+1)+'页第'+(row.line+1)+'行第'+(segment.start+i+1)+'音 '+label(n)} onClick={()=>onSelect&&!passive&&onSelect(segment.start+i)}>
 <circle className="note-anchor" data-index={segment.start+i} cx={p.cx} cy="22" r="0"/><rect className="note-hit" x={i?((positions[i-1].end+p.x)/2):0} y="23" width={(i+1<items.length?(p.end+positions[i+1].x)/2:content)-(i?((positions[i-1].end+p.x)/2):0)} height="62" fill="transparent"/>
 {endpointIds?.includes(n.id)&&<rect className="arc-endpoint" x={p.x-4} y="25" width={m.width+8} height="57" rx="5" fill="none" stroke="#a57b12" strokeWidth="2"/>}
 {m.acc>0&&<text x={p.x} y="56" fontSize="16">{n.accidental==='natural'?'♮':n.accidental}</text>}
 <text className="note-digit" x={p.x+m.acc} y="57" fontSize={fontSize}>{n.degree??'?'}</text>
 {n.octave>0&&!m.rest&&Array.from({length:Math.min(2,n.octave)},(_,j)=><circle key={j} cx={p.cx} cy={31-j*5} r="1.7"/>)}
 {n.octave<0&&!m.rest&&Array.from({length:Math.min(2,-n.octave)},(_,j)=><circle key={j} cx={p.cx} cy={(m.lines?77:67)+j*5} r="1.7"/>)}
 {m.dot&&<circle cx={p.x+m.acc+18} cy="48" r="1.7"/>}
 {Array.from({length:m.tail},(_,j)=>m.rest?<text key={j} x={p.x+17*(j+1)} y="57" fontSize={fontSize}>0</text>:<line key={j} x1={p.x+m.acc+17+j*10} y1="49" x2={p.x+m.acc+24+j*10} y2="49"/>)}
 {a.durationTicks===null&&<text className="unknown-duration" x={p.cx-4} y="83" fontSize="12">?</text>}
 </g>})}
 {/* Shared beam levels connect within the same metric group; barlines always separate beams. */}
 {items.flatMap((m,i)=>Array.from({length:m.lines},(_,level)=>{
 const p=positions[i],next=items[i+1],end=next&&next.lines>level&&beamGroups[offset+segment.start+i]!==null&&beamGroups[offset+segment.start+i]===beamGroups[offset+segment.start+i+1]?positions[i+1].cx+7:p.cx+7;
 return <line key={i+'-'+level} className="duration-beam" data-level={level+1} data-connected={!!(next&&next.lines>level&&beamGroups[offset+segment.start+i]!==null&&beamGroups[offset+segment.start+i]===beamGroups[offset+segment.start+i+1])} x1={p.cx-7} y1={64+level*5} x2={end} y2={64+level*5}/>;
 }))}
 {segment.notes.at(-1).annotation.measureEnd&&<line className="barline" x1={content-2} x2={content-2} y1="28" y2="80"/>}
 {range&&segment.notes.flatMap((n,i)=>{const idx=offset+segment.start+i;return ['start','end'].filter(edge=>idx===(edge==='start'?range.startIndex:range.endIndex)).map(edge=>{const p=positions[i],x=edge==='start'?p.x-5:p.end+4;return <g key={edge} className="range-handle" data-handle={edge} data-global-index={idx}><rect x={x-7} y="20" width="14" height="65" fill="transparent"/><line x1={x} x2={x} y1="26" y2="79" stroke="#b88612" strokeWidth="2.5"/><circle cx={x} cy={edge==='start'?26:79} r="3.5" fill="#b88612"/></g>})})}
 </svg></div>
 {overflow&&<div className="overflow-tools"><button aria-label="向左浏览小节" disabled={!edges.left} onClick={e=>{e.stopPropagation();scroll.current.scrollLeft-=width*.7}}>‹</button><span>内容超宽</span><button aria-label="向右浏览小节" disabled={!edges.right} onClick={e=>{e.stopPropagation();scroll.current.scrollLeft+=width*.7}}>›</button></div>}
 </div>
}
export function EngravedRow({row,offset,allMeasures,active=-1,onSelect,passive=false,previousTie=false,nextExists=false,fontSize=24,beamGroups=[],editAction=null,range=null,document,rowIndex=0,editing=false,arcDraft=null,onArcSelect=null,stableEditing=false}){
 const scale=fontSize/24;const [arcs,setArcs]=useState([]);const root=useRef(),[width,setWidth]=useState(800),[hovered,setHovered]=useState(null);
 useLayoutEffect(()=>{const ob=new ResizeObserver(()=>setWidth(root.current.clientWidth));ob.observe(root.current);setWidth(root.current.clientWidth);return()=>ob.disconnect()},[]);
 const segments=measureSegments(row.notes,offset,allMeasures);
 const meterWidths=segments.map(s=>s.measure.meterChange&&offset+s.start===s.measure.startIndex?Math.max(34,String(s.measure.meter.beats).length*9+25):0);
 const widths=allocateWidths(segments.map(s=>s.minimum),Math.max(1,width/scale-meterWidths.reduce((a,b)=>a+b,0)));
 const canonical=docArcs();
 function docArcs(){if(!document)return [];const stored=document.music?.arcs||[];return arcDraft?[...stored.filter(a=>a.id!==arcDraft.id),{...arcDraft,id:arcDraft.id||'draft',draft:true}]:stored;}
 const connections=document?rowArcSegments(document,rowIndex,canonical):[];
 const requiredArcSpace=connections.length?(12+Math.max(...connections.map(a=>a.level))*10)*scale:0;
 const arcReserve=useRef({row:null,space:0});
 // Keep note baselines fixed during a row editing session, including cancel/delete.
 if(arcReserve.current.row!==(row.id??rowIndex))arcReserve.current={row:row.id??rowIndex,space:Math.max(32*scale,requiredArcSpace)};
 if(stableEditing)arcReserve.current.space=Math.max(arcReserve.current.space,requiredArcSpace,32*scale);
 const arcSpace=stableEditing?arcReserve.current.space:requiredArcSpace;
 const updateArcs=()=>{if(!root.current)return;const rr=root.current.getBoundingClientRect();const anchors=[...root.current.querySelectorAll('.note-anchor')].map(el=>{const r=el.getBoundingClientRect(),v=el.closest('.measure-scroll').getBoundingClientRect();return {x:r.x-rr.x,y:r.y-rr.y,left:v.left-rr.left,right:v.right-rr.left,visible:r.x>=v.left&&r.x<=v.right}});
 const list=connections.flatMap(a=>{const start=a.start===null?null:anchors[a.start],end=a.end===null?null:anchors[a.end];if(a.start!==null&&!start||a.end!==null&&!end)return [];if(start&&end&&!start.visible&&!end.visible&&start.left===end.left)return [];
 const clamp=p=>Math.max(p.left,Math.min(p.right,p.x));const x1=start?clamp(start):0,x2=end?clamp(end):width,y=(anchors[0]?.y??arcSpace+22*scale)-a.level*6*scale;
 return [{...a,x1,x2,y,height:(12+a.level*10)*scale}];});setArcs(old=>JSON.stringify(old)===JSON.stringify(list)?old:list)};
 useLayoutEffect(()=>{updateArcs()},[row,width,fontSize,document,arcDraft,arcSpace,active]);
 const selected=segments.find(s=>active>=s.start&&active<s.start+s.notes.length)?.measure;
 const status=(hovered&&segments.find(s=>s.measure.index===hovered.index)?.measure)||selected;
 return <div className="engraved-row" ref={root} style={{'--arc-space':arcSpace+'px'}}><div className="measure-strip" style={{paddingTop:arcSpace,height:'auto'}} onScrollCapture={updateArcs}>{segments.map((s,i)=><React.Fragment key={s.start}>{s.measure.meterChange&&offset+s.start===s.measure.startIndex&&<span className="inline-meter" style={{width:meterWidths[i]*scale,flexShrink:0,boxSizing:'border-box',textAlign:'center'}}>{s.measure.meter.beats}/{s.measure.meter.beatUnit}</span>}<Measure key={s.start} segment={s} width={widths[i]} scale={scale} beamGroups={beamGroups} offset={offset} row={row} active={active} passive={passive} onSelect={onSelect} onInspect={setHovered} range={range} editing={editing} endpointIds={arcDraft?[arcDraft.fromNoteId,arcDraft.toNoteId]:[]}/></React.Fragment>) }<svg className="row-connections" width={width} height={91*scale+arcSpace} style={{overflow:'visible'}}>{arcs.map(a=>{const d='M '+a.x1+' '+a.y+' Q '+((a.x1+a.x2)/2)+' '+(a.y-a.height*2)+' '+a.x2+' '+a.y;return <g key={a.id} data-arc-id={a.id}>{a.number&&<text x={(a.x1+a.x2)/2} y={a.y-a.height-3*scale} textAnchor="middle" fontSize={13*scale} fill="currentColor" style={{pointerEvents:editing?'auto':'none',cursor:'pointer'}} onClick={()=>onArcSelect?.(a)}>{a.number}</text>}<path data-connection={a.typeSegment} className="connection-arc" d={d} style={a.draft?{stroke:'#a57b12',strokeWidth:2,strokeDasharray:'4 3'}:{}}/>{editing&&onArcSelect&&<path className="arc-hit" d={d} stroke="transparent" strokeWidth="14" fill="none" style={{pointerEvents:'stroke',cursor:'pointer'}} role="button" tabIndex="0" aria-label={'编辑连接 '+a.id} onClick={e=>{e.stopPropagation();onArcSelect(a)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();onArcSelect(a)}}}/>}</g>})}</svg></div>{editing&&<div className="measure-feedback">{status&&<span className={status.status}>第 {status.index+1} 小节 · {explanation(status)}</span>}{editAction&&<button className="text-button edit-row-entry" onClick={editAction}>修改音符 ↗</button>}</div>}</div>
}
