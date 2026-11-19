// Rhymes side panel + shared dictionary loader + cursor-word helpers.
import { h, $ } from './dom.js';
import { loadDictionary, rhymesFor, syllablesOf, decode, TIER_LIMITS, tokensOf } from './rhyme.js';
import { stripChords } from './suno.js';

const OPTS_KEY = 'lyricwriter.rhymeOpts';
const SHOW_FIRST = 60;

let dictPromise = null;
let dictRef = null;
export function getDict() {
  if (!dictPromise) {
    dictPromise = loadDictionary().then((d) => { dictRef = d; return d; }).catch((e) => { dictPromise = null; throw e; });
  }
  return dictPromise;
}
export const dictIfLoaded = () => dictRef;

/* ───── cursor helpers (words from the lyrics textarea the user was last in) ───── */

let lastTA = null;
export function trackTextarea(ta) {
  const remember = () => { lastTA = ta; };
  ta.addEventListener('focus', remember);
  ta.addEventListener('keyup', remember);
  ta.addEventListener('click', remember);
  ta.addEventListener('select', remember);
}

const mask = (t) => t.replace(/\[[^\]\n]*\]/g, (m) => ' '.repeat(m.length));
const lastToken = (s) => { const t = tokensOf(s); return t.length ? t[t.length - 1] : ''; };

export function cursorWords() {
  const ta = lastTA && lastTA.isConnected ? lastTA : null;
  if (!ta) return null;
  const text = mask(ta.value);
  const a = ta.selectionStart ?? 0, b = ta.selectionEnd ?? a;
  let at = '';
  if (b > a) at = lastToken(text.slice(a, b));
  else {
    const re = /[A-Za-z0-9'’\-]+/g;
    let m;
    while ((m = re.exec(text))) { if (m.index <= a && a <= m.index + m[0].length) { at = m[0]; break; } }
  }
  const lineStart = text.lastIndexOf('\n', a - 1) + 1;
  let lineEndIdx = text.indexOf('\n', a); if (lineEndIdx < 0) lineEndIdx = text.length;
  const thisLine = lastToken(text.slice(lineStart, lineEndIdx));
  let above = '';
  const lines = text.slice(0, Math.max(0, lineStart - 1)).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) { const t = lastToken(lines[i]); if (t) { above = t; break; } }
  return { at, thisLine, above };
}

/* ───── panel ───── */

function loadOpts() {
  try { const o = JSON.parse(localStorage.getItem(OPTS_KEY) || 'null'); if (o) return { syl: +o.syl || 0, range: TIER_LIMITS[o.range] ? o.range : 'common' }; } catch { /* default */ }
  return { syl: 0, range: 'common' };
}

export function initRhymePanel({ getSongs, onClose }) {
  const root = $('#rhymes');
  const opts = loadOpts();
  let word = '';

  const input = h('input', { placeholder: 'Rhyme with…', 'aria-label': 'Word to rhyme with', autocomplete: 'off', spellcheck: false });
  const results = h('div', { class: 'rh-results' });
  const info = h('div', { class: 'rh-info muted small', 'aria-live': 'polite' });
  const sylSel = h('select', { 'aria-label': 'Syllables', onchange: () => { opts.syl = +sylSel.value; save(); search(); } },
    [['0', 'Any syllables'], ['1', '1 syllable'], ['2', '2 syllables'], ['3', '3 syllables'], ['4', '4+ syllables']].map(([v, l]) => h('option', { value: v, selected: +v === opts.syl }, l)));
  const rangeSel = h('select', { 'aria-label': 'Word range', onchange: () => { opts.range = rangeSel.value; save(); search(); } },
    [['common', 'Common words'], ['wide', 'Wider range'], ['all', 'Everything (names, rare)']].map(([v, l]) => h('option', { value: v, selected: v === opts.range }, l)));
  const save = () => { try { localStorage.setItem(OPTS_KEY, JSON.stringify(opts)); } catch { /* ignore */ } };

  const from = (key, label) => h('button', {
    class: 'btn small', title: label,
    onclick: () => { const w = cursorWords()?.[key]; if (!w) { info.textContent = 'Click into your lyrics first, then try again.'; return; } setWord(w); },
  }, label);

  root.replaceChildren(
    h('div', { class: 'rh-head' }, h('strong', {}, 'Rhymes'), h('button', { class: 'btn small ghost', 'aria-label': 'Close rhymes', onclick: onClose }, '✕')),
    h('div', { class: 'rh-search' }, input, h('button', { class: 'btn small primary', onclick: () => setWord(input.value) }, 'Find')),
    h('div', { class: 'rh-from' }, from('at', 'Word at cursor'), from('thisLine', 'End of this line'), from('above', 'Line above')),
    h('div', { class: 'rh-opts' }, sylSel, rangeSel),
    info, results,
    h('div', { class: 'rh-foot muted small' }, 'Offline dictionary: CMUdict + SCOWL. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); document.dispatchEvent(new CustomEvent('lw-about')); } }, 'Licenses')));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setWord(input.value); } });

  function yoursSet() {
    const s = new Set();
    for (const song of getSongs()) {
      if (song.deleted) continue;
      for (const sec of song.sections) for (const t of tokensOf(stripChords(sec.lyrics))) s.add(t.toLowerCase().replace(/^'+|'+$/g, ''));
    }
    return s;
  }

  async function search() {
    if (!word) { results.replaceChildren(); info.textContent = 'Type a word, or use the buttons to pull one from your lyrics.'; return; }
    results.replaceChildren(h('div', { class: 'muted' }, 'Loading dictionary…'));
    let d;
    try { d = await getDict(); } catch (e) {
      results.replaceChildren(h('div', { class: 'tag-warn' }, 'Could not load the dictionary. ' + e.message), h('button', { class: 'btn small', onclick: search }, 'Try again'));
      return;
    }
    const r = rhymesFor(d, word, { maxTier: TIER_LIMITS[opts.range], syl: opts.syl, yours: yoursSet() });
    const s = syllablesOf(d, word);
    info.textContent = r.info.found
      ? `${r.info.word} · ${r.info.pron.length ? r.info.pron.join(' / ') : 'guessed from spelling'} · ${s.min === s.max ? s.min : s.min + '–' + s.max} syllable${s.max === 1 ? '' : 's'}${r.info.guessed ? ' (not in dictionary, sound guessed)' : ''}`
      : `Couldn’t work out how “${word}” sounds.`;
    results.replaceChildren(
      group('Perfect', 'Same ending sound', r.perfect),
      group('Near', 'Close ending, e.g. light / like', r.near),
      group('Slant', 'Similar vowel, same ending', r.slant));
    if (r.perfect.length + r.near.length + r.slant.length === 0 && r.info.found) {
      results.append(h('div', { class: 'muted' }, 'Nothing found with these filters. Try “Any syllables” or a wider range.'));
    }
  }

  function group(title, hint, list) {
    const box = h('section', { class: 'rh-group' }, h('h4', {}, title, h('span', { class: 'muted small' }, ` ${list.length} · ${hint}`)));
    if (!list.length) return box;
    const chips = h('div', { class: 'chips' });
    const draw = (all) => {
      chips.replaceChildren(...(all ? list : list.slice(0, SHOW_FIRST)).map((x) => h('button', {
        class: 'chip rh-word', title: `${x.syl} syllable${x.syl === 1 ? '' : 's'}${x.yours ? ' · used in your songs' : ''}`,
        onclick: () => setWord(x.w),
      }, x.w + (x.yours ? ' ★' : ''))));
      if (!all && list.length > SHOW_FIRST) chips.append(h('button', { class: 'btn small', onclick: () => draw(true) }, `Show all ${list.length}`));
    };
    draw(false);
    box.append(chips);
    return box;
  }

  function setWord(w) {
    word = String(w || '').trim();
    input.value = word;
    search();
  }

  return {
    open(w) { root.hidden = false; document.body.classList.add('rhymes-open'); if (w) setWord(w); else if (!word) { const c = cursorWords(); if (c?.above || c?.at) setWord(c.at || c.above); else search(); } input.focus(); },
    close() { root.hidden = true; document.body.classList.remove('rhymes-open'); },
    isOpen: () => !root.hidden,
  };
}
