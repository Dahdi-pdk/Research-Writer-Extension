// Outline: daftar heading dokumen (murni, dari model blok).
import { nextFenceState } from './blocks.js';

export function plainHeading(t) {
  return String(t)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')   // tautan -> teks
    .replace(/\[@[^\]]*\]/g, '')                  // sitasi dibuang dari judul bagian
    .replace(/(\*\*|__|~~|`|\*)/g, '')
    .replace(/\s+/g, ' ').trim();
}

// [{ level, text, block, offset }] — block = indeks blok; offset = posisi karakter heading di seluruh dokumen.
export function extractHeadings(blocks) {
  const out = [];
  let blockStart = 0;
  blocks.forEach((b, bi) => {
    let fence = null, lineOff = 0;
    for (const line of b.raw.split('\n')) {
      const inside = fence !== null;
      fence = nextFenceState(fence, line);
      if (!inside && fence === null) {
        const m = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
        if (m) out.push({ level: m[1].length, text: plainHeading(m[2]), block: bi, offset: blockStart + lineOff });
      }
      lineOff += line.length + 1;
    }
    blockStart += b.raw.length + b.tail.length + 1;
  });
  return out;
}

// tops = jarak atas tiap heading terhadap tepi atas area gulir (urut dokumen). Aktif = heading terakhir yang sudah melewati ambang.
export function pickActive(tops, threshold = 60) {
  let idx = -1;
  for (let i = 0; i < tops.length; i++) { if (tops[i] <= threshold) idx = i; else break; }
  return idx;
}
