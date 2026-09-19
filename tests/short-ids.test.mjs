// 短 ID 映射单测：双射、容量、翻译范围、未命中保持原值、不修改入参。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAliases,
  aliasForRow,
  resolveRow,
  registerHeader,
  registerRequest,
  resolveHeader,
  aliasLabel,
  shortenResponse,
  shortenHeader,
  restoreHeaderResponse,
  restoreRowsResponse,
  MAX_ROWS_PER_PAGE,
} from '../src/lib/shortIds.js';

const slices = (count) => Array.from({length: count}, (_, i) => ({id: `img-1:row-${i + 1}`}));

test('双射：12 行长 ID ↔ r1..r12，正反查一致且无重复短名', () => {
  const aliases = buildAliases(slices(12));
  assert.equal(aliases.rows.size, 12);
  assert.equal(aliases.reverse.size, 12);
  for (let i = 1; i <= 12; i += 1) {
    const long = `img-1:row-${i}`;
    assert.equal(aliasForRow(aliases, long), `r${i}`);
    assert.equal(resolveRow(aliases, `r${i}`), long);
  }
  assert.equal(aliasForRow(aliases, 'img-1:row-13'), null);
  assert.equal(resolveRow(aliases, 'r13'), null);
});

test('容量：999 行可用，1000 行立即抛错（不静默复用短名）', () => {
  assert.equal(buildAliases(slices(MAX_ROWS_PER_PAGE)).rows.size, MAX_ROWS_PER_PAGE);
  assert.throws(() => buildAliases(slices(MAX_ROWS_PER_PAGE + 1)), /超出短 ID 容量/);
});

test('非法切片：缺 id 或 id 重复都拒绝', () => {
  assert.throws(() => buildAliases([{id: 'a'}, {}]), /缺少 id/);
  assert.throws(() => buildAliases([{id: 'a'}, {id: 'a'}]), /切片 id 重复/);
});

test('页眉与请求短名：h1 / q1… 可反查，未命中返回 null', () => {
  const aliases = buildAliases(slices(3));
  assert.equal(registerHeader(aliases, 'img-1'), 'h1');
  assert.equal(resolveHeader(aliases, 'h1'), 'img-1');
  assert.equal(resolveHeader(aliases, 'h2'), null);
  assert.equal(registerRequest(aliases, 'uuid-1'), 'q1');
  assert.equal(registerRequest(aliases, 'uuid-2'), 'q2');
  assert.deepEqual([...aliases.requests.entries()], [['q1', 'uuid-1'], ['q2', 'uuid-2']]);
});

test('requestId 用自增计数器，不依赖 Map.size（并发登记不得拿到同一个短名）', () => {
  const aliases = buildAliases(slices(2));
  const first = registerRequest(aliases, 'uuid-1');
  const sizeAfterFirst = aliases.requests.size;
  const second = registerRequest(aliases, 'uuid-2');
  assert.equal(first, 'q1');
  assert.equal(second, 'q2');
  assert.notEqual(first, second);
  // 编号来自计数器而不是 Map.size：即使 size 被外部改动，编号仍单调递增、绝不回退重复
  aliases.requests.clear();
  assert.equal(aliases.requests.size, 0);
  const third = registerRequest(aliases, 'uuid-3');
  assert.equal(third, 'q3', '计数器不回退，避免并发下同一短名被分配给两次请求');
  assert.ok(sizeAfterFirst >= 1);
});

test('shortenResponse：翻 rowId 与跨行端点，且只翻这两类位置', () => {
  const aliases = buildAliases(slices(3));
  const parsed = {
    requestId: 'q1',
    rows: [
      // 弧线形态 [起点, 终点, 连音数字]：同行端点是音符序号(数字)，跨行端点是 [rowId, 音符序号]
      {rowId: 'r1', symbols: '1 2', arcs: [[1, ['r3', 2], 3], [['r2', 1], 4, null]], tuplets: [[3, null, [1, 2]]], lyrics: ['歌词'], issues: [[1, '看不清']], meterMarks: [[0, 2, 4]]},
      {rowId: 'r2', symbols: '3 4', arcs: [], tuplets: [], lyrics: [], issues: []},
    ],
  };
  const out = shortenResponse(parsed, aliases);
  assert.deepEqual(out.rows.map((r) => r.rowId), ['img-1:row-1', 'img-1:row-2']);
  assert.deepEqual(out.rows[0].arcs[0], [1, ['img-1:row-3', 2], 3], '终点位置的跨行端点翻成长 ID');
  assert.deepEqual(out.rows[0].arcs[1], [['img-1:row-2', 1], 4, null], '起点位置的跨行端点同样翻');
  assert.deepEqual(out.rows[0].tuplets, [[3, null, [1, 2]]], '连音组成员是行内音符序号，不动');
  assert.deepEqual(out.rows[0].issues, [[1, '看不清']], 'issues 目标是音符序号，不动');
  assert.deepEqual(out.rows[0].lyrics, ['歌词'], '歌词文本不动');
  assert.deepEqual(out.rows[0].meterMarks, [[0, 2, 4]], '小节区段号不动');
  assert.equal(out.requestId, 'q1', 'requestId 原样保留，由契约比对');
});

test('shortenResponse：不修改入参（归档 partial 引用同一份响应）', () => {
  const aliases = buildAliases(slices(2));
  const parsed = {requestId: 'q1', rows: [{rowId: 'r1', symbols: '1', arcs: [['r2', 1]], tuplets: [], lyrics: [], issues: []}]};
  const snapshot = JSON.stringify(parsed);
  shortenResponse(parsed, aliases);
  assert.equal(JSON.stringify(parsed), snapshot, '入参必须原封不动');
});

test('未命中的短名保持原值，交出后续分支判定', () => {
  const aliases = buildAliases(slices(2));
  const parsed = {
    requestId: 'q1',
    rows: [
      {rowId: 'r9', symbols: '1', arcs: [['r8', 1]], tuplets: [], lyrics: [], issues: []},
      {rowId: 'img-1:row-2', symbols: '2', arcs: [], tuplets: [], lyrics: [], issues: []},
    ],
  };
  const out = shortenResponse(parsed, aliases);
  assert.equal(out.rows[0].rowId, 'r9', '未知短名不猜测');
  assert.deepEqual(out.rows[0].arcs[0], ['r8', 1], '未知端点点保持原值');
  assert.equal(out.rows[1].rowId, 'img-1:row-2', '已经是长 ID 的原样通过');
});

test('shortenResponse：缺 rows 或结构异常时安全返回', () => {
  const aliases = buildAliases(slices(1));
  assert.equal(shortenResponse(null, aliases), null);
  assert.deepEqual(shortenResponse({requestId: 'q1'}, aliases), {requestId: 'q1'});
});

test('shortenHeader：翻回长 imageId；未知保持原值', () => {
  const aliases = buildAliases(slices(1));
  registerHeader(aliases, 'img-1');
  assert.equal(shortenHeader({headerId: 'h1'}, aliases).headerId, 'img-1');
  assert.equal(shortenHeader({headerId: 'zz'}, aliases).headerId, 'zz');
  assert.equal(shortenHeader({headerId: 'img-1'}, aliases).headerId, 'img-1');
});

test('restoreHeaderResponse：requestId 与 headerId 都要翻回长值（漏翻 requestId 会报「基础信息 ID」）', () => {
  const aliases = buildAliases(slices(1));
  registerHeader(aliases, 'img-1');
  const short = registerRequest(aliases, 'uuid-1');
  assert.equal(short, 'q1');
  const restored = restoreHeaderResponse({requestId: 'q1', headerId: 'h1', title: '歌'}, aliases);
  assert.deepEqual(restored, {requestId: 'uuid-1', headerId: 'img-1', title: '歌'});
});

test('restoreRowsResponse：requestId 翻回长值，行与跨行端点翻回长 rowId', () => {
  const aliases = buildAliases(slices(2));
  const short = registerRequest(aliases, 'uuid-1');
  assert.equal(short, 'q1');
  const restored = restoreRowsResponse(
    {requestId: 'q1', rows: [{rowId: 'r2', symbols: '1', arcs: [[1, ['r1', 1], null]], tuplets: [], lyrics: [], issues: []}]},
    aliases,
  );
  assert.equal(restored.requestId, 'uuid-1');
  assert.equal(restored.rows[0].rowId, 'img-1:row-2');
  assert.deepEqual(restored.rows[0].arcs[0], [1, ['img-1:row-1', 1], null]);
});

test('未登记的 requestId 保持原值（交由契约比对并报错）', () => {
  const aliases = buildAliases(slices(1));
  const parsed = {requestId: 'q9', rows: [{rowId: 'r1', symbols: '1', arcs: [], tuplets: [], lyrics: [], issues: []}]};
  assert.equal(restoreRowsResponse(parsed, aliases).requestId, 'q9');
});

test('aliasLabel：错误文案用「短名(长名)」，未登记原样', () => {
  const aliases = buildAliases(slices(2));
  const label = aliasLabel(aliases);
  assert.equal(label('img-1:row-1'), 'r1(img-1:row-1)');
  assert.equal(label('img-1:row-9'), 'img-1:row-9');
});
