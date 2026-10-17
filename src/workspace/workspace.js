import { createEditor } from './editor.js';
import { countWords } from './blocks.js';
import { putDoc, getDoc, getAllDocs, deleteDoc, createDoc, loadPrefs, savePrefs, DEFAULT_PREFS, putSnapshot, getSnapshots, deleteSnapshots } from './storage.js';
import { makeSnapshot, shouldAutoSnapshot, pruneIds } from './snapshots.js';
import { evaluateDisk } from './disk-sync.js';
import { showHistory } from './history-ui.js';
import { createSourcePanel } from './source-panel.js';
import { pickSources } from './reference-ui.js';
import { pickActive } from './outline.js';
import { citeLabel, citeTip, buildBibliography, citationCounts } from './citations.js';
import { openFile, writeToHandle, saveAs, safeFileName, hasFsAccess, ensureWritePermission, hashText } from './file-io.js';
import { saveDocument } from './save-flow.js';

const $ = (id) => document.getElementById(id);
const el = {
  panel: $('panel'), resizer: $('resizer'), area: $('editor-area'), canvas: $('canvas'), source: $('source'),
  title: $('doc-title'), list: $('doc-list'), search: $('doc-search'),
  statusFile: $('status-file'), statusDraft: $('status-draft'),
  statusMode: $('status-mode'), statusBlocks: $('status-blocks'), statusCounts: $('status-counts'),
  toast: $('toast'), toastText: $('toast-text'), toastAction: $('toast-action'),
  help: $('help'), btnSource: $('btn-source')
};

const sources = createSourcePanel({
  listEl: $('src-list'), urlInput: $('src-url'), addUrlBtn: $('src-add-url'), addPdfBtn: $('src-add-pdf'), addFolderBtn: $('src-add-folder'), rescanBtn: $('src-rescan'), extractAllBtn: $('src-extract-all'),
  foldersEl: $('src-folders'), progressEl: $('src-progress'), progressTextEl: $('src-progress-text'), cancelBtn: $('src-cancel'),
  noteEl: $('src-note'), notify: showToast,
  onChange: () => { clearTimeout(rerenderTimer); rerenderTimer = setTimeout(() => editor.rerender(), 100); },
  onInsertCite: (src) => insertCitation([src], '')
});
let rerenderTimer = null;

const WELCOME = `# Selamat datang di ResearchWriter

Dokumen ini dirender langsung: **klik blok mana saja** untuk melihat dan menyunting teks Markdown-nya, lalu tekan Esc atau klik di luar untuk kembali ke tampilan render.

Satu blok boleh berisi beberapa elemen, misalnya daftar di bawah ini:

- Daftar biasa
  - Daftar bersarang
- [x] Checklist selesai
- [ ] Checklist belum

> Kutipan: tulisan ilmiah yang rapi dimulai dari catatan yang rapi.

| Senyawa | Rumus | Mr |
|:--|:-:|--:|
| Air | H2O | 18,015 |
| Etanol | C2H6O | 46,07 |

Teks **tebal**, *miring*, ~~coret~~, \`kode\`, [tautan](https://example.com), dan https://example.org otomatis menjadi tautan.

\`\`\`python
print("Halo, dunia")
\`\`\`

Tekan Enter dua kali di akhir blok untuk membuat blok baru. Tombol **Sumber** di bilah atas menampilkan seluruh dokumen sebagai teks.
`;

let prefs = { ...DEFAULT_PREFS };
let doc = null;
let allDocs = [];
let draftState = 'saved';       // 'saved' | 'pending' | 'saving' | 'error'
let draftError = '';
let saveTimer = null, countTimer = null, toastTimer = null, saving = Promise.resolve();

/* ---------- Editor ---------- */
const editor = createEditor({
  container: el.area, root: el.canvas, sourceArea: el.source,
  onChange(content) {
    if (!doc) return;
    doc.content = content; doc.updatedAt = Date.now();
    scheduleSave(); renderStatus(); scheduleCounts();
  },
  onState({ mode, blocks }) {
    el.statusMode.textContent = mode === 'edit' ? 'SUNTING BLOK' : mode === 'source' ? 'SUMBER' : 'TAMPILAN';
    el.statusBlocks.textContent = mode === 'source' ? '' : `${blocks} blok`;
    el.btnSource.setAttribute('aria-pressed', String(mode === 'source'));
  },
  notify: showToast,
  onScroll: () => { updateActiveHeading(); scheduleViewSave(); },
  cite: (key) => { const s = sources.getByKey(key); return s ? { label: citeLabel(s), tip: citeTip(s) } : null; },
  onCite: (key) => sources.openByKey(key),
  onLink: (href) => { if (sources.hasUrl(href)) { sources.openByUrl(href); return true; } return false; },
  // Saran saat mengetik "[@": cari di kunci, judul, penulis, tahun dari sumber yang sudah ada/diimpor
  suggest: (q) => {
    const ql = q.toLowerCase();
    return sources.list()
      .filter((s) => !ql || [s.citeKey, s.title, (s.authors || []).join(' '), s.year].join(' ').toLowerCase().includes(ql))
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 6)
      .map((s) => ({ id: s.id, label: citeLabel(s), title: s.title }));
  },
  acceptSuggestion: (item) => { const s = sources.list().find((x) => x.id === item.id); return s ? sources.ensureCitable(s) : null; }
});

/* ---------- Sitasi ---------- */
async function insertCitation(chosen, locator) {
  const offset = editor.getCaretOffset();
  if (offset === null) { showToast('Klik di dalam blok tempat sitasi akan disisipkan dulu, lalu ulangi.'); return; }
  try {
    const keys = [];
    for (const s of chosen) keys.push(await sources.ensureCitable(s));
    editor.insertAt(offset, `[@${keys.join('; @')}${locator ? ', ' + locator : ''}]`);
  } catch (e) { showToast('Gagal menyisipkan sitasi: ' + e.message); }
}
async function startCitePicker() {
  const offset = editor.getCaretOffset();
  if (offset === null) { showToast('Klik di dalam blok tempat sitasi akan disisipkan dulu, lalu ulangi.'); return; }
  const picked = await pickSources(sources.list());
  if (!picked) { editor.focusAt(offset); return; } // dibatalkan: kembalikan kursor ke posisi semula
  try {
    const keys = [];
    for (const s of picked.sources) keys.push(await sources.ensureCitable(s));
    editor.insertAt(offset, `[@${keys.join('; @')}${picked.locator ? ', ' + picked.locator : ''}]`);
  } catch (e) { showToast('Gagal menyisipkan sitasi: ' + e.message); }
}
// "Kutip PDF": pilih PDF -> masuk daftar sumber -> metadata diekstrak otomatis -> sitasi disisipkan.
async function citeFromPdf() {
  let offset = editor.getCaretOffset();
  if (offset === null) { showToast('Klik di dalam blok tempat sitasi akan disisipkan dulu, lalu ulangi.'); return; }
  const snapshot = editor.getContent();
  const res = await sources.importPdfs();
  if (!res || !res.sources.length) { editor.focusAt(offset); return; }
  if (editor.getContent() !== snapshot) offset = editor.getCaretOffset() ?? editor.getContent().length; // dokumen berubah selama ekstraksi
  try {
    const keys = [];
    for (const s of res.sources) keys.push(await sources.ensureCitable(s));
    editor.insertAt(offset, `[@${keys.join('; @')}]`);
  } catch (e) { showToast('Gagal menyisipkan sitasi: ' + e.message); return; }
  const first = res.sources[0];
  if (res.sources.length === 1) {
    const auto = first.metaStatus === 'auto';
    showToast(`Sitasi (${citeLabel(first)}) disisipkan.${auto ? ' Metadata diisi otomatis dari PDF — periksa.' : first.authors && first.authors.length ? '' : ' Metadata tidak ditemukan; lengkapi lewat ✎.'}`,
      { label: 'Periksa', run: () => sources.editDetails(first) });
  } else showToast(`${res.sources.length} sitasi disisipkan. ${res.summary}`.trim());
}

function insertBibliography() {
  const { markdown, missing } = buildBibliography(editor.getContent(), sources.list());
  if (!markdown) { showToast(missing.length ? `Tidak ada sumber untuk kunci: ${missing.join(', ')}` : 'Belum ada sitasi [@kunci] di dokumen ini.'); return; }
  const content = editor.getContent();
  const offset = editor.getCaretOffset() ?? content.length;
  editor.insertAt(offset, (offset > 0 ? '\n\n' : '') + markdown + '\n\n');
  if (missing.length) showToast(`Kunci tanpa sumber dilewati: ${missing.join(', ')}`);
}

function scheduleCounts() {
  clearTimeout(countTimer);
  countTimer = setTimeout(updateCounts, 250);
}
function updateCounts() {
  const t = editor.getContent();
  el.statusCounts.textContent = `${countWords(t)} kata · ${t.length} karakter`;
  sources.setCited(citationCounts(t)); // memisahkan sumber yang dikutip dokumen ini dari yang hanya terdaftar
  refreshOutline();
}
function showToast(text, action, ms = 6000) {
  clearTimeout(toastTimer);
  el.toastText.textContent = text;
  el.toastAction.hidden = !action;
  el.toastAction.textContent = action ? action.label : '';
  el.toastAction.onclick = action ? () => { el.toast.hidden = true; action.run(); } : null;
  el.toast.hidden = false;
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

/* ---------- Pengaturan ---------- */
function persistPrefs() { savePrefs(prefs).catch((e) => console.warn('Gagal menyimpan preferensi', e)); }
function applyTheme() {
  const dark = prefs.theme === 'dark' || (prefs.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
function applyPanel() {
  document.documentElement.style.setProperty('--panel-w', prefs.panelWidth + 'px');
  el.panel.classList.toggle('hidden', !prefs.panelVisible);
  el.resizer.classList.toggle('hidden', !prefs.panelVisible);
}
const PANES = ['docs', 'sources', 'outline'];
function setPane(name) {
  if (!PANES.includes(name)) name = 'docs';
  for (const p of PANES) {
    $('pane-' + p).hidden = p !== name;
    $('ptab-' + p).setAttribute('aria-selected', String(p === name));
  }
  if (prefs.panelTab !== name) { prefs.panelTab = name; persistPrefs(); }
  if (name === 'outline') { refreshOutline(); }
}

/* ---------- Outline ---------- */
let headings = [], outlineEls = [];
function refreshOutline() {
  headings = editor.getHeadings();
  renderOutline();
  updateActiveHeading();
}
function renderOutline() {
  const list = $('outline-list');
  const q = el.search.value.trim().toLowerCase();
  list.textContent = '';
  outlineEls = [];
  headings.forEach((h, i) => {
    if (q && !h.text.toLowerCase().includes(q)) return;
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'outline-item lvl-' + h.level;
    b.style.paddingLeft = 8 + (h.level - 1) * 12 + 'px';
    b.textContent = h.text || '(heading kosong)'; b.title = `H${h.level}: ${h.text}`;
    b.addEventListener('click', () => editor.revealBlock(h.block, h.offset));
    li.appendChild(b); list.appendChild(li); outlineEls[i] = b;
  });
  if (!list.children.length) {
    list.appendChild(Object.assign(document.createElement('li'), { className: 'src-hint', textContent: headings.length ? 'Tidak ada heading yang cocok.' : 'Belum ada heading. Awali baris dengan # Judul, ## Subjudul, …' }));
  }
  $('outline-title').textContent = headings.length ? `Struktur dokumen · ${headings.length} heading` : 'Struktur dokumen';
}
function updateActiveHeading() {
  if (!headings.length || $('pane-outline').hidden) return;
  const idx = pickActive(editor.getHeadingTops(headings), 80);
  outlineEls.forEach((b, i) => { if (b) b.classList.toggle('active', i === idx); });
  const cur = outlineEls[idx];
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
}

/* ---------- Posisi baca per dokumen ---------- */
let viewTimer = null;
function scheduleViewSave() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    if (!doc) return;
    const a = editor.getScrollAnchor();
    if (!a) return;
    prefs.views = prefs.views || {};
    delete prefs.views[doc.id];
    prefs.views[doc.id] = a;
    const keys = Object.keys(prefs.views);
    if (keys.length > 60) delete prefs.views[keys[0]];
    persistPrefs();
  }, 700);
}

function togglePanel() { prefs.panelVisible = !prefs.panelVisible; applyPanel(); persistPrefs(); }

/* ---------- Status ---------- */
function renderStatus() {
  const d = el.statusDraft;
  d.className = '';
  if (draftState === 'saved') { d.textContent = 'Draf tersimpan di browser'; d.classList.add('ok'); }
  else if (draftState === 'pending' || draftState === 'saving') { d.textContent = 'Menyimpan draf…'; d.classList.add('warn'); }
  else { d.textContent = 'GAGAL menyimpan draf: ' + draftError; d.classList.add('err'); }

  const f = el.statusFile;
  f.className = '';
  if (!doc) { f.textContent = ''; return; }
  if (!doc.fileName) { f.textContent = 'Belum disimpan ke file'; f.classList.add('warn'); }
  else if (!doc.handle) { f.textContent = `File: ${doc.fileName} (tautan ke file hilang — Simpan akan meminta lokasi)`; f.classList.add('warn'); }
  else if (doc.fileHash !== hashText(doc.content)) { f.textContent = `● ${doc.fileName}: ada perubahan belum disimpan ke file`; f.classList.add('warn'); }
  else { f.textContent = `${doc.fileName}: tersimpan`; f.classList.add('ok'); }
}

/* ---------- Simpan draf (IndexedDB) ---------- */
function scheduleSave() {
  draftState = 'pending'; renderStatus();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}
// Draf adalah prioritas: bila handle file tidak dapat disimpan, isi dokumen tetap disimpan tanpa handle.
function putDocKeepingDraft(d) {
  return putDoc(d).catch((err) => {
    if (err && err.name === 'DataCloneError' && d.handle) return putDoc({ ...d, handle: null });
    throw err;
  });
}

function flushSave() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!doc) return saving;
  const snapshot = { ...doc };
  draftState = 'saving'; renderStatus();
  saving = saving.then(() => putDocKeepingDraft(snapshot)).then(() => {
    if (!saveTimer) draftState = 'saved';
    refreshList(snapshot);
    maybeAutoSnapshot();
  }).catch((err) => {
    console.error('Gagal menyimpan draf', err);
    draftState = 'error'; draftError = err && err.message ? err.message : String(err);
  }).finally(renderStatus);
  return saving;
}

/* ---------- Daftar dokumen ---------- */
function refreshList(updated) {
  if (updated) {
    const i = allDocs.findIndex((d) => d.id === updated.id);
    const summary = { id: updated.id, title: updated.title, updatedAt: updated.updatedAt };
    if (i >= 0) allDocs[i] = summary; else allDocs.push(summary);
  }
  renderList();
}
function renderList() {
  const q = el.search.value.trim().toLowerCase();
  el.list.textContent = '';
  allDocs.filter((d) => !q || (d.title || '').toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach((d) => {
      const li = document.createElement('li');
      li.className = 'doc-item' + (doc && d.id === doc.id ? ' active' : '');
      const open = document.createElement('button');
      open.className = 'doc-open'; open.textContent = d.title || 'Tanpa judul'; open.title = d.title || '';
      open.addEventListener('click', () => switchDoc(d.id));
      const del = document.createElement('button');
      del.className = 'doc-del'; del.textContent = '✕'; del.title = 'Hapus draf dari browser (file asli tidak dihapus)';
      del.setAttribute('aria-label', 'Hapus draf ' + (d.title || 'Tanpa judul'));
      del.addEventListener('click', () => removeDoc(d.id, d.title));
      li.append(open, del);
      el.list.appendChild(li);
    });
}

/* ---------- Dokumen aktif ---------- */
function show(d) {
  doc = d;
  el.title.value = d.title;
  editor.setContent(d.content);
  snapsReady = loadSnaps(d.id);
  setTimeout(checkDisk, 300);
  prefs.activeDocId = d.id; persistPrefs();
  const anchor = prefs.views && prefs.views[d.id];
  if (anchor) (window.requestAnimationFrame || setTimeout)(() => editor.restoreScrollAnchor(anchor));
  renderList(); renderStatus(); updateCounts();
}
async function switchDoc(id) {
  if (doc && id === doc.id) return;
  editor.commit();
  await flushSave();
  try {
    const d = await getDoc(id);
    if (d) show(d);
  } catch (err) { alert('Gagal membuka draf: ' + err.message); }
}
async function newDoc(title, content, fileName = null, extra = {}) {
  editor.commit();
  await flushSave();
  const d = Object.assign(createDoc(title, content), { fileName }, extra);
  try { await putDocKeepingDraft(d); } catch (err) { alert('Gagal membuat dokumen: ' + err.message); return null; }
  refreshList(d); show(d);
  return d;
}
async function removeDoc(id, title) {
  if (!confirm(`Hapus draf "${title || 'Tanpa judul'}" dari browser?\nFile asli di komputer (jika ada) tidak ikut terhapus.`)) return;
  try { await deleteDoc(id); } catch (err) { alert('Gagal menghapus: ' + err.message); return; }
  getSnapshots(id).then((l) => deleteSnapshots(l.map((x) => x.id))).catch(() => {});
  allDocs = allDocs.filter((d) => d.id !== id);
  if (doc && doc.id === id) {
    clearTimeout(saveTimer); saveTimer = null; doc = null;
    if (allDocs.length) await switchDoc(allDocs.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
    else await newDoc('Tanpa judul', '');
  } else renderList();
}

/* ---------- File ---------- */
async function doOpen() {
  try {
    const { name, text, handle, lastModified } = await openFile();
    const d = await newDoc(name.replace(/\.(md|markdown|txt)$/i, ''), text, name,
      { handle: handle || null, fileHash: handle ? hashText(text) : null, fileModified: handle ? lastModified : null });
    if (d) takeSnapshot('Dibuka dari file');
  } catch (err) { if (err.name !== 'AbortError') alert('Gagal membuka file: ' + err.message); }
}

async function doSave(forceAs = false) {
  if (!doc) return;
  editor.commit();
  const d = doc;
  try {
    const r = await saveDocument(d, {
      forceAs, confirm: (m) => window.confirm(m),
      io: { ensureWritePermission, writeToHandle, saveAs, safeFileName, hashText }
    });
    if (!r.ok) {
      if (r.reason === 'permission') showToast('Izin menulis ke file ditolak. Tekan Simpan lagi lalu pilih "Izinkan", atau pakai Simpan sebagai.');
      else if (r.reason === 'write-failed') showToast(`Gagal menulis ke file asli (${r.error && r.error.message ? r.error.message : 'tidak diketahui'}). Teks aman di draf; coba Simpan sebagai.`);
      return;
    }
    if (r.downloaded) showToast('Browser ini tidak mendukung simpan langsung: file diunduh ke folder Unduhan.');
    if (d === doc) takeSnapshot('Disimpan ke file');
    if (d === doc) { renderStatus(); await flushSave(); } // simpan handle & penanda file ke draf sekarang juga
    else await putDocKeepingDraft(d);
  } catch (err) {
    if (err.name !== 'AbortError') alert('Gagal menyimpan file: ' + err.message + '\nTeks Anda tetap aman di draf browser.');
  }
}

/* ---------- Riwayat versi (titik pemulihan) ---------- */
let snaps = [], snapsReady = Promise.resolve();
async function loadSnaps(docId) {
  try {
    const list = (await getSnapshots(docId)).sort((a, b) => b.at - a.at);
    if (doc && doc.id === docId) snaps = list;
  } catch { if (doc && doc.id === docId) snaps = []; }
}
async function takeSnapshot(label, { auto = false } = {}) {
  await snapsReady;
  if (!doc || !doc.content.trim()) return null;
  const docId = doc.id, content = doc.content, hash = hashText(content);
  if (snaps[0] && snaps[0].hash === hash) return snaps[0];
  const snap = makeSnapshot(docId, content, label, hash);
  try { await putSnapshot(snap); } catch (e) { console.warn('Gagal membuat titik pemulihan', e); return null; }
  if (!doc || doc.id !== docId) return snap;
  snaps.unshift(snap);
  const drop = pruneIds(snaps);
  if (drop.length) { snaps = snaps.filter((x) => !drop.includes(x.id)); deleteSnapshots(drop).catch(() => {}); }
  return snap;
}
function maybeAutoSnapshot() {
  if (!doc) return;
  if (shouldAutoSnapshot({ last: snaps[0], content: doc.content, now: Date.now(), hash: hashText(doc.content) })) takeSnapshot('Otomatis', { auto: true });
}
async function openHistory() {
  if (!doc) return;
  editor.commit();
  await showHistory({
    getSnaps: async () => { await snapsReady; return snaps.slice(); },
    onManual: () => takeSnapshot('Manual'),
    currentText: () => doc.content,
    onRestore: async (snap) => {
      await takeSnapshot('Sebelum pemulihan');
      editor.replaceContent(snap.content);
      showToast('Versi dipulihkan. Isi sebelumnya tersimpan di Riwayat; Ctrl+Z (di luar blok) juga membatalkan.', null, 9000);
    }
  });
}

/* ---------- Perubahan file di luar editor ---------- */
let diskChecking = false, lastDiskCheck = 0;
const diskNotified = new Map(); // id dokumen -> lastModified yang sudah diberitahukan (agar tidak berulang)
async function checkDisk() {
  const d = doc;
  if (!d || !d.handle || !d.fileHash || diskChecking || Date.now() - lastDiskCheck < 2000) return;
  lastDiskCheck = Date.now(); diskChecking = true;
  try {
    let perm;
    try { perm = await d.handle.queryPermission({ mode: 'read' }); } catch { return; }
    if (perm !== 'granted') return; // tidak memunculkan permintaan izin dari pemeriksaan latar belakang
    let file;
    try { file = await d.handle.getFile(); } catch { return; } // hilang/dipindah: ditangani saat Simpan
    if (file.lastModified === d.fileModified) return;
    const text = await file.text();
    if (doc !== d) return;
    const verdict = evaluateDisk({ doc: d, disk: { lastModified: file.lastModified, text }, hashText });
    if (verdict === 'touch' || verdict === 'adopt') {
      d.fileModified = file.lastModified;
      if (verdict === 'adopt') d.fileHash = hashText(text);
      renderStatus(); flushSave(); return;
    }
    if (verdict === 'none' || diskNotified.get(d.id) === file.lastModified) return;
    diskNotified.set(d.id, file.lastModified);
    const reload = async () => {
      if (doc !== d) return;
      await takeSnapshot('Sebelum muat ulang dari disk');
      editor.replaceContent(text);
      d.fileHash = hashText(text); d.fileModified = file.lastModified;
      renderStatus(); await flushSave();
      await takeSnapshot('Dimuat ulang dari disk');
      showToast('Isi dimuat ulang dari disk. Versi sebelumnya ada di Riwayat.', null, 8000);
    };
    if (verdict === 'reload-offer') showToast(`"${d.fileName}" diubah di luar editor.`, { label: 'Muat ulang dari disk', run: reload }, 15000);
    else showToast(`"${d.fileName}" diubah di disk, dan dokumen ini punya perubahan yang belum tersimpan.`, {
      label: 'Selesaikan…',
      run: () => { if (window.confirm(`"${d.fileName}" berubah di disk dan editor juga punya perubahan belum tersimpan.\n\nOK = ganti isi editor dengan versi dari disk (versi editor disimpan di Riwayat).\nBatal = pertahankan versi editor (Anda akan ditanya lagi saat Simpan).`)) reload(); }
    }, 25000);
  } finally { diskChecking = false; }
}

/* ---------- Event ---------- */
function bind() {
  el.title.addEventListener('input', () => { doc.title = el.title.value; doc.updatedAt = Date.now(); scheduleSave(); });
  el.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); editor.focusStart(); } });

  $('btn-new').onclick = $('btn-new-side').onclick = () => newDoc('Tanpa judul', '').then(() => editor.focusStart());
  $('btn-open').onclick = doOpen;
  $('btn-save').onclick = () => doSave(false);
  $('btn-saveas').onclick = () => doSave(true);
  $('btn-toggle-panel').onclick = togglePanel;
  $('btn-history').onclick = openHistory;
  window.addEventListener('focus', checkDisk);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkDisk(); });
  $('btn-theme').onclick = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    prefs.theme = dark ? 'light' : 'dark'; applyTheme(); persistPrefs();
  };
  el.search.addEventListener('input', () => { renderList(); sources.setFilter(el.search.value); renderOutline(); updateActiveHeading(); });
  $('ptab-docs').onclick = () => setPane('docs');
  $('ptab-sources').onclick = () => setPane('sources');
  $('ptab-outline').onclick = () => setPane('outline');

  // Bilah format: mousedown dicegah agar fokus tetap di blok yang sedang disunting
  $('fmtbar').querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  $('fmtbar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cmd]');
    if (!b) return;
    const cmd = b.dataset.cmd;
    if (cmd === 'undo') { if (!editor.undo()) showToast('Tidak ada yang bisa diurungkan'); }
    else if (cmd === 'redo') { if (!editor.redo()) showToast('Tidak ada yang bisa diulangi'); }
    else if (cmd === 'source') editor.toggleSource();
    else if (cmd === 'cite') startCitePicker();
    else if (cmd === 'citepdf') citeFromPdf();
    else if (cmd === 'bib') insertBibliography();
    else editor.format(cmd);
  });
  const toggleHelp = () => { el.help.hidden = !el.help.hidden; };
  $('btn-help').onclick = toggleHelp;
  $('help-close').onclick = toggleHelp;
  el.help.addEventListener('click', (e) => { if (e.target === el.help) toggleHelp(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.help.hidden) { el.help.hidden = true; return; }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); doSave(e.shiftKey); }
    else if (k === 'o') { e.preventDefault(); doOpen(); }
    else if (k === '\\') { e.preventDefault(); togglePanel(); }
    else if (k === 'k' && e.shiftKey) { e.preventDefault(); startCitePicker(); }
    else if (e.key === '/') { e.preventDefault(); toggleHelp(); }
    else if (e.altKey && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) { e.preventDefault(); if (!prefs.panelVisible) togglePanel(); setPane(PANES[Number(e.code.slice(-1)) - 1]); }
  });

  // Ubah lebar panel
  let dragging = false;
  el.resizer.addEventListener('pointerdown', (e) => { dragging = true; el.resizer.setPointerCapture(e.pointerId); el.resizer.classList.add('dragging'); });
  el.resizer.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    prefs.panelWidth = Math.round(Math.min(Math.max(e.clientX, 160), window.innerWidth * 0.6));
    document.documentElement.style.setProperty('--panel-w', prefs.panelWidth + 'px');
  });
  el.resizer.addEventListener('pointerup', () => { dragging = false; el.resizer.classList.remove('dragging'); persistPrefs(); });
  el.resizer.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    prefs.panelWidth = Math.min(Math.max(prefs.panelWidth + (e.key === 'ArrowRight' ? 20 : -20), 160), Math.round(window.innerWidth * 0.6));
    applyPanel(); persistPrefs();
  });

  // Jangan kehilangan teks
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  window.addEventListener('pagehide', flushSave);
  window.addEventListener('beforeunload', (e) => {
    if (saveTimer || draftState === 'saving' || draftState === 'error') { e.preventDefault(); e.returnValue = ''; }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

/* ---------- Mulai ---------- */
async function init() {
  prefs = await loadPrefs().catch(() => ({ ...DEFAULT_PREFS }));
  applyTheme(); applyPanel(); setPane(prefs.panelTab); bind();
  try {
    const docs = await getAllDocs();
    allDocs = docs.map((d) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt }));
    let active = docs.find((d) => d.id === prefs.activeDocId) || docs.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!active) { active = createDoc('Selamat datang', WELCOME); await putDoc(active); allDocs.push({ id: active.id, title: active.title, updatedAt: active.updatedAt }); }
    show(active);
  } catch (err) {
    console.error(err);
    draftState = 'error'; draftError = 'penyimpanan lokal tidak tersedia (' + err.message + ')';
    show(createDoc('Selamat datang', WELCOME)); // tetap bisa menulis; simpan manual ke file
  }
  await sources.init();
  if (!hasFsAccess()) el.statusFile.title = 'Browser ini tidak mendukung File System Access API: Simpan akan mengunduh file.';
}
init();
