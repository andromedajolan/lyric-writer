// Offline pronunciation dictionary: syllable counts, rhymes (perfect / near / slant) and rhyme schemes.
// Data: CMUdict (Carnegie Mellon University, BSD-style license) with SCOWL commonness tiers. See licenses/.
// Pure functions; the only browser bit is loadDictionary() (fetch + gunzip).

const VOWELS = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'];
const CONS = ['B', 'CH', 'D', 'DH', 'F', 'G', 'HH', 'JH', 'K', 'L', 'M', 'N', 'NG', 'P', 'R', 'S', 'SH', 'T', 'TH', 'V', 'W', 'Y', 'Z', 'ZH'];
// Consonant classes used for near rhymes: stop, fricative, nasal, liquid/glide, affricate.
const CLASS_OF = {};
for (const c of ['B', 'D', 'G', 'K', 'P', 'T']) CLASS_OF[c] = 's';
for (const c of ['DH', 'F', 'HH', 'S', 'SH', 'TH', 'V', 'Z', 'ZH']) CLASS_OF[c] = 'f';
for (const c of ['M', 'N', 'NG']) CLASS_OF[c] = 'n';
for (const c of ['L', 'R', 'W', 'Y']) CLASS_OF[c] = 'l';
for (const c of ['CH', 'JH']) CLASS_OF[c] = 'a';
const CONS_CLASS = CONS.map((c) => CLASS_OF[c]);

// Vowel pairs that sound close enough for a slant rhyme (same ending consonants).
const NEIGHBOR_PAIRS = [['IY', 'IH'], ['IH', 'EH'], ['EH', 'AE'], ['EY', 'EH'], ['AA', 'AO'], ['AO', 'OW'], ['UW', 'UH'], ['AH', 'UH'], ['AA', 'AH'], ['OW', 'UH'], ['AY', 'AA']];
const NEIGHBORS = {};
for (const [a, b] of NEIGHBOR_PAIRS) {
  (NEIGHBORS[VOWELS.indexOf(a)] ||= []).push(VOWELS.indexOf(b));
  (NEIGHBORS[VOWELS.indexOf(b)] ||= []).push(VOWELS.indexOf(a));
}

export const TIER_LIMITS = { common: 3, wide: 7, all: 9 };

const isV = (ch) => ch >= 65;
const vChar = (idx) => String.fromCharCode(65 + idx * 3);
const vIdx = (ch) => ((ch - 65) / 3) | 0;
const stressOf = (ch) => (ch - 65) % 3;

export function vowelCount(code) {
  let n = 0;
  for (let i = 0; i < code.length; i++) if (isV(code.charCodeAt(i))) n++;
  return n;
}

// "L AY1 T" style text, for showing the pronunciation.
export function decode(code) {
  const out = [];
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    out.push(isV(c) ? VOWELS[vIdx(c)] + stressOf(c) : CONS[c - 33]);
  }
  return out.join(' ');
}

// Rhyme analysis of one pronunciation: exact tail from the last stressed vowel, a looser "near" key, and the sound before it.
export function analyze(code) {
  let p = -1;
  for (let i = code.length - 1; i >= 0; i--) { const c = code.charCodeAt(i); if (isV(c) && stressOf(c) > 0) { p = i; break; } }
  if (p < 0) for (let i = code.length - 1; i >= 0; i--) if (isV(code.charCodeAt(i))) { p = i; break; }
  if (p < 0) return null;
  let tail = '';
  for (let i = p; i < code.length; i++) { const c = code.charCodeAt(i); tail += isV(c) ? vChar(vIdx(c)) : code[i]; }
  return { tail, near: nearOf(tail), pre: p > 0 ? code[p - 1] : '', syl: vowelCount(code) };
}

function nearOf(tail) {
  let k = tail[0];
  for (let i = 1; i < tail.length; i++) { const c = tail.charCodeAt(i); k += isV(c) ? 'v' : CONS_CLASS[c - 33]; }
  return k;
}

/* ───────────── dictionary ───────────── */

export function parseDict(text) {
  const words = [], tiers = [], variants = [], map = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    map.set(f[0], words.length);
    words.push(f[0]); tiers.push(+f[1]); variants.push(f.slice(2));
  }
  return { words, tiers, variants, map, index: null, guessCache: new Map() };
}

export async function loadDictionary(url = 'data/cmudict.txt.gz') {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Dictionary not found (' + res.status + ')');
  const buf = new Uint8Array(await res.arrayBuffer());
  let text;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder().decode(buf); // host already decompressed it
  }
  return parseDict(text);
}

function ensureIndex(d) {
  if (d.index) return d.index;
  const exact = new Map(), near = new Map();
  const push = (m, k, v) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  for (let wi = 0; wi < d.words.length; wi++) {
    const vs = d.variants[wi];
    for (let vi = 0; vi < vs.length; vi++) {
      const a = analyze(vs[vi]);
      if (!a) continue;
      push(exact, a.tail, wi * 4 + vi);
      push(near, a.near, wi * 4 + vi);
    }
  }
  d.index = { exact, near };
  return d.index;
}

/* ───────────── tokens, lookup, syllables ───────────── */

const TOKEN_RE = /[A-Za-z0-9'’\-]+/g;

export function tokensOf(line) {
  const clean = String(line).replace(/\[[^\]]*\]/g, ' ').replace(/’/g, "'");
  return (clean.match(TOKEN_RE) || []).filter((t) => /[A-Za-z0-9]/.test(t));
}

export function normalizeToken(tok) {
  return String(tok).toLowerCase().replace(/’/g, "'").replace(/^[-]+|[-]+$/g, '');
}

function guessSyllables(w) {
  const s = w.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return 1;
  if (s.length <= 3) return 1;
  const t = s.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = t.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

// Find dictionary variants for a token, trying a few spellings (runnin' -> running, 'cause, possessives).
function lookup(d, tok) {
  const w = normalizeToken(tok);
  const tries = [w];
  if (w.startsWith("'")) tries.push(w.replace(/^'+/, ''));
  if (w.endsWith("in'")) tries.push(w.slice(0, -1) + 'g');
  if (w.endsWith("'")) tries.push(w.replace(/'+$/, ''));
  for (const t of tries) { const wi = d.map.get(t); if (wi !== undefined) return { wi, word: t, extra: 0 }; }
  const poss = /^(.+)'s$/.exec(w);
  if (poss) { const wi = d.map.get(poss[1]); if (wi !== undefined) return { wi, word: poss[1], extra: /(?:s|x|z|sh|ch)$/.test(poss[1]) ? 1 : 0 }; }
  return null;
}

// Syllable range for one token. min/max differ when pronunciations differ (fire = 1-2 syllables).
export function syllablesOf(d, tok) {
  const w = normalizeToken(tok);
  if (!w) return { min: 0, max: 0, approx: false };
  const hit = lookup(d, w);
  if (hit) {
    const counts = d.variants[hit.wi].map(vowelCount);
    return { min: Math.min(...counts) + hit.extra, max: Math.max(...counts) + hit.extra, approx: false };
  }
  if (w.includes('-')) {
    const parts = w.split('-').filter(Boolean).map((p) => syllablesOf(d, p));
    return { min: parts.reduce((s, p) => s + p.min, 0), max: parts.reduce((s, p) => s + p.max, 0), approx: parts.some((p) => p.approx) };
  }
  if (/^\d+$/.test(w)) return { min: 1, max: 1, approx: true };
  const g = guessSyllables(w);
  return { min: g, max: g, approx: true };
}

// Syllables for a whole line (chords and [tags] ignored).
export function countLine(d, line) {
  const words = tokensOf(line).map((raw) => ({ raw, ...syllablesOf(d, raw) }));
  return {
    min: words.reduce((s, x) => s + x.min, 0),
    max: words.reduce((s, x) => s + x.max, 0),
    approx: words.some((x) => x.approx),
    words,
    last: words.length ? words[words.length - 1].raw : '',
  };
}

export const fmtRange = (c) => (c.min === c.max ? String(c.min) : `${c.min}–${c.max}`) ;

/* ───────────── pronunciation analyses for a query word ───────────── */

// Rhyme analyses (one per pronunciation). Unknown words are guessed from words with the same spelling ending.
function analysesFor(d, tok) {
  const w = normalizeToken(tok);
  const hit = lookup(d, w);
  if (hit) {
    const codes = d.variants[hit.wi];
    return { word: hit.word, wi: hit.wi, codes, list: codes.map(analyze).filter(Boolean), guessed: false };
  }
  const last = w.includes('-') ? w.split('-').filter(Boolean).pop() : w;
  const lh = last && last !== w ? lookup(d, last) : null;
  if (lh) { const codes = d.variants[lh.wi]; return { word: w, wi: -1, codes, list: codes.map(analyze).filter(Boolean), guessed: false }; }
  const cached = d.guessCache.get(last);
  if (cached) return cached;
  let result = { word: w, wi: -1, codes: [], list: [], guessed: true };
  for (const k of [4, 3, 2]) {
    if (!last || last.length <= k) continue;
    const suf = last.slice(-k);
    const tails = new Map();
    for (let wi = 0; wi < d.words.length; wi++) {
      if (d.tiers[wi] > 5 || !d.words[wi].endsWith(suf)) continue;
      const a = analyze(d.variants[wi][0]);
      if (a) tails.set(a.tail, (tails.get(a.tail) || 0) + 1);
    }
    if (tails.size) {
      const [tail] = [...tails.entries()].sort((x, y) => y[1] - x[1])[0];
      result = { word: w, wi: -1, codes: [], list: [{ tail, near: nearOf(tail), pre: null, syl: 0 }], guessed: true };
      break;
    }
  }
  d.guessCache.set(last, result);
  return result;
}

/* ───────────── rhymes ───────────── */

// opts: { maxTier: 3 (common) | 7 (wide) | 9 (all), syl: 0 any | 1 | 2 | 3 | 4 (4 or more), yours: Set<string> }
export function rhymesFor(d, tok, opts = {}) {
  const { maxTier = 3, syl = 0, yours = new Set() } = opts;
  const q = analysesFor(d, tok);
  const out = { perfect: [], near: [], slant: [], info: { word: q.word, guessed: q.guessed, pron: q.codes.map(decode), found: q.list.length > 0 } };
  if (!q.list.length) return out;
  const { exact, near } = ensureIndex(d);
  const seen = new Set();
  if (q.wi >= 0) seen.add(q.wi);
  const qword = q.word;

  const ok = (wi, vi) => {
    if (seen.has(wi)) return false;
    const w = d.words[wi];
    if (d.tiers[wi] > maxTier || w.includes('-')) return false;
    if (q.guessed && (w.endsWith(qword) || qword.endsWith(w))) return false;
    if (syl) { const n = vowelCount(d.variants[wi][vi]); if (syl >= 4 ? n < 4 : n !== syl) return false; }
    return true;
  };
  const add = (list, id) => {
    const wi = id >> 2;
    list.push({ w: d.words[wi], tier: d.tiers[wi], syl: vowelCount(d.variants[wi][id & 3]), yours: yours.has(d.words[wi]) });
    seen.add(wi);
  };

  for (const a of q.list) {
    for (const id of exact.get(a.tail) || []) {
      const wi = id >> 2, vi = id & 3;
      if (!ok(wi, vi)) continue;
      const b = analyze(d.variants[wi][vi]);
      if (a.pre !== null && b.pre === a.pre) continue; // same onset sound: not a rhyme (alight / light)
      add(out.perfect, id);
    }
  }
  for (const a of q.list) {
    for (const id of near.get(a.near) || []) {
      const wi = id >> 2, vi = id & 3;
      if (!ok(wi, vi)) continue;
      if (analyze(d.variants[wi][vi]).tail === a.tail) continue; // identical ending, handled above
      add(out.near, id);
    }
  }
  for (const a of q.list) {
    const v0 = a.tail.charCodeAt(0);
    for (const nv of NEIGHBORS[vIdx(v0)] || []) {
      for (const id of exact.get(vChar(nv) + a.tail.slice(1)) || []) {
        if (ok(id >> 2, id & 3)) add(out.slant, id);
      }
    }
  }
  const cmp = (x, y) => (y.yours - x.yours) || (x.tier - y.tier) || (x.syl - y.syl) || x.w.localeCompare(y.w);
  out.perfect.sort(cmp); out.near.sort(cmp); out.slant.sort(cmp);
  return out;
}

/* ───────────── rhyme scheme ───────────── */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// lines: array of lyric lines (non-empty). Returns [{ letter, slant }] per line; letter null = no rhyme found.
export function schemeFor(d, lines) {
  const info = lines.map((line) => {
    const last = tokensOf(line).pop();
    if (!last) return null;
    const q = analysesFor(d, last);
    return { word: normalizeToken(last), tails: new Set(q.list.map((a) => a.tail)), nears: new Set(q.list.map((a) => a.near)) };
  });
  const n = lines.length;
  const parent = lines.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const share = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (!info[i] || !info[j]) continue;
    if (info[i].word === info[j].word || share(info[i].tails, info[j].tails)) parent[find(j)] = find(i);
  }
  const size = new Map();
  for (let i = 0; i < n; i++) if (info[i]) size.set(find(i), (size.get(find(i)) || 0) + 1);
  const group = lines.map((_, i) => (info[i] && size.get(find(i)) > 1 ? find(i) : null));
  const slant = lines.map(() => false);
  for (let i = 0; i < n; i++) {
    if (!info[i] || group[i] !== null) continue;
    for (let j = 0; j < n; j++) {
      if (i === j || !info[j] || !share(info[i].nears, info[j].nears)) continue;
      group[i] = group[j] !== null ? group[j] : find(j);
      slant[i] = true;
      if (group[j] === null) { group[j] = group[i]; slant[j] = true; }
      break;
    }
  }
  const letterOf = new Map();
  return lines.map((_, i) => {
    if (group[i] === null) return { letter: null, slant: false };
    if (!letterOf.has(group[i])) letterOf.set(group[i], LETTERS[letterOf.size % LETTERS.length]);
    return { letter: letterOf.get(group[i]), slant: slant[i] };
  });
}
