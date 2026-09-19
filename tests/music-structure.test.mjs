import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  analyzeMusicDocument,
  buildPitchPlan,
  effectiveDurationFraction,
  normalizeMusicDocument,
  summarizeMusicMeasures,
  tieLinksForDocument,
} from "../src/lib/musicStructure.js";
import { buildRhythmPlaybackPlan } from "../src/lib/rhythmPlayback.js";
import { flatten, rhythmOf } from "../src/training.js";
import { documentFromImages } from "../src/recovery.js";
import { FIXTURE_SKIP, optionalLocalFixture } from "./helpers/local-fixtures.mjs";

function note(id, options = {}) {
  const {
    degree = 1,
    accidental = null,
    octave = 0,
    durationTicks = 24,
    dots = 0,
    tieToNext = false,
    measureEnd = false,
    ...annotation
  } = options;
  return {
    id,
    degree,
    accidental,
    octave,
    annotation: { durationTicks, dots, dotted: dots > 0, tieToNext, measureEnd, ...annotation },
  };
}

function row(page, line, notes, id = `r${page}-${line}`) {
  return { id, page, line, text: "", crop: [0.1, 0.2], notes };
}

function sheet(rows, music = {}, top = {}) {
  const base = {
    version: 1,
    key: "C",
    octave: 4,
    meter: { beats: 4, beatUnit: 4 },
    pickup: false,
    ...top,
  };
  const value = { ...base, rows };
  if (music !== null) value.music = { version: 1, defaultMeter: base.meter, pickup: base.pickup, ...music };
  return value;
}

function planFor(doc, options = {}) {
  const normalized = doc.music ? doc : normalizeMusicDocument(doc, { key: doc.key, octave: doc.octave, bpm: 80 });
  const notes = flatten(normalized);
  const rhythm = rhythmOf(normalized, { baseTempo: 80, key: normalized.key, octave: normalized.octave });
  return buildRhythmPlaybackPlan(notes, rhythm, { tempo: 80, baseTempo: 80, ...options });
}

function planSteps(plan) {
  return plan.steps.map((step) => ({
    index: step.index,
    durationTicksExact: step.durationTicksExact,
    startTicksExact: step.startTicksExact,
    trigger: step.trigger,
    tieContinuation: step.tieContinuation,
    soundDurationTicks: step.soundDurationTicks,
  }));
}

test("旧沙龙与迁入三首保真：音符、ID、时值、播放总时长不变且迁移幂等", { skip: FIXTURE_SKIP }, () => {
  const draftBytes = fs.readFileSync(optionalLocalFixture("legacy-public/song/corrected-draft.json"));
  const draft = JSON.parse(draftBytes).document;
  const draftNotes = flatten(draft);
  const draftPlan = buildRhythmPlaybackPlan(draftNotes, rhythmOf(draft), { tempo: 80 });
  const normalizedDraft = normalizeMusicDocument(draft, { key: "E", octave: 4, bpm: 80 });
  assert.deepEqual(normalizedDraft.rows, draft.rows);
  const upgradedNotes = flatten(normalizedDraft);
  assert.deepEqual(upgradedNotes.map((item) => item.id), draftNotes.map((item) => item.id));
  const upgradedPlan = buildRhythmPlaybackPlan(upgradedNotes, rhythmOf(normalizedDraft, { baseTempo: 80, key: "E", octave: 4 }), { tempo: 80, baseTempo: 80 });
  assert.equal(upgradedPlan.totalTicks, draftPlan.totalTicks);
  assert.equal(upgradedPlan.totalSeconds, draftPlan.totalSeconds);
  assert.deepEqual(planSteps(upgradedPlan), planSteps(draftPlan));
  assert.equal(new Set(upgradedNotes.map((item) => item.id)).size, 473);
  assert.equal(normalizedDraft.music.version, 1);
  const again = normalizeMusicDocument(normalizedDraft, { key: "E", octave: 4, bpm: 80 });
  assert.deepEqual(again.music, normalizedDraft.music);

  const legacySongs = JSON.parse(fs.readFileSync(optionalLocalFixture("legacy-public/legacy/library.json")));
  assert.equal(legacySongs.length, 3);
  for (const song of legacySongs) {
    const assembled = documentFromImages({ ...song, meter: song.meter, pickup: song.pickup }, song.images);
    const beforeNotes = flatten(assembled);
    const beforePlan = buildRhythmPlaybackPlan(beforeNotes, rhythmOf(assembled), { tempo: song.bpm });
    const beforeRows = JSON.stringify(assembled.rows);
    const normalized = normalizeMusicDocument(assembled, { key: song.key, octave: song.octave, bpm: song.bpm });
    assert.equal(JSON.stringify(normalized.rows), beforeRows, `${song.title} 行数据无损`);
    const afterNotes = flatten(normalized);
    assert.deepEqual(afterNotes.map((item) => item.id), beforeNotes.map((item) => item.id));
    const afterPlan = buildRhythmPlaybackPlan(afterNotes, rhythmOf(normalized, { baseTempo: song.bpm, key: song.key, octave: song.octave }), { tempo: song.bpm, baseTempo: song.bpm });
    assert.equal(afterPlan.totalTicks, beforePlan.totalTicks);
    assert.equal(afterPlan.totalSeconds, beforePlan.totalSeconds);
    assert.deepEqual(planSteps(afterPlan), planSteps(beforePlan));
  }
});

test("精确时值：0/1/2 附点与常见连音比例，非等时值且无累计舍入", () => {
  const ratios = [
    { actual: 2, normal: 3, expected: "36" },
    { actual: 3, normal: 2, expected: "16" },
    { actual: 4, normal: 3, expected: "18" },
    { actual: 5, normal: 4, expected: "96/5" },
    { actual: 6, normal: 4, expected: "16" },
    { actual: 7, normal: 4, expected: "96/7" },
  ];
  const notes = ratios.map((item, index) => note(`n${index}`, { durationTicks: 24 }));
  const doc = sheet([row(0, 0, notes)], {
    tuplets: ratios.map((item, index) => ({ id: `t${index}`, actual: item.actual, normal: item.normal, memberIds: [`n${index}`] })),
  });
  const plan = planFor(doc, { tempo: 80 });
  ratios.forEach((item, index) => {
    assert.equal(plan.steps[index].durationTicksExact, item.expected, `${item.actual}:${item.normal}`);
  });

  const unequal = sheet([row(0, 0, [note("u0", { durationTicks: 24 }), note("u1", { durationTicks: 12 }), note("u2", { durationTicks: 48 })])], {
    tuplets: [{ id: "u", actual: 3, normal: 2, memberIds: ["u0", "u1", "u2"] }],
  });
  const unequalPlan = planFor(unequal, { tempo: 80 });
  assert.deepEqual(unequalPlan.steps.map((step) => step.durationTicksExact), ["16", "8", "32"]);
  assert.deepEqual(unequalPlan.steps.map((step) => step.startTicksExact), ["0", "16", "24"]);
  assert.equal(unequalPlan.totalTicksExact, "56");
  assert.equal(unequalPlan.totalSecondsExact, "7/4");

  const dotted = sheet([row(0, 0, [note("d0", { durationTicks: 24, dots: 2 })])]);
  const dottedPlan = planFor(dotted, { tempo: 80 });
  assert.equal(dottedPlan.steps[0].durationTicksExact, "42");
  assert.equal(dottedPlan.steps[0].durationTicks, 42);

  const withRest = sheet([row(0, 0, [note("q0", { degree: 0 }), note("q1"), note("q2")])], {
    tuplets: [{ id: "q", actual: 3, normal: 2, memberIds: ["q0", "q1", "q2"] }],
  });
  const restPlan = planFor(withRest, { tempo: 80 });
  assert.equal(restPlan.steps[0].trigger, false);
  assert.equal(restPlan.steps[0].isRest, true);
  assert.equal(restPlan.steps[0].durationTicksExact, "16");
  assert.equal(restPlan.totalTicksExact, "48");
  assert.equal(effectiveDurationFraction({ durationTicks: 24, dots: 1 }).n, 36n);
});

test("小节身份与拍号：跨行小节、弱起/不完整有预期与实际长度，不通过凑拍改音符", () => {
  const rows = [
    row(0, 0, [note("a"), note("b")]),
    row(0, 1, [note("c", { durationTicks: 48 })]),
  ];
  const normalized = normalizeMusicDocument(sheet(rows, {
    pickup: true,
    measures: [
      { id: "m1", noteIds: ["a"], startNoteId: "a", endNoteId: "a", meter: { beats: 4, beatUnit: 4 }, pickup: true, expectedTicks: 96 },
      { id: "m2", noteIds: ["b", "c"], startNoteId: "b", endNoteId: "c", meter: { beats: 3, beatUnit: 4 } },
    ],
  }, { pickup: true }), { key: "C", octave: 4, bpm: 80 });
  const [m1, m2] = normalized.music.measures;
  assert.equal(m1.id, "m1");
  assert.equal(m1.status, "under");
  assert.equal(m1.actualTicks, 24);
  assert.equal(m1.expectedTicks, 96);
  assert.equal(m2.id, "m2");
  assert.equal(m2.meter.beats, 3);
  assert.equal(m2.meter.beatUnit, 4);
  assert.equal(m2.actualTicks, 72);
  assert.equal(m2.expectedTicks, 72);
  assert.equal(m2.status, "valid");
  assert.deepEqual(m2.noteIds, ["b", "c"]);
  assert.equal(m2.startIndex, 1);
  assert.equal(m2.endIndex, 2);
  assert.deepEqual(normalized.music.defaultMeter, { beats: 4, beatUnit: 4 });
  assert.equal(flatten(normalized)[0].annotation.durationTicks, 24);
  assert.equal(flatten(normalized)[2].annotation.durationTicks, 48);
  const summary = summarizeMusicMeasures(normalized);
  assert.equal(summary[0].status, "under");
  assert.equal(summary[1].meter.beatUnit, 4);
});

test("弧线：auto 同音成 tie、异音成 slur、显式 slur 优先且长弧线不合并内部同音", () => {
  const analyze = (notes, arcs, top = {}) => analyzeMusicDocument(sheet([row(0, 0, notes)], { arcs, pitchSemantics: "legacy" }, top), { key: "C", octave: 4 });
  const same = analyze([note("a"), note("b")], [{ id: "auto", type: "auto", fromNoteId: "a", toNoteId: "b" }]);
  assert.equal(same.music.arcs[0].effectiveType, "tie");
  assert.deepEqual(same.tieLinks, [true]);
  assert.equal(planFor(sheet([row(0, 0, [note("a"), note("b")])], { arcs: [{ id: "auto", type: "auto", fromNoteId: "a", toNoteId: "b" }] })).steps[1].trigger, false);

  const different = analyze([note("a"), note("b", { degree: 2 })], [{ id: "auto", type: "auto", fromNoteId: "a", toNoteId: "b" }]);
  assert.equal(different.music.arcs[0].effectiveType, "slur");
  assert.deepEqual(different.tieLinks, [false]);

  const slur = analyze([note("a"), note("b")], [{ id: "slur", type: "slur", fromNoteId: "a", toNoteId: "b" }]);
  assert.deepEqual(slur.tieLinks, [false]);

  const longSlurWins = analyze([note("a"), note("b"), note("c")], [
    { id: "auto", type: "auto", fromNoteId: "a", toNoteId: "b" },
    { id: "slur", type: "slur", fromNoteId: "a", toNoteId: "c" },
  ]);
  assert.deepEqual(longSlurWins.tieLinks, [false, false]);

  const legacyOverridden = analyze([{ ...note("a"), annotation: { durationTicks: 24, tieToNext: true } }, note("b")], [
    { id: "slur", type: "slur", fromNoteId: "a", toNoteId: "b" },
  ]);
  assert.deepEqual(legacyOverridden.tieLinks, [false]);

  const longAuto = analyze([note("a"), note("b"), note("c")], [{ id: "long-auto", type: "auto", fromNoteId: "a", toNoteId: "c" }]);
  assert.equal(longAuto.music.arcs[0].status, "invalid");
  assert(longAuto.music.diagnostics.some((item) => item.code === "AUTO_ARC_NOT_ADJACENT"));
  assert.deepEqual(longAuto.tieLinks, [false, false]);

  // 弧线是无序的一对端点：两端写反不视为错误，按文档顺序纠正后照常参与延音合并与渲染。
  const flipped = analyze([note("a"), note("b")], [{ id: "flipped", type: "auto", fromNoteId: "b", toNoteId: "a" }]);
  assert.equal(flipped.music.arcs[0].fromNoteId, "a");
  assert.equal(flipped.music.arcs[0].toNoteId, "b");
  assert.equal(flipped.music.arcs[0].status, "valid");
  assert.deepEqual(flipped.tieLinks, [true]);
  assert.equal(flipped.music.diagnostics.some((item) => item.severity === "error"), false);
  assert(flipped.music.diagnostics.some((item) => item.code === "ARC_DIRECTION_NORMALIZED"));
  const flippedLong = analyze([note("a"), note("b"), note("c")], [{ id: "flipped-long", type: "auto", fromNoteId: "c", toNoteId: "a" }]);
  assert.equal(flippedLong.music.arcs[0].status, "invalid");
  assert.equal(flippedLong.music.arcs[0].reason, "AUTO_ARC_NOT_ADJACENT");
  assert.equal(flippedLong.music.arcs[0].fromIndex < flippedLong.music.arcs[0].toIndex, true);
  assert.equal(flippedLong.music.diagnostics.some((item) => item.severity === "error"), false);

  const mismatch = analyze([note("a"), note("b", { degree: 2 })], [{ id: "bad-tie", type: "tie", fromNoteId: "a", toNoteId: "b" }]);
  assert.equal(mismatch.music.arcs[0].status, "invalid");
  assert(mismatch.music.arcs[0].reason, "ARC_TIE_PITCH_MISMATCH");
  assert.deepEqual(mismatch.tieLinks, [false]);
  assert(buildRhythmPlaybackPlan(flatten(sheet([row(0, 0, [note("a"), note("b", { degree: 2 })])], { arcs: [{ id: "bad-tie", type: "tie", fromNoteId: "a", toNoteId: "b" }] })), rhythmOf(sheet([row(0, 0, [note("a"), note("b", { degree: 2 })])], { arcs: [{ id: "bad-tie", type: "tie", fromNoteId: "a", toNoteId: "b" }] })), {}).differentPitchTies.length, 1);

  const restTie = analyze([note("a"), note("b", { degree: 0 })], [{ id: "rest-tie", type: "tie", fromNoteId: "a", toNoteId: "b" }]);
  assert(restTie.music.diagnostics.some((item) => item.code === "ARC_TIE_CROSSES_REST"));
  assert.deepEqual(restTie.tieLinks, [false]);

  const crossRow = sheet([row(0, 0, [note("cr0")]), row(0, 1, [note("cr1")])], {
    measures: [
      { id: "cm1", noteIds: ["cr0"], meter: { beats: 4, beatUnit: 4 } },
      { id: "cm2", noteIds: ["cr1"], meter: { beats: 4, beatUnit: 4 } },
    ],
    arcs: [{ id: "cross-tie", type: "tie", fromNoteId: "cr0", toNoteId: "cr1" }],
  });
  const crossAnalysis = analyzeMusicDocument(crossRow, { key: "C", octave: 4 });
  assert.deepEqual(crossAnalysis.tieLinks, [true]);
  assert.equal(planFor(crossRow).steps[0].soundDurationTicks, 48);
  assert.equal(planFor(crossRow).steps[1].trigger, false);

  const legacy = sheet([row(0, 0, [{ ...note("l0"), annotation: { durationTicks: 24, tieToNext: true } }, note("l1")])], null);
  assert.deepEqual(tieLinksForDocument(legacy), [true]);
  assert.equal(planFor(legacy).steps[1].trigger, false);
});

test("音高：升降还原小节作用域、八度、转调、超范围诊断，且旧逐音语义不变", () => {
  const notes = [
    note("a", { degree: 1, accidental: "#" }),
    note("b", { degree: 1 }),
    note("c", { degree: 1, accidental: "natural" }),
    note("d", { degree: 1 }),
    note("e", { degree: 1, octave: 1 }),
    note("f", { degree: 1 }),
    note("g", { degree: 1, octave: -2 }),
    note("h", { degree: 1, octave: 3 }),
  ];
  const doc = sheet([row(0, 0, notes)], {
    pitchSemantics: "measured",
    measures: [
      { id: "pm1", noteIds: ["a", "b", "c", "d", "e"] },
      { id: "pm2", noteIds: ["f", "g", "h"] },
    ],
    pitchContexts: [],
  });
  const pitches = buildPitchPlan(doc, { key: "C", octave: 4 });
  assert.equal(pitches[0].midi, 61);
  assert.equal(pitches[1].midi, 61, "同小节同音级同八度沿用升号");
  assert.equal(pitches[2].midi, 60, "还原号取消临时升降");
  assert.equal(pitches[3].midi, 60);
  assert.equal(pitches[4].midi, 72, "不同八度不受影响");
  assert.equal(pitches[5].midi, 60, "新小节重置临时记号");
  assert.equal(pitches[6].midi, 36, "支持相对八度 -2");
  assert.equal(pitches[7].midi, 96, "超出范围保留不截断");
  assert.deepEqual(pitches[0].notation, { degree: 1, accidental: "#", octave: 0 });
  assert.equal(notes[0].accidental, "#", "原记谱字段不被实际音高覆盖");
  const warnings = analyzeMusicDocument(doc, { key: "C", octave: 4 }).music.diagnostics;
  assert(warnings.some((item) => item.code === "PITCH_OCTAVE_OUT_OF_RANGE" && item.noteId === "h"));

  const modulation = sheet([row(0, 0, [note("mod"), note("mod2")])], {
    pitchSemantics: "measured",
    measures: [{ id: "mod-measure", noteIds: ["mod", "mod2"] }],
    pitchContexts: [
      { id: "kc", atNoteId: "mod", key: "1=C4", explicit: true },
      { id: "kg", atNoteId: "mod2", key: "1=G4", explicit: true },
    ],
  });
  const modulated = buildPitchPlan(modulation, { key: "C", octave: 4 });
  assert.equal(modulated[0].midi, 60);
  assert.equal(modulated[1].midi, 67, "转调位置后实际音高随调中心改变");

  const legacy = sheet([row(0, 0, [{ ...note("legacy0"), accidental: "#" }, note("legacy1")])], null);
  const legacyPitches = buildPitchPlan(legacy, { key: "C", octave: 4 });
  assert.equal(legacyPitches[0].midi, 61);
  assert.equal(legacyPitches[1].midi, 60, "旧数据仍为逐音 accidental 语义");
  assert.equal(analyzeMusicDocument(legacy, { key: "C", octave: 4 }).music.pitchSemantics, "legacy");
});

test("速度：保存拍单位、明确位置速度变化、旧默认四分音符与练习倍速乘整个时间过程", () => {
  const notes = [note("ta"), note("tb", { durationTicks: 12 }), note("tc")];
  const doc = sheet([row(0, 0, notes)], {
    baseTempo: { bpm: 80, beat: { durationTicks: 24, dots: 0 } },
    tempoEvents: [
      { id: "te0", atNoteId: "ta", bpm: 80, beat: { durationTicks: 24, dots: 0 } },
      { id: "te1", atNoteId: "tb", bpm: 120, beat: { durationTicks: 24, dots: 1 } },
    ],
  });
  const normalized = normalizeMusicDocument(doc, { key: "C", octave: 4, bpm: 80 });
  assert.equal(normalized.music.baseTempo.beat.durationTicks, 24);
  assert.equal(normalized.music.tempoEvents[1].beat.dots, 1);
  assert.equal(normalized.music.tempoEvents[1].beatTicks, 36);
  const basePlan = planFor(normalized, { tempo: 80, baseTempo: 80 });
  assert.deepEqual(basePlan.steps.map((step) => step.startSeconds), [0, 0.75, 0.75 + 1 / 6]);
  assert.equal(basePlan.totalSecondsExact, "5/4");
  const half = planFor(normalized, { tempo: 40, baseTempo: 80 });
  assert.equal(half.totalSecondsExact, "5/2");
  assert.deepEqual(half.steps.map((step) => step.startSeconds), basePlan.steps.map((step) => step.startSeconds * 2));
  const doubled = planFor(normalized, { tempo: 160, baseTempo: 80 });
  assert.equal(doubled.totalSecondsExact, "5/8");
  assert.equal(half.practiceRate, 0.5);
  assert.equal(doubled.practiceRate, 2);

  const seven = sheet([row(0, 0, [note("plain")])], null);
  const plainPlan = planFor(seven, { tempo: 80, baseTempo: undefined });
  assert.equal(plainPlan.tempo, 80);
  assert.equal(plainPlan.totalSeconds, 0.75);
});

test("片段截断：tie 内起止不越界，内部连音结尾仍按选段截断", () => {
  const doc = sheet([row(0, 0, [note("s0"), note("s1"), note("s2")])], {
    arcs: [
      { id: "s01", type: "tie", fromNoteId: "s0", toNoteId: "s1" },
      { id: "s12", type: "tie", fromNoteId: "s1", toNoteId: "s2" },
    ],
  });
  const firstOnly = planFor(doc, { startIndex: 0, endIndex: 0 });
  assert.equal(firstOnly.steps.length, 1);
  assert.equal(firstOnly.steps[0].soundDurationTicks, 24);
  const fromSecond = planFor(doc, { startIndex: 1, endIndex: 2 });
  assert.equal(fromSecond.steps[0].trigger, true);
  assert.equal(fromSecond.steps[0].soundDurationTicks, 48);
  const stopAtSecond = planFor(doc, { startIndex: 1, endIndex: 1 });
  assert.equal(stopAtSecond.steps[0].soundDurationTicks, 24);
  const startThird = planFor(doc, { startIndex: 2, endIndex: 2 });
  assert.equal(startThird.steps[0].trigger, true);
  assert.equal(startThird.steps[0].soundDurationTicks, 24);
});

test("破损关系明确诊断：缺失成员/端点不静默改绑到邻居，重叠连音拒绝播放", () => {
  const missing = sheet([row(0, 0, [note("a"), note("b")])], {
    measures: [{ id: "missing-measure", noteIds: ["c"], startNoteId: "c", endNoteId: "c" }],
    tuplets: [{ id: "missing-tuplet", actual: 3, normal: 2, memberIds: ["c"] }],
    arcs: [{ id: "missing-arc", type: "tie", fromNoteId: "b", toNoteId: "c" }],
  });
  const analyzed = analyzeMusicDocument(missing, { key: "C", octave: 4 });
  const codes = analyzed.music.diagnostics.map((item) => item.code);
  assert(codes.includes("MEASURE_NOTE_MISSING"));
  assert(codes.includes("TUPLET_MEMBER_MISSING"));
  assert(codes.includes("ARC_ENDPOINT_MISSING"));
  const measure = analyzed.music.measures[0];
  assert.equal(measure.id, "missing-measure");
  assert.equal(measure.startIndex, null);
  assert.equal(measure.missingNoteIds[0], "c");
  assert.deepEqual(measure.noteIds, ["c"], "破损关系保留原 ID，不重绑到 b");
  const brokenPlan = buildRhythmPlaybackPlan(flatten(normalizeMusicDocument(missing)), rhythmOf(normalizeMusicDocument(missing), { baseTempo: 80 }), { tempo: 80 });
  assert.equal(brokenPlan.hasBlockingDiagnostics, true);

  const overlap = sheet([row(0, 0, [note("o0"), note("o1"), note("o2")])], {
    tuplets: [
      { id: "g1", actual: 3, normal: 2, memberIds: ["o0", "o1"] },
      { id: "g2", actual: 3, normal: 2, memberIds: ["o1", "o2"] },
    ],
  });
  const overlapPlan = buildRhythmPlaybackPlan(flatten(normalizeMusicDocument(overlap)), rhythmOf(normalizeMusicDocument(overlap), { baseTempo: 80 }), { tempo: 80 });
  assert.equal(overlapPlan.hasBlockingDiagnostics, true);
  assert(overlapPlan.diagnostics.some((item) => item.code === "TUPLET_OVERLAP" || item.code === "TUPLET_MEMBERSHIP_CONFLICT"));
});

test("页序变化/删除时小球身份保留，范围破坏只诊断不重绑", () => {
  const original = sheet([
    row(0, 0, [note("pa"), note("pb")]),
    row(1, 0, [note("pc"), note("pd")]),
  ], {
    measures: [
      { id: "page-measure-a", noteIds: ["pa", "pb"], startNoteId: "pa", endNoteId: "pb" },
      { id: "page-measure-b", noteIds: ["pc", "pd"], startNoteId: "pc", endNoteId: "pd" },
    ],
  });
  const reordered = { ...original, rows: [original.rows[1], original.rows[0]] };
  const normalized = normalizeMusicDocument(reordered, { key: "C", octave: 4, bpm: 80 });
  assert.deepEqual(normalized.music.measures.map((measure) => measure.id), ["page-measure-b", "page-measure-a"]);
  assert.deepEqual(normalized.music.measures.map((measure) => measure.noteIds), [["pc", "pd"], ["pa", "pb"]]);

  const spanning = sheet([
    row(0, 0, [note("qa"), note("qb")]),
    row(1, 0, [note("qc")]),
  ], {
    measures: [{ id: "spanning", noteIds: ["qb", "qc"], startNoteId: "qb", endNoteId: "qc" }],
  });
  const brokenOrder = normalizeMusicDocument({ ...spanning, rows: [spanning.rows[1], spanning.rows[0]] }, { key: "C", octave: 4, bpm: 80 });
  const spanningMeasure = brokenOrder.music.measures[0];
  assert(spanningMeasure.noteIds.includes("qb"));
  assert(spanningMeasure.noteIds.includes("qc"));
  assert(brokenOrder.music.diagnostics.some((item) => item.code === "MEASURE_NOTE_ORDER_BROKEN"));

  const deleted = normalizeMusicDocument({ ...spanning, rows: [spanning.rows[0]] }, { key: "C", octave: 4, bpm: 80 });
  const deletedMeasure = deleted.music.measures[0];
  assert.deepEqual(deletedMeasure.noteIds, ["qb", "qc"]);
  assert.equal(deletedMeasure.startIndex, 1);
  assert.equal(deletedMeasure.endIndex, null, '缺失端点不重绑到邻居');
  assert(deleted.music.diagnostics.some((item) => item.code === "MEASURE_NOTE_MISSING"));
});

test("迁移结构版本化且二次归一化幂等", () => {
  const doc = sheet([row(0, 0, [note("i0"), note("i1", { durationTicks: 12 })])], {
    measures: [{ id: "im", noteIds: ["i0", "i1"] }],
    arcs: [{ id: "ia", type: "auto", fromNoteId: "i0", toNoteId: "i1" }],
  });
  const once = normalizeMusicDocument(doc, { key: "C", octave: 4, bpm: 80 });
  const twice = normalizeMusicDocument(once, { key: "C", octave: 4, bpm: 80 });
  assert.equal(once.music.version, 1);
  assert.equal(twice.music.version, 1);
  assert.deepEqual(twice.music, once.music);
  assert.equal(twice.rows, once.rows);
});


test('Existing editor edits synchronize canonical measures, ties and dotted values through serialization', async()=>{
 const {edit,replaceText}=await import('../src/correction/model.js');
 const initial=normalizeMusicDocument(sheet([row(0,0,[note('edit-a',{tieToNext:true}),note('edit-b',{measureEnd:true})])],null));initial.rows[0].text='1 1 |';
 const saved=d=>normalizeMusicDocument(JSON.parse(JSON.stringify(d)));
 const split=saved(edit(initial,{row:0,note:0},'measureEnd'));
 assert.deepEqual(split.music.measures.map(m=>m.noteIds),[['edit-a'],['edit-b']]);
 assert.equal(split.music.measures[0].id,initial.music.measures[0].id);
 const merged=saved(edit(split,{row:0,note:0},'measureEnd'));
 assert.deepEqual(merged.music.measures.map(m=>m.noteIds),[['edit-a','edit-b']]);
 const textSplit=saved(replaceText(initial,0,'1 | 1 |').document);
 assert.equal(textSplit.music.measures.length,2);
 const untied=saved(edit(initial,{row:0,note:0},'tieToNext'));
 assert.equal(untied.music.arcs.length,0);
 assert.equal(planFor(untied).steps[1].trigger,true);
 const tied=saved(edit(untied,{row:0,note:0},'tieToNext'));
 assert.equal(planFor(tied).steps[1].trigger,false);
 const dotted=structuredClone(initial);dotted.rows[0].notes[0].annotation.dots=2;dotted.rows[0].notes[0].annotation.dotted=true;
 const plain=saved(edit(dotted,{row:0,note:0},'dotted'));
 assert.equal(plain.rows[0].notes[0].annotation.dots,0);
 assert.equal(planFor(plain).steps[0].durationTicks,24);
 const again=saved(edit(plain,{row:0,note:0},'dotted'));
 assert.equal(planFor(again).steps[0].durationTicks,36);
});

test('Explicit pickup length is enforced; unspecified legacy pickup remains compatible',()=>{
 const doc=sheet([row(0,0,[note('p',{durationTicks:24})])],{measures:[{id:'p-measure',noteIds:['p'],pickup:true,expectedTicks:48}]});
 const under=normalizeMusicDocument(doc);assert.equal(under.music.measures[0].status,'under');
 assert.equal(normalizeMusicDocument(under).music.measures[0].status,'under');
 doc.rows[0].notes[0].annotation.durationTicks=48;assert.equal(normalizeMusicDocument(doc).music.measures[0].status,'valid');
 const legacy=sheet([row(0,0,[note('old',{durationTicks:24})])],null,{pickup:true});
 const migrated=normalizeMusicDocument(legacy);assert.equal(migrated.music.measures[0].status,'pickup');
 assert.equal(normalizeMusicDocument(migrated).music.measures[0].status,'pickup');
});

test('弱起只由歌曲级 pickup 决定：结构层旧值不覆盖，且只影响第 1 小节',()=>{
 const rows=[row(0,0,[note('a'),note('b',{measureEnd:true})]),row(0,1,[note('c'),note('d'),note('e'),note('f',{measureEnd:true})])];
 const stale=(topPickup,musicPickup,measurePickup)=>sheet(rows,{
   pickup:musicPickup,
   measures:[
     {id:'m1',noteIds:['a','b'],startNoteId:'a',endNoteId:'b',meter:{beats:4,beatUnit:4},pickup:measurePickup},
     {id:'m2',noteIds:['c','d','e','f'],startNoteId:'c',endNoteId:'f',meter:{beats:4,beatUnit:4}},
   ],
 },{pickup:topPickup});
 const statuses=doc=>summarizeMusicMeasures(doc).map(m=>m.status);
 // 开关打开：结构层里固化的 false 不能压住歌曲级 true
 const on=normalizeMusicDocument(stale(true,false,false));
 assert.deepEqual(statuses(on),['pickup','valid']);
 assert.equal(on.pickup,true);assert.equal(on.music.pickup,true);assert.equal(on.music.measures[0].pickup,true);
 // 开关关闭：结构层里固化的 true 也不能留住弱起
 const off=normalizeMusicDocument(stale(false,true,true));
 assert.deepEqual(statuses(off),['under','valid']);
 assert.equal(off.pickup,false);assert.equal(off.music.pickup,false);assert.equal(off.music.measures[0].pickup,false);
 // 只有第 1 小节会跟着变
 assert.deepEqual(statuses(on).map((s,i)=>s===statuses(off)[i]?null:i).filter(v=>v!==null),[0]);
 // 幂等：拿已经固化过的文档再算一次，结果不变（旧值自愈，不需要迁移脚本）
 assert.deepEqual(statuses(normalizeMusicDocument(on)),['pickup','valid']);
 assert.deepEqual(statuses(normalizeMusicDocument(off)),['under','valid']);
 // 首小节本来就是满拍时，打开弱起也不改判定（不倒退起点）
 const full=normalizeMusicDocument(sheet([row(0,0,[note('g',{durationTicks:48}),note('h',{durationTicks:48,measureEnd:true})])],null,{pickup:true}));
 assert.equal(full.music.measures[0].status,'valid');
 assert.equal(full.music.measures[0].pickup,true);
});


test('Imported song slurs remain playable, including already persisted legacy tie arcs',{skip:FIXTURE_SKIP},()=>{
 const songs=JSON.parse(fs.readFileSync(optionalLocalFixture('legacy-public/legacy/library.json')));
 for(const song of songs){
  const doc=documentFromImages(song,song.images);
  const plan=planFor(doc);
  assert.equal(plan.hasBlockingDiagnostics,false,song.title+': '+JSON.stringify(plan.diagnostics));
  const cached=normalizeMusicDocument(structuredClone(doc),{key:song.key,octave:song.octave});
  for(const arc of cached.music.arcs)if(arc.legacy)arc.type='tie';
  const restored=normalizeMusicDocument(JSON.parse(JSON.stringify(cached)),{key:song.key,octave:song.octave});
  const restoredPlan=planFor(restored);
  assert.equal(restoredPlan.hasBlockingDiagnostics,false,song.title+' cached');
  assert.equal(restoredPlan.totalTicksExact,plan.totalTicksExact);
  assert.deepEqual(restored.rows,doc.rows);
 }
 const explicit=sheet([row(0,0,[note('a'),note('b',{degree:2})])],{arcs:[{id:'explicit',type:'tie',fromNoteId:'a',toNoteId:'b'}]});
 assert.equal(planFor(explicit).hasBlockingDiagnostics,true,'Explicit invalid ties still require correction');
});
