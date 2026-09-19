// 识别原始数据归档：开发服务器把每次 AI 识别的原始请求/返回写到仓库根目录 recognition-raw/。
// 文件名与文件内容都带标识：歌曲（标题＋ID 前缀）、页序、图片 ID、成功/失败、时间、运行 ID。
import {mkdir,writeFile,appendFile,access,readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
export const ARCHIVE_ENDPOINT='/api/recognition-archive';
const LIMIT=8*1024*1024;
const MIME_EXT={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
const pad=(n,width=2)=>String(n).padStart(width,'0');
export const safeSegment=(text,max=24)=>{const clean=String(text??'').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'-').replace(/\s+/g,'-').replace(/^[-.]+|[-.]+$/g,'');return clean.slice(0,max)||'untitled';};
export function archiveStamp(value){const date=new Date(value??Date.now());return {day:`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`,time:`${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`};}
export function archiveRecordPath(payload){
 const {day,time}=archiveStamp(payload.startedAt??payload.request?.startedAt);
 const parts=['p'+(Number.isInteger(payload.page)?pad(payload.page+1):'x'),safeSegment(payload.songTitle),safeSegment(payload.songId,8),safeSegment(payload.imageId,8),payload.status==='ok'?'ok':'failed',time+'-'+safeSegment(payload.runId??payload.request?.runId,8)];
 return {day,name:parts.join('__')+'.json'};
}
const asPosix=value=>value.split(path.sep).join('/');
async function uniquePath(dir,name){let target=path.join(dir,name);for(let n=2;n<100;n++){try{await access(target);target=path.join(dir,name.replace(/\.json$/,'-'+n+'.json'));}catch{break;}}return target;}
async function writeImage(root,image){
 const src=typeof image?.src==='string'?image.src:'';
 const match=/^data:([^;]+);base64,(.*)$/s.exec(src);
 if(!match)return null;
 const bytes=Buffer.from(match[2],'base64'),hash=createHash('sha256').update(bytes).digest('hex');
 const relative=path.join('images',hash.slice(0,16)+'.'+(MIME_EXT[match[1]]??'bin')),file=path.join(root,relative);
 try{await access(file);}catch{await writeFile(file,bytes);}
 return {relative:asPosix(relative),hash,byteLength:bytes.length};
}
const README=`# AI 识别原始数据归档\n\n每次 AI 识别（含失败）由开发服务器写入本目录，浏览器内的 IndexedDB 仍是产品数据源，本目录只是原始留档。\n\n- index.jsonl：每次识别一行摘要，按歌曲/页/状态即可定位；丢了用 npm run archive:reindex 重建。\n- <日期>/：单次识别的完整记录。\n- images/：上传原图，按内容 SHA-256 去重，记录内以 sourceFile 引用。\n\n文件名：p<页序>__<歌名>__<歌曲ID前8>__<图片ID前8>__<ok|failed>__<时分秒>-<运行ID前8>.json。\n\n记录字段：song{id,title}、page（0 起）、firstImage、image{id,name,sourceFile,sourceHash,byteLength}、request{provider,model,promptVersion,promptHash,runId,startedAt,finishedAt}、task（识别原始过程：slices 裁切、calls 每次调用及原始返回/用量/错误、batches 已解析批次、header、streamProgress）、result（成功时的解析结果，其中 raw 与 task 内容相同）。origin 区分实时（live）与回填（backfill）。\n`;
async function ensureReadme(root){const file=path.join(root,'README.md');try{await access(file);}catch{await writeFile(file,README,'utf8');}}
const indexLine=(root,file,record)=>JSON.stringify({at:record.recordedAt,origin:record.origin,status:record.status,song:record.song.title,songId:record.song.id,page:record.page,image:record.image.name,provider:record.request.provider,model:record.request.model,promptVersion:record.request.promptVersion,rows:record.result?.rows?.length??0,error:record.error,file:asPosix(path.relative(root,file))})+'\n';
export async function rebuildIndex(root){
 const entries=[];
 for(const item of await readdir(root,{withFileTypes:true}).catch(()=>[])){
  if(!item.isDirectory()||item.name==='images')continue;
  for(const name of await readdir(path.join(root,item.name))){if(!name.endsWith('.json'))continue;const file=path.join(root,item.name,name);entries.push({file,record:JSON.parse(await readFile(file,'utf8'))});}
 }
 entries.sort((a,b)=>String(a.record.recordedAt).localeCompare(String(b.record.recordedAt)));
 await mkdir(path.join(root,'images'),{recursive:true});
 await ensureReadme(root);
 await writeFile(path.join(root,'index.jsonl'),entries.map(({file,record})=>indexLine(root,file,record)).join(''),'utf8');
 return {records:entries.length,index:asPosix(path.join(root,'index.jsonl'))};
}
export async function writeArchive(root,payload){
 const {day,name}=archiveRecordPath(payload);
 await mkdir(path.join(root,'images'),{recursive:true});
 await mkdir(path.join(root,day),{recursive:true});
 await ensureReadme(root);
 const image=await writeImage(root,payload.image);
 const file=await uniquePath(path.join(root,day),name);
 const record={archiveVersion:1,origin:payload.origin==='backfill'?'backfill':'live',recordedAt:new Date().toISOString(),status:payload.status==='ok'?'ok':'failed',error:payload.error??null,
  song:{id:payload.songId??null,title:payload.songTitle??null},page:Number.isInteger(payload.page)?payload.page:null,firstImage:!!payload.firstImage,
  request:{provider:payload.request?.provider??null,model:payload.request?.model??null,promptVersion:payload.request?.promptVersion??null,promptHash:payload.request?.promptHash??null,runId:payload.request?.runId??null,startedAt:payload.request?.startedAt??null,finishedAt:payload.request?.finishedAt??null},
  image:{id:payload.image?.id??payload.imageId??null,name:payload.image?.name??null,sourceFile:image?.relative??null,sourceHash:image?.hash??null,byteLength:image?.byteLength??null,source:image?null:(payload.image?.src??null)},
  task:payload.task??null,result:payload.result??null};
 await writeFile(file,JSON.stringify(record,null,2),'utf8');
 const relative=asPosix(path.relative(root,file));
 await appendFile(path.join(root,'index.jsonl'),indexLine(root,file,record),'utf8');
 return {file:relative,image:image?.relative??null};
}
export function recognitionArchiveMiddleware({root}){
 return async(req,res,next)=>{
  const route=req.url?.split('?')[0];
  if(route!==ARCHIVE_ENDPOINT)return next();
  if(req.method!=='POST'){res.writeHead(405);res.end();return;}
  if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host){res.writeHead(403);res.end();return;}
  let body='';
  for await(const chunk of req){body+=chunk;if(body.length>LIMIT){res.writeHead(413);res.end();return;}}
  try{const written=await writeArchive(root,JSON.parse(body.replace(/^\uFEFF/,'')));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(written));}
  catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(error?.message||error)}));}
 };
}
