// Buka/simpan file Markdown. Memakai File System Access API bila tersedia (Edge),
// dengan cadangan <input type=file> untuk membuka dan unduhan untuk menyimpan.

export const hasFsAccess = () => 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
const TYPES = [{ description: 'Markdown / teks', accept: { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] } }];

export async function openFile() {
  if (hasFsAccess()) {
    const [handle] = await window.showOpenFilePicker({ types: TYPES, multiple: false });
    const file = await handle.getFile();
    return { name: file.name, text: await file.text(), handle, lastModified: file.lastModified };
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return reject(new DOMException('Dibatalkan', 'AbortError'));
      resolve({ name: f.name, text: await f.text(), handle: null });
    };
    input.oncancel = () => reject(new DOMException('Dibatalkan', 'AbortError'));
    input.click();
  });
}

export async function writeToHandle(handle, text) {
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (err) {
    try { await writable.abort(); } catch { /* abaikan */ }
    throw err;
  }
}

// Mengembalikan { handle, name }. handle null berarti file diunduh (tanpa tautan ke file).
export async function saveAs(suggestedName, text) {
  if (hasFsAccess()) {
    const handle = await window.showSaveFilePicker({ suggestedName, types: TYPES });
    await writeToHandle(handle, text);
    return { handle, name: handle.name };
  }
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = suggestedName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { handle: null, name: suggestedName };
}

export function safeFileName(title) {
  const base = (title || 'dokumen').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'dokumen';
  return /\.(md|markdown|txt)$/i.test(base) ? base : base + '.md';
}

// Meminta izin tulis untuk handle yang dipulihkan dari IndexedDB (setelah browser/Workspace dimuat ulang).
// requestPermission membutuhkan gestur pengguna, jadi panggil dari klik tombol Simpan atau Ctrl+S.
export async function ensureWritePermission(handle) {
  if (!handle || !handle.queryPermission) return true;
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

// Hash cepat (cyrb53) untuk mengetahui apakah teks sekarang sama dengan yang terakhir tersimpan ke file.
export function hashText(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${str.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}
