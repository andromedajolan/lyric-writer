// Count view: syllables per line, rhyme scheme letters, clickable words (opens the rhymes panel).
import { h } from './dom.js';
import { stripChords } from './suno.js';
import { countLine, fmtRange, schemeFor } from './rhyme.js';

export function renderCount(text, dict, { onWord }) {
  const lines = stripChords(text).split('\n').filter((l) => l.trim());
  const root = h('div', { class: 'countview' });
  if (!lines.length) { root.append(h('div', { class: 'muted small chart-empty' }, 'Nothing to count yet.')); return root; }
  const scheme = schemeFor(dict, lines);
  const counts = lines.map((l) => countLine(dict, l));
  lines.forEach((line, i) => {
    const c = counts[i], s = scheme[i];
    const badge = h('span', { class: 'sch' + (s.letter ? '' : ' none'), title: s.letter ? (s.slant ? 'Slant rhyme with the other ' + s.letter + ' lines' : 'Rhymes with the other ' + s.letter + ' lines') : 'No rhyme found' },
      s.letter ? s.letter + (s.slant ? '~' : '') : '·');
    if (s.letter) badge.style.setProperty('--h', ((s.letter.charCodeAt(0) * 47) % 360) + '');
    const words = h('span', { class: 'txt' });
    for (const part of line.split(/(\s+)/)) {
      if (!part.trim()) { words.append(part); continue; }
      const clean = part.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '');
      words.append(clean ? h('span', { class: 'wd', onclick: () => onWord(clean) }, part) : part);
    }
    root.append(h('div', { class: 'al' }, badge, words,
      h('span', { class: 'syl' + (c.approx ? ' approx' : ''), title: c.approx ? 'Includes a word not in the dictionary, so this is an estimate' : c.min === c.max ? 'Syllables' : 'Depends on how you sing a word' },
        (c.approx ? '~' : '') + fmtRange(c))));
  });
  const mins = counts.map((c) => c.min), maxs = counts.map((c) => c.max);
  const total = counts.reduce((a, c) => a + c.min, 0);
  const letters = scheme.map((s) => (s.letter || '·') + (s.slant ? '~' : '')).join('');
  root.append(h('div', { class: 'al-sum muted small' },
    `Scheme ${letters} · ${Math.min(...mins)}${Math.max(...maxs) !== Math.min(...mins) ? '–' + Math.max(...maxs) : ''} syllables per line · ${total} total`));
  return root;
}
