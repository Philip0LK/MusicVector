import {request} from '../localApi.js';
export const normalizeBaseURL=url=>String(url||'').trim().replace(/\/$/,'');
export const maskApiKey=value=>'••••••••'+(String(value).length>=8?String(value).slice(-4):'');
export const isAuthError=e=>e?.statusCode===401||e?.statusCode===403;
const describeCredential=(provider,baseURL)=>request('/api/credentials/describe',{method:'POST',value:{provider,baseURL:normalizeBaseURL(baseURL)}});
const saveCredential=({provider,baseURL})=>describeCredential(provider,baseURL);
const deleteCredential=(provider,baseURL)=>request('/api/credentials/delete',{method:'POST',value:{provider,baseURL:normalizeBaseURL(baseURL)}});
export const CredentialService={describeCredential,saveCredential,deleteCredential,getCredential:describeCredential,hasCredential:async(p,u)=>!!await describeCredential(p,u),markVerified:describeCredential,markAuthError:describeCredential,isAuthError,maskApiKey,normalizeBaseURL};

