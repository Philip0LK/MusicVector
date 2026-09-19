// 导出到手机端的「曲目包」。纯函数、不碰 DOM，Node 测试与 fixture 生成共用。
//
// 设计要点：手机端不重写音乐结构算法。凡是与速度无关的结构（每个音的时值、
// 延音关系、连梁分组、小节边界、弧线布局、还原号产生的音高偏移）都在这里用
// 电脑端现有管线算好；手机端只做「ticks 按自己的 BPM 换算成秒 + 发声 + 绘制」。
import {cropRect, validateCrop} from './cropGeometry.js';
import {beatPositions} from './layoutRules.js';
import {measures as measuresOf} from './model.js';
import {flatten, rhythmOf} from './training.js';
import {rowArcSegments} from './lib/arcEditing.js';
import {analyzeMusicNotes} from './lib/musicStructure.js';
import {buildRhythmPlaybackPlan} from './lib/rhythmPlayback.js';

export const HANDOFF_VERSION = 1;

const IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function imageMime(src) {
  const text = String(src || '');
  const data = text.match(/^data:([^;,]+)/);
  if (data) return data[1];
  if (/\.png(\?|#|$)/i.test(text)) return 'image/png';
  if (/\.webp(\?|#|$)/i.test(text)) return 'image/webp';
  return 'image/jpeg';
}

export function imageFileName(index, mime) {
  return `images/${index}.${IMAGE_EXTENSIONS[mime] || 'jpg'}`;
}

// 播放与导出的共同前置条件：任何一条不满足都不该把这首曲子送到手机上。
export function handoffBlockers({ document, notes, rhythm, images, plan }) {
  const messages = [];
  if (!document?.rows?.length) messages.push('这首歌曲还没有可训练的音符');
  if (document?.rows?.some((row) => row.recognitionBlocked && row.notes.length)) {
    messages.push('存在未确认的音符，请先修正乐谱');
  }
  if ((images || []).some((image) => !image?.result?.rows?.length)) {
    messages.push('部分图片尚无可训练乐谱，请先完成识别和校对');
  }
  if (notes.some((note) => !(note.annotation?.durationTicks > 0))) {
    messages.push('有音符缺少时值标注，请先在修正乐谱中补全');
  }
  if (document?.music?.pendingArcs?.some((arc) => arc.number)) {
    messages.push('连音组范围待确认，请修正连接');
  }
  const blocking = plan?.diagnostics?.find((item) => item.severity === 'error');
  if (blocking) messages.push(blocking.message);
  return [...new Set(messages)];
}

function cropForHandoff(crop) {
  if (Array.isArray(crop)) {
    return { version: 2, kind: 'band', top: Number(crop[0]) || 0, bottom: Number(crop[1]) || 0 };
  }
  if (!validateCrop(crop)) return { version: 2, kind: 'full', x: 0, y: 0, width: 1, height: 1 };
  if (crop.version === 3) {
    const f = crop.rectified;
    return {
      version: 3,
      kind: 'rectified',
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height,
      quad: crop.quad.map((point) => [point[0], point[1]]),
      rectified: {
        width: f.width,
        height: f.height,
        originalWidth: f.originalWidth,
        originalHeight: f.originalHeight,
        fromOriginal: f.fromOriginal.map((row) => [...row]),
        rect: { x: f.rect.x, y: f.rect.y, width: f.rect.width, height: f.rect.height },
      },
    };
  }
  return { version: 2, kind: 'box', x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

const fractionText = (value) => (value === null || value === undefined ? null : String(value));

export function buildHandoffManifest({ song, document, images = [], baseTempo, generatedAt }) {
  const notes = flatten(document);
  const tempo = Number(baseTempo) > 0 ? Number(baseTempo) : song?.bpm ?? 80;
  const rhythm = rhythmOf(document, { baseTempo: tempo, key: song?.key, octave: song?.octave });
  const plan = buildRhythmPlaybackPlan(notes, rhythm, {
    startIndex: 0,
    endIndex: null,
    tempo,
    baseTempo: tempo,
  });
  const allMeasures = measuresOf(document);
  const beamGroups = beatPositions(document, allMeasures);
  const analysis = analyzeMusicNotes(notes, rhythm, {
    key: song?.key,
    octave: song?.octave,
  });

  const blockers = handoffBlockers({ document, notes, rhythm, images, plan });
  if (blockers.length) throw new Error(blockers[0]);

  // 全曲计划的第一个音永远不是延音延续；从「下一个音是否为延续」就能还原逐音延音关系。
  const tieLink = notes.map((_, index) => Boolean(plan.steps[index + 1]?.tieContinuation));
  const imageList = images.map((image, index) => {
    const mime = imageMime(image.src);
    return {
      index,
      id: String(image.id ?? index),
      name: String(image.name || `${index + 1}`),
      mime,
      path: imageFileName(index, mime),
    };
  });

  let offset = 0;
  const rows = document.rows.map((row, index) => {
    const startNoteIndex = offset;
    offset += row.notes.length;
    return {
      index,
      page: row.page,
      line: row.line,
      text: row.text ?? '',
      imageIndex: row.page,
      crop: cropForHandoff(row.crop),
      startNoteIndex,
      noteCount: row.notes.length,
      seamNeedsReview: Boolean(row.seamNeedsReview),
      arcs: rowArcSegments(document, index, document.music?.arcs || []).map((arc) => ({
        id: String(arc.id),
        number: arc.number ?? null,
        start: arc.start,
        end: arc.end,
        level: arc.level,
        typeSegment: arc.typeSegment,
        span: arc.span,
      })),
    };
  });

  return {
    handoff: HANDOFF_VERSION,
    generatedAt: generatedAt || new Date().toISOString(),
    song: {
      id: String(song?.id ?? 'song'),
      title: String(song?.title ?? '未命名'),
      key: String(song?.key ?? 'C'),
      octave: Number(song?.octave ?? 4),
      bpm: tempo,
      meter: { beats: document.meter.beats, beatUnit: document.meter.beatUnit },
      pickup: Boolean(document.pickup),
      ticksPerQuarter: rhythm.ticksPerQuarter,
      // 与 rhythmPlayback.createTempoModel 的 defaultBpm/defaultBeatTicks 同源：
      // 手机端 ticks→秒 必须用这两个值，不能自己猜。
      baseBpm: Number.isFinite(Number(document.music?.baseTempo?.bpm))
        ? Number(document.music.baseTempo.bpm)
        : tempo,
      baseBeatTicks: Number(document.music?.baseTempo?.beatTicks) > 0
        ? Number(document.music.baseTempo.beatTicks)
        : rhythm.ticksPerQuarter,
      tempoEvents: (document.music?.tempoEvents || []).map((event) => ({
        atIndex: Number.isInteger(event.atIndex) ? event.atIndex : null,
        bpm: Number(event.bpm) || null,
        beatTicks: Number(event.beatTicks) || null,
      })),
    },
    notes: notes.map((note, index) => {
      const pitch = analysis.pitches[index] || {};
      const notation = pitch.notation || note;
      const step = plan.steps[index] || {};
      return {
        id: String(note.id ?? index),
        degree: Number.isInteger(notation.degree) ? notation.degree : 0,
        accidental: notation.accidental ?? null,
        octave: Number(notation.octave) || 0,
        pitchOffset: Number(pitch.accidentalOffset) || 0,
        isRest: Number(notation.degree) === 0,
        durationTicks: fractionText(step.durationTicksExact),
        // 排版用的是标注基值时值（6/12/24/48/96），不是附点/连音组折算后的有效时值。
        baseTicks: note.annotation?.durationTicks ?? null,
        soundDurationTicks: fractionText(step.soundDurationTicksExact),
        startTicks: fractionText(step.startTicksExact),
        tieToNext: tieLink[index],
        measureEnd: Boolean(note.annotation?.measureEnd),
        missingDuration: !(note.annotation?.durationTicks > 0),
        dots: Number(note.annotation?.dots ?? (note.annotation?.dotted ? 1 : 0)) || 0,
        dotted: Boolean(note.annotation?.dotted),
        beamGroup: beamGroups[index] ?? null,
      };
    }),
    rows,
    measures: allMeasures.map((measure) => ({
      index: measure.index,
      startIndex: measure.startIndex,
      endIndex: measure.endIndex,
      noteCount: measure.noteCount,
      beats: measure.beats,
      expectedBeats: measure.expectedBeats,
      totalTicks: measure.totalTicks,
      expectedTicks: measure.expectedTicks,
      status: measure.status,
      meter: measure.meter,
      meterChange: Boolean(measure.meterChange),
      pickup: Boolean(measure.pickup),
    })),
    images: imageList,
    totals: {
      notes: notes.length,
      rows: rows.length,
      measures: allMeasures.length,
      missingDurations: plan.missingIndexes.length,
      differentPitchTies: plan.differentPitchTies.length,
    },
  };
}

// 供桌面端与测试共用：曲目包里的第 index 页原图裁切矩形。
export function handoffCropRect(crop, imageWidth, imageHeight) {
  if (crop?.kind === 'band') return cropRect([crop.top, crop.bottom], imageWidth, imageHeight);
  if (crop?.kind === 'rectified') return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
  if (crop?.kind === 'box') return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
  return { x: 0, y: 0, width: 1, height: 1 };
}
