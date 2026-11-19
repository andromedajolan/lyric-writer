// Suno panel (Notes & Suno tab): voice, style, exclude, reference sliders, tagged lyrics, character counters.
import { h, toast, autosize, copyText } from './dom.js';
import {
  taggedLyrics, cleanLyrics, syncStyle, oneLine, LIMITS, fmtCount,
  loadVoices, saveVoices, instrumentTagsIn, instrumentWarning,
} from './suno.js';

function counter(max) {
  const el = h('span', { class: 'counter', 'aria-live': 'off' });
  const set = (len) => {
    el.textContent = `${fmtCount(len)} / ${fmtCount(max)}`;
    el.classList.toggle('over', len > max);
    el.title = len > max ? `Over Suno's ${fmtCount(max)} character limit by ${fmtCount(len - max)}` : `Suno allows ${fmtCount(max)} characters`;
  };
  return { el, set };
}

function copyField(label, ta, what) {
  return h('button', {
    class: 'btn small', title: `Copy ${what}`,
    onclick: () => { const v = oneLine(ta.value); if (!v) { toast(`${label} is empty.`, { ms: 2500 }); return; } copyText(v, `${label} copied`); },
  }, 'Copy');
}

export function buildSunoPanel(song, { touch }) {
  const su = song.suno;

  // Voice
  const voiceSel = h('select', { 'aria-label': 'Suno voice', onchange: (e) => { su.voice = e.target.value; touch(); } });
  const fillVoices = () => {
    const list = loadVoices();
    if (su.voice && !list.includes(su.voice)) list.push(su.voice);
    voiceSel.replaceChildren(h('option', { value: '' }, '— none —'), ...list.map((v) => h('option', { value: v, selected: v === su.voice }, v)));
    voiceSel.value = su.voice;
  };
  fillVoices();
  const voiceRow = h('div', { class: 'field' },
    h('div', { class: 'field-head' }, h('label', {}, 'Voice'), h('div', { class: 'field-btns' },
      h('button', { class: 'btn small', onclick: () => openVoicesDialog(fillVoices) }, 'Edit voices…'))),
    voiceSel);

  // Style
  const styleCount = counter(LIMITS.style);
  const styleTA = h('textarea', {
    class: 'suno-ta', value: su.style, rows: 2, 'aria-label': 'Suno style block',
    placeholder: 'genre, key, BPM, vocal, arrangement, dynamics',
    oninput: (e) => { su.style = e.target.value; styleCount.set(su.style.length); autosize(e.target); touch(); },
  });
  styleCount.set(su.style.length);
  const syncBtn = h('button', {
    class: 'btn small', title: 'Put this song’s key and BPM into the style line',
    onclick: () => {
      if (!song.key && !song.bpm) { toast('Set a key or BPM first.', { ms: 2500 }); return; }
      su.style = syncStyle(su.style, song, { insert: true });
      styleTA.value = su.style; styleCount.set(su.style.length); autosize(styleTA); touch();
    },
  }, 'Sync key/BPM');

  const excludeTA = h('textarea', {
    class: 'suno-ta', value: su.exclude, rows: 2, 'aria-label': 'Suno exclude styles',
    placeholder: 'pop production, EDM, autotune, …',
    oninput: (e) => { su.exclude = e.target.value; autosize(e.target); touch(); },
  });

  const row = (labelEl, ta, ...btns) => h('div', { class: 'field' },
    h('div', { class: 'field-head' }, labelEl, h('div', { class: 'field-btns' }, ...btns)), ta);

  // Reference sliders: Style Influence, Weirdness, Audio Influence. (No Variety.) Never sent anywhere.
  const slider = (label, key, gated) => {
    const input = h('input', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': label });
    const val = h('button', { class: 'sl-val', title: 'Click to set 50' });
    const clear = h('button', { class: 'btn small ghost', 'aria-label': `Clear ${label}`, onclick: () => { su[key] = null; touch(); sync(); } }, 'Clear');
    const rowEl = h('div', { class: 'sl-row' }, h('span', { class: 'sl-label' }, label), h('div', { class: 'notched' }, input), val, clear);
    const sync = () => {
      const v = su[key];
      val.textContent = v == null ? 'not set' : v + '%';
      input.value = v ?? 50;
      input.style.setProperty('--p', (v ?? 50) + '%');
      clear.hidden = v == null;
      rowEl.classList.toggle('unset', v == null);
      const off = !!(gated && !su.audioUploaded);
      rowEl.classList.toggle('off', off);
      input.disabled = off; val.disabled = off;
    };
    input.addEventListener('input', () => { su[key] = parseInt(input.value, 10); touch(); sync(); });
    val.addEventListener('click', () => { if (su[key] == null) { su[key] = 50; touch(); sync(); } });
    rowEl.sync = sync;
    sync();
    return rowEl;
  };
  const sWeird = slider('Weirdness', 'weirdness');
  const sStyle = slider('Style Influence', 'styleInfluence');
  const sAudio = slider('Audio Influence', 'audioInfluence', true);
  const audioBox = h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: su.audioUploaded, onchange: (e) => { su.audioUploaded = e.target.checked; touch(); sAudio.sync(); } }),
    'Audio uploaded (turns on Audio Influence)');

  // Tagged lyrics preview + copy
  const lyricsCount = counter(LIMITS.lyrics);
  const preview = h('textarea', { class: 'suno-ta mono', readOnly: true, rows: 8, 'aria-label': 'Tagged lyrics preview' });
  const refresh = () => { const t = taggedLyrics(song); preview.value = t; lyricsCount.set(t.length); autosize(preview); };
  lyricsCount.set(taggedLyrics(song).length);
  const details = h('details', { class: 'preview' }, h('summary', {}, 'Preview tagged lyrics'), preview);
  details.addEventListener('toggle', () => { if (details.open) refresh(); });

  const warnings = (text) => {
    const bad = instrumentTagsIn(song);
    if (bad.length) toast(instrumentWarning(bad[0]), { ms: 9000 });
    if (text.length > LIMITS.lyrics) toast(`Over Suno's ${fmtCount(LIMITS.lyrics)}-character lyrics limit by ${fmtCount(text.length - LIMITS.lyrics)}.`, { ms: 9000 });
  };
  const copyTagged = h('button', {
    class: 'btn small primary', title: 'Copy lyrics with section tags',
    onclick: async () => {
      const t = taggedLyrics(song);
      if (!t) { toast('No lyrics to copy yet.', { ms: 2500 }); return; }
      if (await copyText(t, 'Tagged lyrics copied')) warnings(t);
    },
  }, 'Copy tagged lyrics');
  const copyClean = h('button', {
    class: 'btn small', title: 'Copy lyrics with no chords or tags',
    onclick: () => { const t = cleanLyrics(song); if (!t) { toast('No lyrics to copy yet.', { ms: 2500 }); return; } copyText(t, 'Clean lyrics copied'); },
  }, 'Copy clean lyrics');

  const panel = h('section', { class: 'suno-panel' },
    h('h3', {}, 'Suno'),
    voiceRow,
    row(h('label', {}, 'Style ', styleCount.el), styleTA, syncBtn, copyField('Style', styleTA, 'the style block')),
    row(h('label', {}, 'Exclude styles'), excludeTA, copyField('Exclude', excludeTA, 'the exclude list')),
    h('div', { class: 'field' },
      h('label', {}, 'Reference sliders'),
      h('div', { class: 'sliders' }, sWeird, sStyle, sAudio, audioBox),
      h('div', { class: 'hint' }, 'Just a reminder of your intended values while you enter the song in Suno. Nothing is sent anywhere.')),
    h('div', { class: 'field' },
      row(h('label', {}, 'Lyrics for Suno ', lyricsCount.el), details, copyClean, copyTagged),
      h('div', { class: 'hint' }, 'Chord brackets are removed. Section tags come from each section’s Suno line on the Lyrics tab.')));
  requestAnimationFrame(() => { autosize(styleTA); autosize(excludeTA); });
  return panel;
}

function openVoicesDialog(onChange) {
  const voices = loadVoices();
  const dlg = h('dialog', { class: 'dlg wide' });
  const commit = () => { saveVoices(voices); onChange?.(); render(); };
  function render() {
    const input = h('input', { placeholder: 'Add a voice name', 'aria-label': 'New voice', autocomplete: 'off' });
    const add = () => { const v = input.value.trim(); if (v && !voices.includes(v)) { voices.push(v); commit(); } else input.value = ''; };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    dlg.replaceChildren(
      h('h3', { style: 'margin-top:0' }, 'Voices'),
      h('p', { class: 'muted small' }, 'Your Suno voices. Each song stores the name you pick. Removing a voice here does not change songs that already use it.'),
      h('div', { class: 'chips' }, voices.map((v) => h('span', { class: 'chip static' }, v,
        h('button', { class: 'x', 'aria-label': `Remove ${v}`, onclick: () => { voices.splice(voices.indexOf(v), 1); commit(); } }, '×')))),
      h('div', { class: 'add-tag' }, input, h('button', { class: 'btn', onclick: add }, 'Add')),
      h('div', { class: 'dlg-actions' }, h('button', { class: 'btn primary', onclick: () => dlg.close() }, 'Done')));
  }
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  render();
  dlg.showModal();
}
