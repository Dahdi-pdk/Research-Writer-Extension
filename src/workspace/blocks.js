// Model blok: dokumen Markdown dipecah di baris kosong (di luar blok kode berpagar).
// Pemecahan dan penggabungan bersifat LOSSLESS: joinBlocks(splitBlocks(t)) === t untuk semua teks t,
// sehingga file .md tidak pernah berubah hanya karena dibuka lalu disimpan, dan tanpa penanda tambahan.

const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

export function nextFenceState(fence, line) {
  const m = line.match(FENCE);
  if (!m) return fence;
  if (!fence) {
    if (m[1][0] === '`' && m[2].includes('`')) return null; // ```kode``` satu baris bukan pagar
    return { ch: m[1][0], len: m[1].length };
  }
  if (m[1][0] === fence.ch && m[1].length >= fence.len && m[2].trim() === '') return null;
  return fence;
}

export function hasOpenFence(text) {
  let f = null;
  for (const line of text.split('\n')) f = nextFenceState(f, line);
  return f !== null;
}

// Mengembalikan [{ raw, tail }]. tail = baris kosong setelah blok (termasuk "\n" pemisah di depannya).
export function splitBlocks(text) {
  const blocks = [];
  let raw = [], tail = [], hasContent = false, fence = null;
  const flush = () => {
    blocks.push({ raw: raw.join('\n'), tail: tail.map((l) => '\n' + l).join('') });
    raw = []; tail = []; hasContent = false;
  };
  for (const line of text.split('\n')) {
    if (!fence && line.trim() === '') {
      if (hasContent) tail.push(line); else raw.push(line);
      continue;
    }
    if (tail.length) flush();
    raw.push(line);
    if (line.trim() !== '') hasContent = true;
    fence = nextFenceState(fence, line);
  }
  flush();
  return blocks;
}

export const joinBlocks = (blocks) => blocks.map((b) => b.raw + b.tail).join('\n');

export function countWords(text) {
  const t = text.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}
