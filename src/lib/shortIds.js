// 短 ID 映射：发给模型的引用名用 2–4 字符短名，系统内部一律保持长 ID。
//
// 背景与依据见 docs/短ID映射方案-2026-09-15.md 与 AI-RECOGNITION-PIPELINE.md 第 3 节：
//   · 原先发给模型的是 42 字符的 `<imageId>:row-N`，模型要逐字符抄回，抄错一个字符即整页失败；
//   · 短名只用前缀 + 页内序号：页眉 h1、请求 q1、行 r1…rN。
//   · 行短名必须是【页级】而不是批次级：跨行弧线端点写成 [rowId, 音符序号]，
//     同一行在不同批次里若是不同短名，跨批引用就对不上。
//
// 三条不可动摇的性质：
//   1. 双射：长↔短一一对应，任一方向都不允许一个名字对出两个；
//   2. 业务身份只用长 ID；短名及映射允许随原始响应归档以便复盘；
//   3. 未命中一律保持原值，交给既有契约判断（不在这里猜、不在这里硬失败）。

// 行短名容量：r1…r999。上限来自既有编码 originalRow = page*10000 + line（每页行号 < 10000），
// 而切片器 35MB/60s 与行批次 20000 token 的预算把实际值压到几十行，999 有 30× 以上余量。
export const MAX_ROWS_PER_PAGE = 999;

const rowShort = (index1) => 'r' + index1;
const indexOfShort = (shortId) => {
  const match = /^r([1-9]\d{0,2})$/.exec(String(shortId ?? ''));
  return match ? Number(match[1]) : null;
};

/**
 * 由本页切片生成短 ID 映射。切片顺序即页内行序，调用方保证同一次识别内不变。
 * @param {Array<{id:string}>} slices 本页切片（按行序）
 * @param {{requestPrefix?:string}} [options] requestPrefix 为请求短名前缀，默认 'q'
 */
export function buildAliases(slices, options = {}) {
  const list = Array.isArray(slices) ? slices : [];
  if (list.length > MAX_ROWS_PER_PAGE) {
    throw Error(`单页行数 ${list.length} 超出短 ID 容量 ${MAX_ROWS_PER_PAGE}，请拆分图片后重试`);
  }
  const rows = new Map();
  const reverse = new Map();
  list.forEach((slice, index) => {
    if (!slice || typeof slice.id !== 'string' || !slice.id) throw Error('切片缺少 id，无法建立短 ID 映射');
    const short = rowShort(index + 1);
    if (rows.has(short)) throw Error('短 ID 重复生成：' + short);
    if (reverse.has(slice.id)) throw Error('切片 id 重复：' + slice.id);
    rows.set(short, slice.id);
    reverse.set(slice.id, short);
  });
  return {
    rows,
    reverse,
    header: new Map(),
    pages: new Map(),
    requests: new Map(),
    requestSeq: 0,
    requestPrefix: options.requestPrefix ?? 'q',
  };
}

/** 长 rowId → 短名；未命中返回 null（不回退、不猜测）。 */
export const aliasForRow = (aliases, longId) => aliases?.reverse?.get(longId) ?? null;

/** 短名 → 长 rowId；未命中返回 null。 */
export const resolveRow = (aliases, shortId) => aliases?.rows?.get(shortId) ?? null;

/** 登记页眉短名（每页只有一个页眉）。 */
export function registerHeader(aliases, longHeaderId) {
  aliases.header.set('h1', longHeaderId);
  return 'h1';
}

/**
 * 登记一次请求的短 requestId，按页内请求次序编号 q1、q2…
 * 编号必须用自增计数器，不能用 Map.size：页眉与行批次是并发发出的，
 * 两个调用若都先读到同一个 size，会拿到相同短名，页眉就会因「requestId 不匹配」整页失败。
 */
export function registerRequest(aliases, requestUuid) {
  aliases.requestSeq = (aliases.requestSeq ?? 0) + 1;
  const short = aliases.requestPrefix + aliases.requestSeq;
  if (aliases.requests.has(short)) throw Error('短 requestId 重复生成：' + short);
  aliases.requests.set(short, requestUuid);
  return short;
}

/** 短页眉名 → 长 headerId；未命中返回 null。 */
export const resolveHeader = (aliases, shortId) => aliases?.header?.get(shortId) ?? null;

/** 错误文案用：把长 ID 标成「短名(长名)」，未登记则原样返回。 */
export const aliasLabel = (aliases) => (longId) => {
  const short = aliasForRow(aliases, longId);
  return short ? `${short}(${longId})` : String(longId);
};

// 需要翻译的只有两类位置：
//   1) rows[].rowId
//   2) rows[].arcs[].start / .end 中形如 ["r9", 音符序号] 的跨行端点首元
// 不翻译：tuplets 成员（行内音符序号）、issues 目标（音符序号）、lyrics（文本）、meterMarks（小节区段号）。
// 未命中短名一律保持原值，交由既有契约分支处理。
function translateEndpoint(aliases, endpoint) {
  if (!Array.isArray(endpoint) || endpoint.length !== 2 || typeof endpoint[0] !== 'string') return endpoint;
  const long = resolveRow(aliases, endpoint[0]);
  return long === null ? endpoint : [long, endpoint[1]];
}

/**
 * 把模型返回里的短名翻回长 ID。返回新对象，不修改入参
 * （归档用的 partial 会引用同一份响应，就地改写会污染留档）。
 */
export function shortenResponse(parsed, aliases) {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.rows)) return parsed;
  return {
    ...parsed,
    rows: parsed.rows.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const longRowId = typeof row.rowId === 'string' ? resolveRow(aliases, row.rowId) : null;
      const next = longRowId === null ? row : { ...row, rowId: longRowId };
      if (!Array.isArray(next.arcs)) return next;
      return {
        ...next,
        arcs: next.arcs.map((arc) => {
          if (!Array.isArray(arc)) return arc;
          const [start, end, ...rest] = arc;
          const translated = [translateEndpoint(aliases, start), translateEndpoint(aliases, end), ...rest];
          return translated.some((value, i) => value !== arc[i]) ? translated : arc;
        }),
      };
    }),
  };
}

/** 把模型返回的页眉短名翻回长 headerId；未命中保持原值。 */
export function shortenHeader(parsed, aliases) {
  if (!parsed || typeof parsed !== 'object' || typeof parsed.headerId !== 'string') return parsed;
  const long = resolveHeader(aliases, parsed.headerId);
  return long === null ? parsed : { ...parsed, headerId: long };
}

// requestId 同样是短名，也必须翻回长值再进契约——否则契约会拿 q1 去比 UUID 而必然失败。
// 漏翻这一处的后果已实测：页面报「基础信息 ID」。
function withLongRequestId(parsed, aliases) {
  if (!parsed || typeof parsed !== 'object' || typeof parsed.requestId !== 'string') return parsed;
  const long = aliases?.requests?.get(parsed.requestId);
  return long === undefined ? parsed : { ...parsed, requestId: long };
}

/** 整条页眉响应：requestId 与 headerId 都翻回长值。 */
export const restoreHeaderResponse = (parsed, aliases) => withLongRequestId(shortenHeader(parsed, aliases), aliases);

/** 整条行响应：requestId 翻回长值，行/跨行端点翻回长 rowId。 */
export const restoreRowsResponse = (parsed, aliases) => withLongRequestId(shortenResponse(parsed, aliases), aliases);

/** Each registry belongs to one page/run. Never use model IDs to route a response. */
export function registerPage(aliases, pageId) {
  if (typeof pageId !== 'string' || !pageId) throw Error('缺少内部页面 ID');
  const previous = aliases.pages.get('p1');
  if (previous !== undefined && previous !== pageId) throw Error('短 ID 注册表不能跨页复用');
  aliases.pages.set('p1', pageId);
  return 'p1';
}
export const snapshotAliases = aliases => ({
  requestIds:Object.fromEntries(aliases.requests), header:Object.fromEntries(aliases.header),
  pages:Object.fromEntries(aliases.pages), rows:Object.fromEntries(aliases.rows),
});

/** Shared B/C wire builder: UUIDs stay exclusively in context and archive. */
export function prepareRecognitionRequest(aliases,{kind,requestUuid,pageId,images,ids=[],includeHeader=false}) {
  if (!['header','rows','page'].includes(kind)) throw Error('未知识别请求类型');
  if (!Array.isArray(images) || images.length !== (kind==='page'?1:ids.length)) throw Error('图片和标识数量不符');
  const pageShort=registerPage(aliases,pageId);
  const requestShort=registerRequest(aliases,requestUuid);
  const content=[{type:'text',text:'requestId='+requestShort+'。'}];
  if(kind==='page')content.push({type:'text',text:'pageId='+pageShort+'。includeHeader='+Boolean(includeHeader)+'。下一项为完整乐谱图片。'},{type:'image',image:images[0]});
  else images.forEach((image,i)=>{
    const short=kind==='header'?registerHeader(aliases,ids[i]):aliasForRow(aliases,ids[i]);
    if(!short)throw Error('短 ID 映射缺失');
    content.push({type:'text',text:(kind==='header'?'headerId=':'rowId=')+short+'。下一项图片对应此 ID。'},{type:'image',image});
  });
  return {content,context:Object.freeze({kind,requestUuid,requestShort,pageId,pageShort,includeHeader:Boolean(includeHeader)})};
}

/** Bind B results to the sending call, even if another valid qN was echoed. */
export function restoreBoundRowsResponse(parsed,aliases,context) {
  if(aliases.pages.get(context.pageShort)!==context.pageId||aliases.requests.get(context.requestShort)!==context.requestUuid)throw Error('请求上下文与注册表不匹配');
  const restored=shortenResponse(parsed,aliases);
  return {...restored,requestId:context.requestUuid};
}

/** Register C's unknown row count before translating any forward references. */
export function restorePageResponse(parsed,aliases,context) {
  if (!parsed || typeof parsed!=='object' || Array.isArray(parsed) || !Array.isArray(parsed.rows)) throw Error('整页识别格式错误');
  if (aliases.pages.get(context.pageShort)!==context.pageId || aliases.requests.get(context.requestShort)!==context.requestUuid) throw Error('请求上下文与注册表不匹配');
  if (aliases.rows.size) throw Error('整页响应必须使用独立空行注册表');
  if (parsed.rows.length>MAX_ROWS_PER_PAGE) throw Error('整页行数超出容量');
  const diagnostics=[];
  for(const [field,expected] of [['requestId',context.requestShort],['pageId',context.pageShort]]) {
    if(parsed[field]!==expected)diagnostics.push({code:field==='requestId'?'requestId-mismatch':'pageId-mismatch',received:parsed[field]??null,expected});
  }
  const unique=new Map(),ambiguous=new Set();
  for(const row of parsed.rows){
    if(!row || typeof row!=='object' || indexOfShort(row.rowId)===null)throw Error('整页行标识必须为 r1 至 r999');
    if(unique.has(row.rowId)){
      const same=JSON.stringify(unique.get(row.rowId))===JSON.stringify(row);
      diagnostics.push({code:same?'duplicate-row-dropped':'duplicate-row-conflict',rowId:row.rowId});
      if(!same)ambiguous.add(row.rowId);
    } else unique.set(row.rowId,row);
  }
  // Reading order is the response order; an ID is a reference, not a sorting key.
  [...unique.keys()].forEach((short,i)=>{const long=context.pageId+':row-'+(i+1);aliases.rows.set(short,long);aliases.reverse.set(long,short);});
  const endpoint=(v,source)=>{
    if(v===null)return null;
    if(!Array.isArray(v))return v;
    if(v.length===2&&typeof v[0]==='string'&&Number.isInteger(v[1])&&v[1]>0&&!ambiguous.has(v[0])&&aliases.rows.has(v[0]))return [aliases.rows.get(v[0]),v[1]];
    diagnostics.push({code:'clipped-connection',rowId:source,reference:v});return null;
  };
  const rows=[...unique.values()].map(row=>({...row,rowId:aliases.rows.get(row.rowId),arcs:Array.isArray(row.arcs)?row.arcs.map(arc=>Array.isArray(arc)?[endpoint(arc[0],row.rowId),endpoint(arc[1],row.rowId),...arc.slice(2)]:arc):row.arcs}));
  return {value:{...parsed,requestId:context.requestUuid,pageId:context.pageId,rows},diagnostics};
}
