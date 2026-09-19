import React,{useRef} from 'react';
import {cropRect} from './layoutRules.js';
import {cropPolygonStyle} from './cropGeometry.js';
export function SourceRowTargets({rows,page,image,onSelect,current,doubleClick=false,hidden=null}) {
 const gesture=useRef(null);
 if(!image?.naturalWidth)return null;
 const regions=rows.map((row,index)=>({row,index})).filter(x=>x.row.page===page&&!(x.row.sourceMapping==='page'&&!x.row.crop)&&!(hidden&&hidden(x.row,x.index)))
  .map(x=>({...x,rect:cropRect(x.row.crop,image.naturalWidth,image.naturalHeight)}))
  .sort((a,b)=>(a.rect.y+a.rect.height/2)-(b.rect.y+b.rect.height/2));
 return regions.map((item,i)=>{
  const r=item.rect,prev=regions[i-1]?.rect,next=regions[i+1]?.rect,center=r.y+r.height/2;
  const top=prev?Math.max(r.y,(prev.y+prev.height/2+center)/2):r.y;
  const bottom=next?Math.min(r.y+r.height,(next.y+next.height/2+center)/2):r.y+r.height;
  return <button key={item.index} className="source-row-target" data-row={item.index}
   aria-label={'原谱第'+(page+1)+'页第'+(item.row.line+1)+'行'} aria-current={current===item.index?'true':undefined}
   style={{...cropPolygonStyle(item.row.crop),top:(item.row.crop?.version===3?r.y:top)*100+'%',height:(item.row.crop?.version===3?r.height:bottom-top)*100+'%',left:r.x*100+'%',width:r.width*100+'%'}}
   onPointerDown={e=>{gesture.current={x:e.clientX,y:e.clientY,id:item.index,moved:false};}}
   onPointerMove={e=>{const g=gesture.current;if(g&&Math.hypot(e.clientX-g.x,e.clientY-g.y)>6)g.moved=true;}}
   onPointerLeave={()=>{if(gesture.current)gesture.current.moved=true;}}
   onPointerCancel={()=>{if(gesture.current)gesture.current.moved=true;}}
   onDoubleClick={e=>{if(doubleClick){e.preventDefault();onSelect(item.index)}}}
   onClick={e=>{if(doubleClick)return;const g=gesture.current;gesture.current=null;if(e.detail!==0&&(!g||g.moved||g.id!==item.index))return;onSelect(item.index);}}
  />;
 });
}
