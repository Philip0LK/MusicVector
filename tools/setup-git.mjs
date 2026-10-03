import {git} from './security.mjs';
git(['config','--local','core.hooksPath','.githooks']);
console.log('已启用提交与推送前的本机密钥检查。');
