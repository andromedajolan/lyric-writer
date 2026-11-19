// Import (plain text) and export (clean lyrics, JSON backup). Pure functions, no DOM.
import { KEYS, MODES, SECTION_TYPES, TIME_SIGS, newSong, newSection, normalizeSong } from './model.js';
import { isChord } from './chords.js';
import { stripChords, sunoHeader, cleanLyrics } from './suno.js';

export const BACKUP_FORMAT = 'lyricwriter-backup';
export const BACKUP_VERSION = 1;

/* ───────────── text import ───────────── */

const ENHARMONIC = { Cb: 'B', Fb: 'E', 'E#': 'F', 'B#': 'C' };

// "C Minor", "Cm", "F# major", "B♭", "Eb min" -> { key, mode } (either may be '').
export function parseKey(raw) {
  const s = String(raw || '').replace(/♯/g, '#').replace(/♭/g, 'b').trim();
  const m = /^([A-Ga-g])\s*([#b]?)\s*(.*)$/.exec(s);
  if (!m) return { key: '', mode: '' };
  let key = m[1].toUpperCase() + m[2];
  key = ENHARMONIC[key] || key;
  if (!KEYS.includes(key)) return { key: '', mode: '' };
  const rest = (m[3].trim() === 'M' ? 'major' : m[3].trim().toLowerCase()).replace(/[().,]/g, '');
  let mode = '';
  if (/^(m|min|minor|aeolian)$/.test(rest)) mode = 'minor';
  else if (/^(maj|major|ionian)?$/.test(rest)) mode = 'major';
  else mode = MODES.find((x) => x === rest || x.startsWith(rest)) || '';
  if (m[3].trim() === 'M') mode = 'major'; // capital M = major
  return { key, mode };
}

const HEADER_FIELD = /^\s*(title|song|key|bpm|tempo|time(?:\s*sig(?:nature)?)?|meter|album|single|release)\s*[:=]\s*(.*?)\s*$/i;
const TYPE_ALT = 'intro|verse|pre[\\s-]?chorus|chorus|post[\\s-]?chorus|bridge|hook|refrain|interlude|instrumental|outro|final chorus|breakdown|solo|drop';
const HEAD_RE = new RegExp(`^(${TYPE_ALT})\\b\\s*(.*)$`, 'i');

function typeFromWord(word) {
  const w = word.toLowerCase().replace(/[\s-]+/g, '');
  if (w === 'prechorus') return 'Pre-Chorus';
  if (w === 'postchorus') return 'Post-Chorus';
  if (w === 'finalchorus') return 'Chorus';
  if (['breakdown', 'solo', 'drop'].includes(w)) return 'Other';
  return SECTION_TYPES.find((t) => t.toLowerCase() === w) || 'Other';
}

// Is this line a section header? Returns { type, label } or null.
// Accepts [Verse 1]  (Chorus)  Verse 1:  and a bare "Chorus" line. Numbers are dropped (the app numbers verses itself).
export function parseHeaderLine(line) {
  const t = line.trim();
  if (!t) return null;
  let inner = null, bare = false;
  let m = /^\[([^\]]+)\]$/.exec(t) || /^\(([^)]+)\)$/.exec(t) || /^\{([^}]+)\}$/.exec(t);
  if (m) inner = m[1].trim();
  else if ((m = /^(.+?):$/.exec(t))) inner = m[1].trim();
  else if ((m = /^[-=*#\s]*(.+?)[-=*#\s]*$/.exec(t)) && /^(?:[-=*#]{2,}\s*)?[A-Za-z][A-Za-z\s-]*\d*$/.test(t) && HEAD_RE.test(t)) { inner = m[1].trim(); bare = true; }
  if (!inner) return null;
  const hm = HEAD_RE.exec(inner);
  if (!hm) return null;
  if (bare && hm[2].trim() && !/^\d+$/.test(hm[2].trim())) return null; // a lyric line that merely starts with "Chorus ..."
  const type = typeFromWord(hm[1]);
  const rest = hm[2].replace(/^[\s:–-]+/, '').trim();
  let label = '';
  if (/^final chorus$/i.test(hm[1].trim())) label = 'Final Chorus';
  else if (rest && !/^\d+$/.test(rest)) label = hm[1].replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase()) + ' ' + rest;
  if (label && /^(?:x\s*\d+|\d+\s*x)$/i.test(rest)) label = ''; // "Chorus x2" is a repeat note, not a name
  return { type, label };
}

const onlyBrackets = (line) => /^\s*(?:\[[^\]\n]+\]\s*)+$/.test(line);
const bracketsOf = (line) => [...line.matchAll(/\[([^\]\n]+)\]/g)].map((x) => x[1].trim());

// One song's worth of text -> song object. `warnings` lists anything worth telling her.
export function parseImport(text, { now = Date.now() } = {}) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/^﻿/, '').split('\n');
  const song = newSong({ created: now, updated: now });
  const warnings = [];
  let i = 0;
  // header block: known "Field: value" lines (and blanks / rules) before any lyrics
  for (; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.trim() || /^[-=_*]{3,}$/.test(ln.trim())) continue;
    const m = HEADER_FIELD.exec(ln);
    if (!m || parseHeaderLine(ln)) break;
    const f = m[1].toLowerCase(), v = m[2];
    if (f === 'title' || f === 'song') song.title = v;
    else if (f === 'key') {
      const k = parseKey(v);
      if (k.key) { song.key = k.key; song.mode = k.mode; } else warnings.push(`Couldn't read key "${v}"`);
    } else if (f === 'bpm' || f === 'tempo') {
      const n = parseFloat(v);
      if (n > 0) song.bpm = Math.round(n * 100) / 100; else warnings.push(`Couldn't read BPM "${v}"`);
    } else if (f.startsWith('time') || f === 'meter') {
      const ts = v.replace(/\s+/g, '');
      if (TIME_SIGS.includes(ts)) song.timeSig = ts; else warnings.push(`Time signature "${v}" isn't in the list`);
    } else if (f === 'album') { if (v) song.release = { type: 'album', name: v }; }
    else if (f === 'single') { song.release = { type: 'single', name: v }; }
    else if (f === 'release') { if (/^pool$/i.test(v)) song.release = { type: 'pool', name: '' }; else if (v) song.release = { type: 'single', name: v }; }
  }
  const body = lines.slice(i);
  // split into sections
  const sections = [];
  let cur = null;
  const start = (type, label) => { cur = { type, label, lines: [], tags: [] }; sections.push(cur); };
  let sawHeader = false;
  for (const ln of body) {
    const hd = parseHeaderLine(ln);
    if (hd && !isChord(ln.trim().replace(/^\[|\]$/g, ''))) { sawHeader = true; start(hd.type, hd.label); continue; }
    if (!sawHeader) {
      // no headers seen yet: blank-line separated blocks
      if (!ln.trim()) { if (cur && cur.lines.length) cur = null; continue; }
      if (!cur) start('Verse', '');
      cur.lines.push(ln);
      continue;
    }
    if (!cur) { if (!ln.trim()) continue; start('Verse', ''); }
    // tag line right after the header: [female vocals][soft] (not chords)
    if (!cur.lines.length && onlyBrackets(ln) && bracketsOf(ln).every((b) => !isChord(b))) { cur.tags.push(...bracketsOf(ln)); continue; }
    cur.lines.push(ln);
  }
  // when headers exist, text before the first header was collected into a Verse by the loop above; keep as is
  const out = sections.map((s) => {
    while (s.lines.length && !s.lines[0].trim()) s.lines.shift();
    while (s.lines.length && !s.lines[s.lines.length - 1].trim()) s.lines.pop();
    const sec = newSection(s.type, s.lines.join('\n'));
    sec.label = s.label;
    sec.tags = [...new Set(s.tags)];
    return sec;
  }).filter((s) => s.lyrics.trim() || s.label || s.tags.length);
  if (out.length) song.sections = out;
  if (!sawHeader && out.length > 1) warnings.push('No section names found, so each paragraph became a Verse. Change the types as needed.');
  return { song: normalizeSong(song), warnings };
}

// A file may hold several songs separated by a line of 3+ "=".
export function splitSongs(text) {
  const parts = String(text).replace(/\r\n?/g, '\n').split(/\n\s*={3,}\s*\n/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function describeImport(song) {
  const bits = [song.title || '(no title)'];
  if (song.key) bits.push(song.key + (song.mode ? ' ' + song.mode : ''));
  if (song.bpm) bits.push(song.bpm + ' BPM');
  bits.push(`${song.sections.length} section${song.sections.length === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

/* ───────────── clean lyrics export ───────────── */

// opts.headers: include section names ([Verse 1] style kept out; plain "Verse 1"). opts.title: put the title on top.
export function lyricsText(song, { headers = false, title = false } = {}) {
  let body;
  if (headers) {
    let verse = 0;
    body = song.sections.map((sec) => {
      if (sec.type === 'Verse') verse++;
      const text = stripChords(sec.lyrics);
      return text ? `${sunoHeader(sec, verse)}\n${text}` : '';
    }).filter(Boolean).join('\n\n');
  } else body = cleanLyrics(song);
  const head = title && song.title.trim() ? song.title.trim() + '\n\n' : '';
  return head + body + (body ? '\n' : '');
}

export function allLyricsText(songs, opts) {
  return songs.map((s) => lyricsText(s, { ...opts, title: true })).filter((t) => t.trim()).join('\n==========\n\n');
}

export function safeFileName(title, ext) {
  const base = String(title || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
  return `${base}.${ext}`;
}

/* ───────────── JSON backup / restore ───────────── */

export function buildBackup(songs, { voices = [], appVersion = '', now = new Date() } = {}) {
  return {
    format: BACKUP_FORMAT,
    v: BACKUP_VERSION,
    exported: now.toISOString(),
    app: 'lyricwriter ' + appVersion,
    voices: [...voices],
    songs: songs.map((s) => ({ ...s })),
  };
}

// Accepts a backup file, a bare array of songs, or a single song object. Throws a readable Error if it is none of these.
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  let songs, voices = [];
  if (Array.isArray(data)) songs = data;
  else if (data && data.format === BACKUP_FORMAT) {
    if (!(data.v >= 1) || data.v > BACKUP_VERSION) throw new Error(`This backup is version ${data.v}; this app understands version ${BACKUP_VERSION}. Update the app first.`);
    songs = data.songs;
    if (Array.isArray(data.voices)) voices = data.voices.map((x) => String(x).trim()).filter(Boolean);
  } else if (data && Array.isArray(data.sections)) songs = [data];
  else throw new Error('That file is not a Lyric Writer backup.');
  if (!Array.isArray(songs)) throw new Error('The backup has no songs list.');
  return { songs: songs.filter((s) => s && typeof s === 'object').map(normalizeSong), voices };
}

// Merge incoming songs into existing (Map id -> song). Same id: the newer `updated` wins. Never deletes anything.
export function planMerge(existing, incoming) {
  const add = [], replace = [], same = [];
  for (const s of incoming) {
    const cur = existing.get(s.id);
    if (!cur) add.push(s);
    else if (s.updated > cur.updated) replace.push(s);
    else same.push(s);
  }
  return { add, replace, same };
}
