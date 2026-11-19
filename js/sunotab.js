// Suno panel (Notes & Suno tab): style, exclude, reference sliders, tagged lyrics, tag defaults dialog.
import { h, toast, autosize, copyText, confirmDialog } from './dom.js';
import { SECTION_TYPES } from './model.js';
import { taggedLyrics, cleanLyrics, syncStyle, oneLine, saveSettings, DEFAULT_SETTINGS, cleanTag } from './suno.js';

function copyField(label, ta, what) {
  return h('button', {
    class: 'btn small', title: `Copy ${what}`,
    onclick: () => { const v = oneLine(ta.value); if (!v) { toast(`${label} is empty.`, { ms: 2500 }); return; } copyText(v, `${label} copied`); },
  }, 'Copy');
}

export function buildSunoPanel(song, { touch, settings }) {
  const su = song.suno;

  const styleTA = h('textarea', {
    class: 'suno-ta', value: su.style, rows: 2, 'aria-label': 'Suno style block',
    placeholder: 'genre, key, BPM, vocal, arrangement, dynamics',
    oninput: (e) => { su.style = e.target.value; autosize(e.target); touch(); },
  });
  const syncBtn = h('button', {
    class: 'btn small', title: 'Put this song’s key and BPM into the style line',
    onclick: () => {
      if (!song.key && !song.bpm) { toast('Set a key or BPM first.', { ms: 2500 }); return; }
      su.style = syncStyle(su.style, song, { insert: true });
      styleTA.value = su.style; autosize(styleTA); touch();
    },
  }, 'Sync key/BPM');

  const excludeTA = h('textarea', {
    class: 'suno-ta', value: su.exclude, rows: 2, 'aria-label': 'Suno exclude styles',
    placeholder: 'pop production, EDM, autotune, …',
    oninput: (e) => { su.exclude = e.target.value; autosize(e.target); touch(); },
  });

  const row = (label, ta, ...btns) => h('div', { class: 'field' },
    h('div', { class: 'field-head' }, h('label', {}, label), h('div', { class: 'field-btns' }, ...btns)), ta);

  // Reference sliders (never sent anywhere).
  const slider = (label, key, gated) => {
    const input = h('input', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': label });
    const val = h('button', { class: 'sl-val', title: 'Click to set 50' });
    const clear = h('button', { class: 'btn small ghost', 'aria-label': `Clear ${label}`, onclick: () => { su[key] = null; touch(); sync(); } }, 'Clear');
    const rowEl = h('div', { class: 'sl-row' }, h('span', { class: 'sl-label' }, label), input, val, clear);
    const sync = () => {
      const v = su[key];
      val.textContent = v == null ? 'not set' : v + '%';
      input.value = v ?? 50;
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
  const sStyle = slider('Style Influence', 'styleInfluence');
  const sWeird = slider('Weirdness', 'weirdness');
  const sAudio = slider('Audio Influence', 'audioInfluence', true);
  const audioBox = h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: su.audioUploaded, onchange: (e) => { su.audioUploaded = e.target.checked; touch(); sAudio.sync(); } }),
    'Audio uploaded (turns on Audio Influence)');

  // Tagged lyrics preview + copy.
  const preview = h('textarea', { class: 'suno-ta mono', readOnly: true, rows: 8, 'aria-label': 'Tagged lyrics preview' });
  const refresh = () => { preview.value = taggedLyrics(song, settings); autosize(preview); };
  const details = h('details', { class: 'preview' }, h('summary', {}, 'Preview tagged lyrics'), preview);
  details.addEventListener('toggle', () => { if (details.open) refresh(); });
  const copyTagged = h('button', {
    class: 'btn small primary', title: 'Copy lyrics with section tags',
    onclick: () => { const t = taggedLyrics(song, settings); if (!t) { toast('No lyrics to copy yet.', { ms: 2500 }); return; } copyText(t, 'Tagged lyrics copied'); },
  }, 'Copy tagged lyrics');
  const copyClean = h('button', {
    class: 'btn small', title: 'Copy lyrics with no chords or tags',
    onclick: () => { const t = cleanLyrics(song); if (!t) { toast('No lyrics to copy yet.', { ms: 2500 }); return; } copyText(t, 'Clean lyrics copied'); },
  }, 'Copy clean lyrics');
  const defaultsBtn = h('button', { class: 'btn small', onclick: () => openDefaultsDialog(settings, () => { if (details.open) refresh(); }) }, 'Tag defaults…');

  const panel = h('section', { class: 'suno-panel' },
    h('h3', {}, 'Suno'),
    row('Style', styleTA, syncBtn, copyField('Style', styleTA, 'the style block')),
    row('Exclude styles', excludeTA, copyField('Exclude', excludeTA, 'the exclude list')),
    h('div', { class: 'field' },
      h('label', {}, 'Reference sliders'),
      h('div', { class: 'sliders' }, sStyle, sWeird, sAudio, audioBox),
      h('div', { class: 'hint' }, 'Just a reminder of your intended values while you enter the song in Suno. Nothing is sent anywhere.')),
    h('div', { class: 'field' },
      h('div', { class: 'field-head' }, h('label', {}, 'Lyrics for Suno'), h('div', { class: 'field-btns' }, defaultsBtn, copyClean, copyTagged)),
      details,
      h('div', { class: 'hint' }, 'Chord brackets are removed. Section tags come from each section’s Tags button.')));
  requestAnimationFrame(() => { autosize(styleTA); autosize(excludeTA); });
  return panel;
}

export function openDefaultsDialog(settings, onChange) {
  const dlg = h('dialog', { class: 'dlg wide' });
  const commit = () => { saveSettings(settings); onChange?.(); render(); };

  function render() {
    dlg.replaceChildren(
      h('h3', { style: 'margin-top:0' }, 'Suno tag defaults'),
      h('p', { class: 'muted small' }, 'These tags go under each section header unless you override them on that section. Sections with no defaults get a header only.'),
      ...SECTION_TYPES.filter((t) => t !== 'Other').map((type) => {
        const on = settings.defaults[type] || [];
        return h('div', { class: 'def-row' },
          h('div', { class: 'def-type' }, type),
          h('div', { class: 'chips' }, settings.glossary.map((tag) => h('button', {
            class: 'chip', 'aria-pressed': String(on.includes(tag)),
            onclick: () => {
              const next = on.includes(tag) ? on.filter((x) => x !== tag) : [...on, tag];
              if (next.length) settings.defaults[type] = next; else delete settings.defaults[type];
              commit();
            },
          }, tag))));
      }),
      h('h4', {}, 'Your tag glossary'),
      h('div', { class: 'chips' }, settings.glossary.map((tag) => h('span', { class: 'chip static' }, tag,
        h('button', {
          class: 'x', 'aria-label': `Remove ${tag}`,
          onclick: () => {
            settings.glossary = settings.glossary.filter((x) => x !== tag);
            for (const k of Object.keys(settings.defaults)) { settings.defaults[k] = settings.defaults[k].filter((x) => x !== tag); if (!settings.defaults[k].length) delete settings.defaults[k]; }
            commit();
          },
        }, '×')))),
      (() => {
        const input = h('input', { placeholder: 'Add a tag, e.g. whisper', 'aria-label': 'New glossary tag', autocomplete: 'off' });
        const add = () => { const t = cleanTag(input.value); if (t && !settings.glossary.includes(t)) { settings.glossary.push(t); commit(); } else input.value = ''; };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
        return h('div', { class: 'add-tag' }, input, h('button', { class: 'btn', onclick: add }, 'Add'));
      })(),
      h('div', { class: 'dlg-actions' },
        h('button', {
          class: 'btn ghost',
          onclick: async () => {
            if (!(await confirmDialog('Reset the glossary and section defaults to the built-in set? Your own tags will be removed from the glossary.', 'Reset'))) return;
            const fresh = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
            settings.glossary = fresh.glossary; settings.defaults = fresh.defaults;
            commit();
          },
        }, 'Reset to built-in'),
        h('button', { class: 'btn primary', onclick: () => dlg.close() }, 'Done')));
  }
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  render();
  dlg.showModal();
}
