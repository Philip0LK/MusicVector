const DEGREE_STEPS = [null, 0, 2, 4, 5, 7, 9, 11];
const NOTE_OFFSETS = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

export function parseJianpuSequence(input) {
  return parseJianpuSequenceWithSpans(input).map((item) => item.note);
}

export function normalizeJianpuOcrText(input) {
  return String(input || "")
    .normalize("NFKC")
    .replace(
      /(^|[^A-Za-z0-9#b.])([#b]?[.]*)([iIlL])(?=(?:[']+|,+)?(?:$|[^A-Za-z0-9]))/g,
      "$1$21",
    );
}

export function parseJianpuSequenceWithSpans(input) {
  const text = normalizeNotationText(input);
  const notePattern =
    /([#b]?)([.]+)?([0-7])([']+|[,]+)?|([.]+)([#b]?)([0-7])/g;
  const notes = [];
  let match;

  while ((match = notePattern.exec(text)) !== null) {
    if (match[7]) {
      notes.push({
        note: normalizeNote({
          accidental: match[6] || null,
          degree: Number(match[7]),
          octave: -match[5].length,
        }),
        start: match.index,
        end: notePattern.lastIndex,
      });
      continue;
    }

    const degree = normalizeDegree(match[3]);
    const suffix = match[4] || "";
    const prefixDots = match[2] || "";
    const octave = suffix.startsWith("'")
      ? suffix.length
      : suffix.startsWith(",")
        ? -suffix.length
        : -prefixDots.length;

    notes.push({
      note: normalizeNote({
        accidental: match[1] || null,
        degree,
        octave,
      }),
      start: match.index,
      end: notePattern.lastIndex,
    });
  }

  return notes;
}

export function groupParsedNotesByLine(
  input,
  parsed = parseJianpuSequenceWithSpans(input),
) {
  const text = normalizeNotationText(input);
  const rows = [];
  let sourceLine = 0;
  let nextLineBreak = text.indexOf("\n");
  let currentRow = null;

  parsed.forEach((item, index) => {
    while (nextLineBreak >= 0 && nextLineBreak < item.start) {
      sourceLine += 1;
      nextLineBreak = text.indexOf("\n", nextLineBreak + 1);
    }

    if (!currentRow || currentRow.sourceLine !== sourceLine) {
      currentRow = { sourceLine, items: [] };
      rows.push(currentRow);
    }
    currentRow.items.push({ ...item, index });
  });

  const sourceLines = text.split("\n");
  let page = 1;
  let lineInPage = 0;
  let previousSourceLine = null;

  return rows.map((row) => {
    const crossedPageBreak =
      previousSourceLine !== null &&
      sourceLines
        .slice(previousSourceLine + 1, row.sourceLine)
        .some((line) => !line.trim());
    if (crossedPageBreak) {
      page += 1;
      lineInPage = 0;
    }
    lineInPage += 1;
    previousSourceLine = row.sourceLine;
    return { ...row, page, lineInPage };
  });
}

export function flattenRecognition(recognition) {
  const normalizedRecognition = normalizeRecognition(recognition);
  const flattened = [];

  normalizedRecognition.pages.forEach((page, pageIndex) => {
    page.rows.forEach((row, rowIndex) => {
      const rowNotes = Array.isArray(row?.notes) && row.notes.length
        ? row.notes.map(normalizeNote)
        : parseJianpuSequence(row?.text || "");

      rowNotes.forEach((note, noteIndex) => {
        flattened.push({
          ...note,
          page: Number(page?.page || pageIndex + 1),
          row: rowIndex + 1,
          indexInRow: noteIndex + 1,
        });
      });
    });
  });

  return flattened;
}

export function normalizeRecognition(input) {
  const source = input && typeof input === "object" ? input : {};
  const pages = Array.isArray(source.pages) ? source.pages : [];

  return {
    songTitle: stringValue(source.songTitle),
    key: stringValue(source.key),
    warnings: Array.isArray(source.warnings)
      ? source.warnings.map(stringValue).filter(Boolean)
      : [],
    pages: pages.map((page, pageIndex) => normalizePage(page, pageIndex)),
  };
}

export function noteLabel(note) {
  const normalized = normalizeNote(note);
  const degree = String(normalized.degree);

  if (normalized.degree === 0) return "0";

  const accidental = normalized.accidental || "";
  if (normalized.octave < 0) {
    return `${".".repeat(Math.abs(normalized.octave))}${accidental}${degree}`;
  }

  return `${accidental}${degree}${"'".repeat(normalized.octave)}`;
}

export function noteToMidi(note, key = "C") {
  const normalized = normalizeNote(note);
  if (normalized.degree === 0) return null;

  const root = keyToMidiRoot(key);
  const accidentalOffset =
    normalized.accidental === "#"
      ? 1
      : normalized.accidental === "b"
        ? -1
        : 0;

  return (
    root +
    DEGREE_STEPS[normalized.degree] +
    normalized.octave * 12 +
    accidentalOffset
  );
}

export function normalizeNote(note) {
  const degree = normalizeDegree(note?.degree ?? 0);

  return {
    degree,
    accidental: normalizeAccidental(note?.accidental),
    octave: Number(note?.octave || 0),
    sourceText: note?.sourceText || note?.text || null,
  };
}

function normalizeNotationText(input) {
  return normalizeJianpuOcrText(input)
    .replace(/[\u266f\uff03]/g, "#")
    .replace(/[\u266d]/g, "b")
    .replace(/[\u2019\u2032]/g, "'")
    .replace(/[\uff0c]/g, ",")
    .replace(/[\u00b7\u2022\u3002]/g, ".")
    .replace(/[|:\uff1a\[\]{}()]/g, " ")
    .replace(/[\u2014\u2013_]/g, "-")
    .replace(/[\uff49]/gi, "i");
}

function normalizeDegree(value) {
  const raw = String(value).trim().toLowerCase();
  if (raw === "i" || raw === "l") return 1;

  const number = Number(raw);
  if (!Number.isInteger(number) || number < 0 || number > 7) return 0;
  return number;
}

function normalizeAccidental(value) {
  if (value === "#" || value === "\u266f") return "#";
  if (value === "b" || value === "\u266d") return "b";
  return null;
}

function keyToMidiRoot(key) {
  const text = String(key || "C").normalize("NFKC");
  const match = text.match(/(?:1\s*=\s*)?([A-G](?:#|b)?)(-?\d+)?/i);
  if (!match) return 60;

  const tonic = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  const octave = match[2] === undefined ? 4 : Number(match[2]);
  const offset = NOTE_OFFSETS[tonic] ?? NOTE_OFFSETS.C;
  return (octave + 1) * 12 + offset;
}

function normalizePage(page, pageIndex) {
  const rows = Array.isArray(page?.rows) ? page.rows : [];
  return {
    page: numberValue(page?.page, pageIndex + 1),
    rows: rows.map(normalizeRow).filter((row) => row.text || row.notes.length),
  };
}

function normalizeRow(row) {
  const text = normalizeJianpuOcrText(stringValue(row?.text));
  const providedNotes = Array.isArray(row?.notes)
    ? row.notes.map(normalizeNote).filter(isValidPlayableNote)
    : [];

  return {
    text,
    notes: providedNotes.length ? providedNotes : parseJianpuSequence(text),
  };
}

function isValidPlayableNote(note) {
  return Number.isInteger(note.degree) && note.degree >= 0 && note.degree <= 7;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
