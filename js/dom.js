// Tiny DOM helpers. Everything is built with textContent/value, never innerHTML, so lyrics can't inject markup.

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list' && k !== 'type') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function toast(message, { action, onAction, ms = 6000, sticky = false } = {}) {
  const host = $('#toasts');
  const el = h('div', { class: 'toast', role: 'status' }, h('span', {}, message));
  const close = () => el.remove();
  if (action) {
    el.append(h('button', { class: 'btn small', onclick: () => { close(); onAction?.(); } }, action));
  }
  if (sticky) el.append(h('button', { class: 'btn small ghost', 'aria-label': 'Dismiss', onclick: close }, '✕'));
  host.append(el);
  if (!sticky) setTimeout(close, ms);
  return close;
}

export function confirmDialog(message, okLabel = 'OK') {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dlg' },
      h('p', {}, message),
      h('div', { class: 'dlg-actions' },
        h('button', { class: 'btn', onclick: () => dlg.close('no') }, 'Cancel'),
        h('button', { class: 'btn danger', onclick: () => dlg.close('yes') }, okLabel)));
    dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'yes'); dlg.remove(); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(ta.scrollHeight + 2, 64) + 'px';
}

export function fmtTime(ms) {
  const d = new Date(ms);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
