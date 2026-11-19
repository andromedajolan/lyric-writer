// Chord chart view: chord chips over the words. Click a chip to edit it, click a word to add a chord there.
import { h } from './dom.js';
import { isChord, diatonicChords } from './chords.js';

const BRACKET = /\[([^\[\]\n]*)\]/g;

function segments(line) {
  const segs = [];
  let last = 0;
  line.replace(BRACKET, (m, x, idx) => {
    if (!isChord(x)) return m;
    if (idx > last) segs.push({ t: 'text', s: last, e: idx });
    segs.push({ t: 'chord', s: idx, e: idx + m.length, v: x.trim() });
    last = idx + m.length;
    return m;
  });
  if (last < line.length) segs.push({ t: 'text', s: last, e: line.length });
  return segs;
}

function unit({ chord, text, pos }) {
  const chip = chord
    ? h('span', { class: 'c', dataset: { s: chord.s, e: chord.e, v: chord.v }, title: 'Edit chord' }, chord.v)
    : h('span', { class: 'c ph' }, ' ');
  return h('span', { class: 'u', dataset: { pos } }, chip, h('span', { class: 'w' }, text || ' '));
}

function renderLine(line, base) {
  if (!line.trim()) return h('div', { class: 'cl blank' });
  const segs = segments(line);
  const row = h('div', { class: 'cl' + (segs.some((x) => x.t === 'chord') ? '' : ' nochip') });
  let pending = null;
  for (const seg of segs) {
    if (seg.t === 'chord') {
      if (pending) row.append(unit({ chord: pending, text: '', pos: base + pending.e }));
      pending = { s: base + seg.s, e: base + seg.e, v: seg.v };
    } else {
      const text = line.slice(seg.s, seg.e);
      let first = true;
      for (const m of text.matchAll(/\S+\s*|\s+/g)) {
        row.append(unit({ chord: first ? pending : null, text: m[0], pos: base + seg.s + m.index }));
        if (first) pending = null;
        first = false;
      }
    }
  }
  if (pending) row.append(unit({ chord: pending, text: '', pos: base + pending.e }));
  return row;
}

let closePop = null;

function openPop({ anchor, value, existing, key, mode, onApply, onRemove }) {
  closePop?.();
  const err = h('div', { class: 'pop-err', role: 'alert' });
  const input = h('input', { value: value || '', placeholder: 'Chord, e.g. Cm7', 'aria-label': 'Chord', autocomplete: 'off', spellcheck: false });
  const apply = (v) => {
    const val = String(v).trim();
    if (!isChord(val)) { err.textContent = 'That doesn’t look like a chord (try C, Am, F#m7, G/B).'; return; }
    close(); onApply(val);
  };
  const sugg = diatonicChords(key, mode);
  const pop = h('div', { class: 'chord-pop', role: 'dialog', 'aria-label': 'Chord' },
    input, err,
    sugg.length ? h('div', { class: 'pop-sugg' }, sugg.map((c) => h('button', { class: 'btn small', onclick: () => apply(c) }, c))) : null,
    h('div', { class: 'pop-actions' },
      existing ? h('button', { class: 'btn small danger', onclick: () => { close(); onRemove(); } }, 'Remove') : null,
      h('button', { class: 'btn small', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'btn small primary', onclick: () => apply(input.value) }, existing ? 'Save' : 'Add')));
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Enter' && e.target === input) { e.preventDefault(); apply(input.value); }
  };
  const onDown = (e) => { if (!pop.contains(e.target)) close(); };
  function close() {
    pop.remove();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    closePop = null;
  }
  closePop = close;
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  pop.style.top = (r.bottom + ph + 12 > window.innerHeight ? Math.max(8, r.top - ph - 6) : r.bottom + 6) + 'px';
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
  input.focus();
  input.select();
}

export function closeChordPopover() { closePop?.(); }

// text: the section's lyrics; onChange(newText) is called after an edit.
export function renderChart(text, { key, mode, onChange }) {
  const root = h('div', { class: 'chart', 'aria-label': 'Chord chart. Click a word to add a chord, click a chord to change it.' });
  let off = 0;
  for (const line of text.split('\n')) { root.append(renderLine(line, off)); off += line.length + 1; }
  if (!text.trim()) root.append(h('div', { class: 'muted small chart-empty' }, 'Nothing to show yet. Switch to Edit and write some lyrics.'));

  root.addEventListener('click', (e) => {
    const u = e.target.closest('.u');
    if (!u) return;
    const chip = u.querySelector('.c[data-s]');
    if (chip) {
      const s = +chip.dataset.s, en = +chip.dataset.e;
      openPop({
        anchor: chip, value: chip.dataset.v, existing: true, key, mode,
        onApply: (v) => onChange(text.slice(0, s) + `[${v}]` + text.slice(en)),
        onRemove: () => onChange(text.slice(0, s) + text.slice(en)),
      });
    } else {
      const pos = +u.dataset.pos;
      openPop({ anchor: u, value: '', existing: false, key, mode, onApply: (v) => onChange(text.slice(0, pos) + `[${v}]` + text.slice(pos)) });
    }
  });
  return root;
}
