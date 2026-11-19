// Suno helpers: tag parsing and warnings, clean/tagged lyric builders, style-line key/BPM sync, voices list.
import { isChord } from './chords.js';

export const LIMITS = { style: 1000, lyrics: 5000 };
export const FADE_TAG = 'diminuendo';

const VOICES_KEY = 'lyricwriter.voices';
export const DEFAULT_VOICES = ['Andromeda Dunn', 'May 12'];

export function cleanTag(t) {
  return String(t ?? '').replace(/[\[\]\n]/g, '').trim();
}

// "[mp][driving]" or "mp, driving" or "mp" -> ['mp','driving']
export function parseTagInput(raw) {
  const s = String(raw ?? '');
  const bracketed = [...s.matchAll(/\[([^\[\]]+)\]/g)].map((m) => cleanTag(m[1]));
  const parts = bracketed.length ? bracketed : s.split(/[,\n]+/).map(cleanTag);
  const seen = new Set();
  return parts.filter((t) => { const k = t.toLowerCase(); if (!t || seen.has(k)) return false; seen.add(k); return true; });
}

// Tags used across songs, most used first (for suggestions).
export function usedTags(songs) {
  const counts = new Map();
  for (const song of songs) {
    for (const sec of song.sections) {
      for (const t of sec.tags || []) {
        const key = t.toLowerCase();
        const cur = counts.get(key) || { tag: t, n: 0 };
        cur.n++;
        counts.set(key, cur);
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)).map((x) => x.tag);
}

// Suno tends to play an instrument named in a tag instead of changing the dynamics.
const INSTRUMENT_RE = /\b(pianos?|keys|keyboards?|guitars?|bass|drums?|strings?|violins?|cellos?|violas?|synth(?:esizer)?s?|organs?|brass|horns?|trumpets?|trombones?|sax(?:ophones?)?|flutes?|clarinets?|ukuleles?|banjos?|mandolins?|harps?|harmonica|accordion|orchestra|percussion)\b/i;
export const isInstrumentTag = (tag) => INSTRUMENT_RE.test(String(tag));
export const instrumentWarning = (tag) =>
  `[${tag}] is an instrument name. Suno may play the instrument instead of changing the dynamics. For quiet, try [mp] or [soft].`;
export const instrumentTagsIn = (song) => [...new Set(song.sections.flatMap((s) => (s.tags || []).filter(isInstrumentTag)))];

export function loadVoices() {
  try {
    const raw = JSON.parse(localStorage.getItem(VOICES_KEY) || 'null');
    if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
  } catch { /* defaults */ }
  return [...DEFAULT_VOICES];
}
export function saveVoices(list) {
  try { localStorage.setItem(VOICES_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

// Remove chord brackets, keep other bracketed words. Lines that were only chords disappear.
export function stripChords(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const stripped = line.replace(/\[([^\[\]\n]*)\]/g, (m, x) => (isChord(x) ? '' : m));
    if (stripped.trim() === '' && line.trim() !== '') continue;
    out.push(stripped.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+/, '').replace(/[ \t]+$/, ''));
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  while (out.length && out[0] === '') out.shift();
  return out.join('\n');
}

// Verses are numbered, everything else is not (matches [Verse 1] [Pre-Chorus] [Chorus] [Bridge]).
export function sunoHeader(sec, verseNo) {
  if (sec.label.trim()) return sec.label.trim();
  return sec.type === 'Verse' ? `Verse ${verseNo}` : sec.type;
}

export function cleanLyrics(song) {
  return song.sections.map((s) => stripChords(s.lyrics)).filter(Boolean).join('\n\n');
}

export function taggedLyrics(song) {
  const blocks = [];
  let verse = 0;
  for (const sec of song.sections) {
    if (sec.type === 'Verse') verse++;
    const body = stripChords(sec.lyrics);
    if (!body) continue;
    const lines = [`[${sunoHeader(sec, verse)}]`];
    const tags = sec.tags || [];
    if (tags.length) lines.push(tags.map((t) => `[${t}]`).join(''));
    const bodyLines = body.split('\n');
    if (sec.fade) {
      let last = bodyLines.length - 1;
      while (last > 0 && !bodyLines[last].trim()) last--;
      bodyLines.splice(last, 0, `[${FADE_TAG}]`);
    }
    blocks.push(lines.concat(bodyLines).join('\n'));
  }
  return blocks.join('\n\n');
}

export const oneLine = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();
export const fmtCount = (n) => n.toLocaleString('en-US');

const KEY_TOKEN = /^([A-G][#b]?)\s+(major|minor|dorian|phrygian|lydian|mixolydian|locrian)$/i;
const BPM_TOKEN = /^\d+(\.\d+)?\s*BPM$/i;

// Keeps "Bb major, 68 BPM" in the style line in step with the song's key and BPM.
// insert=false only rewrites tokens that already exist; insert=true adds missing ones after the first two items.
export function syncStyle(style, song, { insert = false } = {}) {
  const tokens = String(style ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const keyIdx = tokens.findIndex((t) => KEY_TOKEN.test(t));
  const bpmIdx = tokens.findIndex((t) => BPM_TOKEN.test(t));
  const existingMode = keyIdx >= 0 ? KEY_TOKEN.exec(tokens[keyIdx])[2] : '';
  const mode = song.mode || existingMode;
  const keyToken = song.key ? song.key + (mode ? ' ' + mode : '') : null;
  const bpmToken = song.bpm ? `${song.bpm} BPM` : null;

  if (keyToken && keyIdx >= 0) tokens[keyIdx] = keyToken;
  if (bpmToken && bpmIdx >= 0) tokens[bpmIdx] = bpmToken;
  if (insert) {
    if (keyToken && keyIdx < 0) {
      const at = bpmIdx >= 0 ? bpmIdx : Math.min(2, tokens.length);
      tokens.splice(at, 0, keyToken);
    }
    if (bpmToken && bpmIdx < 0) {
      const ki = tokens.findIndex((t) => KEY_TOKEN.test(t));
      tokens.splice(ki >= 0 ? ki + 1 : Math.min(2, tokens.length), 0, bpmToken);
    }
  }
  return tokens.join(', ');
}
