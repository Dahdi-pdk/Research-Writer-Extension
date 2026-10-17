// Kebijakan titik pemulihan (riwayat versi) per dokumen. Murni: penyimpanan dan jam disuntikkan pemanggil.
export const SNAP = { max: 25, autoInterval: 5 * 60 * 1000, maxAutoChars: 2_000_000, minChars: 20 };

export function makeSnapshot(docId, content, label, hash, now = Date.now()) {
  return { id: crypto.randomUUID(), docId, at: now, label, hash, chars: content.length, content };
}

// Otomatis: bila ada isi yang berarti, berubah dari titik terakhir, dan titik terakhir sudah lebih dari 5 menit lalu.
export function shouldAutoSnapshot({ last, content, now, hash }) {
  if (content.trim().length < SNAP.minChars || content.length > SNAP.maxAutoChars) return false;
  if (!last) return true;
  return hash !== last.hash && now - last.at >= SNAP.autoInterval;
}

// ID titik yang harus dihapus agar tersisa `max` terbaru.
export function pruneIds(list, max = SNAP.max) {
  return [...list].sort((a, b) => b.at - a.at).slice(max).map((s) => s.id);
}
