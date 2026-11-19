// IndexedDB storage. Everything this app owns is prefixed "lyricwriter" (DB, localStorage keys, cache) so it cannot collide with the DAW or other apps on this origin.
const DB_NAME = 'lyricwriter-db';
const DB_VERSION = 1;
const HISTORY_KEEP = 25;

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('history')) {
        const h = db.createObjectStore('history', { keyPath: 'hid', autoIncrement: true });
        h.createIndex('songId', 'songId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database upgrade blocked by another tab'));
  });
  return dbp;
}

function tx(stores, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    result = fn(t);
  }));
}

const wrap = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

export async function allSongs() {
  const db = await open();
  return wrap(db.transaction('songs').objectStore('songs').getAll());
}

export function putSong(song) {
  return tx('songs', 'readwrite', (t) => { t.objectStore('songs').put(song); });
}

export function putSongs(songs) {
  return tx('songs', 'readwrite', (t) => { for (const s of songs) t.objectStore('songs').put(s); });
}

export function deleteSong(id) {
  return tx(['songs', 'history'], 'readwrite', (t) => {
    t.objectStore('songs').delete(id);
    const idx = t.objectStore('history').index('songId');
    const cur = idx.openKeyCursor(IDBKeyRange.only(id));
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { t.objectStore('history').delete(c.primaryKey); c.continue(); }
    };
  });
}

export async function addSnapshot(song) {
  const snap = { songId: song.id, at: Date.now(), song: JSON.parse(JSON.stringify(song)) };
  await tx('history', 'readwrite', (t) => {
    const store = t.objectStore('history');
    store.add(snap);
    // Trim old snapshots for this song.
    const keys = [];
    const cur = store.index('songId').openKeyCursor(IDBKeyRange.only(song.id));
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { keys.push(c.primaryKey); c.continue(); }
      else if (keys.length > HISTORY_KEEP) {
        keys.sort((a, b) => a - b).slice(0, keys.length - HISTORY_KEEP).forEach((k) => store.delete(k));
      }
    };
  });
}

export async function listSnapshots(songId) {
  const db = await open();
  const rows = await wrap(db.transaction('history').objectStore('history').index('songId').getAll(IDBKeyRange.only(songId)));
  return rows.sort((a, b) => b.at - a.at);
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}
