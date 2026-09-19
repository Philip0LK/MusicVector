import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=process.env.YUEBEIDOU_SLICE_SCRIPT||fileURLToPath(new URL('./slice_bridge.py',import.meta.url));
export function sliceMiddleware(){let active=0;
 return async(req,res,next)=>{
  if(req.url!=='/api/score-slices')return next();
  const send=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}};
  if(req.method!=='POST')return send(405,{error:'仅支持 POST'});
  if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return send(403,{error:'来源不匹配'});
  if(active>=2)return send(429,{error:'切片任务繁忙，请稍后重试'});
  let body='';try{for await(const chunk of req){body+=chunk;if(body.length>23*1024*1024)return send(413,{error:'图片超过上传限制'});}const input=JSON.parse(body);if(!/^data:image\/(png|jpeg);base64,/.test(input.image))throw Error();}catch{return send(400,{error:'图片格式无效'});}
  active++;const child=spawn(process.env.YUEBEIDOU_PYTHON||'python',[script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',done=false;
  const finish=(code,data)=>{if(done)return;done=true;clearTimeout(timer);active--;send(code,data);};
  const timer=setTimeout(()=>{child.kill();finish(504,{error:'切片超时'});},60000);
  res.on('close',()=>{if(!done)child.kill();});
  child.stdout.on('data',d=>{output+=d;if(output.length>35*1024*1024){child.kill();finish(413,{error:'切片输出过大'});}});
  child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
  child.on('error',()=>finish(503,{error:'本地切片服务无法启动，请检查 Python、OpenCV 和 Pillow'}));
  child.on('close',code=>{try{const value=JSON.parse(output);finish(code===0?200:422,value);}catch{finish(500,{error:'本地切片服务异常'});}});
  child.stdin.end(body);
 };
}
export function scoreSlicesPlugin(){return {name:'score-slices',configureServer(server){server.middlewares.use(sliceMiddleware());},configurePreviewServer(server){server.middlewares.use(sliceMiddleware());}};}
