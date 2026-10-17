// Pengelola tab sumber. Berjalan di halaman Workspace (halaman ekstensi boleh memakai chrome.tabs).
// Aturan: tidak pernah menutup tab, tidak mengubah tab yang bukan sumber, tidak membuka tab ganda.
// Identitas tab hanya berlaku selama sesi (id tab tidak dipercaya setelah browser dimulai ulang):
// saat start() dan setiap ada perubahan tab, keadaan dihitung ulang dari tab yang benar-benar ada.
import { matchKey, parseHttpUrl } from './url-utils.js';

export class SourceError extends Error {
  constructor(message, code) { super(message); this.name = 'SourceError'; this.code = code; }
}

export function createTabManager({ getSources, onOpenChange, onTitle, ensureReadPermission }) {
  const assoc = new Map();     // tabId -> { sourceId, keys:Set<string>, settled, blobUrl? } (tab yang kita buka)
  const inflight = new Map();  // sourceId -> Promise (mencegah klik ganda membuka dua tab)
  let openMap = new Map();     // sourceId -> tabId
  let timer = null;

  const tabKey = (tab) => { const u = tab.url || tab.pendingUrl; return u ? matchKey(u) : null; };

  function dropAssoc(tabId) {
    const a = assoc.get(tabId);
    if (a && a.blobUrl) URL.revokeObjectURL(a.blobUrl);
    assoc.delete(tabId);
  }

  async function refresh() {
    const tabs = await chrome.tabs.query({});
    const byId = new Map(tabs.map((t) => [t.id, t]));
    const byKey = new Map();
    for (const t of tabs) { const k = tabKey(t); if (k && !byKey.has(k)) byKey.set(k, t); }

    const next = new Map();
    for (const [tabId, a] of [...assoc]) {
      const t = byId.get(tabId);
      if (!t) { dropAssoc(tabId); continue; }
      const k = tabKey(t);
      if (!a.settled && t.status === 'complete' && k) { a.keys.add(k); a.settled = true; } // mengakomodasi redirect
      if (a.settled && !a.keys.has(k)) { dropAssoc(tabId); continue; }                      // pengguna menavigasi ke tempat lain
      next.set(a.sourceId, tabId);
    }
    for (const s of getSources()) {
      if (next.has(s.id) || !s.key) continue;
      const t = byKey.get(s.key);
      if (t) next.set(s.id, t.id);
    }
    for (const [sourceId, tabId] of next) {
      const t = byId.get(tabId);
      if (t && t.status === 'complete' && t.title && onTitle) onTitle(sourceId, t.title);
    }
    const same = next.size === openMap.size && [...next].every(([k, v]) => openMap.get(k) === v);
    openMap = next;
    if (!same && onOpenChange) onOpenChange(new Map(openMap));
  }

  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => refresh().catch((e) => console.warn('refresh tab gagal', e)), 120); };

  async function activate(tabId) {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab && tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
  }

  async function activateExisting(src) {
    await refresh();
    const id = openMap.get(src.id);
    if (id == null) return false;
    try { await activate(id); return true; } catch { await refresh(); return false; } // tab sudah hilang
  }

  async function openRemote(src) {
    const p = parseHttpUrl(src.url);
    if (!p.ok) throw new SourceError(p.reason, 'invalid-url');
    if (await activateExisting(src)) return { action: 'activated' };
    let tab;
    try { tab = await chrome.tabs.create({ url: p.url, active: true }); }
    catch (e) { throw new SourceError('Gagal membuka tab: ' + e.message, 'tab-failed'); }
    assoc.set(tab.id, { sourceId: src.id, keys: new Set([p.key]), settled: false });
    await refresh();
    return { action: 'opened' };
  }

  async function openLocal(src) {
    if (await activateExisting(src)) return { action: 'activated' };
    const h = src.handle;
    if (!h) throw new SourceError('Referensi file hilang. Pilih file itu lagi (tombol ↻).', 'not-found');
    let granted;
    try {
      if (ensureReadPermission) granted = await ensureReadPermission(src);
      else {
        let perm = await h.queryPermission({ mode: 'read' });
        if (perm !== 'granted') perm = await h.requestPermission({ mode: 'read' });
        granted = perm === 'granted';
      }
    } catch { throw new SourceError('File tidak ditemukan atau dipindahkan.', 'not-found'); }
    if (!granted) throw new SourceError('Izin membaca file ditolak.', 'permission');
    let file;
    try { file = await h.getFile(); } catch { throw new SourceError('File tidak ditemukan atau dipindahkan.', 'not-found'); }
    if ((await file.slice(0, 5).text()) !== '%PDF-') throw new SourceError('File ini bukan PDF yang valid.', 'not-pdf');
    const blobUrl = URL.createObjectURL(file.slice(0, file.size, 'application/pdf'));
    let tab;
    try { tab = await chrome.tabs.create({ url: blobUrl, active: true }); }
    catch (e) { URL.revokeObjectURL(blobUrl); throw new SourceError('Edge menolak membuka PDF lokal: ' + e.message, 'tab-failed'); }
    assoc.set(tab.id, { sourceId: src.id, keys: new Set([matchKey(blobUrl)]), settled: false, blobUrl });
    await refresh();
    return { action: 'opened' };
  }

  function openSource(src) {
    if (inflight.has(src.id)) return inflight.get(src.id);
    const p = (src.kind === 'pdf-local' ? openLocal(src) : openRemote(src)).finally(() => inflight.delete(src.id));
    inflight.set(src.id, p);
    return p;
  }

  return {
    async start() {
      chrome.tabs.onCreated.addListener(schedule);
      chrome.tabs.onRemoved.addListener((id) => { dropAssoc(id); schedule(); });
      chrome.tabs.onUpdated.addListener((id, change) => { if (change.url || change.status || change.title) schedule(); });
      chrome.tabs.onReplaced.addListener((added, removed) => {
        const a = assoc.get(removed);
        if (a) { assoc.delete(removed); assoc.set(added, a); }
        schedule();
      });
      await refresh();
    },
    refresh, openSource,
    isOpen: (sourceId) => openMap.has(sourceId)
  };
}
