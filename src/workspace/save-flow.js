// Alur "Simpan ke file" yang memakai handle file TERSIMPAN di dokumen (doc.handle), sehingga tetap menulis ke file yang sama
// setelah Workspace dimuat ulang atau browser dimulai ulang. Memakai io yang disuntikkan agar dapat diuji tanpa browser.
//
// Bidang dokumen: handle (FileSystemFileHandle | null), fileName, fileHash (hash isi saat terakhir tersimpan ke file),
// fileModified (lastModified file di disk saat terakhir kita baca/tulis; untuk mendeteksi perubahan dari luar).
//
// Mengembalikan { ok:true } | { ok:true, downloaded:true } | { ok:false, reason:'permission'|'cancelled'|'write-failed', error? }.
// Tidak pernah diam-diam beralih ke "file baru": jika file asli tak bisa dipakai, pengguna ditanya atau diberi tahu.
export async function saveDocument(doc, { forceAs = false, confirm, io }) {
  const content = doc.content;
  let handle = forceAs ? null : doc.handle || null;

  if (handle) {
    if (!(await io.ensureWritePermission(handle))) return { ok: false, reason: 'permission' };
    let current = null;
    try { current = await handle.getFile(); }
    catch (e) { if (e && e.name === 'NotFoundError') handle = null; else throw e; }
    if (!handle) {
      if (!confirm(`File asli "${doc.fileName}" tidak ditemukan (dipindah, diganti nama, atau dihapus).\n\nSimpan sebagai file baru?`)) return { ok: false, reason: 'cancelled' };
    } else if (doc.fileModified && current.lastModified !== doc.fileModified) {
      if (!confirm(`File "${doc.fileName}" di disk berubah sejak terakhir dibuka/disimpan (mungkin diedit program lain).\n\nOK = timpa dengan versi di editor.\nBatal = jangan simpan.`)) return { ok: false, reason: 'cancelled' };
    }
  }

  if (handle) {
    try { await io.writeToHandle(handle, content); }
    catch (e) {
      if (e && e.name === 'AbortError') throw e;
      return { ok: false, reason: 'write-failed', error: e };
    }
  } else {
    const r = await io.saveAs(io.safeFileName(doc.title || doc.fileName), content);
    doc.fileName = r.name;
    if (!r.handle) { doc.handle = null; doc.fileHash = null; doc.fileModified = null; return { ok: true, downloaded: true }; }
    handle = r.handle;
  }

  doc.handle = handle;
  try { doc.fileModified = (await handle.getFile()).lastModified; } catch { doc.fileModified = null; }
  doc.fileHash = io.hashText(content);
  return { ok: true };
}
