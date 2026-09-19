// 测试用合成简谱图生成器：白底 + 黑字，可控减时线根数与低音点。
// 只服务单测，不进入产品代码路径。

const FONT = '28px monospace';

/**
 * @param {Array<{digit?:string, underlines?:number, lowDot?:boolean, rightDot?:boolean}>} specs
 * @param {{width?:number,height?:number,noteWidth?:number,baseline?:number,scale?:number,drawText?:boolean}} [layout]
 */
export function renderRow(specs, layout = {}) {
  const {
    width = 900,
    height = 120,
    noteWidth = 60,
    baseline = 60,
    scale = 28,
    drawText = true,
  } = layout;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 255;
  };
  // 数字：用实心矩形块模拟字身（宽 0.6×scale、高 1×scale），保证连通域尺寸稳定
  specs.forEach((spec, index) => {
    const centerX = 40 + index * noteWidth;
    const bodyWidth = Math.max(6, Math.round(scale * 0.6));
    const bodyHeight = scale;
    const top = baseline - bodyHeight;
    const left = centerX - Math.floor(bodyWidth / 2);
    for (let y = top; y < top + bodyHeight; y += 1) {
      for (let x = left; x < left + bodyWidth; x += 1) put(x, y);
    }
    // 减时线：数字下方，长度 1.6×字宽，层间距 6px
    const underlineLength = Math.round(bodyWidth * 1.6);
    for (let layer = 0; layer < (spec.underlines ?? 0); layer += 1) {
      const y = baseline + 4 + layer * 6;
      for (let x = centerX - Math.floor(underlineLength / 2); x < centerX + Math.ceil(underlineLength / 2); x += 1) put(x, y);
    }
    // 低音点：数字正下方 4px 间隙后的小圆点（半径 2）
    if (spec.lowDot) {
      const dotY = baseline + (spec.underlines ? (spec.underlines - 1) * 6 + 12 : 4) + 2;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (dx * dx + dy * dy <= 4) put(centerX + dx, dotY + dy);
        }
      }
    }
    // 附点：数字右侧、垂直居中
    if (spec.rightDot) {
      const dotX = left + bodyWidth + Math.round(scale * 0.25);
      const dotY = baseline - Math.floor(bodyHeight / 2);
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (dx * dx + dy * dy <= 4) put(dotX + dx, dotY + dy);
        }
      }
    }
  });
  return {data, width, height, font: drawText ? FONT : null};
}

// 供融合层单测：直接造块，绕开像素
export function makeBlock(index, overrides = {}) {
  return {
    index,
    bbox: {x: 40 + index * 60, y: 32, width: 16, height: 28},
    centerX: 48 + index * 60,
    underlines: 1,
    underlineConfidence: 0.9,
    underlineOffsets: [4],
    lowDot: false,
    rightDot: false,
    measureEnd: false,
    digit: 1,
    digitConfidence: 0.9,
    digitRejected: false,
    signature: null,
    ...overrides,
  };
}

export function makeGeometry(blocks, overrides = {}) {
  return {
    available: true,
    version: 1,
    analyzedWidth: 1440,
    scale: 28,
    baselineBottom: 60,
    mappingConfidence: 0.94,
    underlineBands: [{center: 0.14, tolerance: 0.08, support: blocks.length}],
    blocks,
    issues: [],
    ...overrides,
  };
}

export function makeEvent(id, overrides = {}) {
  return {
    id,
    kind: 'note',
    degree: 1,
    octave: 0,
    accidental: 'none',
    underlines: 1,
    dots: 0,
    measureEnd: false,
    ...overrides,
  };
}
