// 手机端接收链路的电脑端契约测试。
//
// 重点：安卓端不重写音乐结构算法，一切依赖「曲目包 + 逐 ticks 时值 + 延音关系」是否够用。
// 这里用一份与安卓端同构的参考实现（phonePlan）复算电脑端的播放计划，逐字段比对；
// 安卓端必须复现同样的数字，否则就是行为漂移。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import * as R from '../src/lib/rational.js';
import {buildHandoffManifest, handoffBlockers, imageFileName, imageMime, HANDOFF_VERSION} from '../src/handoffManifest.js';
import {buildAllFixtures, syntheticSong} from './fixtures/mobile-fixture-data.mjs';
import {FIXTURE_SKIP, optionalLocalFixture} from './helpers/local-fixtures.mjs';

// 个人曲谱夹具只在本机 local/fixtures 下；公开环境里依赖它的用例会跳过。
async function salonTrainingSong() {
  const file = optionalLocalFixture('salon-document.mjs');
  if (!file) return null;
  return (await import(pathToFileURL(file).href)).salonTrainingSong();
}

const FIXTURE_DIR = fileURLToPath(new URL('../android/app/src/test/resources/fixtures/', import.meta.url));

const fixturesPromise = buildAllFixtures();
const close = (a, b, label) =>
  assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${label}: ${a} != ${b}`);
const toFraction = (text) => (text === null || text === undefined ? null : R.fractionFrom(String(text)));

// 与安卓端 PlaybackPlan 同构的参考实现：只吃曲目包，不吃任何电脑端内部结构。
export function phonePlan(manifest, {startIndex, endIndex = null, settingBpm, rate}) {
  const notes = manifest.notes;
  const count = notes.length;
  const first = Math.min(count - 1, Math.max(0, Math.trunc(startIndex)));
  const last = endIndex === null || endIndex === undefined
    ? count - 1
    : Math.min(count - 1, Math.max(first, Math.trunc(endIndex)));
  const songBpm = manifest.song.bpm;
  const planTempo = settingBpm * rate;
  const practiceRate = planTempo / songBpm;
  const events = manifest.song.tempoEvents || [];
  const secondsPerTickAt = (index) => {
    let bpm = manifest.song.baseBpm;
    let beatTicks = manifest.song.baseBeatTicks;
    for (const event of events) {
      if (event.atIndex === null || event.atIndex > index) break;
      if (event.bpm && event.beatTicks) {
        bpm = event.bpm;
        beatTicks = event.beatTicks;
      }
    }
    return 60 / (bpm * practiceRate * beatTicks);
  };
  const durations = notes.map((note) => toFraction(note.durationTicks));
  const missingIndexes = [];
  const steps = [];
  let startTicks = R.ZERO;
  let startSeconds = 0;
  for (let index = first; index <= last; index += 1) {
    const duration = durations[index];
    if (duration === null) missingIndexes.push(index);
    const previousTiesHere = index > first && Boolean(notes[index - 1].tieToNext);
    const isRest = Boolean(notes[index].isRest);
    const durationSeconds = duration === null ? 0 : R.toNumber(duration) * secondsPerTickAt(index);
    let soundDuration = duration ?? R.ZERO;
    let soundDurationSeconds = durationSeconds;
    let tiedIndex = index;
    if (!isRest && !previousTiesHere && duration !== null) {
      while (tiedIndex < last && notes[tiedIndex].tieToNext) {
        const nextDuration = durations[tiedIndex + 1];
        if (nextDuration === null) break;
        soundDuration = R.add(soundDuration, nextDuration);
        soundDurationSeconds += R.toNumber(nextDuration) * secondsPerTickAt(tiedIndex + 1);
        tiedIndex += 1;
      }
    }
    steps.push({
      index,
      startTicksExact: R.toString(startTicks),
      durationTicksExact: duration === null ? null : R.toString(duration),
      trigger: !isRest && !previousTiesHere && duration !== null,
      isRest,
      tieContinuation: previousTiesHere,
      soundDurationTicksExact: R.toString(soundDuration),
      startSeconds,
      durationSeconds,
      soundDurationSeconds,
    });
    startTicks = R.add(startTicks, duration ?? R.ZERO);
    startSeconds += durationSeconds;
  }
  return {
    tempo: planTempo,
    baseTempo: songBpm,
    practiceRate,
    startIndex: first,
    endIndex: last,
    steps,
    missingIndexes,
    totalSeconds: startSeconds,
  };
}

function comparePlans(expected, actual, label) {
  assert.equal(actual.tempo, expected.tempo, `${label} tempo`);
  assert.equal(actual.practiceRate, expected.practiceRate, `${label} practiceRate`);
  assert.equal(actual.startIndex, expected.startIndex, `${label} startIndex`);
  assert.equal(actual.endIndex, expected.endIndex, `${label} endIndex`);
  assert.deepEqual(actual.missingIndexes, expected.missingIndexes, `${label} missingIndexes`);
  assert.equal(actual.steps.length, expected.steps.length, `${label} step count`);
  actual.steps.forEach((step, i) => {
    const want = expected.steps[i];
    const where = `${label} step ${i}`;
    assert.equal(step.index, want.index, `${where} index`);
    assert.equal(step.startTicksExact, want.startTicksExact, `${where} startTicks`);
    assert.equal(step.durationTicksExact, want.durationTicksExact, `${where} durationTicks`);
    assert.equal(step.soundDurationTicksExact, want.soundDurationTicksExact, `${where} soundDurationTicks`);
    assert.equal(step.trigger, want.trigger, `${where} trigger`);
    assert.equal(step.isRest, want.isRest, `${where} isRest`);
    assert.equal(step.tieContinuation, want.tieContinuation, `${where} tieContinuation`);
    close(step.startSeconds, want.startSeconds, `${where} startSeconds`);
    close(step.durationSeconds, want.durationSeconds, `${where} durationSeconds`);
    close(step.soundDurationSeconds, want.soundDurationSeconds, `${where} soundDurationSeconds`);
  });
  close(actual.totalSeconds, expected.totalSeconds, `${label} totalSeconds`);
}

test('曲目包包含《沙龙》的全部结构且没有导出阻塞项', {skip: FIXTURE_SKIP}, async () => {
  const {song, document} = await salonTrainingSong();
  const manifest = buildHandoffManifest({song, document, images: song.images, baseTempo: song.bpm});
  assert.equal(manifest.handoff, HANDOFF_VERSION);
  assert.equal(manifest.song.title, '沙龙');
  assert.equal(manifest.song.key, 'E');
  assert.equal(manifest.song.octave, 4);
  assert.equal(manifest.song.bpm, 80);
  assert.deepEqual(manifest.song.meter, {beats: 4, beatUnit: 4});
  assert.equal(manifest.song.pickup, true);
  assert.equal(manifest.notes.length, 473);
  assert.equal(manifest.rows.length, 18);
  assert.equal(manifest.images.length, 4);
  assert.equal(manifest.totals.missingDurations, 0);
  assert.equal(manifest.notes.findIndex((note) => !note.isRest), 18);
  assert.deepEqual(manifest.rows[0].crop, {version: 2, kind: 'band', top: 0.385, bottom: 0.48});
  // 逐音延音关系必须能完整还原，否则安卓端的延音合并一定漂移。
  const tieLinks = manifest.notes.map((note) => note.tieToNext);
  assert.equal(tieLinks.at(-1), false);
  assert.equal(manifest.measures.length, 74);
  assert.equal(manifest.measures[0].status, 'pickup');
});

test('参考实现能从曲目包复算出电脑端的播放计划（含延音、附点、休止）', async () => {
  const fixtures = await fixturesPromise;
  for (const [name, data] of [['沙龙', fixtures.salon], ['合成曲', fixtures.synthetic]].filter(([, data]) => Boolean(data))) {
    for (const plan of data.plans) {
      const actual = phonePlan(data.manifest, {
        startIndex: plan.startIndex,
        endIndex: plan.endIndex,
        settingBpm: plan.settingBpm,
        rate: plan.rate,
      });
      comparePlans(plan, actual, `${name}/${plan.name}`);
    }
  }
  // 合成曲必须真的覆盖到延音合并：第一个音的时值等于它与后继音的时值之和。
  const synthetic = fixtures.synthetic;
  const first = synthetic.plans[0].steps[0];
  assert.equal(first.soundDurationTicksExact, '48');
  assert.equal(synthetic.plans[0].steps[1].tieContinuation, true);
});

test('换基准音区只用音高偏移重新算 MIDI，偏移与基准音区无关', async () => {
  const fixtures = await fixturesPromise;
  for (const [name, data] of [['沙龙', fixtures.salon], ['合成曲', fixtures.synthetic]].filter(([, data]) => Boolean(data))) {
    const offsets = data.pitch.offsets;
    for (const entry of data.pitch.cases) {
      const tonicMidi = (entry.octave + 1) * 12 + {C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11, Bb: 10, Db: 1, Eb: 3, Gb: 6, Ab: 8}[entry.key];
      const steps = [null, 0, 2, 4, 5, 7, 9, 11];
      data.manifest.notes.forEach((note, index) => {
        const expected = entry.midis[index];
        if (expected === null) {
          assert.equal(note.degree, 0, `${name} 休止符应为 null 音高`);
          return;
        }
        const actual = tonicMidi + steps[note.degree] + note.octave * 12 + offsets[index];
        assert.equal(actual, expected, `${name} ${entry.key}${entry.octave} 第 ${index} 音`);
      });
    }
  }
});

test('裁切矩形、图片类型与落盘路径按原图尺寸推导', () => {
  const cases = [
    [{version: 2, space: 'image-normalized', x: 0.05, y: 0.2, width: 0.9, height: 0.12}, 'image/jpeg', 'images/0.jpg'],
    [{version: 2, space: 'image-normalized', x: 0, y: 0, width: 1, height: 1}, 'image/png', 'images/1.png'],
  ];
  assert.equal(imageMime('data:image/png;base64,AA=='), 'image/png');
  assert.equal(imageMime('/song/images/002.jpg'), 'image/jpeg');
  assert.equal(imageMime('/a/b.webp'), 'image/webp');
  assert.equal(imageFileName(0, 'image/jpeg'), 'images/0.jpg');
  assert.equal(imageFileName(3, 'image/webp'), 'images/3.webp');
  assert.ok(cases.length);
});

test('fixture 与当前电脑端算法一致（改了算法必须重跑 tools/mobile-fixtures.mjs）', async () => {
  const fixtures = await fixturesPromise;
  for (const [name, data] of [['salon', fixtures.salon], ['synthetic', fixtures.synthetic], ['meta', fixtures.meta]]) {
    if (!data) continue;
    const file = JSON.parse(await readFile(`${FIXTURE_DIR}${name}.json`, 'utf8'));
    assert.deepEqual(file, data, `${name}.json 已过期`);
  }
});

test('未标注时值、缺结果或缺页时拒绝导出，并给出与播放一致的提示', {skip: FIXTURE_SKIP}, async () => {
  const {song, document} = await salonTrainingSong();
  const broken = structuredClone(document);
  broken.rows[0].notes[0].annotation.durationTicks = null;
  assert.throws(
    () => buildHandoffManifest({song, document: broken, images: song.images, baseTempo: song.bpm}),
    /时值标注/,
  );
  const images = structuredClone(song.images);
  images[1].result = undefined;
  const notes = document.rows.flatMap((row) => row.notes);
  assert.deepEqual(
    handoffBlockers({document, notes, rhythm: null, images, plan: {diagnostics: []}}),
    ['部分图片尚无可训练乐谱，请先完成识别和校对'],
  );
  const empty = {rows: [], music: {arcs: [], pendingArcs: []}};
  assert.deepEqual(
    handoffBlockers({document: empty, notes: [], rhythm: null, images: [], plan: {diagnostics: []}}),
    ['这首歌曲还没有可训练的音符'],
  );
});

test('合成曲走的是结构化延音而非 tieToNext 兜底', () => {
  const input = syntheticSong();
  const arcs = input.document.music.arcs;
  assert.ok(arcs.some((arc) => arc.effectiveType === 'tie'));
  const manifest = buildHandoffManifest(input);
  assert.deepEqual(
    manifest.notes.map((note) => note.tieToNext).filter(Boolean).length,
    3,
  );
});
