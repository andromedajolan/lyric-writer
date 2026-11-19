// Chord parsing, transposing and spelling. Pure functions, no DOM.

const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// Semitones from a mode's tonic up to its relative major (used to choose flat vs sharp spelling).
const REL_MAJOR = { major: 0, minor: 3, dorian: 10, phrygian: 8, lydian: 7, mixolydian: 5, locrian: 1 };
const SCALE = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

// root, accidental, quality/extensions, optional /bass
export const CHORD_RE = /^([A-G])([#b♯♭]?)((?:maj|min|m|M|dim|aug|sus|add|no|alt|[0-9]|[#b♯♭+\-°øΔ()])*)(?:\/([A-G])([#b♯♭]?))?$/;
const BRACKET_RE = /\[([^\[\]\n]*)\]/g;

export const isChord = (s) => typeof s === 'string' && CHORD_RE.test(s.trim());

const acc = (a) => (a === '#' || a === '♯' ? 1 : a === 'b' || a === '♭' ? -1 : 0);
export const pcOf = (letter, a = '') => (((LETTER[letter] + acc(a)) % 12) + 12) % 12;
export const noteName = (pc, flats) => (flats ? FLAT : SHARP)[((pc % 12) + 12) % 12];

export function keyPc(name) {
  const m = /^([A-G])([#b]?)$/.exec(name || '');
  return m ? pcOf(m[1], m[2]) : null;
}

function flatsForRel(rel, mode) {
  return [5, 10, 3, 8, 1].includes(rel) || (rel === 6 && mode !== 'major');
}

// Should chords for this key be spelled with flats?
export function preferFlats(keyName, mode) {
  if (!keyName) return false;
  if (keyName.includes('b')) return true;
  if (keyName.includes('#')) return false;
  const m = mode || 'major';
  const pc = keyPc(keyName);
  if (pc == null) return false;
  return flatsForRel((pc + (REL_MAJOR[m] ?? 0)) % 12, m);
}

// Conventional key name for a pitch class (Eb minor, not D# minor; F# major, not Gb major).
export function keyNameFor(pc, mode) {
  const m = mode || 'major';
  const rel = (pc + (REL_MAJOR[m] ?? 0)) % 12;
  return noteName(pc, flatsForRel(rel, m));
}

// Smallest move from one key to another; ties go down (you usually lower keys to fit a voice).
export function shortestShift(fromKey, toKey) {
  const a = keyPc(fromKey), b = keyPc(toKey);
  if (a == null || b == null) return 0;
  const d = (b - a + 12) % 12;
  return d >= 6 ? d - 12 : d;
}

export function transposeChord(chord, n, flats) {
  const m = CHORD_RE.exec(String(chord).trim());
  if (!m) return chord;
  const [, L, a, suffix, bL, bA] = m;
  const root = noteName(pcOf(L, a) + n, flats);
  const bass = bL ? '/' + noteName(pcOf(bL, bA || '') + n, flats) : '';
  return root + suffix + bass;
}

// Transposes only bracket tokens that are valid chords. Other brackets are left alone.
export function transposeLyrics(text, n, flats) {
  return text.replace(BRACKET_RE, (m, x) => (isChord(x) ? '[' + transposeChord(x, n, flats) + ']' : m));
}

export function chordsIn(text) {
  const out = [];
  text.replace(BRACKET_RE, (m, x) => { if (isChord(x)) out.push(x.trim()); return m; });
  return out;
}

// Spelling guess when a song has chords but no key set: keep flats if the chart already uses them.
export function chordsUseFlats(texts) {
  return texts.some((t) => chordsIn(t).some((c) => { const m = CHORD_RE.exec(c); return m && (m[2] === 'b' || m[2] === '♭' || m[5] === 'b' || m[5] === '♭'); }));
}

// Chords that belong to the key, for quick entry. Minor also offers the major V.
export function diatonicChords(key, mode) {
  const pc = keyPc(key);
  if (pc == null) return [];
  const m = mode && SCALE[mode] ? mode : 'major';
  const sc = SCALE[m];
  const flats = preferFlats(key, m);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const third = (sc[(i + 2) % 7] - sc[i] + 12) % 12;
    const fifth = (sc[(i + 4) % 7] - sc[i] + 12) % 12;
    const q = third === 4 && fifth === 7 ? '' : third === 3 && fifth === 7 ? 'm' : third === 3 && fifth === 6 ? 'dim' : third === 4 && fifth === 8 ? 'aug' : '';
    out.push(noteName(pc + sc[i], flats) + q);
  }
  if (m === 'minor') { const v = noteName(pc + 7, flats); if (!out.includes(v)) out.push(v); }
  return out;
}
