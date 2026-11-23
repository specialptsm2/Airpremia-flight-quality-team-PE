/*
  Procedural Error Checklist (PE-26) — 오프라인 저장용 서비스 워커
  - 처음 온라인으로 열 때 체크리스트를 iPad에 저장해 두고, 그다음부터는 저장본을 바로 엽니다.
    (인터넷이 없어도 북마크·홈 화면 아이콘으로 열림)
  - 인터넷이 되면 뒤에서 새 버전이 있는지 확인하고, 있으면 저장본을 바꾼 뒤
    화면에 "새 버전을 받았습니다 · 지금 적용" 안내를 띄웁니다. 작성 중인 내용은 지워지지 않습니다.
  - 체크리스트를 열어 둔 채로 있어도, 앱으로 돌아오거나 인터넷이 다시 연결되면 새 버전을 확인합니다.
  - index.html 과 같은 폴더에 두십시오.
*/
const SW_VER = '2026.11.15-1';   // sw.js 를 고칠 때마다 이 값도 바꿈 (화면 아래에 표시)
const CACHE = 'pe-checklist-v1';
const PAGE = './index.html';
const ASSETS = [PAGE, './manifest.json', './app-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('pe-checklist') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const buildOf = html => { const m = /name="pe-build" content="([^"]+)"/.exec(html || ''); return m ? m[1] : ''; };

// 뒤에서 새 버전 확인 → 바뀌었으면 저장본 교체 + 화면에 알림
async function refreshPage() {
  try {
    const res = await fetch(new Request(PAGE, { cache: 'no-store' }));
    if (!res.ok) return;
    const c = await caches.open(CACHE);
    const old = await c.match(PAGE);
    const [nt, ot] = await Promise.all([res.clone().text(), old ? old.text() : '']);
    if (nt === ot) return;
    await c.put(PAGE, res);
    if (old && buildOf(nt) !== buildOf(ot)) {
      const list = await self.clients.matchAll({ type: 'window' });
      list.forEach(cl => cl.postMessage({ type: 'PE_UPDATED', build: buildOf(nt) }));
    }
  } catch (_) { /* 오프라인 — 저장본 그대로 사용 */ }
}

// 화면이 이미 열려 있을 때 : 앱으로 돌아오거나 인터넷이 다시 연결되면 화면이 확인을 요청
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CHECK_UPDATE') e.waitUntil(refreshPage());
  if (e.data && e.data.type === 'GET_VERSION' && e.ports[0]) e.ports[0].postMessage({ sw: SW_VER });
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;

  const isPage = req.mode === 'navigate' || url.pathname === scope.pathname || url.pathname.endsWith('/index.html');
  if (isPage) {
    e.respondWith((async () => {
      const hit = await caches.match(PAGE);
      if (hit) { e.waitUntil(refreshPage()); return hit; }
      const res = await fetch(req);
      if (res.ok) { const c = await caches.open(CACHE); c.put(PAGE, res.clone()); }
      return res;
    })());
    return;
  }
  // 아이콘·manifest : 저장본 우선, 없으면 받아서 저장
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
    return res;
  })));
});
