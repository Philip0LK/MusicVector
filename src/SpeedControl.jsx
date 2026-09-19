import React,{useState,useEffect,useRef} from 'react';
import {SPEED_PRESETS} from './training.js';
const format=n=>Number(n.toFixed(2)).toString();
export function SpeedControl({rate,baseTempo,onChange}){
 const [open,setOpen]=useState(false),root=useRef(),trigger=useRef();
 useEffect(()=>{if(!open)return;const outside=e=>{if(!root.current?.contains(e.target))setOpen(false)};const key=e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus()}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key)}},[open]);
 return <div className="speed-control" ref={root}>
 <button className="speed-trigger" ref={trigger} aria-label="演奏速度" aria-expanded={open} aria-controls="speed-options" onClick={()=>setOpen(v=>!v)}><span>速度</span><strong>{format(rate)}×</strong><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></button>
 {open&&<div className="speed-popover" id="speed-options" role="group" aria-label="演奏速度设置">
 <div className="speed-heading"><strong>演奏速度</strong><span>{format(baseTempo*rate)} 拍/分钟</span></div>
 <div className="speed-presets">{SPEED_PRESETS.map(n=><button key={n} aria-label={format(n)+' 倍速'} aria-pressed={Math.abs(rate-n)<.001} onClick={()=>onChange(n)}>{format(n)}×</button>)}</div>
 <div className="speed-fine"><button aria-label="减速 0.05 倍" disabled={rate<=.25} onClick={()=>onChange(rate-.05)}>−</button><input type="range" aria-label="调节演奏倍速" min="0.25" max="1.25" step="0.05" value={rate} onChange={e=>onChange(Number(e.target.value))}/><button aria-label="加速 0.05 倍" disabled={rate>=1.25} onClick={()=>onChange(rate+.05)}>＋</button></div>
 <div className="speed-scale"><span>0.25× 慢</span><span>快 1.25×</span></div>
 <div className="speed-base">原速 {format(baseTempo)} 拍/分钟</div>
 </div>}
 </div>;
}
