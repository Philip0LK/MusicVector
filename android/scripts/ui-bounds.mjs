// 从 uiautomator dump 的 XML 里列出带文字的控件及其屏幕坐标。
// 用途：装机验证时按文字精确点击，避免靠截图目测坐标。
//
// 用法：
//   adb shell uiautomator dump /sdcard/ui.xml
//   adb pull /sdcard/ui.xml ui.xml
//   node scripts/ui-bounds.mjs ui.xml [关键字]
import {readFileSync} from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('用法：node scripts/ui-bounds.mjs <ui.xml> [关键字]');
  process.exit(1);
}
const filter = process.argv[3];
const xml = readFileSync(file, 'utf8');
const nodePattern = /<node\b[^>]*>/g;
const attribute = (tag, name) => {
  const match = tag.match(new RegExp(name + '="([^"]*)"'));
  return match ? match[1] : '';
};
let count = 0;
for (const tag of xml.match(nodePattern) || []) {
  const text = attribute(tag, 'text') || attribute(tag, 'content-desc');
  const bounds = attribute(tag, 'bounds');
  if (!text.trim() || !bounds) continue;
  if (filter && !text.includes(filter)) continue;
  const box = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!box) continue;
  const [x1, y1, x2, y2] = box.slice(1).map(Number);
  console.log(JSON.stringify({text, center: [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)], bounds: [x1, y1, x2, y2]}));
  count += 1;
}
console.log('matched:', count);
