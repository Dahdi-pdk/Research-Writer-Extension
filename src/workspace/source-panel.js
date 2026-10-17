// Panel "Sumber": daftar URL web, PDF daring, dan PDF lokal; membuka/mengaktifkan tab lewat tab-manager.
import { putSource, getAllSources, deleteSource, createSource, putSources, deleteSources, putFolder, getAllFolders, deleteFolder } from './storage.js';
import { scanDirectory, planFolderImport } from './folder-scan.js';
import { parseHttpUrl, guessTitle } from './url-utils.js';
import { createTabManager, SourceError } from './tab-manager.js';
import { hasFsAccess } from './file-io.js';
import { editReference } from './reference-ui.js';
import { makeKey, partitionSources } from './citations.js';
import { matchKey } from './url-utils.js';
import { extractFromFile } from './pdf-meta.js';

const KIND_LABEL = { web: 'WEB', 'pdf-url': 'PDF', 'pdf-local': 'PDF·LOKAL' };
const PDF_PICKER = { multiple: true, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] };

export function createSourcePanel({ listEl, urlInput, addUrlBtn, addPdfBtn, addFolderBtn, rescanBtn, extractAllBtn, foldersEl, progressEl, progressTextEl, cancelBtn, noteEl, notify, onChange, onInsertCite }) {
  let sources = [];
  let filter = '';
  let openMap = new Map();
  let folders = [];                 // folder PDF terdaftar { id, name, handle, addedAt }
  let citedCounts = new Map();      // kunci -> jumlah sitasi di dokumen aktif
  const collapsed = { cited: false, rest: false };
  let extractChain = Promise.resolve(), cancelFlag = false, pendingBatches = 0;
  const changed = () => { if (onChange) onChange(); };
  const broken = new Set(); // id sumber lokal yang gagal dibuka (menampilkan tombol ↻)

  const tabs = createTabManager({
    getSources: () => sources,
    ensureReadPermission: (src) => ensureReadPermission(src),
    onOpenChange(map) { openMap = map; render(); },
    onTitle(id, title) {
      const s = sources.find((x) => x.id === id);
      const t = title.trim();
      if (!s || !s.autoTitle || s.kind === 'pdf-local' || !t || t === s.title || t.includes('://') || t.length > 200) return;
      s.title = t;
      putSource(s).catch((e) => console.warn('Gagal menyimpan judul', e));
      render(); changed();
    }
  });

  const save = (s) => putSource(s).catch((e) => { notify('Gagal menyimpan daftar sumber: ' + e.message); throw e; });

  async function open(src) {
    try {
      const r = await tabs.openSource(src);
      broken.delete(src.id);
      if (r.action === 'activated') notify('Tab sumber sudah terbuka — diaktifkan.');
    } catch (err) {
      if (err instanceof SourceError) {
        if (err.code === 'not-found' || err.code === 'not-pdf') broken.add(src.id);
        notify(err.message);
      } else notify('Gagal membuka sumber: ' + (err && err.message ? err.message : err));
      render();
    }
  }

  async function addUrl() {
    const p = parseHttpUrl(urlInput.value);
    if (!p.ok) { notify(p.reason); return; }
    let src = sources.find((s) => s.key === p.key);
    if (src) notify('Sumber ini sudah ada di daftar.');
    else {
      src = createSource({ kind: p.kind, url: p.url, key: p.key, title: guessTitle(p.url) });
      try { await save(src); } catch { return; }
      sources.push(src);
    }
    urlInput.value = '';
    render(); changed();
    await open(src);
  }

  // Membuka pemilih file PDF, menambahkan yang baru ke daftar. Mengembalikan { list, added } atau null (dibatalkan).
  async function pickPdfs() {
    if (!hasFsAccess()) { notify('Browser ini tidak mendukung pemilihan file yang diperlukan untuk PDF lokal.'); return null; }
    let handles;
    try { handles = await window.showOpenFilePicker(PDF_PICKER); }
    catch (e) { if (e.name !== 'AbortError') notify('Gagal memilih file: ' + e.message); return null; }
    const list = [], added = [];
    for (const h of handles) {
      let dup = null;
      for (const s of sources) {
        if (s.kind === 'pdf-local' && s.handle && (await s.handle.isSameEntry(h).catch(() => false))) { dup = s; break; }
      }
      if (dup) { list.push(dup); continue; }
      const src = createSource({ kind: 'pdf-local', title: h.name.replace(/\.pdf$/i, ''), autoTitle: false, handle: h, fileName: h.name });
      try { await save(src); } catch { return null; }
      sources.push(src); added.push(src); list.push(src);
    }
    render(); changed();
    return { list, added };
  }

  async function addLocal() {
    const r = await pickPdfs();
    if (!r) return;
    if (r.list.length === 1) await open(r.list[0]);
    else if (!r.added.length) notify('File-file itu sudah ada di daftar.');
    const res = await autoExtract(r.added);
    if (res.total) notify(summaryText(res));
  }

  /* ---------- Ekstraksi metadata otomatis dari PDF lokal ---------- */
  async function getLocalFile(src) {
    const h = src.handle;
    if (!h) throw new SourceError('Referensi file hilang. Pilih file itu lagi (tombol ↻).', 'not-found');
    let granted;
    try { granted = await ensureReadPermission(src); }
    catch { throw new SourceError('File tidak ditemukan atau dipindahkan.', 'not-found'); }
    if (!granted) throw new SourceError('Izin membaca file ditolak.', 'permission');
    let file;
    try { file = await h.getFile(); } catch { throw new SourceError('File tidak ditemukan atau dipindahkan.', 'not-found'); }
    if ((await file.slice(0, 5).text()) !== '%PDF-') throw new SourceError('File ini bukan PDF yang valid.', 'not-pdf');
    return file;
  }

  const FIELD_NAMES = { title: 'judul', authors: 'penulis', year: 'tahun', venue: 'jurnal', doi: 'DOI' };

  // Mengisi HANYA kolom yang masih kosong; tidak pernah menimpa isian pengguna.
  function applyExtracted(src, r) {
    const filled = [];
    const fileTitle = (src.fileName || '').replace(/\.pdf$/i, '');
    if (r.title && r.from.title !== 'nama file' && (!src.title || src.title === fileTitle)) { src.title = r.title; filled.push('title'); }
    if (r.authors.length && !(src.authors || []).length) { src.authors = r.authors; filled.push('authors'); }
    if (r.year && !src.year) { src.year = r.year; filled.push('year'); }
    if (r.venue && !src.venue) { src.venue = r.venue; filled.push('venue'); }
    if (r.doi && !src.doi) { src.doi = r.doi; filled.push('doi'); }
    src.metaTried = true;
    if (filled.length) {
      src.metaStatus = 'auto';
      src.metaFrom = filled.map((k) => `${FIELD_NAMES[k]}: ${r.from[k]}`).join(' · ');
    }
    src.metaNotes = r.notes.join(' ');
    return filled.map((k) => FIELD_NAMES[k]);
  }

  async function extractOne(src) {
    const file = await getLocalFile(src);
    const filled = applyExtracted(src, await extractFromFile(file));
    await save(src);
    return { filled, notes: src.metaNotes };
  }

  const needsMeta = (s) => s.kind === 'pdf-local' && s.metaStatus !== 'manual' && (!(s.authors || []).length || !s.year);

  function setProgress(text) {
    if (!progressEl) { if (text) noteEl.textContent = text; return; }
    progressEl.hidden = !text;
    if (progressTextEl) progressTextEl.textContent = text || '';
  }

  // Ekstraksi berjalan berurutan (satu PDF sekali waktu) di latar belakang dan dapat dihentikan lewat tombol "Hentikan".
  function autoExtract(targets) {
    const res = { total: targets.length, filled: 0, empty: 0, failed: 0, cancelled: 0, reasons: new Set() };
    if (!targets.length) return Promise.resolve(res);
    pendingBatches++;
    const run = async () => {
      for (let i = 0; i < targets.length; i++) {
        if (cancelFlag) { res.cancelled = targets.length - i; break; }
        setProgress(`Mengekstrak metadata PDF ${i + 1}/${targets.length}…`);
        try { const r = await extractOne(targets[i]); if (r.filled.length) res.filled++; else res.empty++; }
        catch (e) {
          res.failed++;
          res.reasons.add(e && e.name === 'PasswordException' ? 'PDF dilindungi kata sandi' : (e && e.message) || String(e));
          if (e instanceof SourceError && (e.code === 'not-found' || e.code === 'not-pdf')) broken.add(targets[i].id);
        }
        if ((i + 1) % 10 === 0) { render(); changed(); }
      }
      return res;
    };
    const p = extractChain.then(run).finally(() => {
      pendingBatches--;
      if (!pendingBatches) { cancelFlag = false; setProgress(''); }
      render(); changed();
    });
    extractChain = p.catch(() => {});
    return p;
  }

  function summaryText(res) {
    const parts = [];
    if (res.filled) parts.push(`${res.filled} PDF terisi otomatis (lencana AUTO — periksa lewat ✎)`);
    if (res.empty) parts.push(`${res.empty} PDF tanpa metadata yang bisa dibaca (isi manual)`);
    if (res.failed) parts.push(`${res.failed} gagal: ${[...res.reasons].join('; ')}`);
    if (res.cancelled) parts.push(`${res.cancelled} PDF dilewati karena dihentikan (lanjutkan dengan ✨ Ekstrak semua)`);
    return parts.join('. ') + '.';
  }

  async function extractManual(src) {
    try {
      const r = await extractOne(src);
      render(); changed();
      notify(r.filled.length ? `Terisi otomatis: ${r.filled.join(', ')}. Periksa lewat ✎ (lencana AUTO).` : `Tidak ada metadata baru yang bisa diekstrak. ${r.notes || 'Isi manual lewat ✎.'}`);
    } catch (e) {
      if (e instanceof SourceError && (e.code === 'not-found' || e.code === 'not-pdf')) { broken.add(src.id); render(); }
      notify('Ekstraksi gagal: ' + (e && e.name === 'PasswordException' ? 'PDF dilindungi kata sandi.' : (e && e.message) || e));
    }
  }

  async function extractAll() {
    const targets = sources.filter(needsMeta);
    if (!targets.length) { notify('Semua PDF lokal sudah punya penulis dan tahun.'); return; }
    const res = await autoExtract(targets);
    notify(summaryText(res));
  }

  // Sebelum dikutip: PDF lokal yang belum pernah dibaca metadatanya diekstrak dulu agar kunci/label sitasi bagus.
  async function ensureCitable(src) {
    if (src.kind === 'pdf-local' && !src.metaTried && !(src.authors || []).length && !src.year) {
      try { await extractOne(src); render(); changed(); } catch { src.metaTried = true; }
    }
    return ensureKey(src);
  }

  /* ---------- Folder PDF ---------- */
  // Untuk PDF dari folder, izin diminta lewat handle folder lebih dulu: izin folder berlaku untuk isinya,
  // sehingga tidak perlu satu permintaan per berkas setelah browser dimulai ulang.
  async function ensureReadPermission(src) {
    const folder = src.folderId ? folders.find((f) => f.id === src.folderId) : null;
    if (folder) {
      try { if ((await folder.handle.queryPermission({ mode: 'read' })) !== 'granted') await folder.handle.requestPermission({ mode: 'read' }); }
      catch { /* lanjut: izin per berkas masih dicoba di bawah */ }
    }
    const h = src.handle;
    let perm = await h.queryPermission({ mode: 'read' });
    if (perm !== 'granted') perm = await h.requestPermission({ mode: 'read' });
    return perm === 'granted';
  }

  async function ensureFolderRead(folder) {
    try {
      if ((await folder.handle.queryPermission({ mode: 'read' })) === 'granted') return true;
      return (await folder.handle.requestPermission({ mode: 'read' })) === 'granted';
    } catch { return false; }
  }

  // Memindai folder dan menambahkan PDF yang belum terdaftar. Yang hilang dari folder hanya ditandai merah (tidak dihapus otomatis).
  async function importFolder(folder, dirHandle) {
    setProgress('Memindai folder…');
    let scan;
    try { scan = await scanDirectory(dirHandle, { onProgress: (n) => setProgress(`Memindai folder… ${n} PDF`) }); }
    catch (e) { setProgress(''); notify('Gagal membaca folder: ' + (e && e.message ? e.message : e)); return null; }
    setProgress('');
    const plan = await planFolderImport(scan.files, sources, folder.id, (a, b) => a.isSameEntry(b));
    const added = plan.toAdd.map((f) => createSource({
      kind: 'pdf-local', title: f.relPath.split('/').pop().replace(/\.pdf$/i, ''), autoTitle: false,
      handle: f.handle, fileName: f.handle.name, folderId: folder.id, relPath: f.relPath
    }));
    if (added.length) {
      try { await putSources(added); } catch (e) { notify('Gagal menyimpan daftar sumber: ' + e.message); return null; }
      sources.push(...added);
    }
    for (const s of plan.missing) broken.add(s.id);
    for (const s of plan.known) if (s.folderId === folder.id) broken.delete(s.id);
    render(); changed(); renderFolders();
    return { scan, plan, added };
  }

  function folderSummary(folder, { scan, plan, added }) {
    if (!scan.files.length) return `Folder "${folder.name}": tidak ada berkas PDF.`;
    const parts = [`${scan.files.length} PDF ditemukan${scan.folders ? ` (termasuk ${scan.folders} subfolder)` : ''}`, `${added.length} baru ditambahkan`];
    const already = scan.files.length - added.length;
    if (already > 0) parts.push(`${already} sudah ada`);
    if (plan.missing.length) parts.push(`${plan.missing.length} tidak ditemukan lagi (ditandai merah)`);
    if (scan.truncated) parts.push('dibatasi 3000 berkas pertama');
    return `Folder "${folder.name}": ${parts.join(', ')}.`;
  }

  async function addFolder() {
    if (typeof window.showDirectoryPicker !== 'function') { notify('Browser ini tidak mendukung pemilihan folder.'); return; }
    let dir;
    try { dir = await window.showDirectoryPicker({ mode: 'read' }); }
    catch (e) { if (e.name !== 'AbortError') notify('Gagal memilih folder: ' + e.message); return; }
    let folder = null;
    for (const f of folders) { if (await f.handle.isSameEntry(dir).catch(() => false)) { folder = f; break; } }
    if (folder) folder.handle = dir;
    else { folder = { id: crypto.randomUUID(), name: dir.name, handle: dir, addedAt: Date.now() }; folders.push(folder); }
    try { await putFolder(folder); } catch (e) { notify('Gagal menyimpan folder: ' + e.message); return; }
    const r = await importFolder(folder, dir);
    if (!r) return;
    notify(folderSummary(folder, r));
    const res = await autoExtract(r.added);
    if (res.total) notify(summaryText(res));
  }

  async function rescanFolders() {
    if (!folders.length) { notify('Belum ada folder terdaftar. Gunakan "＋ Folder…".'); return; }
    const addedAll = [], msgs = [];
    for (const f of folders) {
      if (!(await ensureFolderRead(f))) { msgs.push(`Izin membaca folder "${f.name}" ditolak.`); continue; }
      const r = await importFolder(f, f.handle);
      if (r) { addedAll.push(...r.added); msgs.push(folderSummary(f, r)); }
    }
    if (msgs.length) notify(msgs.join(' '));
    const res = await autoExtract(addedAll);
    if (res.total) notify(summaryText(res));
  }

  async function removeFolder(f) {
    const own = sources.filter((s) => s.folderId === f.id);
    if (!window.confirm(`Lepaskan folder "${f.name}"?\n\n${own.length} PDF dari folder ini ikut dihapus dari daftar sumber (file asli di komputer tidak disentuh, tab yang terbuka tidak ditutup). Sitasi yang menunjuk ke PDF tersebut akan tampil merah.`)) return;
    try { await deleteSources(own.map((s) => s.id)); await deleteFolder(f.id); }
    catch (e) { notify('Gagal melepas folder: ' + e.message); return; }
    const ids = new Set(own.map((s) => s.id));
    sources = sources.filter((s) => !ids.has(s.id));
    for (const id of ids) broken.delete(id);
    folders = folders.filter((x) => x.id !== f.id);
    await tabs.refresh().catch(() => {});
    render(); renderFolders(); changed();
  }

  function renderFolders() {
    if (!foldersEl) return;
    foldersEl.textContent = '';
    foldersEl.hidden = !folders.length;
    for (const f of folders) {
      const n = sources.filter((s) => s.folderId === f.id).length;
      const row = document.createElement('div');
      row.className = 'folder-row';
      const label = document.createElement('span');
      label.className = 'folder-name'; label.textContent = `📁 ${f.name} · ${n} PDF`; label.title = `Folder terdaftar: ${f.name}`;
      row.append(label, btn('src-act', '✕', 'Lepaskan folder dari daftar', () => removeFolder(f)));
      foldersEl.appendChild(row);
    }
  }

  async function relink(src) {
    let handles;
    try { handles = await window.showOpenFilePicker({ ...PDF_PICKER, multiple: false }); }
    catch (e) { if (e.name !== 'AbortError') notify('Gagal memilih file: ' + e.message); return; }
    src.handle = handles[0]; src.fileName = handles[0].name;
    try { await save(src); } catch { return; }
    broken.delete(src.id);
    render();
    await open(src);
  }

  async function editDetails(src) {
    const note = src.metaStatus === 'auto' ? `Diekstrak otomatis dari PDF — periksa sebelum dipakai. ${src.metaFrom || ''} ${src.metaNotes || ''}`.trim() : (src.metaNotes || '');
    const r = await editReference(src, (k) => sources.some((x) => x.id !== src.id && x.citeKey === k), note);
    if (!r) return;
    if (r.title !== src.title) src.autoTitle = false;
    Object.assign(src, r);
    src.metaStatus = 'manual';
    try { await save(src); } catch { return; }
    render(); changed();
  }

  async function ensureKey(src) {
    if (src.citeKey) return src.citeKey;
    src.citeKey = makeKey(src, new Set(sources.map((x) => x.citeKey).filter(Boolean)));
    await save(src);
    return src.citeKey;
  }

  async function remove(src) {
    if (!window.confirm(`Hapus "${src.title}" dari daftar?\nTab yang terbuka dan file aslinya tidak ikut dihapus atau ditutup.`)) return;
    try { await deleteSource(src.id); } catch (e) { notify('Gagal menghapus: ' + e.message); return; }
    sources = sources.filter((s) => s.id !== src.id);
    broken.delete(src.id);
    await tabs.refresh().catch(() => {});
    render(); changed();
  }

  function btn(cls, text, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = text; b.title = title; b.setAttribute('aria-label', title);
    b.addEventListener('mousedown', (e) => e.preventDefault()); // jangan mencuri fokus dari editor
    b.addEventListener('click', onClick);
    return b;
  }

  function buildItem(s) {
    const isOpen = openMap.has(s.id);
    const li = document.createElement('li');
    li.className = 'src-item' + (isOpen ? ' open' : '') + (broken.has(s.id) ? ' broken' : '');
    const dot = document.createElement('span');
    dot.className = 'src-dot'; dot.textContent = isOpen ? '●' : '○';
    dot.title = isOpen ? 'Sedang terbuka di tab' : 'Belum terbuka';
    dot.setAttribute('aria-label', dot.title);
    const kind = document.createElement('span');
    kind.className = 'src-kind'; kind.textContent = KIND_LABEL[s.kind] || '?';
    const folder = s.folderId ? folders.find((f) => f.id === s.folderId) : null;
    const open = btn('src-open', s.title || s.url, s.kind === 'pdf-local'
      ? `File lokal: ${s.relPath || s.fileName}${folder ? ` (folder ${folder.name})` : ''}${broken.has(s.id) ? ' — tidak ditemukan / tidak terbaca' : ''}. Tab hanya berlaku selama Workspace terbuka.` : s.url, () => open_(s));
    li.append(dot, kind);
    const count = s.citeKey ? citedCounts.get(s.citeKey) : 0;
    if (count) li.append(Object.assign(document.createElement('span'), { className: 'src-count', textContent: `×${count}`, title: `${count} sitasi di dokumen ini` }));
    if (s.metaStatus === 'auto') li.append(Object.assign(document.createElement('span'), { className: 'src-auto', textContent: 'AUTO', title: 'Metadata diekstrak otomatis — periksa dengan ✎: ' + (s.metaFrom || '') }));
    li.append(open);
    if (broken.has(s.id)) li.append(btn('src-act', '↻', 'Pilih ulang file ini', () => relink(s)));
    if (s.kind === 'pdf-local') li.append(btn('src-act', '✨', 'Ekstrak penulis/tahun/DOI dari PDF (otomatis)', () => extractManual(s)));
    li.append(btn('src-act', '❝', 'Sisipkan sitasi ke dokumen', () => onInsertCite && onInsertCite(s)),
      btn('src-act', '✎', 'Detail referensi (penulis, tahun, kunci…)', () => editDetails(s)),
      btn('src-act src-del', '✕', 'Hapus dari daftar', () => remove(s)));
    return li;
  }

  // Dua bagian: sumber yang dikutip di DOKUMEN AKTIF, dan sumber yang hanya terdaftar di daftar.
  function section(key, label, items, emptyHint) {
    const head = document.createElement('li');
    head.className = 'src-sep ' + key;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'src-sep-btn';
    b.setAttribute('aria-expanded', String(!collapsed[key]));
    b.textContent = `${collapsed[key] ? '▸' : '▾'} ${label} (${items.length})`;
    b.addEventListener('click', () => { collapsed[key] = !collapsed[key]; render(); });
    head.appendChild(b);
    listEl.appendChild(head);
    if (collapsed[key]) return;
    if (!items.length && emptyHint) listEl.appendChild(Object.assign(document.createElement('li'), { className: 'src-hint', textContent: emptyHint }));
    for (const s of items) listEl.appendChild(buildItem(s));
  }

  function render() {
    const q = filter.trim().toLowerCase();
    listEl.textContent = '';
    const visible = sources.filter((s) => !q || [s.title, s.url, s.fileName, s.relPath].join(' ').toLowerCase().includes(q));
    const { cited, rest } = partitionSources(visible, citedCounts);
    if (sources.length) {
      section('cited', 'Dikutip di dokumen ini', cited, q ? 'Tidak ada yang cocok.' : 'Belum ada sitasi [@…] di dokumen ini.');
      section('rest', 'Hanya terdaftar', rest, q ? 'Tidak ada yang cocok.' : 'Semua sumber sudah dikutip di dokumen ini.');
    }
    const openCount = sources.filter((s) => openMap.has(s.id)).length;
    const citedAll = partitionSources(sources, citedCounts).cited.length;
    noteEl.textContent = sources.length
      ? `${sources.length} sumber · ${citedAll} dikutip di dokumen ini · ${openCount} terbuka. Klik sumber: jika tab-nya sudah ada, tab itu diaktifkan.`
      : 'Belum ada sumber. Tempel URL web/PDF, tambahkan PDF lokal, atau pilih satu folder berisi PDF.';
  }
  const open_ = open;

  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } });
  addUrlBtn.addEventListener('click', addUrl);
  addPdfBtn.addEventListener('click', addLocal);
  if (addFolderBtn) addFolderBtn.addEventListener('click', addFolder);
  if (rescanBtn) rescanBtn.addEventListener('click', rescanFolders);
  if (cancelBtn) cancelBtn.addEventListener('click', () => { cancelFlag = true; setProgress('Menghentikan…'); });
  if (extractAllBtn) extractAllBtn.addEventListener('click', extractAll);

  return {
    async init() {
      try { sources = (await getAllSources()).sort((a, b) => a.addedAt - b.addedAt); }
      catch (e) { notify('Daftar sumber tidak dapat dimuat: ' + e.message); }
      try { folders = (await getAllFolders()).sort((a, b) => a.addedAt - b.addedAt); } catch (e) { notify('Daftar folder tidak dapat dimuat: ' + e.message); }
      render(); renderFolders(); changed();
      try { await tabs.start(); } catch (e) { notify('Pemantauan tab gagal dimulai: ' + e.message); }
    },
    setFilter(q) { filter = q; render(); },
    // Dipanggil workspace saat dokumen aktif/isi berubah: Map kunci -> jumlah sitasi.
    setCited(map) {
      const same = map.size === citedCounts.size && [...map].every(([k, v]) => citedCounts.get(k) === v);
      if (same) return;
      citedCounts = map; render();
    },
    list: () => sources.slice(),
    getByKey: (key) => sources.find((s) => s.citeKey === key) || null,
    ensureKey,
    ensureCitable,
    editDetails,
    // Alur "Kutip PDF": pilih PDF -> masuk daftar -> ekstraksi otomatis -> kembalikan sumbernya (tanpa tab baru).
    async importPdfs() {
      const r = await pickPdfs();
      if (!r) return null;
      const targets = r.list.filter((s) => needsMeta(s) && !s.metaTried);
      const res = await autoExtract(targets);
      return { sources: r.list, summary: res.total ? summaryText(res) : '' };
    },
    async openByKey(key) {
      const src = sources.find((s) => s.citeKey === key);
      if (!src) { notify(`Sumber dengan kunci "${key}" tidak ada di daftar sumber.`); return; }
      await open(src);
    },
    // Tautan biasa di dokumen yang cocok dengan sebuah sumber diperlakukan seperti sitasi (aktifkan tab, bukan tab baru).
    hasUrl: (href) => { const k = matchKey(href); return sources.some((s) => s.key === k); },
    async openByUrl(href) {
      const k = matchKey(href);
      const src = sources.find((s) => s.key === k);
      if (src) await open(src);
    }
  };
}
