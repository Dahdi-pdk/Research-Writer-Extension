// Pemindaian folder PDF (murni; handle disuntikkan agar dapat diuji tanpa browser).

const MAX_DEPTH = 8;
const MAX_FILES = 3000;

// Menelusuri folder (termasuk subfolder) dan mengumpulkan semua berkas .pdf. Folder berawalan "." dilewati.
// Mengembalikan { files: [{ handle, relPath }], truncated, folders }.
export async function scanDirectory(dir, { maxDepth = MAX_DEPTH, maxFiles = MAX_FILES, onProgress } = {}) {
  const files = [];
  let folders = 0, truncated = false;
  async function walk(d, prefix, depth) {
    for await (const [name, h] of d.entries()) {
      if (truncated) return;
      if (name.startsWith('.')) continue;
      if (h.kind === 'file') {
        if (!/\.pdf$/i.test(name)) continue;
        if (files.length >= maxFiles) { truncated = true; return; }
        files.push({ handle: h, relPath: prefix + name });
        if (onProgress && files.length % 25 === 0) onProgress(files.length);
      } else if (h.kind === 'directory' && depth < maxDepth) {
        folders++;
        await walk(h, prefix + name + '/', depth + 1);
      }
    }
  }
  await walk(dir, '', 0);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath, 'id', { numeric: true }));
  return { files, truncated, folders };
}

// Membandingkan hasil pemindaian dengan sumber yang sudah ada.
//  - toAdd   : berkas baru (belum ada di daftar, baik dari folder ini maupun diimpor satuan)
//  - known   : berkas yang sudah terdaftar dari folder ini
//  - missing : sumber dari folder ini yang tidak ditemukan lagi di folder
// isSame(a, b) -> Promise<boolean> (FileSystemHandle.isSameEntry); hanya dipanggil untuk nama berkas yang sama.
export async function planFolderImport(found, existing, folderId, isSame) {
  const byRel = new Map(existing.filter((s) => s.folderId === folderId).map((s) => [s.relPath, s]));
  const others = existing.filter((s) => s.kind === 'pdf-local' && s.handle && s.folderId !== folderId);
  const toAdd = [], known = [], seen = new Set();
  for (const f of found) {
    seen.add(f.relPath);
    if (byRel.has(f.relPath)) { known.push(byRel.get(f.relPath)); continue; }
    const name = f.relPath.split('/').pop();
    let dup = null;
    for (const s of others) {
      if (s.fileName === name && (await isSame(s.handle, f.handle).catch(() => false))) { dup = s; break; }
    }
    if (dup) known.push(dup); else toAdd.push(f);
  }
  const missing = [...byRel.values()].filter((s) => !seen.has(s.relPath));
  return { toAdd, known, missing };
}
