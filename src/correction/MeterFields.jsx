import React,{useEffect,useState} from 'react';

// Keep incomplete typing local; only validated values enter the music document.
export function MeterFields({mark,onApply}){
 const [beats,setBeats]=useState(String(mark.meter.beats)),[error,setError]=useState('');
 useEffect(()=>{setBeats(String(mark.meter.beats));setError('')},[mark.meter.beats]);
 const apply=()=>{
  if(!/^\d+$/.test(beats.trim())||Number(beats)<1||Number(beats)>32){setError('请输入 1–32 的整数');return false;}
  try{onApply({...mark.meter,beats:Number(beats)},mark.onlyMeasure);setBeats(String(Number(beats)));setError('');return true;}
  catch(e){setError(e.message);return false;}
 };
 return <div className="local-meter-fields">
  <input aria-label="变拍分子" aria-invalid={!!error} aria-describedby={error?'meter-error':undefined} type="text" inputMode="numeric" value={beats} onChange={e=>{setBeats(e.target.value);setError('')}} onBlur={apply} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(apply())e.currentTarget.blur()}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setBeats(String(mark.meter.beats));setError('')}}}/>
  <span>/</span><select aria-label="变拍分母" value={mark.meter.beatUnit} onChange={e=>onApply({...mark.meter,beatUnit:Number(e.target.value)},mark.onlyMeasure)}>{[2,4,8,16].map(n=><option key={n}>{n}</option>)}</select>
  <label title="只改变当前小节，下一小节恢复此前拍号"><input type="checkbox" checked={mark.onlyMeasure} onChange={e=>onApply(mark.meter,e.target.checked)}/>仅本小节</label>
  {error&&<span id="meter-error" className="meter-error" role="alert">{error}</span>}
 </div>;
}
