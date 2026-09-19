import {connectionTuplets} from './notationFeatures.js';

import * as R from "./rational.js";

export const STRUCTURE_VERSION = 1;
export const DEFAULT_TICKS_PER_QUARTER = 24;
export const STRUCTURE_BASE_TICKS = Object.freeze([6, 12, 24, 48, 96]);
const BASE_TICKS = new Set(STRUCTURE_BASE_TICKS);
const KNOWN_TUPLET_RATIOS = new Set(["2:3", "3:2", "4:3", "5:4", "6:4", "7:4"]);
const NOTE_OFFSETS = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const DEGREE_STEPS = [null, 0, 2, 4, 5, 7, 9, 11];

export function makeDiagnostic(code, message, details = {}, severity = "error") {
  const diagnostic = { code, severity, message, ...details };
  return diagnostic;
}

export function legacyNoteId(row, noteIndex) {
  const page = Number.isInteger(row?.page) ? row.page : 0;
  const line = Number.isInteger(row?.line) ? row.line : 0;
  return `p${page + 1}r${line + 1}n${noteIndex + 1}`;
}

export function documentationFlattenEntries(document) {
  const rows = Array.isArray(document?.rows) ? document.rows : [];
  const entries = [];
  let index = 0;
  rows.forEach((row, rowIndex) => {
    const notes = Array.isArray(row?.notes) ? row.notes : [];
    notes.forEach((note, noteIndex) => {
      entries.push({
        index,
        row,
        rowIndex,
        note,
        noteIndex,
        annotation: note?.annotation || null,
        id: note?.id || legacyNoteId(row, noteIndex),
      });
      index += 1;
    });
  });
  return entries;
}

export function notesFlattenEntries(notes, annotations, options = {}) {
  const sourceNotes = Array.isArray(notes) ? notes : [];
  const sourceAnnotations = Array.isArray(annotations) ? annotations : [];
  const prefix = options.idPrefix || "n";
  return sourceNotes.map((note, index) => ({
    index,
    row: null,
    rowIndex: 0,
    note,
    noteIndex: index,
    annotation: sourceAnnotations[index] || note?.annotation || null,
    id: note?.id || `${prefix}${index + 1}`,
  }));
}

export function withStableNoteIds(document) {
  const rows = Array.isArray(document?.rows) ? document.rows : [];
  let changed = false;
  const nextRows = rows.map((row) => {
    const notes = Array.isArray(row?.notes) ? row.notes : [];
    let rowChanged = false;
    const nextNotes = notes.map((note, noteIndex) => {
      if (note?.id) return note;
      rowChanged = true;
      changed = true;
      return { ...note, id: legacyNoteId(row, noteIndex) };
    });
    return rowChanged ? { ...row, notes: nextNotes } : row;
  });
  return changed ? { ...document, rows: nextRows } : document;
}

export function normalizeMeter(value, fallback = { beats: 4, beatUnit: 4 }) {
  const source = value && typeof value === "object" ? value : {};
  const beats = clampInteger(source.beats ?? source.beatCount, 1, 32, fallback.beats);
  const beatUnit = [2, 4, 8, 16].includes(Number(source.beatUnit))
    ? Number(source.beatUnit)
    : fallback.beatUnit;
  const beatGroups = Array.isArray(source.beatGroups)
    ? source.beatGroups.map(Number).filter((item) => Number.isInteger(item) && item > 0)
    : undefined;
  return beatGroups?.length ? { beats, beatUnit, beatGroups } : { beats, beatUnit };
}

export function meterTicks(meter, ticksPerQuarter = DEFAULT_TICKS_PER_QUARTER) {
  const normalized = normalizeMeter(meter);
  return R.multiply(
    R.fraction(normalized.beats * ticksPerQuarter),
    R.fraction(4, normalized.beatUnit),
  );
}

export function dottedFactor(dots = 0) {
  const count = clampInteger(dots, 0, 2, 0);
  return R.fraction(2n ** BigInt(count + 1) - 1n, 2n ** BigInt(count));
}

export function annotationBaseTicks(annotation) {
  if (!annotation || typeof annotation !== "object") return null;
  const value = Number(annotation.durationTicks ?? annotation.baseTicks ?? annotation.duration ?? annotation.ticks);
  return BASE_TICKS.has(value) ? value : null;
}

// 界面只支持一个附点：附点数量一律收敛到 0/1。
// 识别端读到两个及以上时，recognitionModel 已降级为一个并留档；这里再兜一层，
// 使显示、排版、播放、手机清单与小节满/欠拍判定永远读同一个口径。
export function annotationDots(annotation) {
  if (!annotation || typeof annotation !== "object") return 0;
  if (annotation.dots !== undefined) return clampInteger(annotation.dots, 0, 1, 0);
  return annotation.dotted ? 1 : 0;
}

export function annotationTupletId(annotation) {
  if (!annotation || typeof annotation !== "object") return null;
  return annotation.tupletId || annotation.tuplet?.id || null;
}

export function effectiveDurationFraction(annotation, tupletsById = null) {
  const baseTicks = annotationBaseTicks(annotation);
  if (baseTicks === null) return null;
  const dotted = dottedFactor(annotationDots(annotation));
  const base = R.multiply(R.fraction(baseTicks), dotted);
  const tupletId = annotationTupletId(annotation);
  if (!tupletId) return base;
  const group = tupletsById?.get?.(tupletId);
  if (!group || group.invalid) return null;
  return R.multiply(base, R.fraction(group.normal, group.actual));
}

export function effectiveDurationTicks(annotation, tupletsById = null) {
  const value = effectiveDurationFraction(annotation, tupletsById);
  return value === null ? null : R.toNumber(value);
}

export function normalizeAccidentalValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).normalize("NFKC");
  if (["#", "♯", "sharp"].includes(text)) return "#";
  if (["b", "♭", "flat"].includes(text)) return "b";
  if (["♮", "n", "natural", "=", "还原"].includes(text)) return "natural";
  return null;
}

export function parsePitchKey(value, fallbackOctave = 4) {
  if (value && typeof value === "object") {
    const tonic = String(value.tonic || value.key || value.note || "C").replace(/[^A-Ga-g#b]/g, "");
    const octave = Number.isInteger(Number(value.octave)) ? Number(value.octave) : fallbackOctave;
    return pitchKeyFromParts(tonic, octave);
  }
  const text = String(value ?? "C").normalize("NFKC");
  const explicit = text.match(/1\s*=\s*([A-Ga-g](?:#|b)?)(-?\d+)?/);
  if (explicit) return pitchKeyFromParts(explicit[1], explicit[2] === undefined ? fallbackOctave : Number(explicit[2]));
  const noteMatch = text.match(/([A-Ga-g](?:#|b)?)(-?\d+)?/);
  if (noteMatch) return pitchKeyFromParts(noteMatch[1], noteMatch[2] === undefined ? fallbackOctave : Number(noteMatch[2]));
  return pitchKeyFromParts("C", fallbackOctave);
}

function pitchKeyFromParts(tonicText, octave) {
  const normalized = tonicText.charAt(0).toUpperCase() + tonicText.slice(1);
  const offset = NOTE_OFFSETS[normalized] ?? 0;
  const safeOctave = Number.isInteger(Number(octave)) ? Number(octave) : 4;
  return {
    key: `1=${normalized}${safeOctave}`,
    tonic: normalized,
    octave: safeOctave,
    tonicMidi: (safeOctave + 1) * 12 + offset,
    mode: "major",
  };
}

export function noteNotation(note) {
  const source = note && typeof note === "object" ? note : {};
  const notation = source.notation && typeof source.notation === "object" ? source.notation : source;
  const degree = Number(notation.degree ?? source.degree ?? 0);
  return {
    degree: Number.isInteger(degree) && degree >= 0 && degree <= 7 ? degree : 0,
    accidental: normalizeAccidentalValue(notation.accidental ?? source.accidental),
    octave: Number.isFinite(Number(notation.octave ?? source.octave)) ? Number(notation.octave ?? source.octave) : 0,
  };
}

export function legacyNoteMidi(note, keyValue = "C4") {
  const notation = noteNotation(note);
  if (notation.degree === 0) return null;
  const key = parsePitchKey(keyValue);
  const accidentalOffset = notation.accidental === "#" ? 1 : notation.accidental === "b" ? -1 : 0;
  return key.tonicMidi + DEGREE_STEPS[notation.degree] + notation.octave * 12 + accidentalOffset;
}

function normalizeMusicInput(document, sourceMusic) {
  return {
    version: STRUCTURE_VERSION,
    ...(sourceMusic && typeof sourceMusic === "object" ? sourceMusic : {}),
  };
}

export function analyzeMusicDocument(document, options = {}) {
  const stableInput = options.assignStableIds ? withStableNoteIds(document) : document;
  const entries = documentationFlattenEntries(stableInput);
  const sourceMusic = stableInput?.music && typeof stableInput.music === "object" ? stableInput.music : null;
  const meter = normalizeMeter(sourceMusic?.defaultMeter ?? sourceMusic?.meter ?? stableInput?.meter, { beats: 4, beatUnit: 4 });
  // 歌曲级 pickup 是唯一输入：music.pickup / measures[].pickup 都是派生缓存，
  // 只有旧数据里完全没有歌曲级取值时才回退到结构层。
  const pickup = Boolean(stableInput?.pickup ?? sourceMusic?.pickup);
  const key = options.key ?? stableInput?.key ?? sourceMusic?.key ?? "C";
  const octave = options.octave ?? stableInput?.octave ?? 4;
  const analysis = buildMusicStructure(entries, sourceMusic, {
    meter,
    pickup,
    key,
    octave,
    baseTempo: options.bpm ?? options.baseTempo,
    sourceDiagnostics: Array.isArray(stableInput?.structureDiagnostics) ? stableInput.structureDiagnostics : [],
  });
  return { document: stableInput, entries, ...analysis };
}

export function normalizeMusicDocument(document, options = {}) {
  const analyzed = analyzeMusicDocument(document, options);
  return analyzed.document === document
    ? { ...document, music: analyzed.music }
    : { ...analyzed.document, music: analyzed.music };
}

export function analyzeMusicNotes(notes, rhythm, options = {}) {
  const annotations = Array.isArray(rhythm?.annotations) ? rhythm.annotations : [];
  const entries = notesFlattenEntries(notes, annotations, { idPrefix: options.idPrefix || "n" });
  const sourceMusic = rhythm?.music && typeof rhythm.music === "object" ? rhythm.music : null;
  const meter = normalizeMeter(sourceMusic?.defaultMeter ?? rhythm?.meter, { beats: 4, beatUnit: 4 });
  const analysis = buildMusicStructure(entries, sourceMusic, {
    meter,
    pickup: Boolean(rhythm?.pickup ?? sourceMusic?.pickup),
    key: options.key ?? rhythm?.key ?? sourceMusic?.key ?? "C",
    octave: options.octave ?? rhythm?.octave ?? 4,
    baseTempo: options.bpm ?? rhythm?.baseTempo,
    sourceDiagnostics: Array.isArray(rhythm?.diagnostics) ? rhythm.diagnostics : [],
  });
  return { entries, ...analysis };
}

export function buildPitchPlan(document, options = {}) {
  const analysis = analysisForDocument(document, options);
  return analysis.pitches;
}

export function tieLinksForDocument(document, options = {}) {
  const analysis = analysisForDocument(document, options);
  return analysis.tieLinks;
}

function analysisForDocument(document, options) {
  const entries = documentationFlattenEntries(document);
  const sourceMusic = document?.music && typeof document.music === "object" ? document.music : null;
  const meter = normalizeMeter(sourceMusic?.defaultMeter ?? document?.meter, { beats: 4, beatUnit: 4 });
  return buildMusicStructure(entries, sourceMusic, {
    meter,
    pickup: Boolean(document?.pickup ?? sourceMusic?.pickup),
    key: options.key ?? document?.key ?? sourceMusic?.key ?? "C",
    octave: options.octave ?? document?.octave ?? 4,
    baseTempo: options.bpm ?? options.baseTempo,
    sourceDiagnostics: Array.isArray(document?.structureDiagnostics) ? document.structureDiagnostics : [],
  });
}

export function buildMusicStructure(entries, sourceMusic, config = {}) {
  const diagnostics = [];
  const source = normalizeMusicInput(null, sourceMusic);
  const sourceDiagnostics = Array.isArray(config.sourceDiagnostics) ? config.sourceDiagnostics : [];
  sourceDiagnostics.forEach((item) => diagnostics.push({ severity: "warning", ...item }));
  const meter = normalizeMeter(config.meter, { beats: 4, beatUnit: 4 });
  const pickup = Boolean(config.pickup);
  const ticksPerQuarter = DEFAULT_TICKS_PER_QUARTER;
  const idToIndex = new Map();
  entries.forEach((entry, index) => {
    if (idToIndex.has(entry.id)) {
      diagnostics.push(makeDiagnostic("DUPLICATE_NOTE_ID", "音符稳定 ID 重复，关系无法可靠解析", { noteId: entry.id, index }, "error"));
    } else {
      idToIndex.set(entry.id, index);
    }
  });

  const tupletsResult = normalizeTuplets({...source,tuplets:connectionTuplets(source,entries,meter)}, entries, diagnostics);
  const resolvedEntries = resolveTupletMembership(entries, tupletsResult, diagnostics);
  const measures = normalizeMeasures(source, resolvedEntries, meter, pickup, tupletsResult.byId, diagnostics);
  const pitchContexts = normalizePitchContexts(source, resolvedEntries, config, diagnostics);
  const explicitPitchContexts = Array.isArray(source.pitchContexts)
    ? source.pitchContexts.some((context) => context && typeof context === "object" && context.explicit !== false)
    : false;
  const explicitKeyChanges = Array.isArray(source.keyChanges) && source.keyChanges.length > 0;
  const pitchSemantics = source.pitchSemantics === "measured" || source.accidentalScope === "measure" || explicitPitchContexts || explicitKeyChanges
    ? "measured"
    : "legacy";
  const pitches = resolvePitches(resolvedEntries, measures, pitchContexts, pitchSemantics, config, diagnostics);
  const brokenSeamPairs = new Set(sourceDiagnostics.filter((item) => item?.code === "SEAM_RELATION_CHANGED").map((item) => item.fromNoteId + ":" + item.toNoteId));
  const arcs = normalizeArcs(source, resolvedEntries, pitches, idToIndex, diagnostics, brokenSeamPairs);
  const tieLinks = resolveTieLinks(resolvedEntries, arcs, pitches, idToIndex, diagnostics);
  const tempoEvents = normalizeTempoEvents(source, resolvedEntries, idToIndex, diagnostics);
  const music = {
    version: STRUCTURE_VERSION,
    defaultMeter: meter,
    pickup,
    pitchSemantics,
    measures,
    tuplets: tupletsResult.tuplets,
    arcs,
    ...(Array.isArray(source.meterChanges)?{meterChanges:source.meterChanges}:{}),
    pendingArcs: Array.isArray(source.pendingArcs) ? source.pendingArcs : [],
    pitchContexts,
    tempoEvents,
    diagnostics: [],
  };
  if (source.baseTempo) music.baseTempo = normalizeBaseTempo(source.baseTempo, diagnostics);
  if (source.notesVersion !== undefined) music.notesVersion = source.notesVersion;
  if (source.recognizedAt !== undefined) music.recognizedAt = source.recognizedAt;
  music.diagnostics = sortDiagnostics(diagnostics);
  return { annotations: resolvedEntries.map((entry) => normalizeAnnotation(entry.annotation)), music, pitches, tieLinks, entries: resolvedEntries };
}

function resolveTupletMembership(entries, tupletsResult, diagnostics) {
  const byMemberId = new Map();
  tupletsResult.tuplets.forEach((group) => {
    group.memberIds.forEach((memberId) => {
      if (byMemberId.has(memberId) && byMemberId.get(memberId).id !== group.id) {
        diagnostics.push(makeDiagnostic("TUPLET_MEMBERSHIP_CONFLICT", "同一音符出现在多个连音组中，首版不支持嵌套或重叠", { noteId: memberId, tupletIds: [byMemberId.get(memberId).id, group.id] }, "error"));
        return;
      }
      byMemberId.set(memberId, group);
    });
  });
  return entries.map((entry) => {
    const explicitId = annotationTupletId(entry.annotation);
    const membership = byMemberId.get(entry.id) || null;
    const tupletId = explicitId || membership?.id || null;
    if (explicitId && membership && explicitId !== membership.id) {
      diagnostics.push(makeDiagnostic("TUPLET_MEMBERSHIP_CONFLICT", "音符标注的连音组与成员列表不一致，保留显式引用并诊断", { noteId: entry.id, explicitId, memberOf: membership.id }, "error"));
    }
    return { ...entry, annotation: { ...normalizeAnnotation(entry.annotation), tupletId } };
  });
}

function normalizeAnnotation(annotation) {
  const source = annotation && typeof annotation === "object" ? annotation : {};
  const durationTicks = annotationBaseTicks(source);
  const dots = annotationDots(source);
  return {
    ...source,
    durationTicks,
    dots,
    dotted: dots > 0,
    tieToNext: Boolean(source.tieToNext),
    measureEnd: Boolean(source.measureEnd),
    tupletId: annotationTupletId(source),
  };
}

function normalizeTuplets(source, entries, diagnostics) {
  const byId = new Map();
  const output = [];
  const overlapPairs = new Set();
  const rawGroups = Array.isArray(source.tuplets) ? source.tuplets : [];
  rawGroups.forEach((raw, rawIndex) => {
    const normalized = normalizeTuplet(raw, entries, diagnostics, rawIndex);
    if (normalized) {
      byId.set(normalized.id, normalized);
      output.push(normalized);
    }
  });

  const derived = new Map();
  entries.forEach((entry) => {
    const annotation = entry.annotation;
    const inline = annotation?.tuplet && typeof annotation.tuplet === "object" ? annotation.tuplet : null;
    let id = annotationTupletId(annotation);
    if (!id && inline) id = `tuplet:${entry.id}`;
    if (!id) return;
    if (!derived.has(id)) derived.set(id, { id, raw: inline || {}, memberIds: [], entryIndexes: [] });
    const group = derived.get(id);
    group.memberIds.push(entry.id);
    group.entryIndexes.push(entry.index);
    if (inline && !group.raw.actual && !group.raw.normal) group.raw = { ...inline, ...group.raw };
  });
  derived.forEach((group, id) => {
    if (byId.has(id)) return;
    if (!group.raw || (group.raw.actual === undefined && group.raw.normal === undefined && !group.raw.inTimeOf)) {
      diagnostics.push(makeDiagnostic("TUPLET_GROUP_MISSING", "音符引用了未定义的连音组", { tupletId: id, memberIds: group.memberIds }, "error"));
      return;
    }
    const normalized = normalizeTuplet({ ...group.raw, id, memberIds: group.memberIds }, entries, diagnostics, output.length);
    if (normalized) {
      byId.set(id, normalized);
      output.push(normalized);
    }
  });

  entries.forEach((entry) => {
    const id = annotationTupletId(entry.annotation);
    if (id && !byId.has(id)) {
      diagnostics.push(makeDiagnostic("TUPLET_GROUP_MISSING", "音符引用了未定义的连音组", { tupletId: id, noteId: entry.id, index: entry.index }, "error"));
    }
  });

  const owner = new Map();
  output.forEach((group) => {
    group.memberIds.forEach((memberId) => {
      const index = entries.findIndex((entry) => entry.id === memberId);
      if (index < 0) return;
      if (owner.has(index) && owner.get(index) !== group.id) {
        const previous = owner.get(index);
        const pairKey = [group.id, previous].sort().join("|");
        if (!overlapPairs.has(pairKey)) {
          overlapPairs.add(pairKey);
          markTupletInvalid(group, diagnostics, "TUPLET_OVERLAP", "连音组与另一连音组重叠，首版不支持", { tupletId: group.id, otherTupletId: previous, noteId: memberId, index });
          const other = byId.get(previous);
          if (other) markTupletInvalid(other, diagnostics, "TUPLET_OVERLAP", "连音组与另一连音组重叠，首版不支持", { tupletId: previous, otherTupletId: group.id, noteId: memberId, index });
        }
      } else {
        owner.set(index, group.id);
      }
    });
  });
  const spans = output
    .map((group) => ({ group, indexes: group.memberIndexes.filter((index) => Number.isInteger(index)) }))
    .filter((item) => item.indexes.length)
    .map((item) => ({ group: item.group, start: Math.min(...item.indexes), end: Math.max(...item.indexes) }));
  for (let left = 0; left < spans.length; left += 1) {
    for (let right = left + 1; right < spans.length; right += 1) {
      if (spans[left].start > spans[right].end || spans[right].start > spans[left].end) continue;
      const a = spans[left].group;
      const b = spans[right].group;
      const pairKey = [a.id, b.id].sort().join("|");
      if (overlapPairs.has(pairKey)) continue;
      overlapPairs.add(pairKey);
      markTupletInvalid(a, diagnostics, "TUPLET_OVERLAP", "连音组与另一连音组在时间范围上重叠，首版不支持", { tupletId: a.id, otherTupletId: b.id, start: spans[left].start, end: spans[left].end });
      markTupletInvalid(b, diagnostics, "TUPLET_OVERLAP", "连音组与另一连音组在时间范围上重叠，首版不支持", { tupletId: b.id, otherTupletId: a.id, start: spans[right].start, end: spans[right].end });
    }
  }
  return { tuplets: output, byId };
}

function normalizeTuplet(raw, entries, diagnostics, rawIndex) {
  const source = raw && typeof raw === "object" ? raw : {};
  const actual = Number(source.actual ?? source.members ?? source.n ?? source.num);
  const normal = Number(source.normal ?? source.inTimeOf ?? source.m ?? source.den);
  const fallbackId = `tuplet:${source.startNoteId ?? source.noteId ?? `unknown-${rawIndex + 1}`}`;
  const id = String(source.id || fallbackId);
  let memberIds = Array.isArray(source.memberIds) ? source.memberIds.map(String) : [];
  const idIndexes = new Map(entries.map((entry, index) => [entry.id, index]));
  const explicitStart = source.startNoteId ?? memberIds[0] ?? null;
  const explicitEnd = source.endNoteId ?? memberIds.at(-1) ?? null;
  if (!memberIds.length && explicitStart !== null && explicitEnd !== null && idIndexes.has(String(explicitStart)) && idIndexes.has(String(explicitEnd))) {
    const start = idIndexes.get(String(explicitStart));
    const end = idIndexes.get(String(explicitEnd));
    memberIds = entries.slice(Math.min(start, end), Math.max(start, end) + 1).map((entry) => entry.id);
  }
  if (!memberIds.length) {
    const index = entries.findIndex((entry) => annotationTupletId(entry.annotation) === id);
    if (index >= 0) {
      for (let cursor = index; cursor < entries.length; cursor += 1) {
        if (annotationTupletId(entries[cursor].annotation) !== id) break;
        memberIds.push(entries[cursor].id);
      }
    }
  }
  const uniqueMemberIds = [...new Set(memberIds)];
  const memberIndexes = [];
  const missingMemberIds = [];
  uniqueMemberIds.forEach((memberId) => {
    if (idIndexes.has(memberId)) memberIndexes.push(idIndexes.get(memberId));
    else missingMemberIds.push(memberId);
  });
  const invalid = !Number.isInteger(actual) || actual <= 0 || !Number.isInteger(normal) || normal <= 0 || missingMemberIds.length > 0;
  const group = {
    id,
    actual: Number.isInteger(actual) && actual > 0 ? actual : null,
    normal: Number.isInteger(normal) && normal > 0 ? normal : null,
    memberIds: uniqueMemberIds,
    startNoteId: explicitStart !== null && idIndexes.has(String(explicitStart)) ? String(explicitStart) : memberIds[0] ?? null,
    endNoteId: explicitEnd !== null && idIndexes.has(String(explicitEnd)) ? String(explicitEnd) : memberIds.at(-1) ?? null,
    ratio: Number.isInteger(actual) && Number.isInteger(normal) ? `${actual}:${normal}` : null,
    invalid,
    missingMemberIds,
    memberIndexes,
  };
  if (!Number.isInteger(actual) || actual <= 0 || !Number.isInteger(normal) || normal <= 0) {
    diagnostics.push(makeDiagnostic("TUPLET_RATIO_INVALID", "连音组比例必须是正整数 n:m", { tupletId: id, actual, normal, memberIds: uniqueMemberIds }, "error"));
  } else if (!KNOWN_TUPLET_RATIOS.has(`${actual}:${normal}`)) {
    diagnostics.push(makeDiagnostic("TUPLET_RATIO_UNUSUAL", "连音组比例不在首版明确支持的常见列表中，已按 n:m 规则计算", { tupletId: id, ratio: `${actual}:${normal}` }, "warning"));
  }
  if (missingMemberIds.length) {
    diagnostics.push(makeDiagnostic("TUPLET_MEMBER_MISSING", "连音组成员音符不存在，关系未被重新绑定到邻居", { tupletId: id, missingMemberIds }, "error"));
  }
  if (memberIndexes.length && memberIndexes.some((index, position) => position > 0 && index !== memberIndexes[position - 1] + 1)) {
    diagnostics.push(makeDiagnostic("TUPLET_NOT_CONTIGUOUS", "连音组成员在当前页序中不连续", { tupletId: id, memberIds: uniqueMemberIds, memberIndexes }, "warning"));
  }
  if (memberIndexes.length !== uniqueMemberIds.length) group.invalid = true;
  return group;
}

function markTupletInvalid(group, diagnostics, code, message, details) {
  group.invalid = true;
  group.invalidReason = code;
  diagnostics.push(makeDiagnostic(code, message, details, "error"));
}

function normalizePitchContexts(source, entries, config, diagnostics) {
  const raw = Array.isArray(source.pitchContexts)
    ? source.pitchContexts
    : Array.isArray(source.keyChanges)
      ? source.keyChanges
      : [];
  const idToIndex = new Map(entries.map((entry, index) => [entry.id, index]));
  const contexts = [];
  const seenIds = new Set();
  raw.forEach((item, index) => {
    const value = item && typeof item === "object" ? item : {};
    const atNoteId = value.atNoteId ?? value.noteId ?? value.at ?? null;
    const id = String(value.id || `key:${atNoteId ?? `unknown-${index + 1}`}`);
    if (seenIds.has(id)) {
      diagnostics.push(makeDiagnostic("PITCH_CONTEXT_DUPLICATE_ID", "转调位置 ID 重复", { contextId: id }, "error"));
      return;
    }
    seenIds.add(id);
    const resolvedIndex = atNoteId !== null && idToIndex.has(String(atNoteId)) ? idToIndex.get(String(atNoteId)) : null;
    if (resolvedIndex === null && atNoteId !== null) {
      diagnostics.push(makeDiagnostic("PITCH_CONTEXT_POSITION_MISSING", "转调位置引用的音符不存在，未被重新绑定到邻居", { contextId: id, atNoteId }, "error"));
    }
    const explicit = value.explicit !== false;
    contexts.push({
      id,
      atNoteId: atNoteId === null ? null : String(atNoteId),
      atIndex: resolvedIndex,
      key: explicit
        ? parsePitchKey(value.key ?? value.tonic ?? value.tonic ?? source.key ?? config.key, value.octave ?? config.octave)
        : parsePitchKey(config.key ?? value.key ?? source.key, value.octave ?? config.octave),
      explicit,
    });
  });
  const fallbackKey = parsePitchKey(config.key ?? source.key, config.octave);
  const hasOpeningContext = contexts.some((context) => context.atIndex !== null && context.atIndex <= 0);
  if (!hasOpeningContext && entries.length) {
    contexts.unshift({
      id: "key:opening",
      atNoteId: entries[0].id,
      atIndex: 0,
      key: fallbackKey,
      explicit: false,
    });
  }
  contexts.sort((left, right) => (left.atIndex ?? Infinity) - (right.atIndex ?? Infinity));
  return contexts;
}

function resolvePitches(entries, measures, contexts, semantics, config, diagnostics) {
  const validContexts = contexts
    .filter((context) => context.atIndex !== null)
    .sort((left, right) => left.atIndex - right.atIndex);
  const measureStarts = new Set();
  if (measures.length) {
    measures.forEach((measure) => {
      if (Number.isInteger(measure.startIndex)) measureStarts.add(measure.startIndex);
    });
  } else if (entries.length) {
    measureStarts.add(0);
  }
  const state = new Map();
  let contextCursor = 0;
  let activeContext = validContexts[0] || { key: parsePitchKey(config.key, config.octave), atIndex: 0 };
  return entries.map((entry, index) => {
    if (measureStarts.has(index)) state.clear();
    while (contextCursor + 1 < validContexts.length && validContexts[contextCursor + 1].atIndex <= index) {
      contextCursor += 1;
      activeContext = validContexts[contextCursor];
      state.clear();
    }
    const notation = noteNotation(entry.note);
    const key = activeContext?.key || parsePitchKey(config.key, config.octave);
    if (notation.degree === 0) {
      return { index, noteId: entry.id, notation, key, isRest: true, midi: null, accidental: null, accidentalSource: null };
    }
    const stateKey = `${notation.degree}:${notation.octave}`;
    let accidentalOffset = 0;
    let accidentalSource = null;
    if (notation.accidental === "#") {
      accidentalOffset = 1;
      accidentalSource = "note";
      state.set(stateKey, 1);
    } else if (notation.accidental === "b") {
      accidentalOffset = -1;
      accidentalSource = "note";
      state.set(stateKey, -1);
    } else if (notation.accidental === "natural") {
      accidentalOffset = 0;
      accidentalSource = "note";
      state.set(stateKey, 0);
    } else if (semantics === "measured" && state.has(stateKey)) {
      accidentalOffset = state.get(stateKey);
      accidentalSource = "measure";
    }
    const midi = key.tonicMidi + DEGREE_STEPS[notation.degree] + notation.octave * 12 + accidentalOffset;
    if (notation.octave < -2 || notation.octave > 2) {
      diagnostics.push(makeDiagnostic("PITCH_OCTAVE_OUT_OF_RANGE", "相对八度超出 -2..2，保留原值并继续解析", { noteId: entry.id, index, octave: notation.octave }, "warning"));
    }
    return {
      index,
      noteId: entry.id,
      notation,
      key,
      isRest: false,
      midi,
      accidental: notation.accidental,
      accidentalOffset,
      accidentalSource,
      stateKey,
    };
  });
}

function normalizeMeasures(source, entries, defaultMeter, defaultPickup, tupletsById, diagnostics) {
  const rawMeasures = Array.isArray(source.measures) ? source.measures : [];
  const idToIndex = new Map(entries.map((entry, index) => [entry.id, index]));
  let measures = rawMeasures.length
    ? rawMeasures.map((raw, index) => normalizeMeasure(raw, entries, idToIndex, defaultMeter, defaultPickup, tupletsById, diagnostics, index))
    : deriveLegacyMeasures(entries, defaultMeter, defaultPickup, tupletsById, diagnostics);
  if (Array.isArray(source.meterChanges)) {
    let activeMeter=defaultMeter;
    const changes=source.meterChanges;
    for(const change of changes)if(!measures.some(m=>m.startNoteId===change.noteId))diagnostics.push(makeDiagnostic('METER_LOCATION_MISSING','变拍位置需要重新确认',{noteId:change.noteId}));
    measures=measures.map((m,index)=>{
      const change=changes.find(c=>c.noteId===m.startNoteId);
      if(change&&!change.onlyMeasure)activeMeter=change.meter;
      return {...normalizeMeasure({...m,meter:change?.meter||activeMeter,expectedIsExplicit:false},entries,idToIndex,defaultMeter,defaultPickup,tupletsById,diagnostics,index),meterChange:Boolean(change)};
    });
  }
  const usedIds = new Set();
  measures.forEach((measure, index) => {
    if (usedIds.has(measure.id)) {
      measure.id = `${measure.id}:${index + 1}`;
      diagnostics.push(makeDiagnostic("MEASURE_DUPLICATE_ID", "小节 ID 重复，已加后缀保留但请修复来源数据", { measureId: measure.id }, "error"));
    }
    usedIds.add(measure.id);
  });
  measures.sort((left, right) => {
    const leftIndex = Number.isInteger(left.startIndex) ? left.startIndex : Infinity;
    const rightIndex = Number.isInteger(right.startIndex) ? right.startIndex : Infinity;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.originalIndex - right.originalIndex;
  });
  measures.forEach((measure, index) => {
    measure.index = index;
    if (Number.isInteger(measure.startIndex) && Number.isInteger(measure.endIndex)) {
      if (index > 0 && Number.isInteger(measures[index - 1]?.endIndex) && measure.startIndex <= measures[index - 1].endIndex) {
        diagnostics.push(makeDiagnostic("MEASURE_RANGE_OVERLAP", "小节范围重叠，未进行邻居重绑定", { measureId: measure.id, previousMeasureId: measures[index - 1].id }, "error"));
      }
    }
  });
  let startTicks = R.ZERO;
  measures.forEach((measure) => {
    measure.startTicks = R.toNumber(startTicks);
    measure.startTicksExact = R.toString(startTicks);
    if (Number.isFinite(measure.actualTicks)) startTicks = R.add(startTicks, R.fractionFromNumber(measure.actualTicks));
  });
  return measures;
}

function normalizeMeasure(raw, entries, idToIndex, defaultMeter, defaultPickup, tupletsById, diagnostics, originalIndex) {
  const source = raw && typeof raw === "object" ? raw : {};
  const explicitNoteIds = Array.isArray(source.noteIds) ? source.noteIds.map(String) : [];
  const explicitStart = source.startNoteId ? String(source.startNoteId) : null;
  const explicitEnd = source.endNoteId ? String(source.endNoteId) : null;
  let noteIds = explicitNoteIds.slice();
  if (!noteIds.length && explicitStart && explicitEnd && idToIndex.has(explicitStart) && idToIndex.has(explicitEnd)) {
    const start = idToIndex.get(explicitStart);
    const end = idToIndex.get(explicitEnd);
    noteIds = entries.slice(Math.min(start, end), Math.max(start, end) + 1).map((entry) => entry.id);
  }
  if (!noteIds.length && explicitStart && idToIndex.has(explicitStart)) {
    const start = idToIndex.get(explicitStart);
    const nextBoundary = entries.findIndex((entry, index) => index > start && entry.annotation?.measureEnd);
    const end = nextBoundary < 0 ? entries.length - 1 : nextBoundary;
    noteIds = entries.slice(start, end + 1).map((entry) => entry.id);
  }
  const uniqueNoteIds = [...new Set(noteIds)];
  const missingNoteIds = uniqueNoteIds.filter((id) => !idToIndex.has(id));
  const memberIndexes = uniqueNoteIds.map((id) => idToIndex.get(id)).filter((index) => index !== undefined);
  const startBoundaryExists = explicitStart ? idToIndex.has(explicitStart) : memberIndexes.length > 0;
  const endBoundaryExists = explicitEnd ? idToIndex.has(explicitEnd) : memberIndexes.length > 0;
  const startIndex = startBoundaryExists && memberIndexes.length ? Math.min(...memberIndexes) : null;
  const endIndex = endBoundaryExists && memberIndexes.length ? Math.max(...memberIndexes) : null;
  const id = String(source.id || `measure:${explicitStart || explicitNoteIds[0] || entries[originalIndex]?.id || originalIndex + 1}`);
  const meter = normalizeMeter(source.meter ?? defaultMeter, normalizeMeter(defaultMeter));
  // 第 1 小节的 pickup 恒等于歌曲级取值：结构层里固化的旧值不再覆盖它，
  // 其余小节的 pickup 仍按各自存储的显式值保留（拆分/合并时会写 false）。
  const pickup = originalIndex === 0 ? defaultPickup : Boolean(source.pickup);
  const explicitExpected = positiveNumber(source.expectedTicks ?? source.expected ?? source.expectedLengthTicks);
  const expectedIsExplicit = source.expectedIsExplicit ?? (explicitExpected !== null);
  const expected = !expectedIsExplicit || explicitExpected === null ? meterTicks(meter) : R.fractionFromNumber(explicitExpected);
  let actual = R.ZERO;
  let hasMissingDuration = missingNoteIds.length > 0;
  memberIndexes.forEach((index) => {
    const duration = effectiveDurationFraction(entries[index].annotation, tupletsById);
    if (duration === null) hasMissingDuration = true;
    else actual = R.add(actual, duration);
  });
  const comparison = R.compare(actual, expected);
  let status = "incomplete";
  if (!hasMissingDuration) {
    if (comparison === 0) status = "valid";
    else if (comparison < 0 && pickup && !expectedIsExplicit) status = "pickup";
    else if (comparison < 0) status = "under";
    else status = "over";
  }
  if (missingNoteIds.length) {
    diagnostics.push(makeDiagnostic("MEASURE_NOTE_MISSING", "小节成员音符不存在，未被重新绑定到邻居", { measureId: id, missingNoteIds }, "error"));
  }
  if (memberIndexes.some((index, position) => position > 0 && index !== memberIndexes[position - 1] + 1)) {
    diagnostics.push(makeDiagnostic("MEASURE_NOTE_ORDER_BROKEN", "小节成员在当前页序中不连续或顺序已改变", { measureId: id, noteIds: uniqueNoteIds, memberIndexes }, "warning"));
  }
  return {
    id,
    noteIds: uniqueNoteIds,
    startNoteId: explicitStart || uniqueNoteIds[0] || null,
    endNoteId: explicitEnd || uniqueNoteIds.at(-1) || null,
    startIndex,
    endIndex,
    noteCount: uniqueNoteIds.length,
    presentCount: memberIndexes.length,
    missingNoteIds,
    actualTicks: R.toNumber(actual),
    actualTicksExact: R.toString(actual),
    expectedIsExplicit,
    expectedTicks: R.toNumber(expected),
    expectedTicksExact: R.toString(expected),
    beats: R.toNumber(R.divide(actual, R.fraction(24))),
    expectedBeats: R.toNumber(R.divide(expected, R.fraction(24))),
    meter,
    pickup,
    status,
    originalIndex,
  };
}

function deriveLegacyMeasures(entries, meter, pickup, tupletsById, diagnostics) {
  if (!entries.length) return [];
  const groups = [];
  let startIndex = 0;
  entries.forEach((entry, index) => {
    const isEnd = Boolean(entry.annotation?.measureEnd) || index === entries.length - 1;
    if (!isEnd) return;
    const noteIds = entries.slice(startIndex, index + 1).map((item) => item.id);
    groups.push({
      id: `measure:${noteIds[0]}`,
      noteIds,
      startNoteId: noteIds[0],
      endNoteId: noteIds.at(-1),
      startIndex,
      endIndex: index,
      noteCount: noteIds.length,
      presentCount: noteIds.length,
      missingNoteIds: [],
      meter,
      pickup: groups.length === 0 && pickup,
      expectedTicks: 0,
      actualTicks: 0,
      originalIndex: groups.length,
    });
    startIndex = index + 1;
  });
  return groups.map((measure, index) => normalizeMeasure(measure, entries, new Map(entries.map((entry, entryIndex) => [entry.id, entryIndex])), meter, pickup, tupletsById, diagnostics, index));
}

function normalizeArcs(source, entries, pitches, idToIndex, diagnostics, brokenSeamPairs = new Set()) {
  const sourceArcs = Array.isArray(source.arcs) ? source.arcs : [];
  const sourcePairs = new Set(sourceArcs.map((raw) => {
    const item = raw && typeof raw === "object" ? raw : {};
    return `${item.fromNoteId}:${item.toNoteId}`;
  }));
  const candidates = [...sourceArcs];
  entries.forEach((entry, index) => {
    if (!entry.annotation?.tieToNext) return;
    const next = entries[index + 1];
    if (!next) {
      diagnostics.push(makeDiagnostic("TIE_TO_NEXT_NO_TARGET", "tieToNext 没有后继音符，未进行邻居重绑定", { noteId: entry.id, index }, "warning"));
      return;
    }
    if (sourcePairs.has(`${entry.id}:${next.id}`)) return;
    candidates.push({
      id: `legacy-tie:${entry.id}:${next.id}`,
      type: "auto",
      fromNoteId: entry.id,
      toNoteId: next.id,
      legacy: true,
    });
  });
  const usedIds = new Set();
  return candidates.map((raw, index) => {
    const sourceArc = raw && typeof raw === "object" ? raw : {};
    // Legacy tieToNext also represented slurs. Upgrade cached legacy ties too.
    const type = sourceArc.number ? "slur" : sourceArc.legacy && sourceArc.type === "tie" ? "auto" : (["tie", "slur", "auto"].includes(sourceArc.type) ? sourceArc.type : "auto");
    // 弧线是无序的一对端点：先后由文档顺序决定。模型或历史数据把两端写反不是错误，这里直接纠正。
    let fromNoteId = sourceArc.fromNoteId !== undefined ? String(sourceArc.fromNoteId) : null;
    let toNoteId = sourceArc.toNoteId !== undefined ? String(sourceArc.toNoteId) : null;
    let fromIndex = fromNoteId !== null && idToIndex.has(fromNoteId) ? idToIndex.get(fromNoteId) : null;
    let toIndex = toNoteId !== null && idToIndex.has(toNoteId) ? idToIndex.get(toNoteId) : null;
    const reversed = fromIndex !== null && toIndex !== null && toIndex < fromIndex;
    if (reversed) {
      [fromNoteId, toNoteId] = [toNoteId, fromNoteId];
      [fromIndex, toIndex] = [toIndex, fromIndex];
    }
    if(fromIndex!==null&&toIndex!==null&&fromIndex>toIndex){[fromNoteId,toNoteId]=[toNoteId,fromNoteId];[fromIndex,toIndex]=[toIndex,fromIndex];}
    let id = String(sourceArc.id || `arc:${type}:${fromNoteId ?? index}:${toNoteId ?? index}`);
    if (usedIds.has(id)) id = `${id}:${index + 1}`;
    usedIds.add(id);
    if (reversed) diagnostics.push(makeDiagnostic("ARC_DIRECTION_NORMALIZED", "弧线两端写反，已按文档顺序纠正", { arcId: id, fromNoteId, toNoteId, type }, "warning"));
    const adjacent = fromIndex !== null && toIndex !== null && toIndex === fromIndex + 1;
    const seamBroken = fromNoteId !== null && toNoteId !== null && brokenSeamPairs.has(fromNoteId + ":" + toNoteId);
    const fromPitch = fromIndex === null ? null : pitches[fromIndex];
    const toPitch = toIndex === null ? null : pitches[toIndex];
    const samePitch = Boolean(fromPitch && toPitch && !fromPitch.isRest && !toPitch.isRest && fromPitch.midi === toPitch.midi);
    const crossesRest = Boolean((fromPitch && fromPitch.isRest) || (toPitch && toPitch.isRest));
    let status = "valid";
    let effectiveType = type === "auto" ? "slur" : type;
    let reason = null;
    if (seamBroken) {
      status = "invalid";
      effectiveType = "slur";
      reason = "SEAM_RELATION_CHANGED";
    } else if (fromIndex === null || toIndex === null) {
      status = "invalid";
      effectiveType = "slur";
      reason = "ARC_ENDPOINT_MISSING";
      diagnostics.push(makeDiagnostic("ARC_ENDPOINT_MISSING", "弧线端点音符不存在，未被重新绑定到邻居", { arcId: id, fromNoteId, toNoteId, type }, "error"));
    } else if (type === "tie") {
      if (!adjacent) {
        status = "invalid";
        effectiveType = "slur";
        reason = "ARC_TIE_NOT_ADJACENT";
        diagnostics.push(makeDiagnostic("ARC_TIE_NOT_ADJACENT", "tie 必须连接相邻音符；长弧线不会合并中间同音", { arcId: id, fromNoteId, toNoteId }, "error"));
      } else if (crossesRest) {
        status = "invalid";
        effectiveType = "slur";
        reason = "ARC_TIE_CROSSES_REST";
        diagnostics.push(makeDiagnostic("ARC_TIE_CROSSES_REST", "tie 不可跨越休止符", { arcId: id, fromNoteId, toNoteId }, "error"));
      } else if (!samePitch) {
        status = "invalid";
        effectiveType = "slur";
        reason = "ARC_TIE_PITCH_MISMATCH";
        diagnostics.push(makeDiagnostic("ARC_TIE_PITCH_MISMATCH", "tie 两端实际音高不同", { arcId: id, fromNoteId, toNoteId, fromMidi: fromPitch?.midi ?? null, toMidi: toPitch?.midi ?? null }, "error"));
      } else {
        effectiveType = "tie";
      }
    } else if (type === "auto") {
      if (adjacent && samePitch && !crossesRest) {
        status = "valid";
        effectiveType = "tie";
      } else if (adjacent) {
        status = "valid";
        effectiveType = "slur";
      } else {
        status = "invalid";
        effectiveType = "slur";
        reason = "AUTO_ARC_NOT_ADJACENT";
        diagnostics.push(makeDiagnostic("AUTO_ARC_NOT_ADJACENT", "auto 弧线只判定相邻两音；长弧线按 slur 处理，不合并内部同音", { arcId: id, fromNoteId, toNoteId }, "warning"));
      }
    } else {
      if (!adjacent && samePitch) {
        status = "valid";
        effectiveType = "slur";
      } else {
        status = "valid";
        effectiveType = "slur";
      }
    }
    return {
      id,
      type,
      fromNoteId,
      toNoteId,
      fromIndex,
      toIndex,
      number: sourceArc.number ?? null,
      normal: sourceArc.normal ?? null,
      legacy: Boolean(sourceArc.legacy),
      status,
      effectiveType,
      reason,
    };
  });
}

function resolveTieLinks(entries, arcs, pitches, idToIndex, diagnostics) {
  const count = entries.length;
  const links = Array(Math.max(0, count - 1)).fill(false);
  const explicitSlurSpans = arcs.filter((arc) => arc.type === "slur" && arc.fromIndex !== null && arc.toIndex !== null && arc.toIndex > arc.fromIndex);
  arcs.forEach((arc) => {
    if (arc.effectiveType !== "tie" || arc.status !== "valid") return;
    if (arc.fromIndex === null || arc.toIndex === null || arc.toIndex !== arc.fromIndex + 1) return;
    const suppressedBySlur = explicitSlurSpans.some((slur) => slur.fromIndex <= arc.fromIndex && slur.toIndex >= arc.toIndex && !(arc.type === "tie" && !arc.legacy));
    if (suppressedBySlur && arc.type !== "tie") return;
    if (suppressedBySlur && arc.legacy) return;
    const fromPitch = pitches[arc.fromIndex];
    const toPitch = pitches[arc.toIndex];
    if (!fromPitch || !toPitch || fromPitch.isRest || toPitch.isRest || fromPitch.midi !== toPitch.midi) {
      if (!arc.legacy) {
        diagnostics.push(makeDiagnostic("TIE_LINK_INVALID", "tie 连接在播放前验证失败，未合并发声", { arcId: arc.id, fromNoteId: arc.fromNoteId, toNoteId: arc.toNoteId }, "warning"));
      }
      return;
    }
    links[arc.fromIndex] = true;
  });
  return links;
}

function normalizeTempoEvents(source, entries, idToIndex, diagnostics) {
  const raw = Array.isArray(source.tempoEvents) ? source.tempoEvents : [];
  const events = raw.map((item, index) => {
    const event = item && typeof item === "object" ? item : {};
    const atNoteId = event.atNoteId ?? event.noteId ?? event.position?.noteId ?? null;
    const resolvedIndex = atNoteId !== null && idToIndex.has(String(atNoteId)) ? idToIndex.get(String(atNoteId)) : null;
    if (resolvedIndex === null && atNoteId !== null) {
      diagnostics.push(makeDiagnostic("TEMPO_POSITION_MISSING", "速度变化位置的音符不存在，未被重新绑定到邻居", { eventId: event.id, atNoteId }, "error"));
    }
    const bpm = Number(event.bpm ?? event.tempo);
    if (!Number.isFinite(bpm) || bpm <= 0) {
      diagnostics.push(makeDiagnostic("TEMPO_BPM_INVALID", "速度值必须是正数", { eventId: event.id, bpm }, "error"));
    }
    const beat = normalizeBeatUnit(event.beat ?? (event.beatUnit === undefined ? event.unit : { beatUnit: event.beatUnit, dots: event.dots ?? (event.dotted ? 1 : 0) }), diagnostics, event.id);
    return {
      id: String(event.id || `tempo:${atNoteId ?? index + 1}`),
      atNoteId: atNoteId === null ? null : String(atNoteId),
      atIndex: resolvedIndex,
      bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : null,
      beat: beat.beat,
      beatTicks: beat.beatTicks,
      beatTicksExact: beat.beatTicksExact,
    };
  });
  events.sort((left, right) => (left.atIndex ?? Infinity) - (right.atIndex ?? Infinity));
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].atIndex !== null && events[index].atIndex === events[index - 1].atIndex) {
      diagnostics.push(makeDiagnostic("TEMPO_POSITION_DUPLICATE", "同一位置存在多个速度变化，按后定义生效", { eventIds: [events[index - 1].id, events[index].id], atIndex: events[index].atIndex }, "warning"));
    }
  }
  return events;
}

function normalizeBeatUnit(value, diagnostics, eventId) {
  const source = value && typeof value === "object" ? value : {};
  let baseTicks = annotationBaseTicks(source);
  let dots = annotationDots(source);
  if (baseTicks === null && source.beatUnit !== undefined) {
    const unit = Number(source.beatUnit);
    if (Number.isFinite(unit) && [2, 4, 8, 16].includes(unit)) baseTicks = DEFAULT_TICKS_PER_QUARTER * 4 / unit;
  }
  if (baseTicks === null && value !== undefined) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && [2, 4, 8, 16].includes(numeric)) {
      baseTicks = DEFAULT_TICKS_PER_QUARTER * 4 / numeric;
    } else if (BASE_TICKS.has(Number(value))) {
      baseTicks = Number(value);
    }
  }
  if (baseTicks === null) baseTicks = DEFAULT_TICKS_PER_QUARTER;
  if (!BASE_TICKS.has(baseTicks)) {
    diagnostics.push(makeDiagnostic("TEMPO_BEAT_INVALID", "速度拍单位无效，已回退为四分音符", { eventId, baseTicks }, "warning"));
    baseTicks = DEFAULT_TICKS_PER_QUARTER;
  }
  const beatTicks = R.multiply(R.fraction(baseTicks), dottedFactor(dots));
  return {
    beat: { durationTicks: baseTicks, dots },
    beatTicks: R.toNumber(beatTicks),
    beatTicksExact: R.toString(beatTicks),
  };
}

function normalizeBaseTempo(value, diagnostics) {
  const source = value && typeof value === "object" ? value : { bpm: value };
  const bpm = Number(source.bpm ?? source.tempo);
  if (!Number.isFinite(bpm) || bpm <= 0) {
    diagnostics.push(makeDiagnostic("BASE_TEMPO_INVALID", "默认速度必须是正数", { bpm }, "error"));
    return { bpm: null, beat: { durationTicks: DEFAULT_TICKS_PER_QUARTER, dots: 0 }, beatTicks: DEFAULT_TICKS_PER_QUARTER, beatTicksExact: "24" };
  }
  const beat = normalizeBeatUnit(source.beat ?? (source.beatUnit === undefined ? { durationTicks: DEFAULT_TICKS_PER_QUARTER, dots: 0 } : { beatUnit: source.beatUnit, dots: source.dots ?? (source.dotted ? 1 : 0) }), diagnostics, "baseTempo");
  return { bpm, beat: beat.beat, beatTicks: beat.beatTicks, beatTicksExact: beat.beatTicksExact };
}

function sortDiagnostics(items) {
  return items
    .map((item, index) => ({ ...item, _order: index }))
    .sort((left, right) => {
      const leftIndex = Number.isInteger(left.index) ? left.index : Infinity;
      const rightIndex = Number.isInteger(right.index) ? right.index : Infinity;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      if (left.code !== right.code) return left.code < right.code ? -1 : 1;
      return left._order - right._order;
    })
    .map(({ _order, ...item }) => item);
}

export function summarizeMusicMeasures(document, noteCount) {
  const analyzed = analysisForDocument(document, {});
  const measures = analyzed.music.measures;
  if (!measures.length) return [];
  return measures.map((measure) => ({
    index: measure.index,
    measureId: measure.id,
    startNoteId: measure.startNoteId,
    endNoteId: measure.endNoteId,
    meterChange: Boolean(measure.meterChange),
    startIndex: measure.startIndex,
    endIndex: measure.endIndex,
    noteCount: measure.noteCount,
    annotatedCount: measure.presentCount,
    totalTicks: measure.actualTicks,
    expectedTicks: measure.expectedTicks,
    beats: measure.beats,
    expectedBeats: measure.expectedBeats,
    status: measure.status,
    meter: measure.meter,
    pickup: measure.pickup,
    noteIds: measure.noteIds,
  }));
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

