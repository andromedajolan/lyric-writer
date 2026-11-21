// Offline cache. Bump VERSION on every release (must match APP_VERSION in js/app.js).
const VERSION = '0.5.1';
const CACHE = 'lyricwriter-cache-' + VERSION + '-r5';
const ASSETS = [
'./',
'index.html',
'manifest.webmanifest',
'css/app.css',
'js/app.js',
'js/model.js',
'js/db.js',
'js/dom.js',
'js/chords.js',
'js/suno.js',
'js/chart.js',
'js/sunotab.js',
'js/rhyme.js',
'js/rhymepanel.js',
'js/countview.js',
'js/portable.js',
'js/datadialog.js',
'data/cmudict.txt.gz',
'licenses/CMUdict-LICENSE.txt',
'licenses/SCOWL-Copyright.txt',
'icons/icon-192.png',
'icons/icon-512.png',
'icons/icon-maskable-512.png',
'icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
e.waitUntil(
caches.keys()
.then((keys) => Promise.all(keys.filter((k) => k.startsWith('lyricwriter-cache-') && k !== CACHE).map((k) => caches.delete(k))))
.then(() => self.clients.claim()),
);
});

self.addEventListener('fetch', (e) => {
const req = e.request;
if (req.method !== 'GET') return;
const url = new URL(req.url);
if (url.origin !== location.origin) return;
e.respondWith(
caches.match(req, { ignoreSearch: true }).then((hit) => {
if (hit) return hit;
return fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
}),
);
});
