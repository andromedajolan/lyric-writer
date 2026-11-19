// Song data model. Plain JSON, versioned, readable by other studio modules.
// See docs/DATA_FORMAT.md.

export const SCHEMA_VERSION = 1;

export const SECTION_TYPES = [
  'Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Post-Chorus', 'Bridge',
  'Hook', 'Refrain', 'Interlude', 'Instrumental', 'Outro', 'Other',
];

export const QUICK_ADD = ['Verse', 'Pre-Chorus', 'Chorus', 'Bridge'];

export const KEYS = [
  'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb',
  'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B',
];

export const MODES = [
  'major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian',
];

export const TIME_SIGS = ['4/4', '3/4', '6/8', '2/4', '12/8', '5/4', '7/8', '2/2'];

export const RELEASE_TYPES = ['none', 'album', 'single', 'pool'];

export function uid(prefix = 's') {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return prefix + Date.now().toString(36) + r[0].toString(36) + r[1].toString(36);
}

export function newSection(type = 'Verse', lyrics = '') {
  return { id: uid('sec'), type, label: '', tags: null, fade: false, lyrics };
}

export function newSong(overrides = {}) {
  const now = Date.now();
  return {
    v: SCHEMA_VERSION,
    id: uid('song'),
    title: '',
    key: '',
    mode: '',
    bpm: null,
    timeSig: '4/4',
    release: { type: 'none', name: '' },
    sections: [newSection('Verse')],
    notes: { meaning: '', performance: '' },
    suno: { style: '', exclude: '', weirdness: null, styleInfluence: null, audioInfluence: null, audioUploaded: false },
    created: now,
    updated: now,
    deleted: false,
    ...overrides,
  };
}

// Fill in missing fields so older/partial data (and future imports) never crash the UI.
export function normalizeSong(raw) {
  const base = newSong();
  const s = { ...base, ...(raw || {}) };
  s.id = String(s.id || base.id);
  s.title = String(s.title ?? '');
  s.key = KEYS.includes(s.key) ? s.key : '';
  s.mode = MODES.includes(s.mode) ? s.mode : '';
  const bpm = Number(s.bpm);
  s.bpm = Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm * 100) / 100 : null;
  s.timeSig = String(s.timeSig || '4/4');
  s.release = {
    type: RELEASE_TYPES.includes(s.release?.type) ? s.release.type : 'none',
    name: String(s.release?.name ?? ''),
  };
  s.sections = Array.isArray(s.sections) ? s.sections.map(normalizeSection) : [];
  if (!s.sections.length) s.sections = [newSection('Verse')];
  s.notes = {
    meaning: String(s.notes?.meaning ?? ''),
    performance: String(s.notes?.performance ?? ''),
  };
  const su = s.suno || {};
  s.suno = {
    style: String(su.style ?? ''),
    exclude: String(su.exclude ?? ''),
    weirdness: pct(su.weirdness),
    styleInfluence: pct(su.styleInfluence),
    audioInfluence: pct(su.audioInfluence),
    audioUploaded: !!su.audioUploaded,
  };
  s.created = Number(s.created) || base.created;
  s.updated = Number(s.updated) || s.created;
  s.deleted = !!s.deleted;
  s.v = SCHEMA_VERSION;
  return s;
}

const cleanTag = (t) => String(t ?? '').replace(/[\[\]\n]/g, '').trim();
const HEADER_WORDS = /^(intro|verse|pre-chorus|chorus|post-chorus|bridge|hook|refrain|interlude|instrumental|outro|final chorus)\b/i;

// 0-100 whole number, or null when the slider is unset.
function pct(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}

function normalizeSection(raw) {
  const r = raw || {};
  let tags = Array.isArray(r.tags) ? r.tags.map(cleanTag).filter(Boolean) : null;
  // v0.1 stored one free-text "sunoTag"; fold its bracketed tags into the new list (headers dropped).
  if (tags === null && typeof r.sunoTag === 'string' && r.sunoTag.trim()) {
    const found = [...r.sunoTag.matchAll(/\[([^\]]+)\]/g)].map((x) => cleanTag(x[1])).filter((t) => t && !HEADER_WORDS.test(t));
    if (found.length) tags = found;
  }
  return {
    id: String(r.id || uid('sec')),
    type: SECTION_TYPES.includes(r.type) ? r.type : 'Other',
    label: String(r.label ?? ''),
    tags,
    fade: !!r.fade,
    lyrics: String(r.lyrics ?? ''),
  };
}

// Auto labels: "Verse 1", "Verse 2" when a type repeats, plain "Bridge" when it appears once.
export function autoLabels(song) {
  const totals = {};
  for (const sec of song.sections) totals[sec.type] = (totals[sec.type] || 0) + 1;
  const seen = {};
  const out = {};
  for (const sec of song.sections) {
    seen[sec.type] = (seen[sec.type] || 0) + 1;
    out[sec.id] = totals[sec.type] > 1 ? `${sec.type} ${seen[sec.type]}` : sec.type;
  }
  return out;
}

export function sectionTitle(song, sec, labels = autoLabels(song)) {
  return sec.label.trim() || labels[sec.id];
}

export function songTitle(song) {
  return song.title.trim() || 'Untitled song';
}

export function keyLine(song) {
  const k = song.key ? `${song.key}${song.mode ? ' ' + song.mode : ''}` : '';
  return [k, song.bpm ? `${song.bpm} BPM` : ''].filter(Boolean).join(' · ');
}

export function searchText(song) {
  return [
    song.title, song.release.name, song.key, song.mode,
    song.notes.meaning, song.notes.performance,
    ...song.sections.map((s) => s.label + ' ' + s.lyrics),
  ].join('\n').toLowerCase();
}

// Key used to group songs in the library.
export function groupKey(song) {
  const { type, name } = song.release;
  if (type === 'album') return { order: 0, label: name.trim() ? `Album: ${name.trim()}` : 'Album (no name)', sort: name.trim().toLowerCase() };
  if (type === 'pool') return { order: 1, label: name.trim() ? `Pool: ${name.trim()}` : 'Pool (no name)', sort: name.trim().toLowerCase() };
  if (type === 'single') return { order: 2, label: 'Singles', sort: '' };
  return { order: 3, label: 'Unassigned', sort: '' };
}
