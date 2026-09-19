import {restorePageResponse,snapshotAliases,aliasLabel} from './lib/shortIds.js';
import {decodeCompactRows} from './compactNotation.js';
import {validateHeader} from './recognitionContract.js';

export function decodeCompactPage(parsed,aliases,context){
 const fields=['requestId','pageId','header','rows','pageIssues'];
 if(!parsed||typeof parsed!=='object'||fields.some(k=>!Object.hasOwn(parsed,k))||Object.keys(parsed).some(k=>!fields.includes(k)))throw Error('整页响应字段不匹配');
 if(!Array.isArray(parsed.pageIssues)||parsed.pageIssues.some(i=>!i||!['unreadable-region','ambiguous-melody','ambiguous-order','no-melody','unreadable-page'].includes(i.code)||typeof i.detail!=='string'||Object.keys(i).some(k=>!['code','detail'].includes(k))))throw Error('整页问题格式不匹配');
 const {value,diagnostics}=restorePageResponse(parsed,aliases,context);
 const rowIds=value.rows.map(r=>r.rowId);
 const decoded=decodeCompactRows({requestId:context.requestUuid,rows:value.rows},{requestId:context.requestUuid,rowIds,aliasLabel:aliasLabel(aliases)});
 let header=null;
 if(context.includeHeader){
  const h=value.header;
  if(!h||Object.keys(h).length!==5||!['title','key','meters','tempo','issues'].every(k=>Object.hasOwn(h,k)))throw Error('整页页眉字段不匹配');
  header=validateHeader({...h,requestId:context.requestUuid,headerId:context.pageId},{requestId:context.requestUuid,headerId:context.pageId});
 }
 return {...decoded,header,pageId:context.pageId,pageIssues:value.pageIssues,diagnostics,transientIds:snapshotAliases(aliases)};
}
