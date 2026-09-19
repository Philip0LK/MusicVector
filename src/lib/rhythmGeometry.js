// 简谱行几何测量层：从「整行裁切图」里量出音符骨架。
//
// 分工（依据 AI-RECOGNITION-ACCURACY-REPORT.md 第三之二节实验 1–3）：
//   · 本模块【负责】音符个数、数字字形、减时线根数   —— 实测 337/337、100%
//   · 本模块【只作旁证】低音点（未检出不等于不存在）、附点（42.5%，不作判决）、视觉小节线（0/50，不采用）
//   · 音高语义、附点、小节线由 AI 提供，融合在 rhythmFusion.js
//
// 设计约束：
//   1. 纯函数：输入 {data,width,height}（RGBA），输出普通对象；不碰 DOM / canvas / 网络
//   2. 不依赖 AI 输出：本模块不知道 AI 说了什么（数字分类模板由融合层注入）
//   3. 零依赖：Otsu 二值化、连通域、行定位、减时线层计数全部自带
//
// 算法来源：旧版 src/octaveDetector.js 的几何部分（已在 Baby Song 上实测 100%），
// 此处按「单行裁切图」输入测量：同一裁切仍可能包含音区点、弧线、小节线和歌词，
// 数字带由切片器提供；无数字带时只接受不歧义的候选，不能把最上方图形等同于数字。

export const GEOMETRY_VERSION = 2;
export const ANALYSIS_WIDTH = 1440;

// ---------------------------------------------------------------- 基础工具

export function median(values) {
  if (!values?.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function medianAbsoluteDeviation(values, center = median(values)) {
  return median((values || []).map((value) => Math.abs(value - center)));
}

export function otsuThreshold(histogram, total) {
  let totalSum = 0;
  for (let value = 0; value < 256; value += 1) totalSum += value * histogram[value];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let bestThreshold = 127;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = value;
    }
  }
  return bestThreshold;
}

export function binarize(rgba, width, height) {
  const histogram = new Uint32Array(256);
  const grayscale = new Uint8Array(width * height);
  for (let pixel = 0, offset = 0; pixel < grayscale.length; pixel += 1, offset += 4) {
    const value = Math.round(rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114);
    grayscale[pixel] = value;
    histogram[value] += 1;
  }
  const threshold = otsuThreshold(histogram, grayscale.length);
  const binary = new Uint8Array(grayscale.length);
  for (let index = 0; index < grayscale.length; index += 1) {
    binary[index] = grayscale[index] <= threshold ? 1 : 0;
  }
  return binary;
}

export function connectedComponents(binary, width, height) {
  const visited = new Uint8Array(binary.length);
  const queue = new Int32Array(binary.length);
  const components = [];
  for (let start = 0; start < binary.length; start += 1) {
    if (!binary[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let area = 0;
    while (head < tail) {
      const index = queue[head++];
      const y = Math.floor(index / width);
      const x = index - y * width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      area += 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        const nextY = y + dy;
        if (nextY < 0 || nextY >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nextX = x + dx;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (!binary[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    components.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      area,
      centerX: minX + (maxX - minX) / 2,
      bottom: maxY,
    });
  }
  return components;
}

// ---------------------------------------------------------------- 行定位

const isGlyphLike = (component) => {
  const aspect = component.width / component.height;
  const density = component.area / (component.width * component.height);
  return aspect >= 0.18 && aspect <= 1.25 && density >= 0.12;
};

// 一条裁切里只有一个简谱行 → 取「底部对齐最紧的字形簇」作为该行。
// 判据与旧版 buildAdaptiveRowCandidates 一致（高度比 0.68–1.47、基线差 ≤ 0.24×字高），
// 再按 rowCandidateQuality 取最优，避免歌词行/水印胜出。
export function detectRowBand(components, {digitBand = null} = {}) {
  // digitBand is in the same pixel space as the connected components. It is
  // evidence from the image-only slicer, never an AI note count or song preset.
  const bandHeight = digitBand ? digitBand[1] - digitBand[0] : null;
  const glyphs = components.filter(isGlyphLike).filter((c) => {
    if (!digitBand) return true;
    const overlap = Math.max(0, Math.min(c.y + c.height, digitBand[1]) - Math.max(c.y, digitBand[0]));
    return c.height >= bandHeight * 0.55 && c.height <= bandHeight * 1.4 &&
      overlap / c.height >= 0.7 && Math.abs(c.bottom - digitBand[1]) <= bandHeight * 0.3;
  });
  const candidates = [];
  for (const anchor of glyphs) {
    if (anchor.height <= 0) continue;
    const nearby = glyphs.filter((component) => {
      const heightRatio = component.height / anchor.height;
      return (
        heightRatio >= 0.68 &&
        heightRatio <= 1.47 &&
        Math.abs(component.bottom - anchor.bottom) <= anchor.height * 0.24
      );
    });
    if (nearby.length < 2) continue;
    const scale = median(nearby.map((component) => component.height));
    const baselineBottom = median(nearby.map((component) => component.bottom));
    const digits = nearby
      .filter((component) => {
        const heightRatio = component.height / scale;
        return (
          heightRatio >= 0.7 &&
          heightRatio <= 1.43 &&
          Math.abs(component.bottom - baselineBottom) <= scale * 0.2
        );
      })
      .sort((left, right) => left.x - right.x);
    if (digits.length < 2) continue;
    const row = {
      baselineBottom,
      scale,
      digits,
      baselineDispersion: medianAbsoluteDeviation(digits.map((c) => c.bottom), baselineBottom) / scale,
      scaleDispersion: medianAbsoluteDeviation(digits.map((c) => c.height), scale) / scale,
    };
    const duplicateIndex = candidates.findIndex(
      (candidate) =>
        Math.abs(candidate.baselineBottom - row.baselineBottom) <=
          Math.max(candidate.scale, row.scale) * 0.22 &&
        Math.max(candidate.scale, row.scale) / Math.max(1e-6, Math.min(candidate.scale, row.scale)) <= 1.35,
    );
    if (duplicateIndex < 0) candidates.push(row);
    else if (rowQuality(row) > rowQuality(candidates[duplicateIndex])) candidates[duplicateIndex] = row;  }
  if (candidates.length === 0) return null;
  // Without a slicer hint, tiny dot clusters must not define the search band.
  // Prefer substantial glyph rows; if another comparable row exists, abstain.
  const maxScale = Math.max(...candidates.map(c => c.scale));
  const eligible = candidates.filter(c => c.scale >= maxScale * 0.6)
    .sort((a, b) => rowQuality(b) - rowQuality(a));
  const best = eligible[0];
  const rival = eligible.find(c => Math.abs(c.baselineBottom - best.baselineBottom) > Math.max(c.scale, best.scale) * 0.5);
  if (rival && rowQuality(best) - rowQuality(rival) < 0.5) return null;
  return best;
}

const rowQuality = (row) =>
  Math.log2(row.digits.length + 1) - row.baselineDispersion * 2 - row.scaleDispersion;

// ---------------------------------------------------------------- 减时线（核心资产）

function horizontalRuns(binary, width, y, left, right) {
  const runs = [];
  const offset = y * width;
  let x = left;
  while (x <= right) {
    while (x <= right && !binary[offset + x]) x += 1;
    const start = x;
    while (x <= right && binary[offset + x]) x += 1;
    if (x > start) runs.push({ start, end: x - 1, length: x - start });
  }
  return runs;
}

// 数字基线下方扫横线层：横向范围 = 相邻数字中心的中点（连起来的减时线只算给相邻音符）
export function underlineLayerCandidates(binary, width, height, row, digitIndex) {
  const digit = row.digits[digitIndex];
  if (!digit) return [];
  const center = digit.x + digit.width / 2;
  const previousCenter = digitIndex
    ? row.digits[digitIndex - 1].x + row.digits[digitIndex - 1].width / 2
    : center - digit.width * 1.4;
  const nextCenter =
    digitIndex < row.digits.length - 1
      ? row.digits[digitIndex + 1].x + row.digits[digitIndex + 1].width / 2
      : center + digit.width * 1.4;
  const left = Math.max(0, Math.floor((previousCenter + center) / 2));
  const right = Math.min(width - 1, Math.ceil((center + nextCenter) / 2));
  const minimumRun = Math.max(row.scale * 0.32, digit.width * 0.55);
  const candidateRows = [];
  const strengths = [];
  for (
    let y = Math.max(0, Math.floor(row.baselineBottom + row.scale * 0.06));
    y <= Math.min(height - 1, Math.ceil(row.baselineBottom + row.scale * 0.75));
    y += 1
  ) {
    const runs = horizontalRuns(binary, width, y, left, right);
    const relevant = runs.filter(
      (run) =>
        run.length >= minimumRun &&
        run.start <= center + Math.max(digit.width, row.scale * 0.45) * 0.45 &&
        run.end >= center - Math.max(digit.width, row.scale * 0.45) * 0.45,
    );
    if (!relevant.length) continue;
    candidateRows.push(y);
    strengths.push(Math.min(1, Math.max(...relevant.map((run) => run.length)) / digit.width));
  }
  const layers = [];
  candidateRows.forEach((y, index) => {
    const layer = layers.at(-1);
    if (!layer || y - layer.rows.at(-1) > 1) layers.push({ rows: [y], strengths: [strengths[index]] });
    else {
      layer.rows.push(y);
      layer.strengths.push(strengths[index]);
    }
  });
  return layers
    .filter((layer) => layer.rows.length <= Math.max(1, row.scale * 0.24))
    .map((layer) => ({
      offset: median(layer.rows) - row.baselineBottom,
      strength: Math.max(...layer.strengths),
    }));
}

// 全行统计减时线「带」：offset/scale 归一化后聚类，第一条带 ∈ [0.08,0.45]，第二条 ∈ [1.35×,2.7×] 第一条。
// 这样「第几条减时线」是从本行排版里学出来的，抗字号与缩放差异。
export function estimateUnderlineBands(binary, width, height, row) {
  const normalizedOffsets = [];
  row.digits.forEach((_, digitIndex) => {
    underlineLayerCandidates(binary, width, height, row, digitIndex).forEach((layer) => {
      normalizedOffsets.push(layer.offset / row.scale);
    });
  });
  const clusters = clusterScalarValues(normalizedOffsets, 0.075).map((cluster) => ({
    center: median(cluster),
    support: cluster.length,
    spread: medianAbsoluteDeviation(cluster),
  }));
  const first = clusters
    .filter((cluster) => cluster.center >= 0.08 && cluster.center <= 0.45)
    .sort((left, right) => right.support - left.support)[0];
  if (!first) return [];
  const second = clusters
    .filter((cluster) => cluster.center >= first.center * 1.35 && cluster.center <= first.center * 2.7)
    .sort((left, right) => right.support - left.support)[0];
  return [first, second]
    .filter(Boolean)
    .sort((left, right) => left.center - right.center)
    .map((cluster) => ({
      center: Number(cluster.center.toFixed(4)),
      tolerance: Number(Math.max(0.075, cluster.spread * 3).toFixed(4)),
      support: cluster.support,
    }));
}

export function clusterScalarValues(values, tolerance) {
  const clusters = [];
  [...values].sort((left, right) => left - right).forEach((value) => {
    const cluster = clusters.at(-1);
    if (!cluster || value - median(cluster) > tolerance) clusters.push([value]);
    else cluster.push(value);
  });
  return clusters;
}

export function detectUnderlineCount(binary, width, height, row, digitIndex, bands) {
  const layers = underlineLayerCandidates(binary, width, height, row, digitIndex);
  const validLayers = (bands || []).flatMap((band) => {
    const candidates = layers.filter(
      (layer) => Math.abs(layer.offset / row.scale - band.center) <= band.tolerance,
    );
    if (!candidates.length) return [];
    return [candidates.sort((left, right) => right.strength - left.strength)[0]];
  });
  const confidence = validLayers.length
    ? validLayers.reduce((total, layer) => total + layer.strength, 0) / validLayers.length
    : bands?.length
      ? 0.8
      : 0;
  return {
    count: validLayers.length,
    confidence,
    // 原始笔画数（未按带过滤）：0 表示"这个音底下没扫到横线"。
    layerCount: layers.length,
    offsets: validLayers.map((layer) => Math.round(layer.offset)),
  };
}

// ---------------------------------------------------------------- 低音点 / 附点（旁证）

// 低音点：数字正下方的小实心圆点。实测误报 0/315（Baby Song），故可用于「否决 AI 的多写低音点」。
// 纵向范围必须跟着减时线深度走：有 1 条线时点在 0.28×scale 处，2 条线时在 0.45×scale 处（实测）。
export function detectLowDot(components, digit, scale, underlineOffsets = []) {
  const centerX = digit.x + digit.width / 2;
  const underlineDepth = underlineOffsets.length ? Math.max(...underlineOffsets) : 0;
  const verticalRange = underlineDepth + scale * 0.6;
  const candidates = components.filter((component) => {
    const ratio = component.width / component.height;
    const relativeWidth = component.width / scale;
    const relativeHeight = component.height / scale;
    const density = component.area / (component.width * component.height);
    const center = component.x + component.width / 2;
    const gap = component.y - digit.bottom;
    return (
      relativeWidth >= 0.1 &&
      relativeWidth <= 0.5 &&
      relativeHeight >= 0.1 &&
      relativeHeight <= 0.5 &&
      density >= 0.35 &&
      ratio >= 0.55 &&
      ratio <= 1.8 &&
      Math.abs(center - centerX) <= scale * 0.3 &&
      gap >= -scale * 0.1 &&
      gap <= verticalRange
    );
  });
  if (!candidates.length) return false;
  // 低音点常常紧贴最后一条减时线（减时线比点宽 2–3 倍，点像挂在横线中段下方），
  // 因此判据是「点不在任何减时线之上」，而不是「点必须比减时线低一整段」。
  // 实测 Baby Song 中音样本误报 0/315，低音样本字高与中音一致（点未粘进数字主体）。
  if (!underlineOffsets.length) return true;
  const lowestUnderlineBottom = digit.bottom + Math.max(...underlineOffsets);
  const tolerance = Math.max(1, scale * 0.06);
  return candidates.some((component) => component.y >= lowestUnderlineBottom - tolerance);
}

// 附点：数字右侧、垂直居中的小圆点。实测仅 42.5%，故只作证据、不作判决。
export function detectRightDot(components, digit, scale) {
  const right = digit.x + digit.width;
  const centerY = digit.y + digit.height / 2;
  const candidates = components.filter((component) => {
    const ratio = component.width / component.height;
    const relativeWidth = component.width / scale;
    const relativeHeight = component.height / scale;
    const density = component.area / (component.width * component.height);
    const dotX = component.x + component.width / 2;
    const dotY = component.y + component.height / 2;
    return (
      relativeWidth >= 0.12 &&
      relativeWidth <= 0.42 &&
      relativeHeight >= 0.12 &&
      relativeHeight <= 0.42 &&
      density >= 0.35 &&
      ratio >= 0.55 &&
      ratio <= 1.8 &&
      dotX - right >= scale * 0.02 &&
      dotX - right <= scale * 0.68 &&
      Math.abs(dotY - centerY) <= scale * 0.2
    );
  });
  return candidates.length > 0;
}

// 视觉小节线：旧版实测 0/50，明确不采用。保留函数只为将来实验，默认不参与融合。
export function detectVisualMeasureEnd(binary, width, height, row, digitIndex) {
  const digit = row.digits[digitIndex];
  if (!digit) return false;
  const nextDigit = row.digits[digitIndex + 1] || null;
  const left = digit.x + digit.width + row.scale * 0.02;
  const right = nextDigit ? nextDigit.x - row.scale * 0.02 : width - 1;
  if (right <= left) return false;
  const top = Math.max(0, Math.floor(row.baselineBottom - row.scale * 1.15));
  const bottom = Math.min(height - 1, Math.ceil(row.baselineBottom + row.scale * 0.65));
  for (let x = Math.ceil(left); x <= Math.floor(right); x += 1) {
    let ink = 0;
    for (let y = top; y <= bottom; y += 1) if (binary[y * width + x]) ink += 1;
    if (ink >= (bottom - top + 1) * 0.8) return true;
  }
  return false;
}

// ---------------------------------------------------------------- 数字分类（模板由融合层注入）

export function glyphSignature(binary, width, component, columns = 10, rows = 14) {
  const signature = new Float32Array(columns * rows);
  for (let y = component.y; y < component.y + component.height; y += 1) {
    for (let x = component.x; x < component.x + component.width; x += 1) {
      if (!binary[y * width + x]) continue;
      const targetX = Math.min(columns - 1, Math.floor(((x - component.x + 0.5) * columns) / component.width));
      const targetY = Math.min(rows - 1, Math.floor(((y - component.y + 0.5) * rows) / component.height));
      signature[targetY * columns + targetX] += 1;
    }
  }
  const magnitude = Math.sqrt(signature.reduce((sum, value) => sum + value ** 2, 0)) || 1;
  for (let index = 0; index < signature.length; index += 1) signature[index] /= magnitude;
  return signature;
}

export function cosineSimilarity(left, right) {
  let product = 0;
  for (let index = 0; index < left.length; index += 1) product += left[index] * right[index];
  return Math.max(0, Math.min(1, product));
}

// 用 (样本签名, 标签) 训练原型；标签为 '0'–'7'。样本不足的类别不参与分类（返回 null 表示未分类）。
export function createDigitClassifier(samples, {minSamplesPerLabel = 2, minSimilarity = 0.62} = {}) {
  const byLabel = new Map();
  for (const {signature, label} of samples || []) {
    if (signature == null || label == null) continue;
    const key = String(label);
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key).push(signature);
  }
  const prototypes = [];
  for (const [label, list] of byLabel) {
    if (list.length < minSamplesPerLabel) continue;
    const prototype = new Float32Array(list[0].length);
    for (const signature of list) for (let i = 0; i < prototype.length; i += 1) prototype[i] += signature[i];
    const magnitude = Math.sqrt(prototype.reduce((sum, value) => sum + value ** 2, 0)) || 1;
    for (let i = 0; i < prototype.length; i += 1) prototype[i] /= magnitude;
    prototypes.push({label, prototype});
  }
  return {
    labels: prototypes.map((item) => item.label).sort(),
    classify(signature) {
      if (!signature || !prototypes.length) return {digit: null, confidence: 0};
      let best = {digit: null, similarity: -1};
      for (const {label, prototype} of prototypes) {
        const similarity = cosineSimilarity(signature, prototype);
        if (similarity > best.similarity) best = {digit: Number(label), similarity};
      }
      if (best.similarity < minSimilarity) return {digit: null, confidence: best.similarity, rejected: true};
      return {digit: best.digit, confidence: best.similarity};
    },
  };
}

// ---------------------------------------------------------------- 主入口

/**
 * 测量一条行裁切图。
 * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} imageData 已缩放到 ANALYSIS_WIDTH 的 RGBA
 * @param {{classifier?:{classify:Function}, detectVisualBarlines?:boolean, digitBand?:[number,number]}} options digitBand 为裁切内归一化纵向数字带
 * @returns 几何结果；available=false 表示该行几何不可用（融合层应整行降级）
 */
export function analyzeRowGeometry(imageData, options = {}) {
  const {data, width, height} = imageData || {};
  if (!data?.length || !width || !height) {
    return {available: false, version: GEOMETRY_VERSION, reason: 'empty-image', blocks: [], issues: []};
  }
  const binary = binarize(data, width, height);
  const components = connectedComponents(binary, width, height);
  const suppliedBand = options.digitBand;
  if (suppliedBand != null && (!Array.isArray(suppliedBand) || suppliedBand.length !== 2 ||
      !suppliedBand.every(Number.isFinite) || suppliedBand[0] < 0 || suppliedBand[1] > 1 || suppliedBand[1] <= suppliedBand[0])) {
    return {available: false, version: GEOMETRY_VERSION, reason: 'invalid-digit-band', blocks: [], issues: []};
  }
  const row = detectRowBand(components, {digitBand: suppliedBand?.map(y => y * height)});
  if (!row || row.digits.length < 2) {
    return {available: false, version: GEOMETRY_VERSION, reason: 'no-row-detected', blocks: [], issues: []};
  }
  const bands = estimateUnderlineBands(binary, width, height, row);
  const issues = [];
  if (!bands.length) issues.push({code: 'no-underline-band', detail: '未标定减时线带，根数仅作候选，不覆盖 AI 时值'});

  const blocks = row.digits.map((digit, index) => {
    const underline = detectUnderlineCount(binary, width, height, row, index, bands);
    const signature = glyphSignature(binary, width, digit);
    const classified = options.classifier?.classify(signature) ?? {digit: null, confidence: 0};
    const block = {
      index,
      bbox: {x: digit.x, y: digit.y, width: digit.width, height: digit.height},
      centerX: digit.centerX,
      underlines: underline.count,
      underlineConfidence: Number((underline.confidence ?? 0).toFixed(4)),
      // 该块实际扫到的横线笔画数（未按带过滤）。count 是"落进标定带的层数"，
      // 而 layerCount 回答"这个音底下到底有没有横线"——判断"测出来没有"要用后者。
      layerCount: underline.layerCount,
      underlineOffsets: underline.offsets,
      lowDot: detectLowDot(components, digit, row.scale, underline.offsets),
      rightDot: detectRightDot(components, digit, row.scale),
      measureEnd: options.detectVisualBarlines
        ? detectVisualMeasureEnd(binary, width, height, row, index)
        : false,
      digit: classified.digit,
      digitConfidence: Number((classified.confidence ?? 0).toFixed(4)),
      digitRejected: Boolean(classified.rejected),
      signature,
    };
    return block;
  });

  // 行置信度：字形个数、基线离散度、字高离散度三者合成（与融合层门控阈值 0.45 对齐）
  const countSupport = Math.min(1, blocks.length / 8);
  const mappingConfidence = Number(
    Math.max(
      0,
      Math.min(1, 0.45 * countSupport + 0.35 * (1 - Math.min(1, row.baselineDispersion * 4)) + 0.2 * (1 - Math.min(1, row.scaleDispersion * 4))),
    ).toFixed(4),
  );

  return {
    available: true,
    version: GEOMETRY_VERSION,
    analyzedWidth: width,
    analyzedHeight: height,
    scale: Math.round(row.scale * 100) / 100,
    baselineBottom: row.baselineBottom,
    baselineDispersion: Number(row.baselineDispersion.toFixed(4)),
    scaleDispersion: Number(row.scaleDispersion.toFixed(4)),
    mappingConfidence,
    underlineBands: bands,
    blocks,
    issues,
  };
}

// 把签名喂给分类器训练：融合层用「AI 已标注且对齐成功」的字形当模板
export function collectSignatureSamples(geometry, labels) {
  if (!geometry?.available) return [];
  return geometry.blocks.flatMap((block, index) => {
    const label = labels?.[index];
    if (label == null) return [];
    return [{signature: block.signature, label}];
  });
}
