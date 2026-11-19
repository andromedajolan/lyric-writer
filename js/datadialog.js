// "Import / Export" dialog: paste or open text files, export clean lyrics, JSON backup and restore.
import { h, toast, copyText, confirmDialog, fmtTime } from './dom.js';
import { parseImport, splitSongs, describeImport, lyricsText, allLyricsText, safeFileName, buildBackup, parseBackup, planMerge } from './portable.js';
import { loadVoices, saveVoices } from './suno.js';

const LAST_BACKUP_KEY = 'lyricwriter.lastBackup';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name, style: 'display:none' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const readFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(file); });

export function showDataDialog(ctx) {
  const dlg = h('dialog', { class: 'dlg wide data-dlg' });
  const close = () => dlg.close();
  const song = ctx.current();
  const live = () => ctx.getSongs().filter((s) => !s.deleted);

  /* import */
  const paste = h('textarea', { class: 'imp-text', rows: 7, placeholder: 'Paste lyrics here.\n\nTitle: My Song\nKey: C Minor\nBPM: 100\n\n[Verse 1]\n…', 'aria-label': 'Lyrics to import' });
  const preview = h('div', { class: 'muted small imp-prev', 'aria-live': 'polite' }, 'Paste text, or choose a .txt file. Headers like Key: and BPM: are read automatically.');
  const parsed = () => splitSongs(paste.value).map((t) => parseImport(t));
  paste.addEventListener('input', () => {
    const ps = paste.value.trim() ? parsed() : [];
    preview.replaceChildren(...(ps.length ? ps.flatMap((p, i) => [
      h('div', {}, (ps.length > 1 ? `Song ${i + 1}: ` : 'Will create: ') + describeImport(p.song)),
      ...p.warnings.map((w) => h('div', { class: 'tag-warn' }, w))]) : ['Paste text, or choose a .txt file. Headers like Key: and BPM: are read automatically.']));
    importBtn.disabled = !ps.length;
  });
  const fileIn = h('input', { type: 'file', accept: '.txt,.md,text/plain', multiple: true, style: 'display:none' });
  fileIn.addEventListener('change', async () => {
    const texts = [];
    for (const f of fileIn.files) { try { texts.push(await readFile(f)); } catch { toast('Could not read ' + f.name); } }
    if (texts.length) { paste.value = texts.join('\n=====\n'); paste.dispatchEvent(new Event('input')); }
    fileIn.value = '';
  });
  const importBtn = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
    const ps = parsed();
    if (!ps.length) return;
    await ctx.addSongs(ps.map((p) => p.song));
    toast(`Imported ${ps.length} song${ps.length === 1 ? '' : 's'}`, { ms: 3000 });
    close();
  } }, 'Import');

  /* export */
  const optHeaders = h('input', { type: 'checkbox', id: 'opt-headers' });
  const optTitle = h('input', { type: 'checkbox', id: 'opt-title' });
  const opts = () => ({ headers: optHeaders.checked, title: optTitle.checked });
  const exportRow = song
    ? h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => copyText(lyricsText(song, opts()), 'Lyrics copied') }, 'Copy lyrics'),
      h('button', { class: 'btn', onclick: () => download(safeFileName(song.title, 'txt'), lyricsText(song, opts()), 'text/plain') }, 'Download .txt'))
    : h('div', { class: 'muted small' }, 'Open a song to export it.');
  const allBtn = h('button', { class: 'btn', disabled: !live().length, onclick: () => download('Lyric Writer - all lyrics.txt', allLyricsText(live(), opts()), 'text/plain') }, `All ${live().length} songs (.txt)`);

  /* backup */
  const last = lsGet(LAST_BACKUP_KEY);
  const backupBtn = h('button', { class: 'btn primary', onclick: () => {
    const all = ctx.getSongs();
    const stamp = new Date().toISOString().slice(0, 10);
    download(`lyric-writer-backup-${stamp}.json`, JSON.stringify(buildBackup(all, { voices: loadVoices(), appVersion: ctx.appVersion }), null, 1), 'application/json');
    try { localStorage.setItem(LAST_BACKUP_KEY, String(Date.now())); } catch { /* ignore */ }
    lastLine.textContent = 'Last backup: just now';
    toast(`Backup saved (${all.length} song${all.length === 1 ? '' : 's'}, trash included)`, { ms: 3000 });
  } }, 'Download backup');
  const lastLine = h('div', { class: 'muted small' }, last ? 'Last backup: ' + fmtTime(+last) : 'No backup made from this device yet.');
  const restoreIn = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  restoreIn.addEventListener('change', async () => {
    const f = restoreIn.files[0]; restoreIn.value = '';
    if (!f) return;
    try {
      const { songs, voices } = parseBackup(await readFile(f));
      const plan = planMerge(new Map(ctx.getSongs().map((s) => [s.id, s])), songs);
      if (!plan.add.length && !plan.replace.length) { toast('Nothing to restore: everything in that file is already here (or newer here).'); return; }
      const msg = `Restore from ${f.name}? ${plan.add.length} new song${plan.add.length === 1 ? '' : 's'}, ${plan.replace.length} older song${plan.replace.length === 1 ? '' : 's'} here will be updated to the file’s newer version (the old one is kept in History), ${plan.same.length} unchanged. Nothing is deleted.`;
      if (!(await confirmDialog(msg, 'Restore'))) return;
      await ctx.applyMerge(plan);
      if (voices.length) saveVoices([...new Set([...loadVoices(), ...voices])]);
      toast(`Restored ${plan.add.length + plan.replace.length} song${plan.add.length + plan.replace.length === 1 ? '' : 's'}`, { ms: 4000 });
      close();
    } catch (e) { toast(e.message || 'Could not read that file.', { ms: 8000 }); }
  });

  dlg.append(
    h('h3', { style: 'margin-top:0' }, 'Import / Export'),
    h('section', {}, h('h4', {}, 'Import lyrics'), paste, preview,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Choose file…'), importBtn), fileIn),
    h('section', {}, h('h4', {}, 'Export lyrics (clean, no chords or Suno tags)'),
      h('label', { class: 'chk' }, optHeaders, ' Include section names'),
      h('label', { class: 'chk' }, optTitle, ' Include title'),
      h('div', { class: 'row' }, exportRow, allBtn)),
    h('section', {}, h('h4', {}, 'Backup'),
      h('div', { class: 'muted small' }, 'One JSON file with every song (and trash), notes, Suno settings and your voice list. Keep a copy somewhere other than this Chromebook.'),
      h('div', { class: 'row' }, backupBtn, h('button', { class: 'btn', onclick: () => restoreIn.click() }, 'Restore from file…'), restoreIn), lastLine),
    h('div', { class: 'dlg-actions' }, h('button', { class: 'btn', onclick: close }, 'Close')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
