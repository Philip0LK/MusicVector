// Provider-independent response contract. Unknown values are preserved, never filled in.
const fail=message=>{throw Error('识别结果格式错误：'+message)};
const obj=(v,keys,path)=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(path);if(Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!(k in v)))fail(path+' 字段不匹配');};
const array=(v,path)=>{if(!Array.isArray(v))fail(path);return v;};
const str=(v,path)=>{if(typeof v!=='string'||!v.length)fail(path);};
const nullable=(v,check)=>v===null||check(v);
const int=(v,min=0,max=128)=>Number.isInteger(v)&&v>=min&&v<=max;
const one=(v,values)=>values.includes(v);
const check=(ok,path)=>{if(!ok)fail(path)};
const eventKeys={note:['id','kind','degree','octave','accidental','underlines','dots'],rest:['id','kind','underlines','dots'],extension:['id','kind'],barline:['id','kind','style'],unknown:['id','kind']};
// 行级 issue 码：前五项来自 AI 接收端；后七项来自几何测量与融合层（见 src/lib/rhythmFusion.js）；
// 末尾一组是"单点降级"记录（requestId 粘连、读不出的写法、缺行占位、重复行冲突）——只作留档，界面不呈现。
// 融合层的码必须在这里登记，否则带几何结果的识别会被接收校验拒绝。
const rowIssueCodes=['extra-row-ignored','unclear-symbol','clipped-connection','ambiguous-association','unsupported-symbol','target-row-uncertain','duplicate-row-dropped',
 'note-count-mismatch','ai-missed-note','ai-extra-note','low-dot-overridden','degree-disagree','degree-unverified','geometry-unavailable','rhythm-unresolved',
 'requestId-mismatch','unknown-note-token','unknown-note-dropped','unknown-arc-dropped','mark-conflict-resolved','missing-row-placeholder','duplicate-row-conflict',
 'geometry-block-unpaired','low-row-quality','rhythm-from-default'];
function issues(list,header=false){for(const issue of array(list,'issues')){
 obj(issue,header?['field','code','detail']:['code','targetId','field','detail'],'issue');
 check(one(issue.code,header?['unclear','multiple','unsupported']:rowIssueCodes),'issue.code');
 for(const k of header?['field','detail']:['targetId','field','detail'])check(nullable(issue[k],v=>typeof v==='string'),'issue.'+k);
}}
export function validateHeader(value,{requestId,headerId}){
 obj(value,['requestId','headerId','title','key','meters','tempo','issues'],'header');check(value.requestId===requestId&&value.headerId===headerId,'基础信息 ID');
 check(nullable(value.title,v=>typeof v==='string'),'title');
 if(value.key!==null){obj(value.key,['tonic','accidental'],'key');check(nullable(value.key.tonic,v=>/^[A-G]$/.test(v)),'tonic');check(nullable(value.key.accidental,v=>one(v,['sharp','flat','natural','none'])),'key.accidental');}
 for(const m of array(value.meters,'meters')){obj(m,['numerator','denominator'],'meter');check(int(m.numerator,1,64)&&int(m.denominator,1,64),'拍号');}
 if(value.tempo!==null){obj(value.tempo,['bpm','beatDenominator','beatDots'],'tempo');check(nullable(value.tempo.bpm,v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=1000),'bpm');check(nullable(value.tempo.beatDenominator,v=>int(v,1,128)),'beatDenominator');check(nullable(value.tempo.beatDots,v=>int(v,0,4)),'beatDots');}
 issues(value.issues,true);return value;
}
export function validateRows(value,{requestId,rowIds}){
 obj(value,['requestId','rows'],'response');
 // requestId 不一致只记录、不作废整页：它不参与行映射（行由 rowId 逐一核对），
 // 而模型在单行批次里会把紧邻的 rowId 标签粘进来，据此作废等于丢掉整页可用数据。
 const requestIdMismatch=value.requestId===requestId?null:String(value.requestId);
 array(value.rows,'rows');check(value.rows.length===rowIds.length,'缺少或多出乐谱行');
 const byRow=new Map();
 value.rows.forEach((r,index)=>{
  obj(r,['rowId','events','arcs','tuplets','lyrics','issues',...(Object.hasOwn(r,'meterMarks')?['meterMarks']:[])],'row');check(r.rowId===rowIds[index]&&!byRow.has(r.rowId),'rowId 或顺序');
  const ids=new Map();byRow.set(r.rowId,ids);
  for(const e of array(r.events,'events')){check(!!eventKeys[e.kind],'事件类型');obj(e,eventKeys[e.kind],'event');str(e.id,'event.id');check(!ids.has(e.id),'重复事件 ID');ids.set(e.id,e.kind);
   if(e.kind==='note'){check(nullable(e.degree,v=>int(v,1,7)),'degree');check(nullable(e.octave,v=>int(v,-2,2)),'octave');check(nullable(e.accidental,v=>one(v,['sharp','flat','natural','none'])),'accidental');}
   if(['note','rest'].includes(e.kind))for(const field of ['underlines','dots'])check(nullable(e[field],v=>int(v,0,16)),field);
   if(e.kind==='barline')check(one(e.style,['single','double','final','unknown']),'barline.style');
  }
  for(const key of ['arcs','tuplets','lyrics']){array(r[key],key);const seen=new Set(ids.keys());for(const x of r[key]){str(x.id,key+'.id');check(!seen.has(x.id),'重复对象 ID');seen.add(x.id);}}
  issues(r.issues);
 });
 // 单点引用降级：引用指不到可确认的音符时，把该处置空/剔除并留档，绝不因一条坏引用作废整页。
 // 只有结构问题（顶层字段、行数、rowId 与请求不逐一对应）才整页失败。
 const relax=(r,code,targetId,field,detail)=>{r.issues.push({code,targetId,field,detail:detail+'，已降级处理'});};
 for(const r of value.rows){const ids=byRow.get(r.rowId);const allIds=new Set([...ids.keys(),...r.arcs.map(v=>v.id),...r.tuplets.map(v=>v.id),...r.lyrics.map(v=>v.id)]);
  for(const a of r.arcs){obj(a,['id','start','end',...(Object.hasOwn(a,'number')?['number']:[])],'arc');
   if(a.number!==undefined&&!nullable(a.number,v=>int(v,2))){relax(r,'unsupported-symbol',a.id,'number','连音数字 '+JSON.stringify(a.number)+' 无效');a.number=null;}
   for(const name of ['start','end'])if(a[name]!==null){obj(a[name],['rowId','eventId'],'arc endpoint');
    // 端点指向"非结构事件"即放行：指向读不出的音（unknown）也放行，由 convertRows 决定连弧线一起丢弃。
    const target=byRow.get(a[name].rowId)?.get(a[name].eventId);
    if(!one(target,['note','rest','unknown'])){relax(r,'unsupported-symbol',a.id,name,'弧线端点 '+a[name].rowId+'/'+a[name].eventId+' 指不到音符');a[name]=null;}
   }
  }
  r.tuplets=r.tuplets.filter(t=>{
   obj(t,['id','displayedNumber','displayedNormalNumber','members'],'tuplet');
   if(!nullable(t.displayedNumber,v=>int(v,2))||!nullable(t.displayedNormalNumber,v=>int(v,1))){relax(r,'unsupported-symbol',t.id,'number','连音数字无效');t.displayedNumber=null;t.displayedNormalNumber=null;}
   if(t.members===null)return true;
   array(t.members,'members');
   const kept=t.members.filter(id=>one(ids.get(id),['note','rest','extension']));
   if(kept.length!==t.members.length)relax(r,'unsupported-symbol',t.id,'members','连音组成员含非音符，已剔除');
   if(!kept.length||new Set(kept).size!==kept.length){relax(r,'unsupported-symbol',t.id,'members','连音组成员无法确认，已置空');t.members=null;}else t.members=kept;
   return true;
  });
  r.lyrics.forEach((l,index)=>{
   obj(l,['id','lineIndex','units'],'lyrics');
   if(!int(l.lineIndex,1)){relax(r,'unsupported-symbol',l.id,'lineIndex','歌词行号无效，已按顺序补');l.lineIndex=index+1;}
   for(const u of array(l.units,'units')){obj(u,['text','eventIds'],'lyric unit');
    if(!nullable(u.text,v=>typeof v==='string')){relax(r,'unsupported-symbol',l.id,'text','歌词文本类型不符，已置空');u.text=null;}
    if(u.eventIds!==null){array(u.eventIds,'eventIds');
     const kept=u.eventIds.filter(id=>ids.get(id)==='note');
     if(kept.length!==u.eventIds.length)relax(r,'unsupported-symbol',l.id,'eventIds','歌词引用含非音符，已置空');
     u.eventIds=kept.length===u.eventIds.length?kept:null;
    }
   }
  });
  r.issues.forEach(issue=>{if(issue.targetId!==null&&!allIds.has(issue.targetId)){issue.targetId=null;}});
 }
 return value;
}
