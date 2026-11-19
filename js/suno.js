// Suno helpers: tag settings, clean/tagged lyric builders, style-line key/BPM sync. Pure except settings storage.
import { isChord } from './chords.js';

const SETTINGS_KEY = 'lyricwriter.suno';

export const DEFAULT_SETTINGS = {
  glossary: ['piano', 'pianissimo', 'forte', 'legato', 'crescendo', 'diminuendo', 'sparse'],
  defaults: {
    Verse: ['piano', 'legato', 'sparse'],
    'Pre-Chorus': ['crescendo', 'legato'],
    Chorus: ['forte', 'legato'],
    Bridge: ['pianissimo', 'sparse'],
  },
};

export const FADE_TAG = 'diminuendo';

export function cleanTag(t) {
  return String(t ?? '').replace(/[\[\]\n]/g, '').trim();
}

export function loadSettings() {
  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (raw && Array.isArray(raw.glossary)) base.glossary = raw.glossary.map(cleanTag).filter(Boolean);
    if (raw && raw.defaults && typeof raw.defaults === 'object') {
      base.defaults = {};
      for (const [k, v] of Object.entries(raw.defaults)) if (Array.isArray(v)) base.defaults[k] = v.map(cleanTag).filter(Boolean);
    }
  } catch { /* use defaults */ }
  return base;
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

// null tags = use the default for the section type; an array (even empty) = this section's own tags.
export function effectiveTags(sec, settings) {
  return sec.tags ?? settings.defaults[sec.type] ?? [];
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

export function taggedLyrics(song, settings) {
  const blocks = [];
  let verse = 0;
  for (const sec of song.sections) {
    if (sec.type === 'Verse') verse++;
    const body = stripChords(sec.lyrics);
    if (!body) continue;
    const lines = [`[${sunoHeader(sec, verse)}]`];
    const tags = effectiveTags(sec, settings);
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
