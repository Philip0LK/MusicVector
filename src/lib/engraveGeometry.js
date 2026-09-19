// 简谱字形的纯几何：训练谱、校对谱与手机端移植都以这里为唯一依据。
// 本模块不依赖 React 或 DOM，可直接在 Node 中测试。
// 所有数值都在 24 单位字形空间里，渲染时由外层统一乘 scale（fontSize/24）。
import { annotationDots } from './musicStructure.js';

export const DIGIT_WIDTH = 14;
export const BASE_FONT_SIZE = 24;
export const NOTE_ADVANCE = 5;
export const MEASURE_PADDING = 16;

export function glyph(n) {
  const a = n.annotation;
  const t = a.durationTicks;
  // 附点与统计同源：统一读 annotationDots（界面只支持一个附点），
  // 不再单独读布尔 dotted，避免「标记有附点却按无附点画」这类分叉。
  const dotted = annotationDots(a) > 0;
  const beats = ((t || 24) / 24) * (dotted ? 1.5 : 1);
  const tail = beats >= 2 ? Math.floor(beats) - 1 : 0;
  const rest = n.degree === 0;
  const acc = n.accidental && !rest ? 12 : 0;
  const dot = dotted && beats < 2;
  return {
    acc,
    tail,
    rest,
    dot,
    lines: t === 6 ? 2 : t === 12 ? 1 : 0,
    width: acc + DIGIT_WIDTH + tail * (rest ? 17 : 10) + (dot ? 7 : 0),
    weight: 1 + Math.max(0, Math.log2((t || 24) / 6)) * 0.16,
  };
}

// 一个小节的排版下限：所有字形宽度加字距，再加左右留白。
export function measureMinimum(notes) {
  return notes.reduce((s, n) => s + glyph(n).width + NOTE_ADVANCE, 0) + MEASURE_PADDING;
}

// 小节宽度分配：先按字形下限等比放大铺满，放不下时再等比压缩到统一上限。
export function allocateWidths(minimums, width) {
  const total = minimums.reduce((a, b) => a + b, 0);
  if (total <= width) return minimums.map((w) => w + ((width - total) * w) / total);
  let lo = 0;
  let hi = Math.max(...minimums);
  for (let i = 0; i < 40; i++) {
    const cap = (lo + hi) / 2;
    if (minimums.reduce((s, w) => s + Math.min(w, cap), 0) > width) hi = cap;
    else lo = cap;
  }
  return minimums.map((w) => Math.min(w, lo));
}

// 小节内每个音的横向位置；与 Measure 的渲染使用同一组数字。
export function measureLayout(notes, minimum, width) {
  const items = notes.map(glyph);
  const content = Math.max(minimum, width);
  const sum = items.reduce((v, m) => v + m.weight, 0);
  const extra = Math.max(0, content - minimum);
  let x = 9;
  const positions = items.map((m) => {
    const p = { x, cx: x + m.acc + 7, end: x + m.width };
    x += m.width + NOTE_ADVANCE + (extra * m.weight) / sum;
    return p;
  });
  return { items, positions, content, overflow: minimum > width + 0.5 };
}

// 按小节边界把一行的音切成若干小节段。
export function measureSegments(rowNotes, rowOffset, allMeasures) {
  const segments = [];
  let start = 0;
  while (start < rowNotes.length) {
    const measure = allMeasures.find(
      (m) =>
        Number.isInteger(m.startIndex) &&
        Number.isInteger(m.endIndex) &&
        rowOffset + start >= m.startIndex &&
        rowOffset + start <= m.endIndex,
    ) || { index: 0, startIndex: rowOffset, endIndex: rowOffset + rowNotes.length - 1 };
    const end = Math.max(start + 1, Math.min(rowNotes.length, measure.endIndex - rowOffset + 1));
    const notes = rowNotes.slice(start, end);
    segments.push({ start, notes, measure, minimum: measureMinimum(notes) });
    start = end;
  }
  return segments;
}
