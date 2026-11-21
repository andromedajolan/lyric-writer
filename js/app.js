import {
  SECTION_TYPES, QUICK_ADD, KEYS, MODES, TIME_SIGS, RELEASE_TYPES,
  newSong, newSection, normalizeSong, uid, autoLabels, songTitle, keyLine, searchText, groupKey, validDate,
} from './model.js';
import * as db from './db.js';
import { h, $, toast, confirmDialog, autosize, fmtTime } from './dom.js';
import {
  transposeLyrics, chordsIn, chordsUseFlats, preferFlats, keyNameFor, keyPc, shortestShift,
} from './chords.js';
import { renderChart, closeChordPopover } from './chart.js';
import { buildSunoPanel } from './sunotab.js';
import { initRhymePanel, getDict, trackTextarea } from './rhymepanel.js';
import { renderCount } from './countview.js';
import { showDataDialog } from './datadialog.js';
import {
  syncStyle, taggedLyrics, parseTagInput, usedTags, isInstrumentTag, instrumentWarning, LIMITS, fmtCount,
} from './suno.js';

const APP_VERSION = '0.5.1'; // keep in sync with sw.js
const PENDING_KEY = 'lyricwriter.pending';
const LAST_KEY = 'lyricwriter.last';
const GROUP_KEY = 'lyricwriter.groupBy';
const THEME_KEY = 'studio.theme'; // shared across studio apps on this origin
const THEMES = ['dark', 'gray', 'light'];
const SNAPSHOT_EVERY_MS = 2 * 60 * 1000;

const state = {
  songs: new Map(),
  currentId: null,
  tab: 'lyrics',
  showTrash: false,
  search: '',
  groupBy: 'release',
  finalOnly: false,
  view: 'edit', // lyrics tab: 'edit' (plain text with [C] brackets), 'chart' (chips over words) or 'count' (syllables + rhyme scheme)
};

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* quota/private mode */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

const cur = () => state.songs.get(state.currentId) || null;
let rhymes = null;

/* ───────────────────────── Autosave + crash recovery ─────────────────────────
   Every edit: (1) synchronously mirrors the song to localStorage ("pending"),
   (2) debounces a write to IndexedDB. If the tab dies before (2) finishes,
   the pending copy is recovered on next launch. */

const dirty = new Set();
const lastSnap = new Map();
let saveTimer = null;
let retryTimer = null;

function setSave(kind, text) {
  const el = $('#save-state');
  el.className = 'save-state' + (kind === 'saving' ? ' saving' : kind === 'error' ? ' error' : '');
  el.textContent = text;
}

function touch(song) {
  song.updated = Date.now();
  dirty.add(song.id);
  lsSet(PENDING_KEY, JSON.stringify(song));
  setSave('saving', 'Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 350);
}

async function flush() {
  clearTimeout(saveTimer);
  clearTimeout(retryTimer);
  if (!dirty.size) return;
  const ids = [...dirty];
  dirty.clear();
  try {
    for (const id of ids) {
      const song = state.songs.get(id);
      if (!song) continue;
      await db.putSong(song);
      if (Date.now() - (lastSnap.get(id) || 0) > SNAPSHOT_EVERY_MS) {
        lastSnap.set(id, Date.now());
        db.addSnapshot(song).catch(() => {});
      }
    }
    if (!dirty.size) {
      lsDel(PENDING_KEY);
      setSave('ok', 'Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    }
  } catch (err) {
    ids.forEach((id) => dirty.add(id));
    setSave('error', 'Save failed – retrying');
    retryTimer = setTimeout(flush, 3000);
    console.error('Save failed', err);
  }
}

async function recoverPending() {
  const raw = lsGet(PENDING_KEY);
  if (!raw) return;
  try {
    const pending = normalizeSong(JSON.parse(raw));
    const existing = state.songs.get(pending.id);
    if (!existing || pending.updated > existing.updated) {
      await db.putSong(pending);
      state.songs.set(pending.id, pending);
      toast(`Recovered unsaved changes to “${songTitle(pending)}”.`, { sticky: true });
    }
    lsDel(PENDING_KEY);
  } catch (err) {
    console.error('Could not recover pending edit', err);
  }
}

window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); flush(); }
});

/* ───────────────────────── Library ───────────────────────── */

let libTimer = null;
const refreshLibrarySoon = () => { clearTimeout(libTimer); libTimer = setTimeout(renderLibrary, 150); };

const finalBadge = (date) => h('span', { class: 'final-badge', title: 'Release date ' + date }, 'Final');

function renderLibrary() {
  const list = $('#song-list');
  list.replaceChildren();
  const all = [...state.songs.values()];
  const trashCount = all.filter((s) => s.deleted).length;
  $('#btn-trash').textContent = `Trash (${trashCount})`;
  $('#btn-trash').setAttribute('aria-pressed', String(state.showTrash));
  $('#btn-final').setAttribute('aria-pressed', String(state.finalOnly));

  let songs = all.filter((s) => s.deleted === state.showTrash && (!state.finalOnly || state.showTrash || s.release.date));
  const terms = state.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length && !state.showTrash) {
    songs = songs.filter((s) => { const t = searchText(s); return terms.every((w) => t.includes(w)); });
  }
  $('#lib-count').textContent = `${songs.length} song${songs.length === 1 ? '' : 's'}`;

  if (!songs.length) {
    list.append(h('div', { class: 'empty-note' },
      state.showTrash ? 'Trash is empty.' : state.finalOnly ? 'No final songs yet. Set a release date on a song to mark it Final.' : terms.length ? 'No songs match.' : 'No songs yet. Hit + New.'));
    return;
  }

  const byTitle = (a, b) => songTitle(a).localeCompare(songTitle(b), undefined, { sensitivity: 'base', numeric: true });
  const item = (s) => state.showTrash
    ? h('div', { class: 'trash-row' },
      h('span', { class: 't' }, songTitle(s)),
      h('button', { class: 'btn small', onclick: () => restoreSong(s.id) }, 'Restore'),
      h('button', { class: 'btn small ghost', onclick: () => deleteForever(s.id) }, 'Delete'))
    : h('button', {
      class: 'song-item' + (s.id === state.currentId ? ' active' : ''),
      onclick: () => openSong(s.id),
    }, h('div', { class: 't' }, songTitle(s), s.release.date ? finalBadge(s.release.date) : null), h('div', { class: 's' }, keyLine(s) || ' '));

  if (state.showTrash || state.groupBy === 'az') {
    songs.sort(byTitle).forEach((s) => list.append(item(s)));
  } else if (state.groupBy === 'recent') {
    songs.sort((a, b) => b.updated - a.updated).forEach((s) => list.append(item(s)));
  } else {
    const groups = new Map();
    for (const s of songs) {
      const g = groupKey(s);
      if (!groups.has(g.label)) groups.set(g.label, { ...g, songs: [] });
      groups.get(g.label).songs.push(s);
    }
    [...groups.values()]
      .sort((a, b) => a.order - b.order || a.sort.localeCompare(b.sort))
      .forEach((g) => {
        list.append(h('div', { class: 'group-head' }, g.label));
        g.songs.sort(byTitle).forEach((s) => list.append(item(s)));
      });
  }
}

/* ───────────────────────── Song actions ───────────────────────── */

function isBlank(s) {
  return !s.title.trim() && !s.key && !s.mode && !s.bpm && s.release.type === 'none'
    && !s.notes.meaning && !s.notes.performance && !s.suno.style && !s.suno.exclude && !s.suno.voice
    && s.suno.weirdness == null && s.suno.styleInfluence == null && s.suno.audioInfluence == null
    && s.sections.length <= 1
    && s.sections.every((x) => !x.lyrics && !x.label && !x.tags.length && !x.fade);
}

async function discardIfBlank(id) {
  const s = state.songs.get(id);
  if (!s || !isBlank(s) || s.deleted) return;
  dirty.delete(id);
  state.songs.delete(id);
  if (lsGet(PENDING_KEY) && !dirty.size) lsDel(PENDING_KEY);
  try { await db.deleteSong(id); } catch { /* ignore */ }
}

function closeDrawer() { document.body.classList.remove('lib-open'); $('#scrim').hidden = true; }

async function openSong(id) {
  const prev = state.currentId;
  if (prev && prev !== id) { await flush(); await discardIfBlank(prev); }
  state.currentId = id;
  if (id) lsSet(LAST_KEY, id); else lsDel(LAST_KEY);
  closeDrawer();
  renderEditor();
  renderLibrary();
}

async function createSong() {
  const prev = state.currentId;
  if (prev) { await flush(); }
  const song = newSong();
  state.songs.set(song.id, song);
  try { await db.putSong(song); } catch (e) { setSave('error', 'Save failed'); }
  state.currentId = song.id;
  lsSet(LAST_KEY, song.id);
  if (prev) await discardIfBlank(prev);
  state.showTrash = false;
  closeDrawer();
  renderEditor();
  renderLibrary();
  $('#title-input')?.focus();
}

async function duplicateSong() {
  const s = cur(); if (!s) return;
  await flush();
  const copy = normalizeSong(JSON.parse(JSON.stringify(s)));
  copy.id = uid('song');
  copy.title = (s.title.trim() || 'Untitled song') + ' (copy)';
  copy.created = copy.updated = Date.now();
  copy.sections.forEach((x) => { x.id = uid('sec'); });
  state.songs.set(copy.id, copy);
  await db.putSong(copy);
  await openSong(copy.id);
  toast('Duplicated.');
}

async function trashSong() {
  const s = cur(); if (!s) return;
  s.deleted = true;
  touch(s);
  await flush();
  state.currentId = null;
  lsDel(LAST_KEY);
  renderEditor();
  renderLibrary();
  toast(`Moved “${songTitle(s)}” to Trash.`, { action: 'Undo', onAction: () => restoreSong(s.id, true) });
}

async function restoreSong(id, open = false) {
  const s = state.songs.get(id); if (!s) return;
  s.deleted = false;
  touch(s);
  await flush();
  if (open) { state.showTrash = false; $('#btn-trash').setAttribute('aria-pressed', 'false'); await openSong(id); }
  else renderLibrary();
}

async function deleteForever(id) {
  const s = state.songs.get(id); if (!s) return;
  const ok = await confirmDialog(`Permanently delete “${songTitle(s)}”? This can't be undone.`, 'Delete forever');
  if (!ok) return;
  dirty.delete(id);
  state.songs.delete(id);
  await db.deleteSong(id);
  renderLibrary();
}

/* ───────────────────────── Editor ───────────────────────── */

function field(label, control, cls = '') {
  const id = 'f-' + uid('x');
  control.id = id;
  return h('div', { class: 'field ' + cls }, h('label', { for: id }, label), control);
}

function select(options, value, onchange, blankLabel) {
  const el = h('select', { onchange: (e) => onchange(e.target.value) });
  if (blankLabel != null) el.append(h('option', { value: '' }, blankLabel));
  for (const o of options) el.append(h('option', { value: o, selected: o === value }, o[0].toUpperCase() + o.slice(1)));
  if (blankLabel != null && !value) el.value = '';
  return el;
}

function renderEditor() {
  const root = $('#editor');
  root.replaceChildren();
  const song = cur();
  $('#btn-history').hidden = !song;
  document.title = song ? `${songTitle(song)} – Stilus` : 'Stilus';
  if (!song) {
    root.append(h('div', { class: 'empty-state' },
      h('p', {}, state.songs.size ? 'Pick a song from the library, or start a new one.' : 'No songs yet.'),
      h('button', { class: 'btn primary', onclick: createSong }, '+ New song')));
    return;
  }

  const syncSunoStyle = () => { song.suno.style = syncStyle(song.suno.style, song); };
  const edit = (fn) => (v) => { fn(v); syncSunoStyle(); touch(song); refreshLibrarySoon(); };

  const titleIn = h('input', {
    id: 'title-input', class: 'title-input', placeholder: 'Song title', value: song.title, 'aria-label': 'Song title',
    oninput: (e) => { song.title = e.target.value; document.title = `${songTitle(song)} – Stilus`; touch(song); refreshLibrarySoon(); },
  });

  const bpmIn = h('input', {
    type: 'number', min: '20', max: '400', step: 'any', inputMode: 'decimal', placeholder: '—',
    value: song.bpm ?? '',
    oninput: (e) => { const n = parseFloat(e.target.value); song.bpm = Number.isFinite(n) && n > 0 ? n : null; syncSunoStyle(); touch(song); refreshLibrarySoon(); },
  });

  const tsIn = h('input', {
    list: 'ts-list', value: song.timeSig, placeholder: '4/4', autocomplete: 'off',
    oninput: (e) => { song.timeSig = e.target.value.trim() || '4/4'; touch(song); },
  });
  const tsList = h('datalist', { id: 'ts-list' }, TIME_SIGS.map((t) => h('option', { value: t })));

  const relName = h('input', {
    list: 'rel-list', value: song.release.name, autocomplete: 'off',
    oninput: (e) => { song.release.name = e.target.value; touch(song); refreshLibrarySoon(); },
  });
  const relList = h('datalist', { id: 'rel-list' });
  const relField = field('Name', relName, 'wide');
  const syncRelease = () => {
    const t = song.release.type;
    relField.hidden = !(t === 'album' || t === 'pool');
    relName.placeholder = t === 'album' ? 'Album name' : 'Pool name';
    relField.querySelector('label').textContent = t === 'album' ? 'Album name' : 'Pool name';
    relList.replaceChildren();
    const names = new Set();
    for (const s of state.songs.values()) if (s.release.type === t && s.release.name.trim()) names.add(s.release.name.trim());
    [...names].sort().forEach((n) => relList.append(h('option', { value: n })));
  };
  const relDate = h('input', {
    type: 'date', value: song.release.date, 'aria-label': 'Release date',
    onchange: (e) => { song.release.date = validDate(e.target.value); syncFinal(); touch(song); refreshLibrarySoon(); },
  });
  const finalHead = h('span', {});
  const syncFinal = () => finalHead.replaceChildren(...(song.release.date ? [finalBadge(song.release.date)] : []));
  syncFinal();
  const relType = h('select', {
    onchange: (e) => { song.release.type = e.target.value; if (!['album', 'pool'].includes(e.target.value)) song.release.name = ''; relName.value = song.release.name; syncRelease(); touch(song); refreshLibrarySoon(); },
  }, RELEASE_TYPES.map((t) => h('option', { value: t, selected: t === song.release.type }, t === 'none' ? 'Not set' : t[0].toUpperCase() + t.slice(1))));
  syncRelease();

  const meta = h('div', { class: 'meta' },
    field('Key', select(KEYS, song.key, edit((v) => { song.key = v; }), '—')),
    field('Mode', select(MODES, song.mode, edit((v) => { song.mode = v; }), '—')),
    field('BPM', bpmIn),
    field('Time signature', tsIn),
    field('Release', relType),
    relField,
    field('Release date', relDate),
    tsList, relList);

  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div', {});
  const showTab = (t) => {
    state.tab = t;
    tabsEl.replaceChildren(
      ...[['lyrics', 'Lyrics'], ['notes', 'Notes & Suno']].map(([id, label]) =>
        h('button', { class: 'tab', role: 'tab', 'aria-selected': String(state.tab === id), onclick: () => showTab(id) }, label)));
    body.replaceChildren(t === 'lyrics' ? lyricsTab(song) : notesTab(song));
    body.querySelectorAll('textarea').forEach(autosize);
  };

  root.append(h('div', { class: 'editor-inner' },
    h('div', { class: 'title-row' }, titleIn, finalHead,
      h('button', { class: 'btn', onclick: duplicateSong, title: 'Make a copy of this song' }, 'Duplicate'),
      h('button', { class: 'btn', onclick: trashSong, title: 'Move this song to Trash' }, 'Delete')),
    meta, tabsEl, body));
  showTab(state.tab);
}

async function doTranspose({ steps = 0, toKey = '' }) {
  const song = cur(); if (!song) return;
  await flush();
  const hasChords = song.sections.some((s) => chordsIn(s.lyrics).length);
  if (!hasChords && !song.key) { toast('Nothing to transpose yet. Add chords or set a key first.', { ms: 3500 }); return; }

  let n = steps;
  let newKey = song.key;
  if (toKey) {
    if (!song.key) { toast('Set the song’s key first, then pick the key to move to.', { ms: 3500 }); return; }
    n = shortestShift(song.key, toKey);
    newKey = toKey;
  } else if (song.key) {
    newKey = keyNameFor((keyPc(song.key) + n + 120) % 12, song.mode);
  }
  if (n === 0 && newKey === song.key) { toast('Already in that key.', { ms: 2500 }); return; }

  const flats = newKey ? preferFlats(newKey, song.mode) : chordsUseFlats(song.sections.map((s) => s.lyrics));
  const before = { key: song.key, style: song.suno.style, lyrics: song.sections.map((s) => [s.id, s.lyrics]) };
  db.addSnapshot(song).catch(() => {});

  for (const sec of song.sections) sec.lyrics = transposeLyrics(sec.lyrics, n, flats);
  song.key = newKey;
  song.suno.style = syncStyle(song.suno.style, song);
  touch(song);
  const root = $('#editor'); const top = root.scrollTop;
  renderEditor(); renderLibrary();
  root.scrollTop = top;
  const msg = `Transposed ${n > 0 ? '+' : ''}${n} semitone${Math.abs(n) === 1 ? '' : 's'}` + (before.key !== newKey ? ` (${before.key || '—'} → ${newKey})` : '') + '.';
  toast(msg, {
    action: 'Undo', ms: 15000,
    onAction: () => {
      if (cur() !== song) return;
      song.key = before.key; song.suno.style = before.style;
      for (const [id, lyr] of before.lyrics) { const sec = song.sections.find((x) => x.id === id); if (sec) sec.lyrics = lyr; }
      touch(song); renderEditor(); renderLibrary();
    },
  });
}

function lyricsTab(song) {
  const wrap = h('div', {});
  const count = h('span', { class: 'tb-count', title: 'Length of the tagged lyrics you would paste into Suno' });
  const updateCount = () => {
    const n = taggedLyrics(song).length;
    count.textContent = `Suno lyrics ${fmtCount(n)} / ${fmtCount(LIMITS.lyrics)}`;
    count.classList.toggle('over', n > LIMITS.lyrics);
  };
  const tc = () => { touch(song); updateCount(); };
  const list = h('div', {});
  const addBar = h('div', { class: 'add-bar' });

  const viewBtn = (id, label) => h('button', {
    class: 'btn small seg', 'aria-pressed': String(state.view === id),
    onclick: () => { state.view = id; closeChordPopover(); renderSections(); syncToolbar(); },
  }, label);
  const viewEdit = viewBtn('edit', 'Edit');
  const viewChart = viewBtn('chart', 'Chords');
  const viewCount = viewBtn('count', 'Count');
  const rhymeBtn = h('button', {
    class: 'btn small seg', 'aria-pressed': String(rhymes?.isOpen() || false), title: 'Open the rhyme finder',
    onclick: () => { if (rhymes.isOpen()) rhymes.close(); else rhymes.open(); rhymeBtn.setAttribute('aria-pressed', String(rhymes.isOpen())); },
  }, 'Rhymes');
  const toKey = h('select', {
    'aria-label': 'Transpose to key', title: 'Move the whole song to another key (set the song\u2019s key first)',
    onchange: (e) => { const k = e.target.value; e.target.value = ''; if (k) doTranspose({ toKey: k }); },
  }, h('option', { value: '' }, 'To key…'), KEYS.map((k) => h('option', { value: k }, k)));
  const toolbar = h('div', { class: 'toolbar' },
    h('div', { class: 'tb-group' }, h('span', { class: 'tb-label' }, 'View'), viewEdit, viewChart, viewCount, rhymeBtn),
    h('div', { class: 'tb-group' }, h('span', { class: 'tb-label' }, 'Transpose'),
      h('button', { class: 'btn small', 'aria-label': 'Down one semitone', title: 'Down one semitone', onclick: () => doTranspose({ steps: -1 }) }, '−1'),
      h('button', { class: 'btn small', 'aria-label': 'Up one semitone', title: 'Up one semitone', onclick: () => doTranspose({ steps: 1 }) }, '+1'),
      toKey),
    count);
  const syncToolbar = () => {
    viewEdit.setAttribute('aria-pressed', String(state.view === 'edit'));
    viewChart.setAttribute('aria-pressed', String(state.view === 'chart'));
    viewCount.setAttribute('aria-pressed', String(state.view === 'count'));
  };

  const updateLabels = () => {
    const labels = autoLabels(song);
    list.querySelectorAll('.label-in').forEach((el) => { el.placeholder = labels[el.closest('.sec').dataset.id]; });
  };

  const renderSections = () => {
    list.replaceChildren();
    if (!song.sections.length) list.append(h('p', { class: 'muted' }, 'No sections yet. Add one below.'));
    song.sections.forEach((sec) => list.append(sectionCard(sec)));
    updateLabels();
    list.querySelectorAll('textarea').forEach(autosize);
  };

  const addSection = (type) => {
    const sec = newSection(type);
    song.sections.push(sec);
    tc();
    renderSections();
    const card = list.querySelector(`[data-id="${sec.id}"]`);
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card?.querySelector('textarea')?.focus();
  };

  function sectionBody(sec) {
    if (state.view === 'chart') {
      return renderChart(sec.lyrics, {
        key: song.key, mode: song.mode,
        onChange: (text) => { sec.lyrics = text; tc(); refreshLibrarySoon(); renderSections(); },
      });
    }
    if (state.view === 'count') {
      const box = h('div', { class: 'countwrap' }, h('div', { class: 'muted small', style: 'padding:10px 12px' }, 'Loading dictionary…'));
      getDict().then((d) => box.replaceChildren(renderCount(sec.lyrics, d, { onWord: (w) => { rhymes.open(w); } })))
        .catch(() => box.replaceChildren(h('div', { class: 'tag-warn', style: 'padding:10px 12px' }, 'Could not load the dictionary.')));
      return box;
    }
    const ta = h('textarea', {
      class: 'lyrics', value: sec.lyrics, placeholder: 'Write lyrics here. Add chords like [C]word', 'aria-label': 'Lyrics',
      oninput: (e) => { sec.lyrics = e.target.value; autosize(e.target); tc(); refreshLibrarySoon(); },
    });
    ta.spellcheck = false;
    trackTextarea(ta);
    return ta;
  }

  function sectionCard(sec) {
    // Tags: summary line always visible, panel on click. Sections start with no tags.
    const tagSum = h('button', { class: 'tagsum', title: 'Edit Suno tags for this section' });
    const panel = h('div', { class: 'tagpanel', hidden: true });
    const refreshSum = () => {
      const warn = sec.tags.some(isInstrumentTag);
      tagSum.textContent = (sec.tags.length ? sec.tags.map((x) => `[${x}]`).join('') : 'no tags') + (sec.fade ? ' · fade' : '') + (warn ? ' · ⚠ instrument tag' : '');
      tagSum.classList.toggle('warn', warn);
    };
    const setTags = (arr) => { sec.tags = arr; tc(); refreshSum(); renderPanel(); };
    function renderPanel() {
      const tags = sec.tags;
      const dlId = uid('dl');
      const suggestions = usedTags([...state.songs.values()].filter((s) => !s.deleted)).filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()));
      const bad = tags.filter(isInstrumentTag);
      const input = h('input', { list: dlId, placeholder: 'Add a tag, e.g. mezzo-forte', 'aria-label': 'Add tag to this section', autocomplete: 'off' });
      const add = (raw) => {
        const found = parseTagInput(raw);
        if (!found.length) return;
        const next = [...tags];
        for (const t of found) if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
        setTags(next);
        panel.querySelector('input')?.focus();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(input.value); } });
      const copyToOthers = () => {
        const others = song.sections.filter((s) => s !== sec && s.type === sec.type);
        if (!others.length) { toast(`No other ${sec.type} sections in this song.`, { ms: 3000 }); return; }
        const prev = others.map((o) => [o, o.tags]);
        others.forEach((o) => { o.tags = [...sec.tags]; });
        tc(); renderSections();
        toast(`Copied these tags to ${others.length} other ${sec.type} section${others.length === 1 ? '' : 's'}.`, {
          action: 'Undo', ms: 10000,
          onAction: () => { if (state.currentId === song.id) { prev.forEach(([o, t]) => { o.tags = t; }); tc(); renderSections(); } },
        });
      };
      panel.replaceChildren(
        tags.length ? h('div', { class: 'chips' }, tags.map((t) => h('button', {
          class: 'chip' + (isInstrumentTag(t) ? ' warn' : ''), 'aria-pressed': 'true', title: 'Click to remove',
          onclick: () => setTags(tags.filter((x) => x !== t)),
        }, t + (isInstrumentTag(t) ? ' ⚠' : '')))) : null,
        h('div', { class: 'add-tag' }, input, h('datalist', { id: dlId }, suggestions.map((t) => h('option', { value: t }))),
          h('button', { class: 'btn small', onclick: () => add(input.value) }, 'Add')),
        suggestions.length ? h('div', { class: 'chips suggest' }, h('span', { class: 'tb-label' }, 'From your songs'),
          suggestions.slice(0, 16).map((t) => h('button', { class: 'chip', 'aria-pressed': 'false', onclick: () => add(t) }, t))) : null,
        bad.length ? h('div', { class: 'tag-warn', role: 'alert' }, instrumentWarning(bad[0])) : null,
        h('div', { class: 'tag-opts' },
          h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: sec.fade, onchange: (e) => { sec.fade = e.target.checked; tc(); refreshSum(); } }),
            'Fade on last line ([diminuendo] before it)'),
          h('div', { class: 'tb-group' },
            h('button', { class: 'btn small', onclick: copyToOthers, title: 'Give every other section of this type these same tags' }, `Copy tags to other ${sec.type} sections`),
            h('button', { class: 'btn small ghost', disabled: !tags.length, onclick: () => setTags([]) }, 'Clear'))));
    }
    tagSum.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) renderPanel(); });
    refreshSum();

    const move = (d) => {
      const k = song.sections.findIndex((x) => x.id === sec.id);
      const j = k + d;
      if (j < 0 || j >= song.sections.length) return;
      [song.sections[k], song.sections[j]] = [song.sections[j], song.sections[k]];
      tc(); renderSections();
      list.querySelector(`[data-id="${sec.id}"] [data-act="${d < 0 ? 'up' : 'down'}"]`)?.focus();
    };
    return h('div', { class: 'sec', dataset: { id: sec.id } },
      h('div', { class: 'sec-head' },
        select(SECTION_TYPES, sec.type, (v) => { sec.type = v; tc(); updateLabels(); refreshSum(); if (!panel.hidden) renderPanel(); }),
        h('input', {
          class: 'label-in', value: sec.label, 'aria-label': 'Section name (optional)',
          oninput: (e) => { sec.label = e.target.value; tc(); },
        }),
        h('div', { class: 'sec-tools' },
          h('button', { class: 'btn small ghost', dataset: { act: 'up' }, 'aria-label': 'Move section up', title: 'Move up', onclick: () => move(-1) }, '↑'),
          h('button', { class: 'btn small ghost', dataset: { act: 'down' }, 'aria-label': 'Move section down', title: 'Move down', onclick: () => move(1) }, '↓'),
          h('button', {
            class: 'btn small ghost', 'aria-label': 'Duplicate section', title: 'Duplicate',
            onclick: () => {
              const idx = song.sections.findIndex((x) => x.id === sec.id);
              song.sections.splice(idx + 1, 0, { ...sec, id: uid('sec'), tags: [...sec.tags] });
              tc(); renderSections();
            },
          }, '⧉'),
          h('button', {
            class: 'btn small ghost', 'aria-label': 'Delete section', title: 'Delete section',
            onclick: () => {
              const idx = song.sections.findIndex((x) => x.id === sec.id);
              const [removed] = song.sections.splice(idx, 1);
              tc(); renderSections();
              toast('Section deleted.', {
                action: 'Undo', ms: 10000,
                onAction: () => { if (cur() === song) { song.sections.splice(Math.min(idx, song.sections.length), 0, removed); tc(); renderSections(); } },
              });
            },
          }, '✕'))),
      h('div', { class: 'tagrow' }, h('span', { class: 'tag-label' }, 'Suno'), tagSum),
      panel,
      sectionBody(sec));
  }

  const more = h('select', {
    'aria-label': 'Add another section type',
    onchange: (e) => { if (e.target.value) addSection(e.target.value); e.target.value = ''; },
  }, h('option', { value: '' }, 'More…'),
  SECTION_TYPES.filter((t) => !QUICK_ADD.includes(t)).map((t) => h('option', { value: t }, t)));
  addBar.append(...QUICK_ADD.map((t) => h('button', { class: 'btn', onclick: () => addSection(t) }, '+ ' + t)), more);

  wrap.append(toolbar, list, addBar);
  renderSections();
  updateCount();
  return wrap;
}

function notesTab(song) {
  const ta = (label, get, set, ph) => {
    const el = h('textarea', {
      value: get(), placeholder: ph, 'aria-label': label,
      oninput: (e) => { set(e.target.value); autosize(e.target); touch(song); refreshLibrarySoon(); },
    });
    return h('div', { class: 'field' }, h('label', {}, label), el);
  };
  return h('div', { class: 'notes-grid' },
    ta('What this song means (in my words)', () => song.notes.meaning, (v) => { song.notes.meaning = v; }, 'What is this song about?'),
    ta('Performance notes', () => song.notes.performance, (v) => { song.notes.performance = v; }, 'Dynamics, breaths, where to push, live arrangement…'),
    buildSunoPanel(song, { touch: () => touch(song) }));
}

/* ───────────────────────── History (earlier versions) ───────────────────────── */

async function showHistory() {
  const song = cur(); if (!song) return;
  await flush();
  let snaps = [];
  try { snaps = await db.listSnapshots(song.id); } catch { /* ignore */ }
  const dlg = h('dialog', { class: 'hist' }, h('h3', { style: 'margin:0' }, 'Earlier versions'),
    h('p', { class: 'muted small' }, 'A version is kept about every two minutes while you write. Restoring keeps your current version in this list too.'));
  const listEl = h('div', { class: 'hist-list' });
  if (!snaps.length) listEl.append(h('div', { class: 'muted' }, 'No earlier versions yet.'));
  for (const sn of snaps) {
    const lines = sn.song.sections.reduce((n, s) => n + (s.lyrics ? s.lyrics.split('\n').filter((l) => l.trim()).length : 0), 0);
    listEl.append(h('div', { class: 'hist-row' },
      h('div', {}, h('div', {}, fmtTime(sn.at)), h('div', { class: 'muted small' }, `${sn.song.sections.length} sections · ${lines} lines`)),
      h('button', {
        class: 'btn small',
        onclick: async () => {
          dlg.close();
          await flush();
          await db.addSnapshot(song).catch(() => {});
          const restored = normalizeSong(sn.song);
          restored.id = song.id;
          restored.deleted = false;
          state.songs.set(song.id, restored);
          touch(restored);
          await flush();
          renderEditor(); renderLibrary();
          toast('Restored version from ' + fmtTime(sn.at) + '.');
        },
      }, 'Restore')));
  }
  dlg.append(listEl, h('div', { class: 'dlg-actions' }, h('button', { class: 'btn', onclick: () => dlg.close() }, 'Close')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/* ───────────────────────── Theme, install, service worker ───────────────────────── */

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('#btn-theme').textContent = t[0].toUpperCase() + t.slice(1);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#141418');
}

function showAbout() {
  const license = (title, url) => {
    const pre = h('pre', { class: 'license' }, 'Loading…');
    const det = h('details', {}, h('summary', {}, title), pre);
    det.addEventListener('toggle', () => { if (det.open && pre.textContent === 'Loading…') fetch(url).then((r) => r.text()).then((t) => { pre.textContent = t; }).catch(() => { pre.textContent = 'Could not load the license text.'; }); });
    return det;
  };
  const dlg = h('dialog', { class: 'dlg wide' },
    h('h3', { style: 'margin-top:0' }, 'Stilus v' + APP_VERSION),
    h('p', { class: 'muted small' }, 'Everything stays on this device. No accounts, no AI, no network calls once installed.'),
    h('p', { class: 'small' }, 'Rhymes and syllable counts use the CMU Pronouncing Dictionary (Carnegie Mellon University) and SCOWL word lists (Kevin Atkinson and contributors). Their license notices are reproduced below.'),
    license('CMU Pronouncing Dictionary license', 'licenses/CMUdict-LICENSE.txt'),
    license('SCOWL copyright and license notices', 'licenses/SCOWL-Copyright.txt'),
    h('div', { class: 'dlg-actions' }, h('button', { class: 'btn primary', onclick: () => dlg.close() }, 'Close')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

async function addImported(list) {
  if (state.currentId) { await flush(); await discardIfBlank(state.currentId); }
  for (const s of list) { state.songs.set(s.id, s); }
  await db.putSongs(list);
  state.showTrash = false;
  state.currentId = list[0].id;
  lsSet(LAST_KEY, list[0].id);
  renderEditor(); renderLibrary();
}

async function applyMerge(plan) {
  await flush();
  for (const s of plan.replace) { const old = state.songs.get(s.id); if (old) { try { await db.addSnapshot(old); } catch { /* history is best-effort */ } } }
  const list = [...plan.add, ...plan.replace];
  for (const s of list) state.songs.set(s.id, s);
  await db.putSongs(list);
  const c = state.songs.get(state.currentId);
  if (!c) state.currentId = null;
  renderEditor(); renderLibrary();
}

function setupChrome() {
  const saved = lsGet(THEME_KEY);
  applyTheme(THEMES.includes(saved) ? saved : 'dark');
  $('#btn-theme').addEventListener('click', () => {
    const next = THEMES[(THEMES.indexOf(document.documentElement.dataset.theme) + 1) % THEMES.length];
    lsSet(THEME_KEY, next);
    applyTheme(next);
  });
  window.addEventListener('storage', (e) => { if (e.key === THEME_KEY && THEMES.includes(e.newValue)) applyTheme(e.newValue); });

  $('#btn-menu').addEventListener('click', () => {
    const open = document.body.classList.toggle('lib-open');
    $('#scrim').hidden = !open;
  });
  $('#scrim').addEventListener('click', closeDrawer);
  $('#btn-new').addEventListener('click', createSong);
  $('#btn-history').addEventListener('click', showHistory);
  $('#btn-data').addEventListener('click', async () => { await flush(); showDataDialog({ getSongs: () => [...state.songs.values()], current: cur, addSongs: addImported, applyMerge, appVersion: APP_VERSION }); });
  $('#btn-final').addEventListener('click', () => { state.finalOnly = !state.finalOnly; renderLibrary(); });
  $('#btn-trash').addEventListener('click', () => { state.showTrash = !state.showTrash; renderLibrary(); });
  $('#search').addEventListener('input', (e) => { state.search = e.target.value; renderLibrary(); });
  const gb = $('#group-by');
  const savedGroup = lsGet(GROUP_KEY);
  if (['release', 'recent', 'az'].includes(savedGroup)) { state.groupBy = savedGroup; gb.value = savedGroup; }
  gb.addEventListener('change', () => { state.groupBy = gb.value; lsSet(GROUP_KEY, gb.value); renderLibrary(); });
  $('#library').append(h('div', { class: 'muted small', style: 'padding:6px 12px' }, 'Stilus v' + APP_VERSION + ' · ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); showAbout(); } }, 'About & licenses')));
  document.addEventListener('lw-about', showAbout);
  rhymes = initRhymePanel({ getSongs: () => state.songs.values(), onClose: () => { rhymes.close(); document.querySelectorAll('.toolbar .tb-group button[title="Open the rhyme finder"]').forEach((b) => b.setAttribute('aria-pressed', 'false')); } });

  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); installEvt = e;
    const b = h('button', { class: 'btn', id: 'btn-install', onclick: async () => { installEvt.prompt(); installEvt = null; b.remove(); } }, 'Install');
    $('#btn-theme').before(b);
  });

  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => document.querySelectorAll('#editor textarea').forEach(autosize), 150);
  });
}

function registerSW() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('App updated. Reload to use the new version.', { action: 'Reload', onAction: () => location.reload(), sticky: true });
  });
}

/* ───────────────────────── Boot ───────────────────────── */

async function boot() {
  setupChrome();
  registerSW();
  try {
    const rows = await db.allSongs();
    for (const r of rows) { const s = normalizeSong(r); state.songs.set(s.id, s); }
    await recoverPending();
    db.requestPersistence();
  } catch (err) {
    console.error(err);
    setSave('error', 'Storage unavailable');
    toast('Could not open local storage. Your songs will not be saved in this browser session.', { sticky: true });
  }
  const last = lsGet(LAST_KEY);
  const lastSong = last && state.songs.get(last);
  state.currentId = lastSong && !lastSong.deleted ? lastSong.id : null;
  if (!$('#save-state').classList.contains('error')) setSave('ok', 'Ready');
  renderEditor();
  renderLibrary();
}

boot();
