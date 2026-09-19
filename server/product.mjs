import net from 'node:net';
import {startUsbPhone} from './phoneStartup.mjs';
import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';import {randomBytes} from 'node:crypto';
import {DataStore,atomic,json,safeId} from './dataStore.mjs';import {Vault} from './vault.mjs';import {sliceMiddleware} from './scoreSlices.mjs';import {createHandoffHandler,privateAddresses} from './handoff.mjs';import {providerById,verifyConnection,describeAiError} from './providers.mjs';import {streamText,Output} from 'ai';
async function main(){
const appRoot=path.resolve(process.env.YUEBEIDOU_APP_ROOT||fileURLToPath(new URL('..',import.meta.url)));
const arg=n=>{const i=process.argv.indexOf(n);return i<0?null:process.argv[i+1]};
const home=path.resolve(arg('--home')||appRoot),dataRoot=path.resolve(process.env.YUEBEIDOU_DATA||path.join(home,'data'));
const python=process.env.YUEBEIDOU_PYTHON||path.join(home,'runtime/python/python.exe');
process.env.YUEBEIDOU_PYTHON=python;process.env.YUEBEIDOU_SLICE_SCRIPT=path.join(appRoot,'server/slice_bridge.py');
const store=new DataStore(dataRoot);await fs.mkdir(dataRoot,{recursive:true});
const instanceFile=path.join(dataRoot,'.instance.json'),lockFile=path.join(dataRoot,'.lock');
const openBrowser=url=>{if(process.env.YUEBEIDOU_NO_OPEN==='1')return;spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,detached:true,stdio:'ignore'}).unref()};
const previous=await json(instanceFile,null);
if(previous){try{const r=await fetch(previous.url+'/api/health',{headers:{'x-yuebeidou-token':previous.token},signal:AbortSignal.timeout(1500)});const v=await r.json();if(v.instance===previous.token){if(process.argv.includes('--stop')){const stopped=await fetch(previous.url+'/api/shutdown',{method:'POST',headers:{'x-yuebeidou-token':previous.token}});const result=await stopped.json();if(!stopped.ok){console.error(result.error);process.exitCode=1;return}}else openBrowser(previous.url+'/?launch='+previous.token);return}}catch{}}
if(process.argv.includes('--stop')){console.log('乐北斗尚未运行');return}
try{const old=await json(lockFile,null);if(old?.pid){try{process.kill(old.pid,0);throw Error('乐北斗正在启动，请稍后再试')}catch(e){if(e.code!=='ESRCH')throw e}await fs.unlink(lockFile)}const f=await fs.open(lockFile,'wx');await f.writeFile(JSON.stringify({pid:process.pid}));await f.close()}catch(e){console.error(e.message);process.exitCode=1;return}
await store.init();
const token=randomBytes(32).toString('hex'),vault=new Vault(path.join(home,'private/credentials'),python,path.join(appRoot,'server/dpapi.py'));
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
const body=async req=>{let n=0;const parts=[];for await(const x of req){n+=x.length;if(n>512*1024*1024)throw Object.assign(Error('请求数据过大'),{status:413});parts.push(x)}return JSON.parse(Buffer.concat(parts).toString()||'{}')};
const local=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ogg':'audio/ogg','.webp':'image/webp'};
const slice=sliceMiddleware();let localPort,phonePort;
const handoff=createHandoffHandler({lanBound:true});let busy=0;
const staticRoot=await fs.access(path.join(appRoot,'dist/index.html')).then(()=>path.join(appRoot,'dist')).catch(()=>path.join(appRoot,'public'));
async function file(res,root,rel){const target=path.resolve(root,rel);if(!target.startsWith(path.resolve(root)+path.sep))throw Object.assign(Error('路径无效'),{status:403});const bytes=await fs.readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes)}
async function route(req,res){
 const url=new URL(req.url,'http://127.0.0.1');
 if(!local(req))return send(res,403,{error:'仅允许本机访问'});
 if(!['127.0.0.1:'+localPort,'localhost:'+localPort].includes(req.headers.host))return send(res,403,{error:'来源无效'});
 if(url.searchParams.get('launch')===token){res.writeHead(303,{'Set-Cookie':'yuebeidou_'+localPort+'='+token+'; HttpOnly; SameSite=Strict; Path=/','Location':'/','Cache-Control':'no-store'});return res.end()}
 const authorized=req.headers['x-yuebeidou-token']===token||String(req.headers.cookie||'').split(';').some(s=>s.trim()==='yuebeidou_'+localPort+'='+token);
 if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/')||url.pathname.startsWith('/handoff')){
 if(!authorized)return send(res,401,{error:'请通过启动命令打开乐北斗'});
 if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host)return send(res,403,{error:'来源不匹配'});
 if(url.pathname==='/api/health')return send(res,200,{name:'乐北斗',instance:token});
 if(url.pathname==='/api/shutdown'&&req.method==='POST'){if(busy)return send(res,409,{error:'正在识别，请先终止或等待完成'});await store.queue;send(res,200,{stopped:true});return setTimeout(shutdown,100)}
 if(url.pathname==='/api/library'){if(req.method==='GET')return send(res,200,await store.state());if(req.method==='PUT'){const v=await body(req);return send(res,200,await store.save(v.value,v.revision))}}
 if(url.pathname==='/api/practice'||url.pathname.startsWith('/api/drafts/')){const rel=url.pathname==='/api/practice'?'practice.json':'songs/'+safeId(decodeURIComponent(url.pathname.slice(12)))+'/draft.json';if(req.method==='GET')return send(res,200,await store.readDocument(rel));if(req.method==='PUT'){const v=await body(req);return send(res,200,await store.writeDocument(rel,v.value,v.revision))}}
 if(url.pathname.startsWith('/media/'))return file(res,dataRoot,decodeURIComponent(url.pathname.slice(7)));
 if(url.pathname==='/api/recognition-archive'&&req.method==='POST'){const v=await body(req);return send(res,200,await store.archive(v.songId,v))}
 if(url.pathname==='/api/score-slices')return slice(req,res,()=>send(res,404,{error:'接口不存在'}));
 if(url.pathname==='/api/credentials/describe'&&req.method==='POST'){const v=await body(req);return send(res,200,await vault.describe(v.provider,v.baseURL))}
 if(url.pathname==='/api/credentials/delete'&&req.method==='POST'){const v=await body(req);await fs.rm(vault.file(v.provider,v.baseURL),{force:true});return send(res,200,{deleted:true})}
 if(url.pathname==='/api/credentials/verify'&&req.method==='POST'){const v=await body(req);const key=v.apiKey||(await vault.get(v.provider,v.endpoint))?.apiKey;if(!key)throw Error('请先填写 API 密钥');busy++;try{const result=await verifyConnection({...v,apiKey:key});await vault.save(v.provider,v.endpoint,key);return send(res,200,result)}catch(error){throw Error(describeAiError(error).replaceAll(key,'[REDACTED]'))}finally{busy--}}
 if(url.pathname==='/api/ai/request'&&req.method==='POST'){
 const v=await body(req);safeId(v.songId);const credential=await vault.get(v.provider,v.endpoint);if(!credential)throw Error('请先在设置中验证并保存 API 密钥');
 busy++;const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort()});let received='',record={songId:v.songId,imageId:v.imageId,runId:v.runId,requestId:v.requestId,kind:v.kind,provider:v.provider,model:v.model,startedAt:Date.now()},ended=false;
 const archive=await store.archive(v.songId,{...record,status:'running',input:{system:v.system,messages:v.messages}}).catch(e=>{busy--;throw e});
 res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store'});
 const emit=value=>{if(!res.destroyed)res.write(JSON.stringify(value)+'\n')};
 try{const instance=await providerById(v.provider).create({apiKey:credential.apiKey,baseURL:v.endpoint});let streamError;const generation=streamText({onError:({error})=>{streamError=error},output:Output.json(),model:instance(v.model),system:v.system,messages:v.messages,maxOutputTokens:20000,maxRetries:0,timeout:600000,abortSignal:controller.signal,...(['qwen','deepseek'].includes(v.provider)?{temperature:0}:{}),providerOptions:v.provider==='qwen'?{alibaba:{enableThinking:false}}:v.provider==='deepseek'?{deepseek:{thinking:{type:'disabled'}}}:undefined});
 for await(const delta of generation.textStream){received+=delta;emit({delta})}if(streamError)throw streamError;
 const clean=value=>typeof value==='string'?value.replaceAll(credential.apiKey,'[REDACTED]'):Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v)])):value;const result=clean({output:await generation.output,usage:await generation.usage,finishReason:await generation.finishReason});
 await store.archive(v.songId,{...record,status:'ok',finishedAt:Date.now(),input:{system:v.system,messages:v.messages},...result},archive.file);ended=true;emit({result});
 }catch(e){const error=describeAiError(e).replaceAll(credential.apiKey,'[REDACTED]');try{await store.archive(v.songId,{...record,status:'failed',error,outputText:received.replaceAll(credential.apiKey,'[REDACTED]'),finishedAt:Date.now()},archive.file)}catch{emit({error:'识别记录保存失败，请检查本地数据目录'})}emit({error,statusCode:e.statusCode});}finally{busy--;res.end()}return;
 }
 if(url.pathname==='/handoff/info')return send(res,200,{addresses:privateAddresses(),preferred:privateAddresses()[0]?.address||null,port:phonePort,lanBound:true});
 if(url.pathname.startsWith('/handoff')){const original=req.headers.host;req.headers.host='127.0.0.1:'+phonePort;const origin=req.headers.origin;if(origin)req.headers.origin='http://'+req.headers.host;try{if(await handoff(req,res))return}finally{req.headers.host=original;if(origin)req.headers.origin=origin}}
 return send(res,404,{error:'接口不存在'});
 }
 if(req.method!=='GET')return send(res,405,{error:'请求方式无效'});
 return file(res,staticRoot,url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1)));
}
const server=http.createServer((req,res)=>route(req,res).catch(e=>{if(!res.headersSent)send(res,e.status|| (e.code==='ENOENT'?404:500),{error:e.code==='ENOENT'?'文件不存在':describeAiError(e)});else res.end()}));
const phone=http.createServer(async(req,res)=>{try{if(req.method!=='GET'||!/^\/handoff\/[a-f0-9-]+\/(manifest\.json|images\/\d+\.[a-z]+)$/.test(req.url.split('?')[0]))return send(res,403,{error:'仅开放临时曲目接收'});if(!await handoff(req,res))send(res,404,{error:'不存在'})}catch{send(res,500,{error:'接收失败'})}});
const occupied=port=>new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});let done=false;const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value)};socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.setTimeout(300,()=>finish(true))});
// EADDRINUSE 是端口被别的程序占用，EACCES 是端口落在 Windows 保留段里——两种都往后换。
async function listen(server,first,host){for(let port=first;port<65535;port++){if(await occupied(port))continue;try{return await new Promise((resolve,reject)=>{const fail=e=>{server.removeListener('listening',ready);reject(e)},ready=()=>{server.removeListener('error',fail);resolve(server.address().port)};server.once('error',fail);server.once('listening',ready);server.listen({port,host,exclusive:true})})}catch(e){if(e.code!=='EADDRINUSE'&&e.code!=='EACCES')throw e}}throw Error('没有可用端口')}

localPort=await listen(server,Number(process.env.YUEBEIDOU_PORT)||4176,'127.0.0.1');phonePort=await listen(phone,localPort+1,'0.0.0.0');
const url='http://127.0.0.1:'+localPort;await atomic(instanceFile,{pid:process.pid,url,phonePort,token,home});console.log('乐北斗已启动：'+url+'，数据目录：'+dataRoot);openBrowser(url+'/?launch='+token);if(process.env.YUEBEIDOU_NO_USB!=='1')void startUsbPhone(home,phonePort);
let closing=false;async function shutdown(){if(closing)return;closing=true;await store.queue;await fs.rm(instanceFile,{force:true});await fs.rm(lockFile,{force:true});const stopped=Promise.all([new Promise(r=>server.close(r)),new Promise(r=>phone.close(r))]);server.closeAllConnections();phone.closeAllConnections();await stopped}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);


}
main().catch(error=>{console.error(error.message);process.exitCode=1});
