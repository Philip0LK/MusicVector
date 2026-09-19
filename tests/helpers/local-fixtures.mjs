// 个人曲谱夹具（原曲校订草稿、早期迁入曲库）只放在本机 `local/fixtures` 下，不随仓库提供。
// 公开环境里依赖它们的用例会明确跳过；本机保留完整覆盖。
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../local/fixtures/', import.meta.url)).replace(/\\/g, '/');

/** 本机是否放好了个人夹具。 */
export function hasLocalFixtures() {
  return fs.existsSync(ROOT + 'legacy-public');
}

/** 传给 node:test 的 skip 值：有夹具时为 false，否则是跳过原因。 */
export const FIXTURE_SKIP = hasLocalFixtures()
  ? false
  : '需要 local/fixtures 下的个人曲谱夹具（不随仓库提供）';

/** `local/fixtures` 下的路径；缺夹具时返回 null，调用方据此跳过。 */
export function optionalLocalFixture(relative) {
  const file = ROOT + relative;
  return fs.existsSync(file) ? file : null;
}
