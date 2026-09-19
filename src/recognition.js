import {aiRequest,request as localRequest} from './localApi.js';
import sop from '../AI-RECOGNITION-SOP.md?raw';
import {providerById,describeAiError} from './aiProviders.js';
import {redactText} from './credentials/redact.js';
import {CredentialService} from './credentials/service.js';
import {validateHeader} from './recognitionContract.js';
import {decodeCompactRows} from './compactNotation.js';
import {convertRows} from './recognitionModel.js';
import {measurePageGeometry} from './lib/recognitionGeometry.js';
import {buildAliases,aliasLabel,restoreHeaderResponse,prepareRecognitionRequest,restoreBoundRowsResponse,snapshotAliases} from './lib/shortIds.js';
import {decodeCompactPage} from './pageRecognition.js';
// 提示词文件包含 A/B/C 三个 H2 段落：请求只发送段落正文，H1 标题、文件说明与系统执行方案都不进入提示词。
const section=name=>new RegExp(`\\n## ${name}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`).exec('\n'+sop)?.[1].trim()??'';
const promptA=section('提示词 A：'),promptB=section('提示词 B：'),promptC=section('提示词 C：');
if(!promptA||!promptB||!promptC)throw Error('提示词文件缺少提示词段落');
export const PROMPT_VERSION='2.6-page-short-ids-no-lyrics-2026-09-16';
async function sha(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
// 原始数据归档：每次识别（成功或失败）把请求参数、裁切、每批调用与原始返回交给开发服务器落盘。
// 归档失败不影响识别本身，也不带 abortSignal：用户中途终止时同样要留下已收到的原始返回。
async function sendArchive({image,songId,songTitle,page,firstImage,settings,runId},{status,error,result,task,promptHash,startedAt}){
 try{
  const response=await fetch('/api/recognition-archive',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({status,error,songId,songTitle,page,firstImage,imageId:image.id,image:{id:image.id,name:image.name,src:image.src},request:{provider:settings.provider,model:settings.model,runId,promptVersion:PROMPT_VERSION,promptHash,startedAt,finishedAt:Date.now()},task,result})});
  if(!response.ok)throw Error('识别归档保存失败');return await response.json();
 }catch(e){throw Error('识别归档未保存：'+e.message);}
}
export async function recognizeImage(options){
 const archive={status:'failed',error:null,result:null,task:null,promptHash:null,startedAt:Date.now()};
 try{const result=await transcribe(options,archive);archive.status='ok';archive.result=result;return result;}
 catch(error){archive.error=describeAiError(error);throw error;}
 finally{
  // 归档位置回写进识别记录：从歌曲数据里就能直接找到这次识别的原始数据文件。
  const written=await sendArchive(options,archive);
  if(written?.file&&archive.task&&options.onPartial)await options.onPartial({...archive.task,archive:written}).catch(()=>{});
 }
}
async function transcribe({image,songId,page,firstImage,settings,runId,signal,onProgress=()=>{},onPartial=async()=>{}},archive){
 signal.throwIfAborted();
 const credential=await CredentialService.getCredential(settings.provider,settings.endpoint);
 if(!credential)throw Error('请先在设置中验证并保存该接口的 API 密钥');
 const promptHash=await sha(new TextEncoder().encode(promptA+'\n'+promptB+'\n'+promptC));
 const calls=[];let partial={calls,header:null,batches:[]};archive.task=partial;archive.promptHash=promptHash;
 async function request(kind,images,ids){
  // ids 是本批次的【长 ID】（行 = imageId:row-N，页眉 = imageId）。发给模型的是短引用名：
  // 42 字符 UUID 拼接串逐字符抄回会出错（实测抄错一个字符即整页失败），短名把抄写面降到 2–4 字符。
  // 映射是【页级】的：跨行弧线端点写 [rowId,音符序号]，同一行在不同批次必须是同一个短名。
  signal.throwIfAborted();const requestUuid=crypto.randomUUID(),start=Date.now();
  const {content,context}=prepareRecognitionRequest(aliases,{kind,requestUuid,pageId:image.id,images,ids,includeHeader:firstImage});
  const requestId=context.requestShort;
  syncIds();await onPartial(structuredClone(partial));
  let received='',lastProgress=0,response;
  try{
   // 推理参数按服务商区分（都是实测结论，不是偏好）：
   //   · temperature 只有 qwen/deepseek 接受 0；Moonshot 的 kimi-k3 只接受 1，
   //     传 0 会直接 400 "invalid temperature: only 1 is allowed for this model"，
   //     所以 kimi 不传该字段、用服务端默认值。
   //   · 关掉思考：Qwen 用 enableThinking:false；DeepSeek 用 thinking.type='disabled'
   //     （DeepSeek 开思考时 temperature 会被完全忽略）。
   const providerOptionsByProvider={
    qwen:{alibaba:{enableThinking:false}},
    deepseek:{deepseek:{thinking:{type:'disabled'}}},
   };
   const temperatureByProvider={qwen:0,deepseek:0};
   response=await aiRequest({songId,imageId:image.id,runId,requestId,kind,provider:settings.provider,endpoint:settings.endpoint,model:settings.model,system:kind==='header'?promptA:kind==='page'?promptC:promptB,messages:[{role:'user',content}]},signal,async delta=>{received+=delta;if(Date.now()-lastProgress>10000){lastProgress=Date.now();partial.streamProgress={kind,receivedCharacters:received.length};onProgress(kind==='header'?'正在读取基础信息':'正在转录乐谱');await onPartial(structuredClone(partial))}});
   const parsed=response.output;
   // 模型回传的是短名，翻回长 ID 之后再进契约校验：契约与下游（convertRows/几何索引/音符 ID）全程只见长 ID。
   // 未命中的短名保持原值，由既有分支处理（行位置 → extras/missing；跨行端点 → clipped-connection 置空待确认）。
   if(response.finishReason==='length')throw Error('识别输出被截断，请更换图片或重试');
   const normalized=kind==='header'
    ?validateHeader(restoreHeaderResponse(parsed,aliases),{requestId:requestUuid,headerId:ids[0]})
    :kind==='page'?decodeCompactPage(parsed,aliases,context)
    :decodeCompactRows(restoreBoundRowsResponse(parsed,aliases,context),{requestId:requestUuid,rowIds:ids,aliasLabel:aliasLabel(aliases)});
   const diagnostics=normalized.diagnostics??[];
   if(kind==='rows'&&parsed.requestId!==requestId){
    const diagnostic={code:'requestId-mismatch',received:parsed.requestId??null,expected:requestId};diagnostics.push(diagnostic);
    normalized.rows[0]?.issues.push({code:'requestId-mismatch',targetId:null,field:'requestId',detail:'请求标识抄写不一致，已按发送上下文接收'});
   }
   syncIds();
   calls.push({requestId,requestUuid,kind,model:settings.model,provider:settings.provider,latencyMs:Date.now()-start,usage:response.usage,finishReason:response.finishReason,output:parsed,diagnostics});
   return normalized;
  }catch(error){syncIds();calls.push({requestId,requestUuid,kind,model:settings.model,provider:settings.provider,latencyMs:Date.now()-start,error:describeAiError(error),outputText:redactText(error.text||received),finishReason:response?.finishReason??error.finishReason??null,usage:response?.usage??error.usage??null});await onPartial(structuredClone(partial));if(CredentialService.isAuthError(error))await CredentialService.markAuthError(settings.provider,settings.endpoint);throw Error(describeAiError(error));}
 }
 onProgress('正在裁切乐谱');
 const sourceResponse=await fetch(image.src,{signal});if(!sourceResponse.ok)throw Error('原图读取失败');const bytes=await sourceResponse.arrayBuffer();
 const mime=sourceResponse.headers.get('content-type')?.split(';')[0]||'image/jpeg';let binary='';const data=new Uint8Array(bytes);for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));const original='data:'+mime+';base64,'+btoa(binary);
 const sliced=await fetch('/api/score-slices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:original}),signal});
 const sliceResult=await sliced.json();if(!sliced.ok)throw Error(sliceResult.error||'切片失败');
 const usePage=sliceResult.decision==='page'||!sliceResult.rows?.length;
 const slices=(usePage?[]:sliceResult.rows).map((r,i)=>({...r,id:image.id+':row-'+(i+1)}));
 partial={...partial,cropReliability:sliceResult.reliability??null,cropFrame:sliceResult.frame??null,slices:slices.map(({src,...r})=>r),sourceHash:await sha(bytes),promptHash,promptVersion:PROMPT_VERSION,model:settings.model,provider:settings.provider};
 archive.task=partial;
 await onPartial(structuredClone(partial));
 // 短 ID 映射：页级（不是批次级），因为跨行弧线端点要引用可能不在本批次的其他行。
 // 业务结果使用长 ID；原始响应和映射随归档保存，失败时也能还原短名。
 // 必须挂在 partial（= archive.task）上：归档读的是 archive.task，挂在 archive 上会漏掉。
 const aliases=buildAliases(slices);
 const syncIds=()=>{partial.transientIds=snapshotAliases(aliases);archive.task=partial;};
 if(usePage){
  partial.mode='page';partial.fallbackReason=sliceResult.reason||'no-reliable-rows';onProgress('正在整页识别乐谱');
  const decoded=await request('page',[original],[]);
  partial.pageIssues=decoded.pageIssues;partial.header=decoded.header;partial.batches=[{requestId:decoded.requestId,rows:decoded.rows}];
  const pageSlices=decoded.rows.map(r=>({id:r.rowId,crop:null,sourceMapping:'page'}));
  const rows=convertRows(decoded.rows,pageSlices,{imageId:image.id,songId,page,runId,mode:'page'});
  if(!rows.some(r=>r.notes.some(n=>Number.isInteger(n.degree))))throw Error('整页识别未得到可用音符，请检查图片后重试');
  signal.throwIfAborted();await onPartial(structuredClone(partial));
  return {schemaVersion:'1.0',header:decoded.header,rows,raw:partial,recognitionMode:'page',pageIssues:decoded.pageIssues,reviewStatus:'unreviewed',completedAt:Date.now()};
 }
 partial.mode='rows';
 // 一次性发起：切片完成后页眉与全部行批次同时排队发出，最多 MAX_IN_FLIGHT 个同时在飞。
 // 并发上限的取法（qwen3.8-max 官方只限 RPM/TPM，没有并发维度，且明确会拦"短时间请求激增"）：
 // 页请求数 = 1(页眉) + ceil(行数/3)，实测页行数 1–15 → 最多 6 个请求；取 6 意味着所有见过的
 // 页都是一波发完（真·一次性），只有超长页才排队；再往上收益为零、只增加突发被拦的风险。
 // 完成顺序不定，因此按批次索引回填：入库顺序由 batchResults 决定，仍是页序。
 const MAX_IN_FLIGHT=6,batchSize=3;
 const batches=[];for(let i=0;i<slices.length;i+=batchSize)batches.push(slices.slice(i,i+batchSize));
 let header=null,completed=0;const batchResults=new Array(batches.length);
 const total=batches.length+(firstImage?1:0); const progress=()=>{syncIds();onProgress('识别请求 '+completed+'/'+total);};
 // 并发上限为 1 的服务商（实测 Moonshot）：页眉与行批次必须串行，否则成对 429
 const serialProviders=new Set(['kimi']);
 const headerTask=async()=>{header=await request('header',[original],[image.id]);partial.header=header;completed++;progress();await onPartial(structuredClone(partial));};
 const runBatch=async(batch,index)=>{const response=await request('rows',batch.map(r=>r.src),batch.map(r=>r.id));batchResults[index]=response;partial.batches=batchResults.filter(Boolean);completed++;progress();await onPartial(structuredClone(partial));};
 progress();
 if(serialProviders.has(settings.provider)){if(firstImage)await headerTask();for(let index=0;index<batches.length;index++)await runBatch(batches[index],index);}
 else{
  // 有界并发池：只限制同时在飞的数量，不改变请求内容、批次大小与失败语义。
  const tasks=[...(firstImage?[headerTask]:[]),...batches.map((batch,index)=>()=>runBatch(batch,index))],failures=[];let cursor=0;
  await Promise.all(Array.from({length:Math.min(MAX_IN_FLIGHT,tasks.length)},async()=>{while(cursor<tasks.length){const task=tasks[cursor++];try{await task()}catch(error){failures.push(error)}}}));
  const failed=failures.find(Boolean);if(failed)throw failed;
 }
 const allRows=batches.flatMap((_,index)=>batchResults[index]?.rows??[]);
 signal.throwIfAborted();
 // 只读第一层：切片给的 digitBand 就是该行最上面那条数字带（score_slicer.py 保证 digitBand=digitBands[0]），
 // 因此几何层对每一行都按第一层量，不需要按"是否多排"分流。
 const eventsByRow=new Map(allRows.map(r=>[r.rowId,r.events]));
 const rows=convertRows(allRows,slices,{imageId:image.id,songId,page,runId,geometry:await measurePageGeometry(slices.map(slice=>({id:slice.id,slice:slice.src,crop:slice.crop,digitBand:slice.digitBand,events:eventsByRow.get(slice.id)??[]})))});
 return {schemaVersion:'1.0',header,rows,raw:partial,experimental:{tuplets:allRows.map(r=>({rowId:r.rowId,tuplets:r.tuplets})),lyrics:allRows.map(r=>({rowId:r.rowId,lyrics:r.lyrics}))},reviewStatus:'unreviewed',completedAt:Date.now()};
}
