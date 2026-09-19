// 敏感信息过滤器：任何可能落到日志、错误提示或上报的文本，都先过这里。
export const REDACTED='[已隐藏]';
// 键名统一去掉分隔符再比对，authorization / Authorization / x-api-key / x_api_key / apiKey 都能命中。
const normalizeKey=key=>String(key??'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const SENSITIVE_KEYS=new Set(['authorization','proxyauthorization','xapikey','apikey','xgoogapikey','xauthtoken','cookie','setcookie','secret','clientsecret','token','accesstoken','refreshtoken','idtoken','password','passwd','bearer','credential','encryptedapikey','cryptokey','apikeyencrypted'].map(normalizeKey));
export const isSensitiveKey=key=>SENSITIVE_KEYS.has(normalizeKey(key));
const MAX_DEPTH=4,MAX_ENTRIES=60;
const PATTERNS=[
 [/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/=]{4,}/gi,(_match,scheme)=>scheme+' '+REDACTED],
 [/\bsk-[A-Za-z0-9\-_]{4,}/g,()=>REDACTED],
 [/(authorization|api[_-]?key|x-api-key|token|secret|password)(\s*[:=]\s*)("?)([^"',\s}]*)(\3)/gi,(_match,name,separator,quote)=>name+separator+quote+REDACTED+quote]
];
export function redactText(value){
 let text=String(value??'');
 for(const [pattern,replace] of PATTERNS)text=text.replace(pattern,replace);
 return text;
}
export function redact(value,depth=0){
 if(value==null)return value;
 if(typeof value==='string')return redactText(value);
 if(typeof value==='number'||typeof value==='boolean')return value;
 if(depth>=MAX_DEPTH)return '[层级过深]';
 if(typeof value!=='object')return value;
 if(value.constructor?.name==='CryptoKey')return '[密钥句柄]';
 if(value instanceof Date)return value.toISOString();
 if(value instanceof ArrayBuffer||ArrayBuffer.isView(value))return '[二进制]';
 if(Array.isArray(value))return value.slice(0,MAX_ENTRIES).map(item=>redact(item,depth+1));
 const result={};
 let count=0;
 for(const [key,item] of Object.entries(value)){
  if(++count>MAX_ENTRIES){result['…']='[已截断]';break}
  result[key]=isSensitiveKey(key)?REDACTED:redact(item,depth+1);
 }
 return result;
}
