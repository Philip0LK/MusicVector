import {validateRows} from './recognitionContract.js';
const fail=message=>{throw Error('识别结果格式错误：'+message)};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail('紧凑格式字段');};
const list=v=>{if(!Array.isArray(v))fail('应为数组');return v;};
const tuple=(v,n)=>{if(!Array.isArray(v)||v.length!==n)fail('紧凑数组长度');return v;};
// 一个音符内，音区标记、减时线、附点是三个独立计数，先后顺序不携带信息：
// 这三个字符都不可能另起一个事件，按个数读取不会与相邻事件混淆，因此任意排列都读成同一个音符。
// 变音号相反：它自己可以另起一个事件（5#6 是 5 与 #6 还是 #5 与 6 无法判定），所以必须写在数字前。
// 容忍范围的判据：只容忍不可能另起事件的字符；字形等价（全角、♯♭♮‖）在词法前统一。
// 括号从"按空白忽略"改成"连音组标记"：`2(1)` 表示 2 这个音是编号 1 的连音组的一个端点。
// 标记只说明端点，不携带位置信息（这正是改造目的：模型不需要数音符序号），因此它不占事件位置、不参与事件编号。
// 这是唯一允许的括号用法：谱面上其他括号内容按提示词要求不写进 symbols；万一写进来了，
// 内容读不出组号就只丢这一处标记并记一条待确认问题，不作废整行。
// 反复/跳转记号的冒号（`:||`、`‖:`、全角 `：`）同理：只读第一层时它是纯记号，去掉冒号后的小节线照常成为事件，
// 因而不记待确认问题——否则每个反复记号都会给用户添一条没有可操作性的待确认项。
const glyphs={'♯':'#','♭':'b','♮':'n','‖':'||','–':'-','—':'-','−':'-','‐':'-'};
const normalizeSymbols=text=>text.normalize('NFKC').replace(/[♯♭♮‖–—−‐]/g,c=>glyphs[c]);
// 规定外内容一趟清洗。四条防误伤约束：
// 1) 只处理词法器匹配不到的空隙，已匹配的 token 一个字符都不动（不会把 1. 或 #5 拆坏）；
// 2) 丢弃的内容只按空隙跳过，绝不删除后粘连（两侧仍分属两个 token，1.5 不会读成 15）；
// 3) 空隙不可能包含小节线——`|` 本身能另起事件，所以反复记号里的小节线会照常成为 token，小节结构不受影响；
// 4) 除纯装饰外都不静默：被忽略的内容逐行汇总成一条待确认问题，原始返回另有归档，便于事后核对。
// 落单的右括号（提示性括号的另一半）仍按纯装饰忽略：它不可能是组标记，给它记问题只会白添待确认项。
const decoration=/^[,，、;；。:：~～*'"“”‘’\[\]【】{}《》…)]+$/;
export function parseSymbols(symbols,onIgnored,onDegraded,onMark){
 if(typeof symbols!=='string')fail('symbols');
 const text=normalizeSymbols(symbols);
 const raw=[];let offset=0;const ignored=[];
 // 连音组标记作为独立 token 参与词法，但不成为事件：`2/(1)` 读成 2/ 与标记 (1)。
 const lexeme=/\s+|\|\]|\|\||\||-|\?|\([^)\s]*\)?|[#bn]?[0-7][v^/.]*/y;
 const canStart=/[\s|?\-0-7#bn(]/y;
 while(offset<text.length){
  lexeme.lastIndex=offset;const m=lexeme.exec(text);
  if(m){const value=m[0],end=lexeme.lastIndex;offset=end;if(!/^\s+$/.test(value))raw.push({value,start:end-value.length,end});continue;}
  let end=offset;while(end<text.length){canStart.lastIndex=end;if(canStart.test(text))break;end++;}
  if(end===offset)end=offset+1;
  const gap=text.slice(offset,end);offset=end;
  if(!decoration.test(gap))ignored.push(gap);
 }
 if(ignored.length&&onIgnored)onIgnored(ignored);
 // 读不出的 token 不再作废整页：产出可删除的 unknown 事件占住原事件位置（模型给的弧线端点序号不会因此错位），
 // 并逐条上报，由接收端决定如何处置。这类情况在提示词收紧后应当极少出现。
 const degraded=(token,id)=>{if(onDegraded)onDegraded(token);return {id,kind:'unknown'};};
 const readEvent=(token,id)=>{
  if(token==='-')return {id,kind:'extension'};
  if(['|','||','|]'].includes(token))return {id,kind:'barline',style:{'|':'single','||':'double','|]':'final'}[token]};
  if(token==='?')return degraded(token,id);
  const m=/^([#bn]?)([0-7])([v^/.]*)$/.exec(token);
  if(!m)return degraded(token,id);
  const [,accidental,degree,marks]=m;
  // 同一字段给了互相冲突的标记时，从左往右第一个算数，其余忽略，尽量给出可用读数。
  // 音区：方向由第一个出现的 ^ 或 v 决定，之后相反方向的标记一律丢弃（6v^ 读成低音 6）。
  const up=(marks.match(/\^/g)||[]).length,down=(marks.match(/v/g)||[]).length;
  const conflict=(up&&down)||up>2||down>2;
  let octave=0;
  if(up||down){
   // 从左往右扫：方向由第一个出现的 ^ 或 v 决定，之后同向的计数（上限两级），反向的丢弃。
   const at=marks.search(/[\^v]/),direction=marks[at];
   let count=0;
   for(let k=at;k<marks.length&&count<2;k++)if(marks[k]===direction)count++;
   octave=direction==='^'?count:-count;
   // 同向标记超过两级（count 被截到 2）、或出现与已确立方向相反的标记，都算读过冲突写法：取值照上面，但要留档。
   if(up+down>count)degraded(token);
  }
  const underlines=(marks.match(/\//g)||[]).length,dots=(marks.match(/\./g)||[]).length;
  const clamped=underlines>16||dots>16;
  if(conflict||clamped)degraded(token);
  const u=Math.min(underlines,16),d=Math.min(dots,16);
  if(degree==='0'){
   // 休止符不该带变音或音区：丢掉这些标记，读成普通休止符。
   if(accidental||up||down)degraded(token);
   return {id,kind:'rest',underlines:u,dots:d};
  }
  return {id,kind:'note',degree:Number(degree),octave,accidental:({'#':'sharp',b:'flat',n:'natural'})[accidental]||'none',underlines:u,dots:d};
 };
 // 事件编号只数事件本身：连音组标记不占号，没有标记时编号与改造前逐位一致，历史归档与几何对齐都不受影响。
 const events=[],idOf=new Map(),kindOf=new Map();
 for(let i=0;i<raw.length;i++){
  if(raw[i].value.startsWith('('))continue;
  const id='e'+(events.length+1),event=readEvent(raw[i].value,id);
  events.push(event);idOf.set(i,id);kindOf.set(id,event.kind);
 }
 // 标记归属只看词法相邻：紧贴在前一个事件后、或紧贴在后一个事件前，都算附着在这一个事件上
 // （`2(1)(a)` 的两个标记都贴在 2 上）。模型把标记单独写成一个 token（前后都有空白）时按最近的音符补挂，
 // 并把 detached 标出来交给接收端留档。故意不越过紧贴的那个事件去找音符：`0(1)` 的标记属于休止符，
 // 越过它就等于把标记挪到别的音上，那才是真的猜。
 if(onMark)for(let i=0;i<raw.length;i++){
  if(!raw[i].value.startsWith('('))continue;
  let prev=-1;for(let j=i-1;j>=0;j--)if(!raw[j].value.startsWith('(')){prev=j;break;}
  let next=-1;for(let j=i+1;j<raw.length;j++)if(!raw[j].value.startsWith('(')){next=j;break;}
  const anchored=(i>0&&raw[i-1].end===raw[i].start&&prev>=0)?idOf.get(prev):(i+1<raw.length&&raw[i].end===raw[i+1].start&&next>=0)?idOf.get(next):null;
  const noteBefore=prev>=0&&kindOf.get(idOf.get(prev))==='note'?idOf.get(prev):null;
  const noteAfter=next>=0&&kindOf.get(idOf.get(next))==='note'?idOf.get(next):null;
  const target=anchored??noteBefore??noteAfter;
  onMark({content:raw[i].value.replace(/^\(/,'').replace(/\)$/,''),targetId:target??null,targetKind:target?kindOf.get(target):null,detached:!anchored&&Boolean(target)});
 }
 return events;
}
export function decodeCompactRows(value,options){
 exact(value,['requestId','rows']);
 // requestId 只用于归档定位与模型退化的长期探针，不参与任何行映射（行的归属由 rowId 逐一核对，那层仍致命）。
 // 实测模型会在"只返回 1 行"的批次里把紧邻的 rowId 标签粘进 requestId（q3rowId=r4），
 // 若据此作废整页，代价是整页识别结果全丢，而行的内容本来完全可用。故只记录、不作废。
 const requestIdMismatch=value.requestId!==options.requestId?String(value.requestId):null;
 // 拼错误文案用的标注函数（默认恒等）：短名映射只影响可读性，不参与任何判断。
 const label=options.aliasLabel??(id=>id);
 const expected=options.rowIds,received=list(value.rows),byId=new Map(),extras=[];
 // 重复行处理（判据必须可证无损）：
 //   · 同一个 rowId 再次出现，且整行内容逐字节相同 → 纯冗余副本，丢弃并记录；丢弃不可能丢信息（首份保留）。
 //   · 同一个 rowId 再次出现但内容不同 → 保留第一份并记录冲突（无法判定哪份对，但第一份可用，不作废整页）。
 //   · 只是"内容相同但 rowId 不同" → 不动：同一段旋律合法地重复出现是正常谱面，不能据此删行。
 const duplicateDropped=[],duplicateConflicts=[];
 const sameRow=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 for(const row of received){
  if(!row||typeof row.rowId!=='string')fail('返回行缺少 rowId');
  if(!byId.has(row.rowId)){byId.set(row.rowId,row);}
  else if(sameRow(byId.get(row.rowId),row)){duplicateDropped.push(row.rowId);}
  else duplicateConflicts.push(row.rowId);
  if(!expected.includes(row.rowId))extras.push(row);
 }
 const counts=new Map();for(const row of received)counts.set(row.rowId,(counts.get(row.rowId)??0)+1);
 // 缺行不再作废整页：补一个空占位行，用户能在修正界面看到并补上，其余行照常可用。
 const missing=expected.filter(id=>!byId.has(id));
 const placeholder=id=>({rowId:id,symbols:'',arcs:[],tuplets:[],lyrics:[],issues:[[null,'模型未返回此行']]});
 for(const id of missing)byId.set(id,placeholder(id));
 // 只有"完全空且形状已知"的请求外行才能丢弃；有内容的请求外行同样忽略但必须记录（可能是被切开的真实乐谱行）。
 // 可选字段（拍号、连音数、跨行标记）只要求"要么没有、要么是空数组"，不要求模型必须写出来。
 const optional=row=>['meterMarks','groupNumbers','openGroups','incomingGroups'].every(k=>!Object.hasOwn(row,k)||(Array.isArray(row[k])&&!row[k].length));
 const empty=row=>Object.keys(row).every(k=>['rowId','symbols','arcs','tuplets','lyrics','issues','meterMarks','groupNumbers','openGroups','incomingGroups'].includes(k))&&typeof row.symbols==='string'&&!row.symbols.trim()&&['arcs','tuplets','lyrics','issues'].every(k=>Array.isArray(row[k])&&row[k].length===0)&&optional(row);
 value={...value,rows:expected.map(id=>byId.get(id))};
 // 重复输出的记录：逐字节相同的副本被丢弃、内容冲突的保留第一份。模型重复输出是故障信号，
 // 丢弃只是不让它毁掉整页，不能让它静默消失（复盘要能看到"哪一行被重复了几次"）。
 const duplication=[...new Set(duplicateDropped)].map(id=>`${label(id)}×${counts.get(id)}`);

 // 单条引用出问题不得连累整张图：引用无法解析时记一条待确认问题并置空，符号转录照常保留。
 // unsupported-symbol = 模型用了契约里没有的写法（留给后续优化提示词或加容忍）；clipped-connection = 写法合法但指不到音符。
 const problem=(issues,code,targetId,field,detail)=>issues.push({code,targetId,field,detail:detail+'，待人工确认'});
 const positionOf=v=>(Number.isInteger(v)&&v>=1?v:null);
 const rows=list(value.rows).map((r,index)=>{
  // 空集合字段缺失按空集合补齐：模型漏写一个空数组是常见退化，缺一个空数组不该作废整页
  // （与"缺行补占位、requestId 抄错只记录"同一条原则）。字段存在但类型不对仍照旧整页失败。
  r=['arcs','tuplets','lyrics','issues'].every(k=>Object.hasOwn(r,k))?r:{...r,arcs:r.arcs??[],tuplets:r.tuplets??[],lyrics:r.lyrics??[],issues:r.issues??[]};
  exact(r,['rowId','symbols','arcs','tuplets','lyrics','issues',
   ...(Object.hasOwn(r,'meterMarks')?['meterMarks']:[]),
   ...(Object.hasOwn(r,'groupNumbers')?['groupNumbers']:[]),
   ...(Object.hasOwn(r,'openGroups')?['openGroups']:[]),
   ...(Object.hasOwn(r,'incomingGroups')?['incomingGroups']:[])]);
  const issues=[];
  // 批次级记录挂在本批首行（用下标判断，不能用对象身份：首行可能是补出来的占位行）。
  const batchIssue=index===0;
  if(requestIdMismatch!==null&&batchIssue)issues.push({code:'requestId-mismatch',targetId:null,field:'requestId',detail:'返回的 requestId「'+requestIdMismatch+'」与本次请求不一致；行已按 rowId 逐一核对后收下'});
  const extrasAll=extras.map(r=>label(r.rowId));
  if(extrasAll.length)issues.push({code:'extra-row-ignored',targetId:null,field:null,detail:'已忽略请求外'+(extras.every(empty)?'空行':'含内容的行')+'：'+extrasAll.join(', ')});
  if(missing.length&&batchIssue)issues.push({code:'missing-row-placeholder',targetId:null,field:null,detail:'模型未返回这些行，已按空行占位待补：'+missing.map(label).join(', ')});
  // 重复输出的记录同属批次级（问题属于"这次返回"，不属于被丢掉的副本本身）。
  if(duplication.length&&batchIssue)issues.push({code:'duplicate-row-dropped',targetId:null,field:null,detail:'模型重复输出了相同的行，已丢弃冗余副本：'+duplication.join(', ')});
  if(duplicateConflicts.length&&batchIssue)issues.push({code:'duplicate-row-conflict',targetId:null,field:null,detail:'同一 rowId 返回了不同内容，已保留第一份：'+[...new Set(duplicateConflicts)].map(label).join(', ')});
  // 读不出的 token 逐条记录（同一 token 只记一次），供后台复盘；用户界面不呈现。
  const degradedSeen=new Set(),marks=[];
  const events=parseSymbols(r.symbols,ignored=>issues.push({code:'unsupported-symbol',targetId:null,field:null,detail:'已忽略规定外内容「'+ignored.join(' ').slice(0,40)+'」，待人工确认'}),token=>{
   if(degradedSeen.has(token))return;degradedSeen.add(token);
   issues.push({code:'unknown-note-token',targetId:null,field:'symbols',detail:'写法「'+token+'」已按从左往右第一个标记取值，其余冲突标记忽略'});
  },mark=>marks.push(mark));
  const notes=events.filter(e=>e.kind==='note').map(e=>e.id);
  const endpoint=(id,field,v)=>{
   if(v===null)return null;
   if(Array.isArray(v)){
    const target=v.length===2&&typeof v[0]==='string'?positionOf(v[1]):null;
    if(target===null){problem(issues,'unsupported-symbol',id,field,'跨行端点 '+JSON.stringify(v)+' 无法解析');return null;}
    return {rowId:v[0],position:target};
   }
   const target=positionOf(v);
   if(target===null){problem(issues,'unsupported-symbol',id,field,'端点 '+JSON.stringify(v)+' 无法解析');return null;}
   return {rowId:r.rowId,position:target};
  };
  // 连音组标记：数字是行内组、字母是跨行组（写法见 SOP）。这里只做三件事——
  // 判定每个标记是否可用、按同类去重、把可用标记归到"行内组号"或"跨行字母"两处。
  // 组的范围由两个端点之间的全部音符决定（与既有连音组语义一致），所以下面只产出两个端点。
  const position=new Map(notes.map((id,i)=>[id,i+1]));
  const firstNote=notes[0]??null,lastNote=notes[notes.length-1]??null;
  const byNumber=new Map(),letters=[],slot=new Map();
  for(const mark of marks){
   const text=String(mark.content??'').trim().toLowerCase();
   if(mark.targetKind!=='note'){
    // 标记没落在音符上：休止符上的单独记（谱面上确有把连音线画到休止符的写法），其他位置记为无效。
    problem(issues,mark.targetKind==='rest'?'group-mark-on-rest':'group-mark-invalid',mark.targetId,'symbols','连音组标记「('+mark.content+')」不在音符上');
    continue;
   }
   const kind=/^\d{1,2}$/.test(text)&&Number(text)>=1?'digit':/^[a-z]$/.test(text)?'letter':null;
   if(!kind){problem(issues,'group-mark-invalid',mark.targetId,'symbols','连音组标记「('+mark.content+')」读不出组号');continue;}
   if(mark.detached)problem(issues,'group-mark-detached',mark.targetId,'symbols','连音组标记「('+mark.content+')」与音符之间有空隙，已按最近的音符处理');
   const key=mark.targetId+':'+kind;
   if(slot.has(key)){problem(issues,'group-mark-duplicated',mark.targetId,'symbols','同一个音符上有两个同类连音组标记，只采用「('+slot.get(key)+')」');continue;}
   slot.set(key,text);
   if(kind==='digit'){const number=Number(text);if(!byNumber.has(number))byNumber.set(number,[]);byNumber.get(number).push(mark.targetId);}
   else letters.push({letter:text,eventId:mark.targetId});
  }
  // groupNumbers 只登记"要按连音比例演奏"的组：[组号,连音数]。三种写法都收（成对数组、单个对、对象映射），
  // 因为这一项是附加信息，写法上的小差异不该让整组连音数丢掉。值写 null 等于明说"这组是普通连接"。
  const tupletNumbers=new Map(),rawGroups=r.groupNumbers??[];
  const groupEntries=Array.isArray(rawGroups)
   ?(rawGroups.length===2&&rawGroups.every(v=>Number.isInteger(v))?[rawGroups]:rawGroups)
   :rawGroups&&typeof rawGroups==='object'?Object.entries(rawGroups):null;
  if(groupEntries===null)problem(issues,'group-mark-invalid',null,'groupNumbers','连音数 '+JSON.stringify(rawGroups)+' 无法解析');
  else for(const entry of groupEntries){
   if(!Array.isArray(entry)||entry.length!==2){problem(issues,'group-mark-invalid',null,'groupNumbers','连音数 '+JSON.stringify(entry)+' 不是 [组号,连音数]');continue;}
   const number=Number(entry[0]);
   if(!Number.isInteger(number)||number<1||number>99){problem(issues,'group-mark-invalid',null,'groupNumbers','连音数里的组号 '+JSON.stringify(entry[0])+' 无效');continue;}
   if(entry[1]===null)continue;
   if(!Number.isInteger(entry[1])||entry[1]<2||entry[1]>16){problem(issues,'group-mark-invalid',null,'groupNumbers','组 ('+number+') 的连音数 '+JSON.stringify(entry[1])+' 无效');continue;}
   if(tupletNumbers.has(number)){problem(issues,'group-mark-duplicated',null,'groupNumbers','组 ('+number+') 的连音数给了两次，只采用第一个');continue;}
   tupletNumbers.set(number,entry[1]);
  }
  // 行内组：两个端点成组，缺一端时的处置只按"右邻音符/行末"两种可判定情形分流，不猜更远的音。
  // 字母标记本来只用于跨行，但实测模型也会用字母标行内的一对音（同一行里同一个字母出现两次）：
  // 判据始终是"同一个标记出现两次就是一条连接"，不因为写了字母就丢掉这条连接，只把它记成写法偏差。
  const inRow=[...byNumber].map(([number,ends])=>({label:String(number),ends,tuplet:tupletNumbers.get(number)??null,letter:false}));
  const letterCounts=new Map();
  for(const {letter} of letters)letterCounts.set(letter,(letterCounts.get(letter)??0)+1);
  for(const [letter,count] of letterCounts){
   if(count<2)continue;
   const ends=letters.filter((x)=>x.letter===letter).map((x)=>x.eventId);
   problem(issues,'group-cross-row-misplaced',ends[0],'symbols','字母标记「('+letter+')」只用于跨行连接，本行出现了两次，已按行内的一组连接处理');
   inRow.push({label:letter,ends,tuplet:null,letter:true});
  }
  const groupArcs=[];let groupSeq=0;
  for(const {label,ends,tuplet} of inRow){
   if(ends.length===1){
    const only=ends[0];
    if(tuplet!==null){
     // 连音数已知却只标出一个端点：组的范围无从确定，交回用户重设（沿用既有"待确认连接"入口）。
     problem(issues,'group-open-unresolved',only,'symbols','连音组 ('+label+') 只标出一个端点，范围待确认');
     groupArcs.push({id:'g'+(++groupSeq),start:{rowId:r.rowId,position:position.get(only)},end:null,number:tuplet});
    }else if(only!==lastNote){
     // 普通连接只缺一端：补到它右边紧邻的那个音符，用户可在修正界面改掉。
     const next=notes[notes.indexOf(only)+1];
     problem(issues,'group-endpoint-completed',only,'symbols','连音组 ('+label+') 只标出一个端点，已补到它右边的音符');
     groupArcs.push({id:'g'+(++groupSeq),start:{rowId:r.rowId,position:position.get(only)},end:{rowId:r.rowId,position:position.get(next)},number:null});
    }else problem(issues,'group-open-unresolved',only,'symbols','连音组 ('+label+') 只标出一个端点且在行末，本行无法补全');
   }else{
    // 同一组号标了两处以上：只取最左边的两个端点（其余落点无法判定属于哪一组，只能留档）。
    const pair=ends.length>2?ends.slice(0,2):ends;
    if(ends.length>2)problem(issues,'group-number-reused',pair[0],'symbols','编号 ('+label+') 出现了 '+ends.length+' 次，只取最左边的两个端点');
    groupArcs.push({id:'g'+(++groupSeq),start:{rowId:r.rowId,position:position.get(pair[0])},end:{rowId:r.rowId,position:position.get(pair[1])},number:tuplet});
   }
  }
  for(const number of tupletNumbers.keys())if(!byNumber.has(number))problem(issues,'group-number-unmatched',null,'groupNumbers','连音数里的组 ('+number+') 在本行没有对应标记');
  // 跨行组：字母不参与配对——每两行之间最多只可能有一条跨行连接，位置本身已经确定了连接，
  // 字母只用来核对两端写的是同一个组。真正的连接要等整页的行都到齐，在 convertRows 里接。
  // 只出现一次的字母才是跨行标记；行内成对的字母上面已经按行内组处理。
  const openGroups=[],incomingGroups=[];
  for(const {letter,eventId} of letters){
   if(letterCounts.get(letter)>1)continue;
   if(eventId===lastNote)openGroups.push(letter);
   else if(eventId===firstNote&&firstNote!==lastNote)incomingGroups.push(letter);
   else problem(issues,'group-cross-row-misplaced',eventId,'symbols','跨行标记「('+letter+')」只写在本行末音与下一行首音上，此处已忽略');
  }
  const arcs=[];
  // 同一行同时给了组标记与 arcs 时以组标记为准：两套写法混用时无法判断 arcs 里的条目是否已被标记覆盖，
  // 同时收下会把同一组连音记两遍（连音比例会被算错），因此只保留组标记并留档。
  if(slot.size&&list(r.arcs).length)problem(issues,'arc-source-conflict',null,'arcs','同一行同时给了连音组标记和 arcs，已以组标记为准');
  if(slot.size)arcs.push(...groupArcs);
  else list(r.arcs).forEach((a,i)=>{
   const id='a'+(i+1);
   if(!Array.isArray(a)||![2,3].includes(a.length)){problem(issues,'unsupported-symbol',null,'arc','弧线 '+JSON.stringify(a)+' 不是 [起点,终点]');return;}
   if(a.length===3&&a[2]!==null&&(!Number.isInteger(a[2])||a[2]<2||a[2]>16)){problem(issues,'unsupported-symbol',id,'number','连音数字无效');return;}
   arcs.push({id,start:endpoint(id,'start',a[0]),end:endpoint(id,'end',a[1]),...(a.length===3?{number:a[2]}:{})});
  });
  const tuplets=list(r.tuplets).map((t,i)=>{
   tuple(t,3);
   const id='t'+(i+1);
   if(t[2]===null)return {id,displayedNumber:t[0],displayedNormalNumber:t[1],members:null};
   if(!Array.isArray(t[2])){problem(issues,'unsupported-symbol',id,'members','连音组成员 '+JSON.stringify(t[2])+' 无法解析');return {id,displayedNumber:t[0],displayedNormalNumber:t[1],members:null};}
   const members=t[2].map(positionOf);
   if(members.some(v=>v===null)){problem(issues,'unsupported-symbol',id,'members','连音组成员 '+JSON.stringify(t[2])+' 无法解析');return {id,displayedNumber:t[0],displayedNormalNumber:t[1],members:null};}
   return {id,displayedNumber:t[0],displayedNormalNumber:t[1],members};
  });
  for(const issue of list(r.issues)){
   tuple(issue,2);if(typeof issue[1]!=='string')fail('问题说明');
   const target=issue[0]===null?null:positionOf(issue[0]);
   if(issue[0]!==null&&target===null)problem(issues,'unsupported-symbol',null,'target','问题目标 '+JSON.stringify(issue[0])+' 无法解析');
   issues.push({code:'unclear-symbol',position:target,field:null,detail:issue[1]});
  }
  const meterMarks=list(r.meterMarks??[]).map(m=>{tuple(m,3);if(!Number.isInteger(m[0])||m[0]<0||!Number.isInteger(m[1])||m[1]<1||m[1]>32||![2,4,8,16].includes(m[2]))fail('变拍拍号或小节位置');return m;});
  return {rowId:r.rowId,events,notes,arcs,tuplets,issues,...(r.meterMarks?{meterMarks}:{}),
   // 跨行标记透传给 convertRows：真正连哪两个音要等整页的行都在手上才能定（行批次之间也可能相连）。
   ...(openGroups.length?{openGroups:[openGroups[0]]}:{}),...(incomingGroups.length?{incomingGroups:[incomingGroups[0]]}:{}),
   lyrics:list(r.lyrics).map((text,i)=>{if(typeof text!=='string')fail('歌词文本');return {id:'ly'+(i+1),lineIndex:i+1,units:[{text,eventIds:null}]};})};
 });
 // 引用按音符序号解析：只数音符，休止、横线、小节线、读不出的位置都不占号（与 SOP 一致）。
 // 解析不到的音符记为未知并标待确认：保留原始响应，不猜测邻近音符，也不丢弃有效符号序列。
 const refEventsByRow=new Map(rows.map(r=>[r.rowId,r.notes]));
 const noteId=(rowId,position)=>refEventsByRow.get(rowId)?.[position-1]??null;
 for(const r of rows){
  for(const arc of r.arcs)for(const field of ['start','end']){
   const end=arc[field];if(!end)continue;
   const eventId=noteId(end.rowId,end.position);
   if(!eventId)problem(r.issues,'clipped-connection',arc.id,field,'无效弧线端点 '+end.rowId+' 第 '+end.position+' 个音符');
   arc[field]=eventId?{rowId:end.rowId,eventId}:null;
  }
  r.tuplets=r.tuplets.map(t=>{
   if(t.members===null)return t;
   const members=t.members.map(position=>{const eventId=noteId(r.rowId,position);if(!eventId)problem(r.issues,'clipped-connection',t.id,'members','连音组成员第 '+position+' 个音符无效');return eventId;});
   return {...t,members:members.every(Boolean)?members:null};
  });
  const rest=[];
  for(const {position,...issue} of r.issues){
   if(position===undefined){rest.push(issue);continue;}
   if(position===null){rest.push({...issue,targetId:null});continue;}
   const targetId=noteId(r.rowId,position);
   if(!targetId)problem(rest,'clipped-connection',null,'target','问题目标第 '+position+' 个音符无效');
   rest.push({...issue,targetId});
  }
  r.issues=rest;
 }
 return validateRows({requestId:value.requestId,rows:rows.map(({notes,...row})=>row)},options);
}
