import {redactText} from '../src/credentials/redact.js';
// 统一 AI 接入：用 AI SDK 一套接口对接 Kimi / GLM / DeepSeek / Qwen。
// SDK 只在点击“验证连接”时按需加载，训练主流程不产生任何 AI 请求。
export const PROVIDERS=[
 {id:'kimi',label:'Kimi（月之暗面）',endpoint:'https://api.moonshot.cn/v1',
  models:['kimi-k3','kimi-k2.7-code','kimi-k2.7-code-highspeed','kimi-k2.6'],
  async create({apiKey,baseURL}){const {createMoonshotAI}=await import('@ai-sdk/moonshotai');return createMoonshotAI({apiKey,baseURL})}},
 {id:'glm',label:'GLM（智谱）',endpoint:'https://open.bigmodel.cn/api/paas/v4',
  models:['glm-5.3','glm-5.3-flash','glm-5.2','glm-4.7'],
  async create({apiKey,baseURL}){const {createOpenAICompatible}=await import('@ai-sdk/openai-compatible');return createOpenAICompatible({name:'zhipu',apiKey,baseURL})}},
 {id:'deepseek',label:'DeepSeek',endpoint:'https://api.deepseek.com',
  models:['deepseek-flash','deepseek-v4-pro'],
  async create({apiKey,baseURL}){const {createDeepSeek}=await import('@ai-sdk/deepseek');return createDeepSeek({apiKey,baseURL})}},
 {id:'qwen',label:'Qwen（通义千问）',endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1',
  models:['qwen3.8-max','qwen3.8-flash','qwen3.7-plus','qwen3-max'],
  async create({apiKey,baseURL}){const {createAlibaba}=await import('@ai-sdk/alibaba');return createAlibaba({apiKey,baseURL})}}
];
const FALLBACK=PROVIDERS[0];
export const providerById=id=>PROVIDERS.find(p=>p.id===id)||FALLBACK;
export const defaultAiSettings=()=>({provider:FALLBACK.id,endpoint:FALLBACK.endpoint,model:FALLBACK.models[0]});
// 未记录服务商的旧配置（早期只存接口地址与模型名）整体回到默认，避免服务商与地址错配。
export function normalizeAiSettings(saved){
 if(!saved||!PROVIDERS.some(p=>p.id===saved.provider))return defaultAiSettings();
 const provider=providerById(saved.provider);
 return {provider:provider.id,endpoint:String(saved.endpoint||'').trim()||provider.endpoint,model:String(saved.model||'').trim()||provider.models[0]};
}
export const VERIFY_PROMPT='只回复两个字：正常。';
export const VERIFY_TIMEOUT=30000;
export async function verifyConnection({provider,endpoint,model,apiKey,timeout=VERIFY_TIMEOUT}){
 const {generateText}=await import('ai');
 const instance=await providerById(provider).create({apiKey,baseURL:endpoint});
 const started=Date.now();
 // 256 而非 64：deepseek-v4-pro 这类默认开启思考的模型，需要给推理留出额度才能给出正式回答。
 const {text}=await generateText({model:instance(model),prompt:VERIFY_PROMPT,maxOutputTokens:256,maxRetries:0,timeout});
 return {reply:String(text||'').trim(),latencyMs:Date.now()-started};
}
const STATUS_HINT={400:'请求被拒绝，请检查接口地址与模型名称',401:'API 密钥无效或已过期',403:'账号无权访问该模型',404:'接口地址或模型名称不存在',422:'请求参数不被接受',429:'请求过于频繁或额度不足'};
function providerMessage(error){
 const body=error?.responseBody;if(body==null)return '';
 try{const parsed=typeof body==='string'?JSON.parse(body):body;const message=parsed?.error?.message||parsed?.message||parsed?.error?.type;return typeof message==='string'?message.slice(0,160):''}catch{return String(body).slice(0,160)}
}
export function describeAiError(error){
 const status=typeof error?.statusCode==='number'?error.statusCode:undefined,detail=providerMessage(error);
 if(status)return redactText(status+' · '+(STATUS_HINT[status]||(status>=500?'服务端错误，请稍后重试':'服务返回错误'))+(detail?'（'+detail+'）':''));
 if(error?.name==='AI_LoadAPIKeyError')return '缺少 API 密钥';
 if(error?.name==='AI_NoSuchModelError')return '模型名称不存在';
 if(error?.name==='AbortError'||error?.name==='TimeoutError')return '请求超时，请检查网络后重试';
 if(error instanceof TypeError)return '网络请求失败，请检查网络是否可达';
 return redactText(error?.message||'未知错误');
}

