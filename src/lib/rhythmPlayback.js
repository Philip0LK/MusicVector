import {
  TICKS_PER_QUARTER,
  normalizeRhythmDocument,
} from "./rhythmAnnotation.js";
import * as R from "./rational.js";
import {
  analyzeMusicNotes,
  effectiveDurationFraction,
  tieLinksForDocument,
} from "./musicStructure.js";

export const DEFAULT_TEMPO_BPM = 80;

export function normalizeTempo(value) {
  const tempo = Number(value);
  if (!Number.isFinite(tempo) || tempo <= 0) return DEFAULT_TEMPO_BPM;
  return tempo;
}

export function ticksToSeconds(
  ticks,
  tempo = DEFAULT_TEMPO_BPM,
  ticksPerQuarter = TICKS_PER_QUARTER,
) {
  return (
    (Number(ticks) || 0) *
    (60 / normalizeTempo(tempo)) /
    (Number(ticksPerQuarter) || TICKS_PER_QUARTER)
  );
}

export function buildRhythmPlaybackPlan(
  notes,
  document,
  {
    startIndex = 0,
    endIndex = null,
    tempo = undefined,
    baseTempo = undefined,
    practiceRate = undefined,
  } = {},
) {
  const sourceNotes = Array.isArray(notes) ? notes : [];
  const rhythm = normalizeRhythmDocument(document, sourceNotes.length);
  const analysis = analyzeMusicNotes(sourceNotes, rhythm, {
    key: document?.key,
    octave: document?.octave,
  });
  const music = analysis.music;
  const tieLinks = analysis.tieLinks;
  const tupletsById = new Map(music.tuplets.map((group) => [group.id, group]));

  const firstIndex = sourceNotes.length
    ? Math.min(sourceNotes.length - 1, Math.max(0, Math.trunc(Number(startIndex) || 0)))
    : 0;
  const lastIndex = sourceNotes.length
    ? Math.min(
        sourceNotes.length - 1,
        Math.max(
          firstIndex,
          endIndex === null || endIndex === undefined
            ? sourceNotes.length - 1
            : Math.trunc(Number(endIndex) || 0),
        ),
      )
    : 0;

  const tempoModel = createTempoModel(music, { tempo, baseTempo, practiceRate });
  const bpm = tempoModel.planTempo;
  const missingIndexes = [];
  const differentPitchTies = [];
  const steps = [];
  const durationFractions = sourceNotes.map((_, index) =>
    effectiveDurationFraction(analysis.annotations[index], tupletsById),
  );
  const secondsPerTick = durationFractions.map((_, index) => tempoModel.secondsPerTickAt(index));
  const durationSeconds = durationFractions.map((duration, index) => duration === null
    ? R.ZERO
    : R.multiply(duration, secondsPerTick[index]));
  let startTicks = R.ZERO;
  let startSeconds = R.ZERO;
  let totalTicks = R.ZERO;

  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const duration = durationFractions[index];
    if (duration === null) missingIndexes.push(index);

    const previousTiesHere = index > firstIndex && Boolean(tieLinks[index - 1]);
    const isRest = Number(sourceNotes[index]?.degree) === 0;
    let soundDuration = duration || R.ZERO;
    let soundDurationSeconds = durationSeconds[index] || R.ZERO;
    let tiedIndex = index;

    if (!isRest && !previousTiesHere && duration !== null) {
      while (tiedIndex < lastIndex && tieLinks[tiedIndex]) {
        const nextDuration = durationFractions[tiedIndex + 1];
        if (nextDuration === null) break;
        soundDuration = R.add(soundDuration, nextDuration);
        soundDurationSeconds = R.add(soundDurationSeconds, durationSeconds[tiedIndex + 1]);
        tiedIndex += 1;
      }
    }

    const endTicks = R.add(startTicks, duration || R.ZERO);
    const endSeconds = R.add(startSeconds, durationSeconds[index] || R.ZERO);
    steps.push({
      index,
      startTicks: R.toNumber(startTicks),
      startTicksExact: R.toString(startTicks),
      durationTicks: duration === null ? 0 : R.toNumber(duration),
      durationTicksExact: duration === null ? null : R.toString(duration),
      endTicks: R.toNumber(endTicks),
      endTicksExact: R.toString(endTicks),
      trigger: !isRest && !previousTiesHere && duration !== null,
      isRest,
      tieContinuation: Boolean(previousTiesHere),
      soundDurationTicks: R.toNumber(soundDuration),
      soundDurationTicksExact: R.toString(soundDuration),
      startSeconds: R.toNumber(startSeconds),
      endSeconds: R.toNumber(endSeconds),
      durationSeconds: R.toNumber(durationSeconds[index] || R.ZERO),
      soundDurationSeconds: R.toNumber(soundDurationSeconds),
    });
    startTicks = endTicks;
    startSeconds = endSeconds;
    totalTicks = R.add(totalTicks, duration || R.ZERO);
  }

  music.arcs.forEach((arc) => {
    if (
      arc.type === "tie" &&
      arc.reason === "ARC_TIE_PITCH_MISMATCH" &&
      Number.isInteger(arc.fromIndex) &&
      arc.fromIndex >= firstIndex &&
      arc.fromIndex <= lastIndex
    ) {
      differentPitchTies.push(arc.fromIndex);
    }
  });

  return {
    tempo: bpm,
    baseTempo: tempoModel.baseTempo,
    practiceRate: tempoModel.practiceRate,
    tempoEvents: music.tempoEvents,
    ticksPerQuarter: rhythm.ticksPerQuarter || TICKS_PER_QUARTER,
    startIndex: firstIndex,
    endIndex: lastIndex,
    steps,
    missingIndexes,
    differentPitchTies: [...new Set(differentPitchTies)],
    diagnostics: music.diagnostics,
    hasBlockingDiagnostics: music.diagnostics.some((item) => item.severity === "error"),
    totalTicks: R.toNumber(totalTicks),
    totalTicksExact: R.toString(totalTicks),
    totalSeconds: R.toNumber(startSeconds),
    totalSecondsExact: R.toString(startSeconds),
  };
}

function createTempoModel(music, { tempo, baseTempo, practiceRate }) {
  const events = Array.isArray(music.tempoEvents) ? music.tempoEvents : [];
  const baseObject = music.baseTempo || null;
  const hasStructuredTempo = events.length > 0 || Boolean(baseObject) || Number.isFinite(Number(baseTempo));
  const requestedTempo = Number(tempo);
  const hasRequestedTempo = Number.isFinite(requestedTempo) && requestedTempo > 0;

  if (!hasStructuredTempo) {
    const bpm = normalizeTempo(requestedTempo);
    const secondsPerTick = secondsPerTickFraction(bpm, 1, TICKS_PER_QUARTER);
    return {
      planTempo: bpm,
      baseTempo: bpm,
      practiceRate: 1,
      events,
      secondsPerTickAt: () => secondsPerTick,
    };
  }

  const referenceTempo = Number.isFinite(Number(baseTempo))
    ? normalizeTempo(baseTempo)
    : Number.isFinite(Number(baseObject?.bpm))
      ? normalizeTempo(baseObject.bpm)
      : Number.isFinite(Number(events[0]?.bpm))
        ? normalizeTempo(events[0].bpm)
        : DEFAULT_TEMPO_BPM;
  let rate = Number(practiceRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    if (hasRequestedTempo && Number.isFinite(Number(baseTempo)) && Number(baseTempo) > 0) {
      rate = normalizeTempo(requestedTempo) / normalizeTempo(baseTempo);
    } else if (hasRequestedTempo) {
      rate = normalizeTempo(requestedTempo) / normalizeTempo(referenceTempo);
    } else {
      rate = 1;
    }
  }
  const defaultBpm = Number.isFinite(Number(baseObject?.bpm)) ? normalizeTempo(baseObject.bpm) : referenceTempo;
  const defaultBeatTicks = Number(baseObject?.beatTicks) > 0 ? Number(baseObject.beatTicks) : TICKS_PER_QUARTER;
  const secondsPerTickAt = (index) => {
    let bpm = defaultBpm;
    let beatTicks = defaultBeatTicks;
    for (const event of events) {
      if (event.atIndex === null || event.atIndex > index) break;
      if (event.bpm && event.beatTicks) {
        bpm = event.bpm;
        beatTicks = event.beatTicks;
      }
    }
    return secondsPerTickFraction(bpm, rate, beatTicks);
  };
  return {
    planTempo: normalizeTempo(hasRequestedTempo ? requestedTempo : defaultBpm),
    baseTempo: referenceTempo,
    practiceRate: rate,
    events,
    secondsPerTickAt,
  };
}

function secondsPerTickFraction(bpm, rate, beatTicks) {
  return R.divide(
    R.fraction(60n, 1n),
    R.multiply(
      R.multiply(R.fractionFromNumber(bpm), R.fractionFromNumber(rate)),
      R.fractionFromNumber(beatTicks),
    ),
  );
}

export function buildPlaybackCursorTimeline(plan) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const tempo = normalizeTempo(plan?.tempo);
  const ticksPerQuarter = Number(plan?.ticksPerQuarter) || TICKS_PER_QUARTER;
  return steps.map((step) => ({
    index: step.index,
    isRest: Boolean(step.isRest),
    atSeconds: Number.isFinite(step.startSeconds)
      ? step.startSeconds
      : ticksToSeconds(step.startTicks, tempo, ticksPerQuarter),
  }));
}

export function tiedPlaybackEndIndex(document, noteCount, startIndex, { maxIndex = null } = {}) {
  const count = Math.max(0, Math.trunc(Number(noteCount) || 0));
  if (!count) return 0;
  const start = Math.min(count - 1, Math.max(0, Math.trunc(Number(startIndex) || 0)));
  const limit = Math.min(
    count - 1,
    Math.max(start, maxIndex === null || maxIndex === undefined ? count - 1 : Math.trunc(Number(maxIndex) || 0)),
  );
  const links = tieLinksForDocumentLike(document, count);
  let end = start;
  while (end < limit && links[end]) end += 1;
  return end;
}

function tieLinksForDocumentLike(document, count) {
  if (Array.isArray(document?.rows)) return tieLinksForDocument(document);
  const annotations = Array.isArray(document?.annotations) ? document.annotations : [];
  const links = Array(Math.max(0, count - 1)).fill(false);
  for (let index = 0; index < links.length; index += 1) {
    links[index] = Boolean(annotations[index]?.tieToNext);
  }
  return links;
}
