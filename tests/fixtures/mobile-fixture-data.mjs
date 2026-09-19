// 安卓端金标准 fixture 的数据构造。
//
// 所有期望值都来自电脑端正在使用的算法（rhythmPlayback / musicStructure / engraveGeometry）：
// 电脑端行为变了，这里生成的数字就会变，安卓端单测随即报错，逼着两边一起改。
import {pathToFileURL} from 'node:url';
import {buildHandoffManifest} from '../../src/handoffManifest.js';
import {allocateWidths, measureLayout, measureSegments} from '../../src/lib/engraveGeometry.js';
import {buildPitchPlan, normalizeMusicDocument} from '../../src/lib/musicStructure.js';
import {buildRhythmPlaybackPlan} from '../../src/lib/rhythmPlayback.js';
import {cropRect} from '../../src/cropGeometry.js';
import {flatten, rhythmOf} from '../../src/training.js';
import {measures as measuresOf} from '../../src/model.js';
import {optionalLocalFixture} from '../helpers/local-fixtures.mjs';

// 个人曲谱只放在本机 local/fixtures 下；没有它时只生成合成曲夹具，
// 依赖它的用例会明确跳过（见 tests/helpers/local-fixtures.mjs）。
async function optionalTrainingSong() {
  const file = optionalLocalFixture('salon-document.mjs');
  if (!file) return null;
  const {salonTrainingSong} = await import(pathToFileURL(file).href);
  return salonTrainingSong();
}

// 与 App.jsx 的 playbackPlan() 同一个调用形状。
export function planFor({document, notes, rhythm}, {startIndex, endIndex = null, tempo, baseTempo}) {
  const plan = buildRhythmPlaybackPlan(notes, rhythm, {startIndex, endIndex, tempo, baseTempo});
  return {
    startIndex: plan.startIndex,
    endIndex: plan.endIndex,
    tempo: plan.tempo,
    baseTempo: plan.baseTempo,
    practiceRate: plan.practiceRate,
    ticksPerQuarter: plan.ticksPerQuarter,
    totalSeconds: plan.totalSeconds,
    totalTicksExact: plan.totalTicksExact,
    missingIndexes: plan.missingIndexes,
    steps: plan.steps.map((step) => ({
      index: step.index,
      startTicksExact: step.startTicksExact,
      durationTicksExact: step.durationTicksExact,
      trigger: step.trigger,
      isRest: step.isRest,
      tieContinuation: step.tieContinuation,
      soundDurationTicksExact: step.soundDurationTicksExact,
      startSeconds: step.startSeconds,
      durationSeconds: step.durationSeconds,
      soundDurationSeconds: step.soundDurationSeconds,
    })),
  };
}

export function layoutFor({document, allMeasures}, containerWidth, fontSize) {
  const scale = fontSize / 24;
  const available = Math.max(1, containerWidth / scale);
  const rows = [];
  let offset = 0;
  document.rows.forEach((row, rowIndex) => {
    const segments = measureSegments(row.notes, offset, allMeasures);
    const widths = allocateWidths(segments.map((s) => s.minimum), available);
    rows.push({
      rowIndex,
      offset,
      scale,
      measures: segments.map((segment, i) => {
        const layout = measureLayout(segment.notes, segment.minimum, widths[i]);
        return {
          measureIndex: segment.measure.index,
          start: segment.start,
          minimum: segment.minimum,
          width: widths[i],
          content: layout.content,
          overflow: layout.overflow,
          items: layout.items,
          positions: layout.positions,
        };
      }),
    });
    offset += row.notes.length;
  });
  return {containerWidth, fontSize, rows};
}

const PLAN_CASES = [
  {name: 'full-default', startIndex: 0, endIndex: null, rate: 1},
  {name: 'from-first-sounding', startIndex: 18, endIndex: null, rate: 1},
  {name: 'range-4-30', startIndex: 4, endIndex: 30, rate: 1},
  {name: 'single-note-18', startIndex: 18, endIndex: 18, rate: 1.25},
  {name: 'slow-0.5', startIndex: 18, endIndex: 60, rate: 0.5},
  {name: 'fast-1.1', startIndex: 100, endIndex: 140, rate: 1.1},
  {name: 'bpm-60', startIndex: 40, endIndex: 90, rate: 1, bpm: 60},
  {name: 'bpm-120-rate-0.9', startIndex: 200, endIndex: 260, rate: 0.9, bpm: 120},
];

const KEY_CASES = [
  {key: 'E', octave: 4},
  {key: 'C', octave: 4},
  {key: 'G', octave: 3},
  {key: 'F#', octave: 5},
  {key: 'Bb', octave: 3},
];

const CROP_CASES = [
  {name: 'band-jpeg-1500x2000', crop: [0.385, 0.48], width: 1500, height: 2000},
  {name: 'band-wide-2400x1400', crop: [0.12, 0.3], width: 2400, height: 1400},
  {
    name: 'box-v2',
    crop: {version: 2, space: 'image-normalized', x: 0.05, y: 0.2, width: 0.9, height: 0.12},
    width: 1600,
    height: 2200,
  },
];

// fixture 必须可重复生成：时间戳固定，否则无法用它判断「电脑端算法是否变了」。
const FIXTURE_TIMESTAMP = '2026-01-01T00:00:00.000Z';

function buildCase({song, document, images, baseTempo}) {
  const notes = flatten(document);
  const rhythm = rhythmOf(document, {baseTempo, key: song.key, octave: song.octave});
  const allMeasures = measuresOf(document);
  const manifest = buildHandoffManifest({
    song,
    document,
    images,
    baseTempo,
    generatedAt: FIXTURE_TIMESTAMP,
  });
  const plans = PLAN_CASES.map((item) => ({
    name: item.name,
    settingBpm: item.bpm ?? song.bpm,
    rate: item.rate,
    ...planFor(
      {document, notes, rhythm},
      {
        startIndex: item.startIndex,
        endIndex: item.endIndex,
        tempo: (item.bpm ?? song.bpm) * item.rate,
        baseTempo: song.bpm,
      },
    ),
  }));
  return {
    manifest,
    plans,
    pitch: buildCasePitch({document, notes}),
    layout: [layoutFor({document, allMeasures}, 1000, 24), layoutFor({document, allMeasures}, 720, 28)],
  };
}

function buildCasePitch({document, notes}) {
  // pitchOffset 必须与基准音区无关，否则「手机上换基准音区就移调」的算法不成立。
  const byKey = KEY_CASES.map(({key, octave}) => ({
    key,
    octave,
    pitches: buildPitchPlan(document, {key, octave}),
  }));
  const offsets = notes.map((_, index) => byKey[0].pitches[index]?.accidentalOffset ?? 0);
  const invariant = byKey.every((entry) =>
    entry.pitches.every((item, index) => (item?.accidentalOffset ?? 0) === offsets[index]),
  );
  if (!invariant) throw new Error('pitchOffset 依赖基准音区，导出方案不成立');
  return {
    offsets,
    cases: byKey.map(({key, octave, pitches}) => ({
      key,
      octave,
      midis: pitches.map((item) => item?.midi ?? null),
    })),
  };
}

// 合成曲：覆盖延音合并、附点、混合时值、跨行延音与休止符——《沙龙》里这些都没出现。
export function syntheticSong() {
  const note = (id, degree, octave, annotation) => ({
    id,
    degree,
    accidental: null,
    octave,
    sourceText: null,
    annotation: {dotted: false, dots: 0, tieToNext: false, measureEnd: false, ...annotation},
  });
  const rows = [
    {
      id: 'syn-row-0',
      page: 0,
      line: 0,
      text: '1 1 2 3 | 5 5 4 3 |',
      crop: [0.1, 0.2],
      notes: [
        note('s0', 1, 0, {durationTicks: 24, tieToNext: true}),
        note('s1', 1, 0, {durationTicks: 24}),
        note('s2', 2, 0, {durationTicks: 12}),
        note('s3', 3, 0, {durationTicks: 6, dots: 1, dotted: true, measureEnd: true}),
        note('s4', 5, 0, {durationTicks: 48}),
        note('s5', 5, 0, {durationTicks: 24, tieToNext: true}),
        note('s6', 5, 0, {durationTicks: 24}),
        note('s7', 4, 0, {durationTicks: 96, measureEnd: true}),
      ],
    },
    {
      id: 'syn-row-1',
      page: 0,
      line: 1,
      text: "0 0 3' 2 | 6 6 6 6 |",
      crop: [0.3, 0.4],
      notes: [
        note('s8', 3, 1, {durationTicks: 24, tieToNext: true}),
        note('s9', 3, 1, {durationTicks: 24}),
        note('s10', 0, 0, {durationTicks: 12}),
        note('s11', 0, 0, {durationTicks: 12}),
        note('s12', 6, 0, {durationTicks: 6}),
        note('s13', 6, 0, {durationTicks: 6}),
        note('s14', 6, 0, {durationTicks: 12}),
        note('s15', 6, 0, {durationTicks: 12}),
        note('s16', 2, 0, {durationTicks: 96, measureEnd: true}),
      ],
    },
  ];
  const base = {
    version: 1,
    meter: {beats: 4, beatUnit: 4},
    pickup: false,
    rows,
    music: {arcs: [], tuplets: [], measures: []},
  };
  const document = normalizeMusicDocument(base, {key: 'C', octave: 4, bpm: 90});
  const images = [
    {id: 'syn-image-0', name: '合成曲.png', src: 'data:image/png;base64,AA==', status: 'done', result: {rows}},
  ];
  return {
    song: {id: 'synthetic', title: '合成测试曲', key: 'C', octave: 4, bpm: 90},
    document,
    images,
    baseTempo: 90,
  };
}

export async function buildAllFixtures() {
  const salonInput = await optionalTrainingSong();
  const salon = salonInput ? buildCase({song: salonInput.song, document: salonInput.document, images: salonInput.song.images, baseTempo: salonInput.song.bpm}) : null;
  const syntheticInput = syntheticSong();
  const synthetic = buildCase(syntheticInput);
  const crops = CROP_CASES.map((item) => ({
    name: item.name,
    crop: item.crop,
    width: item.width,
    height: item.height,
    rect: cropRect(item.crop, item.width, item.height),
  }));
  const syntheticNotes = flatten(syntheticInput.document);
  // meta 只放与个人夹具无关的指标，保证它在任何机器上生成的结果都一样。
  const performance = {
    syntheticNotes: syntheticNotes.length,
    tieIndexes: syntheticNotes.map((n, i) => (n.annotation?.tieToNext ? i : -1)).filter((i) => i >= 0),
  };
  return {
    salon: salon ? {...salon, crops} : null,
    synthetic,
    meta: {performance, planCases: PLAN_CASES, keyCases: KEY_CASES, cropCases: CROP_CASES.map((c) => c.name)},
  };
}
