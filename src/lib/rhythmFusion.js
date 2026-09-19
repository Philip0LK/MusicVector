// Geometry supplies measured rhythm only after row localization and count agreement.
// AI owns event identity and musical structure. Count disagreement is diagnostic,
// never authorization to delete, invent, or rebind notes. This module is pure.

// 匹配分权重（改动前请先看策略文档第三节）
const MATCH_DIGIT_AGREE = 2;
const MATCH_DIGIT_DISAGREE = -2;
const MATCH_UNDERLINE_AGREE = 1;
const MATCH_LOWDOT_AGREE = 1;
const SKIP_PENALTY = -1;

const isPitchEvent = (event) => event?.kind === 'note' || event?.kind === 'rest';

export const MIN_ROW_CONFIDENCE = 0.45;

/**
 * 单调对齐：几何块 ↔ AI 事件（只数音符类事件、按行内顺序）。
 * @returns {{pairs:Array<{block:number,event:number}>, skippedBlocks:number[], skippedEvents:number[], score:number}}
 */
export function alignBlocksToEvents(blocks, events) {
  const noteIndexes = [];
  events.forEach((event, index) => {
    if (isPitchEvent(event)) noteIndexes.push(index);
  });
  const n = blocks.length;
  const m = noteIndexes.length;
  const matchScore = (blockIndex, eventIndex) => {
    const block = blocks[blockIndex];
    const event = events[eventIndex];
    let score = 0;
    if (block.digit !== null && block.digit !== undefined && (event.kind === 'rest' || event.degree != null)) {
      score += block.digit === (event.kind === 'rest' ? 0 : event.degree) ? MATCH_DIGIT_AGREE : MATCH_DIGIT_DISAGREE;
    }
    const eventUnderlines = event.underlines;
    if (eventUnderlines != null && block.underlines === eventUnderlines) score += MATCH_UNDERLINE_AGREE;
    const eventLow = (event.octave ?? null) < 0;
    if (Boolean(block.lowDot) === eventLow) score += MATCH_LOWDOT_AGREE;
    return score;
  };

  // dp[i][j] = 前 i 个块 与 前 j 个音符事件 的最优分
  const dp = Array.from({length: n + 1}, () => new Float64Array(m + 1));
  const choice = Array.from({length: n + 1}, () => new Uint8Array(m + 1)); // 0=匹配 1=跳块 2=跳事件
  for (let i = 1; i <= n; i += 1) {
    dp[i][0] = dp[i - 1][0] + SKIP_PENALTY;
    choice[i][0] = 1;
  }
  for (let j = 1; j <= m; j += 1) {
    dp[0][j] = dp[0][j - 1] + SKIP_PENALTY;
    choice[0][j] = 2;
  }
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const match = dp[i - 1][j - 1] + matchScore(i - 1, noteIndexes[j - 1]);
      const skipBlock = dp[i - 1][j] + SKIP_PENALTY;
      const skipEvent = dp[i][j - 1] + SKIP_PENALTY;
      if (match >= skipBlock && match >= skipEvent) {
        dp[i][j] = match;
        choice[i][j] = 0;
      } else if (skipBlock >= skipEvent) {
        dp[i][j] = skipBlock;
        choice[i][j] = 1;
      } else {
        dp[i][j] = skipEvent;
        choice[i][j] = 2;
      }
    }
  }
  const pairs = [];
  const skippedBlocks = [];
  const skippedEvents = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = i === 0 ? 2 : j === 0 ? 1 : choice[i][j];
    if (step === 0) {
      pairs.push({block: i - 1, event: noteIndexes[j - 1]});
      i -= 1;
      j -= 1;
    } else if (step === 1) {
      skippedBlocks.push(i - 1);
      i -= 1;
    } else {
      skippedEvents.push(noteIndexes[j - 1]);
      j -= 1;
    }
  }
  pairs.reverse();
  skippedBlocks.reverse();
  skippedEvents.reverse();
  return {pairs, skippedBlocks, skippedEvents, score: dp[n][m]};
}

/**
 * 融合一行。
 * @param {object} geometry analyzeRowGeometry 的结果
 * @param {Array} events    AI 事件（compactNotation.parseSymbols 的输出，未过滤）
 * @returns {{notes:Array, issues:Array, alignment:object, degraded:boolean, reason?:string}}
 */
export function fuseRow(geometry, events, options = {}) {
  const list = Array.isArray(events) ? events : [];
  const allNotes = list.filter(isPitchEvent);

  const fallback = (reason, issues = [], alignment = null) => ({
    degraded: true, reason,
    alignment: alignment ?? {matched: 0, skippedBlocks: [], skippedEvents: [], exact: false},
    // 整行连数字带都没定位到：算法给不出读数 → 按无减时线取 0（四分音符），不用 AI 的时值。
    notes: allNotes.map(aiOnlyNote),
    issues: [...issues, {code: 'geometry-unavailable', targetId: event0(list), field: null,
      detail: reason + '，算法未测出减时线，按无减时线取值，待复核'}],
  });
  // 唯一保留的整行降级：整行连数字带都没定位到，没有任何可测位置。
  if (!geometry?.available)
    return fallback(geometry?.reason ?? 'geometry-unavailable');
  const blocks = geometry.blocks ?? [];
  const exact = blocks.length === allNotes.length;
  const noteIndexes = list.flatMap((event, index) => isPitchEvent(event) ? [index] : []);
  // 对应关系：块数相等时按行内阅读顺序逐位对应（双方都是左→右，逐位即单调，实测 49 行里 48 行走这条）；
  // 块数不等时用单调 DP 对齐，未配上的音符没有几何读数 → 按 0 条取值，未配上的块不产生音符。
  const {pairs, skippedBlocks, skippedEvents} = exact
    ? {pairs: blocks.map((_, index) => ({block: index, event: noteIndexes[index]})), skippedBlocks: [], skippedEvents: []}
    : alignBlocksToEvents(blocks, list);
  const alignment = {matched: pairs.length, skippedBlocks, skippedEvents, exact, rowQuality: geometry.mappingConfidence ?? null};
  const issues = [];
  // 行级质量只记录、不再换源：低质量行的时值仍逐音取几何读数，由评测脚本暴露问题，而不是静默退回 AI。
  if (!Number.isFinite(geometry.mappingConfidence) || geometry.mappingConfidence < (options.minRowConfidence ?? MIN_ROW_CONFIDENCE))
    issues.push({code: 'low-row-quality', targetId: null, field: null,
      detail: '行级字形质量偏低（' + geometry.mappingConfidence + '），仍按几何读数取时值，待复核'});
  if (skippedBlocks.length) issues.push({code: 'geometry-block-unpaired', targetId: null, field: null,
    detail: '几何候选未能与 AI 音符一一对应，未配对候选已忽略（不影响音高与顺序）'});
  if (skippedEvents.length) issues.push({code: 'geometry-block-unpaired', targetId: null, field: null,
    detail: '有 ' + skippedEvents.length + ' 个音符没有几何读数，已按无减时线取值'});
  // 音符的身份、顺序、结构始终来自 AI；时值一律来自算法：配对上的用该块的读数，
  // 未配对的按"无减时线"（0 条）取值，不采用 AI 的时值。
  const blockByEvent = new Map(pairs.map(pair => [pair.event, pair.block]));
  return {
    degraded: false, alignment, issues,
    notes: list.flatMap((event, index) => {
      if (!isPitchEvent(event)) return [];
      const blockIndex = blockByEvent.get(index);
      return blockIndex === undefined ? [aiOnlyNote(event)] : [fuseNote(blocks[blockIndex], event, issues)];
    }),
  };
}

function fuseNote(block, event, issues) {
 // 时值一律由纯算法（几何层）给出，不退回 AI。
 // 「测出来没有」= 这个音底下扫到了横线笔画（layerCount>0）。扫到就用它的读数。
 // 一条都没扫到 → 算法认为"没有横线"= 没有减时线 = 四分音符（underlines 0）。
 // 注：confidence===0 只说明该行没标定出减时线带，不代表这个音没测到，不能拿它当判据。
 const layers = block.layerCount;
 const measured = Number.isInteger(layers) ? layers > 0
   : Number.isInteger(block.underlines) && block.underlineConfidence > 0;
 const underlines = measured && Number.isInteger(block.underlines) ? block.underlines : 0;
 const source = measured ? 'geometry' : 'geometry-default';
 if (!measured) issues.push({code: 'rhythm-from-default', targetId: event.id, field: 'underlines',
   detail: '算法未扫到减时线，按无减时线（四分音符）取值'});
  const degree = event.kind === 'rest' ? 0 : event.degree;
  if (block.digit != null && degree != null && block.digit !== degree) issues.push({code: 'degree-disagree', targetId: event.id,
    field: 'degree', detail: 'AI 与几何字形分类不一致，保留 AI 音高，待确认'});
  return {
    blockIndex: block.index, bbox: block.bbox, centerX: block.centerX,
    kind: event.kind, eventId: event.id, degree, degreeSource: 'ai', geoDegree: block.digit,
    octave: event.kind === 'rest' ? 0 : event.octave, accidental: event.accidental ?? null,
    underlines, dots: event.dots ?? null, measureEnd: Boolean(event.measureEnd),
    evidence: {
      underlines: {adopted: underlines, source, confidence: block.underlineConfidence, measured,
        ai: event.underlines ?? null, geo: Number.isInteger(block.underlines) ? block.underlines : null, layerCount: layers ?? null,
        conflict: event.underlines != null && event.underlines !== underlines ? 'ai-disagrees' : null},
      dots: {adopted: event.dots ?? null, source: 'ai', ai: event.dots ?? null, geo: block.rightDot ? 1 : 0,
        conflict: event.dots != null && block.rightDot !== (event.dots > 0) ? 'geo-disagrees' : null},
      // convertRows interprets independent barline events and updates this evidence.
      measureEnd: {adopted: Boolean(event.measureEnd), source: 'ai', ai: Boolean(event.measureEnd), geo: block.measureEnd,
        conflict: block.measureEnd !== Boolean(event.measureEnd) ? 'geo-disagrees' : null},
      // Failure to detect a dot is not proof of an absent octave mark.
      octave: {adopted: event.kind === 'rest' ? 0 : event.octave, source: 'ai', ai: event.octave ?? 0, geoLowDot: block.lowDot,
        overridden: false, conflict: event.octave != null && (event.octave < 0) !== block.lowDot ? 'geo-disagrees' : null},
    },
  };
}

function aiOnlyNote(event) {
  return {
    blockIndex: null,
    bbox: null,
    centerX: null,
    kind: event.kind,
    eventId: event.id ?? null,
    degree: event.kind === 'rest' ? 0 : (event.degree ?? null),
    degreeSource: 'ai',
    geoDegree: null,
    octave: event.kind === 'rest' ? 0 : (event.octave ?? null),
    accidental: event.accidental ?? null,
    // 时值一律由算法给出：这个位置没有几何读数（整行测不出 / 未配对）→ 按无减时线取 0，不用 AI 的读数。
    underlines: 0,
    dots: event.dots ?? null,
    measureEnd: Boolean(event.measureEnd),
    evidence: {
      underlines: {adopted: 0, source: 'geometry-default', measured: false, ai: event.underlines ?? null, geo: null, layerCount: null},
      dots: {adopted: event.dots ?? 0, source: 'ai', ai: event.dots ?? 0, geo: null},
      measureEnd: {adopted: Boolean(event.measureEnd), source: 'ai', ai: Boolean(event.measureEnd), geo: null},
      octave: {adopted: event.octave ?? 0, source: 'ai', ai: event.octave ?? 0, geoLowDot: null, overridden: false},
    },
  };
}

const event0 = (list) => (list.length && list[0].id) || null;

/**
 * 跨行收集数字分类模板：用「AI 对齐成功且音数一致」的块当样本。
 * 这样模板永远来自本页同字体，不需要人标，也不会把未验证的分类当主源。
 */
export function buildClassifierSamples(rows) {
  const samples = [];
  for (const row of rows) {
    if (!row.geometry?.available) continue;
    if (row.fused?.degraded || !row.fused?.alignment?.exact || row.geometry.blocks.length !== row.fused.alignment.matched) continue;
    const byBlock = new Map();
    for (const note of row.fused.notes ?? []) byBlock.set(note.blockIndex, note);
    row.geometry.blocks.forEach((block, index) => {
      const note = byBlock.get(index);
      if (!note || note.degreeSource !== 'ai') return;
      if (note.geoDegree != null && note.geoDegree !== note.degree) return;
      if (note.degree === null || note.degree === undefined) return;
      samples.push({signature: block.signature, label: note.degree});
    });
  }
  return samples;
}
