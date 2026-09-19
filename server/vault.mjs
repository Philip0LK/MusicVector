import {spawn} from 'node:child_process';
import path from 'node:path';
import {atomic,json,hash} from './dataStore.mjs';
export class Vault{
 constructor(root,python,helper){this.root=root;this.python=python;this.helper=helper}
 identity(provider,url){return hash(provider+'\n'+String(url).replace(/\/$/,''))}
 file(provider,url){return path.join(this.root,this.identity(provider,url)+'.json')}
 async protect(op,value){return new Promise((resolve,reject)=>{const c=spawn(this.python,[this.helper],{windowsHide:true,stdio:['pipe','pipe','pipe']});let text='';c.stdout.on('data',d=>text+=d);c.stderr.on('data',()=>{});c.on('error',()=>reject(Error('凭据保护服务无法启动')));c.on('close',()=>{try{const v=JSON.parse(text);if(v.error)reject(Error(v.error));else resolve(v.value)}catch{reject(Error('凭据保护失败'))}});c.stdin.end(JSON.stringify({op,value}))})}
 async get(provider,baseURL){const r=await json(this.file(provider,baseURL),null);if(!r)return null;return {...r,apiKey:await this.protect('unprotect',r.encrypted)}}
 async describe(provider,baseURL){const r=await json(this.file(provider,baseURL),null);if(!r)return null;const {encrypted,...metadata}=r;return metadata}
 async save(provider,baseURL,apiKey){const encrypted=await this.protect('protect',apiKey);const r={provider,baseURL,encrypted,masked:'••••••••'+(apiKey.length>=8?apiKey.slice(-4):''),status:'verified',createdAt:Date.now(),lastVerifiedAt:Date.now()};await atomic(this.file(provider,baseURL),r);return this.describe(provider,baseURL)}
}

