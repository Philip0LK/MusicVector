import test from 'node:test';
import assert from 'node:assert/strict';
import {PROVIDERS,providerById,defaultAiSettings,normalizeAiSettings,describeAiError} from '../src/aiProviders.js';

test('首批接入四家服务商，均为 https 且给出最新模型',()=>{
 assert.deepEqual(PROVIDERS.map(p=>p.id),['kimi','glm','deepseek','qwen']);
 for(const provider of PROVIDERS){
  assert.match(provider.endpoint,/^https:\/\/[^\s]+$/);
  assert.ok(provider.label);
  assert.ok(provider.models.length>=2,provider.id+' 至少给出两个模型');
  assert.equal(new Set(provider.models).size,provider.models.length);
 }
});

test('未记录服务商的旧配置回到默认，避免服务商与地址错配',()=>{
 assert.deepEqual(normalizeAiSettings(undefined),defaultAiSettings());
 assert.deepEqual(normalizeAiSettings({endpoint:'https://example.invalid/v1',model:'vision-demo'}),defaultAiSettings());
 assert.deepEqual(normalizeAiSettings({provider:'anthropic'}),defaultAiSettings());
});

test('DeepSeek 默认用官方现行的 deepseek-flash，退役别名不再出现在选项里',()=>{
 const deepseek=providerById('deepseek');
 assert.equal(deepseek.models[0],'deepseek-flash');
 assert.ok(!deepseek.models.includes('deepseek-v4-flash'),'deepseek-v4-flash 已被官方标记为退役别名');
 assert.ok(!deepseek.models.includes('deepseek-v4-flash-vision-exp'),'vision-exp 是同一批退役别名');
});

test('已知服务商保留用户改过的接口地址与模型',()=>{
 assert.deepEqual(normalizeAiSettings({provider:'glm',endpoint:' https://example.com/v4 ',model:' glm-5.3 '}),{provider:'glm',endpoint:'https://example.com/v4',model:'glm-5.3'});
 assert.deepEqual(normalizeAiSettings({provider:'qwen'}),{provider:'qwen',endpoint:providerById('qwen').endpoint,model:providerById('qwen').models[0]});
});

test('四家都通过 AI SDK 构造出可调用的语言模型',async()=>{
 for(const provider of PROVIDERS){
  const {providerById:serverProvider}=await import('../server/providers.mjs');const instance=await serverProvider(provider.id).create({apiKey:'test-key',baseURL:provider.endpoint});
  for(const id of provider.models){
   const model=instance(id);
   assert.equal(model.modelId,id,provider.id+' → '+id);
   assert.equal(model.specificationVersion,'v4');
  }
 }
});

test('错误信息按状态码给出可读提示，并带上服务端原文',()=>{
 const api=Object.assign(new Error('bad request'),{name:'AI_APICallError',statusCode:401,responseBody:JSON.stringify({error:{message:'Invalid Authentication'}})});
 assert.match(describeAiError(api),/^401 · API 密钥无效或已过期/);
 assert.match(describeAiError(api),/Invalid Authentication/);
 assert.match(describeAiError(Object.assign(new Error('x'),{statusCode:503,responseBody:''})),/^503 · 服务端错误/);
 assert.match(describeAiError(Object.assign(new Error('x'),{name:'AI_LoadAPIKeyError'})),/缺少 API 密钥/);
 assert.match(describeAiError(new TypeError('Failed to fetch')),/网络请求失败/);
 assert.match(describeAiError(Object.assign(new Error('x'),{name:'TimeoutError'})),/请求超时/);
});

test('服务端把密钥回显在错误里也不会被带出去',()=>{
 const error=Object.assign(new Error('boom'),{statusCode:401,responseBody:JSON.stringify({error:{message:'Invalid key sk-leaked-12345678'}})});
 const text=describeAiError(error);
 assert.match(text,/^401/);
 assert.ok(!text.includes('sk-leaked-12345678'),text);
});
