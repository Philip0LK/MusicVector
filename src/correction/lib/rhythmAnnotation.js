import {summarizeMusicMeasures} from '../../lib/musicStructure.js';

export const TICKS_PER_QUARTER = 24;

export const RHYTHM_DURATIONS = Object.freeze([
  Object.freeze({ ticks: 6, label: "十六分", shortLabel: "1/16" }),
  Object.freeze({ ticks: 12, label: "八分", shortLabel: "1/8" }),
  Object.freeze({ ticks: 24, label: "四分", shortLabel: "1/4" }),
  Object.freeze({ ticks: 48, label: "二分", shortLabel: "1/2" }),
  Object.freeze({ ticks: 96, label: "全音符", shortLabel: "全" }),
]);

const VALID_BASE_TICKS = new Set(RHYTHM_DURATIONS.map((item) => item.ticks));

export function createRhythmDocument(noteCount = 0) {
  return normalizeRhythmDocument(null, noteCount);
}

export function normalizeRhythmDocument(input, noteCount = 0) {
  const source = input && typeof input === "object" ? input : {};
  const meter = source.meter && typeof source.meter === "object"
    ? source.meter
    : {};
  const beats = clampInteger(meter.beats, 1, 32, 4);
  const beatUnit = [2, 4, 8, 16].includes(Number(meter.beatUnit))
    ? Number(meter.beatUnit)
    : 4;
  const sourceAnnotations = Array.isArray(source.annotations)
    ? source.annotations
    : [];
  const annotations = Array.from(
    { length: Math.max(0, Number(noteCount) || 0) },
    (_, index) => normalizeAnnotation(sourceAnnotations[index]),
  );

  return {
    version: 1,
    ticksPerQuarter: TICKS_PER_QUARTER,
    meter: { beats, beatUnit },
    pickup: Boolean(source.pickup),
    annotations,
    music: source.music,
    baseTempo: source.baseTempo,
    key: source.key,
    octave: source.octave,
  };
}

export function updateRhythmSettings(document, settings, noteCount = 0) {
  const current = normalizeRhythmDocument(document, noteCount);
  const source = settings && typeof settings === "object" ? settings : {};
  const next = normalizeRhythmDocument(
    {
      ...current,
      meter: {
        beats: source.beats ?? current.meter.beats,
        beatUnit: source.beatUnit ?? current.meter.beatUnit,
      },
      pickup: source.pickup ?? current.pickup,
    },
    noteCount,
  );

  return {
    rhythm: next,
    meterChanged:
      next.meter.beats !== current.meter.beats ||
      next.meter.beatUnit !== current.meter.beatUnit,
    pickupChanged: next.pickup !== current.pickup,
  };
}

export function annotationFromBarlines(document, notation, parsedNotes) {
  const normalized = normalizeRhythmDocument(document, parsedNotes.length);
  parsedNotes.forEach((item, index) => {
    const nextStart = parsedNotes[index + 1]?.start ?? String(notation || "").length;
    const between = String(notation || "").slice(item.end, nextStart);
    if (between.includes("|")) {
      normalized.annotations[index] = {
        ...(normalized.annotations[index] || emptyAnnotation()),
        measureEnd: true,
      };
    }
  });
  return normalized;
}

export function setRhythmAnnotation(document, index, changes, noteCount) {
  const normalized = normalizeRhythmDocument(document, noteCount);
  if (!Number.isInteger(index) || index < 0 || index >= normalized.annotations.length) {
    return normalized;
  }
  const current = normalized.annotations[index] || emptyAnnotation();
  const next = normalizeAnnotation({ ...current, ...changes });
  normalized.annotations[index] = hasAnnotationValue(next) ? next : null;
  return normalized;
}

export function clearRhythmAnnotation(document, index, noteCount) {
  const normalized = normalizeRhythmDocument(document, noteCount);
  const measureEnd = Boolean(normalized.annotations[index]?.measureEnd);
  if (index >= 0 && index < normalized.annotations.length) {
    normalized.annotations[index] = measureEnd
      ? { ...emptyAnnotation(), measureEnd: true }
      : null;
  }
  return normalized;
}

export function effectiveDurationTicks(annotation) {
  const normalized = normalizeAnnotation(annotation);
  if (!normalized || normalized.durationTicks === null) return null;
  if (normalized.tupletId) return null;
  const dots = normalized.dots ?? (normalized.dotted ? 1 : 0);
  return normalized.durationTicks * ((2 ** (dots + 1) - 1) / (2 ** dots));
}

export function expectedMeasureTicks(document) {
  const normalized = normalizeRhythmDocument(document, 0);
  return (
    normalized.meter.beats *
    normalized.ticksPerQuarter *
    (4 / normalized.meter.beatUnit)
  );
}

export function summarizeMeasures(document, noteCount) {
  if (Array.isArray(document?.rows)) return summarizeMusicMeasures(document, noteCount);
  const normalized = normalizeRhythmDocument(document, noteCount);
  if (!normalized.annotations.length) return [];
  const expectedTicks = expectedMeasureTicks(normalized);
  const measures = [];
  let startIndex = 0;
  let totalTicks = 0;
  let annotatedCount = 0;

  normalized.annotations.forEach((annotation, index) => {
    const duration = effectiveDurationTicks(annotation);
    if (duration !== null) {
      totalTicks += duration;
      annotatedCount += 1;
    }
    const isEnd = Boolean(annotation?.measureEnd) || index === noteCount - 1;
    if (!isEnd) return;

    const notesInMeasure = index - startIndex + 1;
    const complete = annotatedCount === notesInMeasure;
    let status = "incomplete";
    if (complete && totalTicks === expectedTicks) status = "valid";
    // 只有不带 rows 的旧输入才会走到这里；带 rows 的文档在函数开头就交给结构层，
    // 由歌曲级 pickup 决定首小节是否弱起，不要在这里改弱起判定。
    else if (complete && measures.length === 0 && normalized.pickup && totalTicks < expectedTicks) {
      status = "pickup";
    } else if (complete && totalTicks < expectedTicks) status = "under";
    else if (complete && totalTicks > expectedTicks) status = "over";

    measures.push({
      index: measures.length,
      startIndex,
      endIndex: index,
      noteCount: notesInMeasure,
      annotatedCount,
      totalTicks,
      expectedTicks,
      beats: ticksToBeats(totalTicks, normalized.ticksPerQuarter),
      expectedBeats: ticksToBeats(expectedTicks, normalized.ticksPerQuarter),
      status,
    });
    startIndex = index + 1;
    totalTicks = 0;
    annotatedCount = 0;
  });
  return measures;
}

export function measureIndexForNote(measures, noteIndex) {
  return Math.max(
    0,
    measures.findIndex(
      (measure) => noteIndex >= measure.startIndex && noteIndex <= measure.endIndex,
    ),
  );
}

export function durationLabel(annotation) {
  const normalized = normalizeAnnotation(annotation);
  if (!normalized || normalized.durationTicks === null) return "";
  const duration = RHYTHM_DURATIONS.find(
    (item) => item.ticks === normalized.durationTicks,
  );
  return `${duration?.shortLabel || normalized.durationTicks}${normalized.dotted ? "·" : ""}`;
}

function normalizeAnnotation(value) {
  if (!value || typeof value !== "object") return null;
  const durationTicks = VALID_BASE_TICKS.has(Number(value.durationTicks))
    ? Number(value.durationTicks)
    : null;
  const dots = clampInteger(value.dots ?? (value.dotted ? 1 : 0), 0, 2, 0);
  return {
    durationTicks,
    dots,
    dotted: durationTicks !== null && dots > 0,
    tieToNext: Boolean(value.tieToNext),
    measureEnd: Boolean(value.measureEnd),
    tupletId: value.tupletId ?? value.tuplet?.id ?? null,
  };
}

function emptyAnnotation() {
  return {
    durationTicks: null,
    dotted: false,
    tieToNext: false,
    measureEnd: false,
  };
}

function hasAnnotationValue(annotation) {
  return Boolean(
    annotation &&
      (annotation.durationTicks !== null ||
        annotation.tieToNext ||
        annotation.measureEnd),
  );
}

function ticksToBeats(ticks, ticksPerQuarter) {
  return Number((ticks / ticksPerQuarter).toFixed(4));
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}



