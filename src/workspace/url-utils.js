// Validasi dan normalisasi URL sumber. Aturan identitas sengaja konservatif:
// hanya yang tidak mengubah dokumen yang dinormalkan (huruf besar-kecil skema/host, port bawaan, path kosong "/")
// serta fragmen (#...) yang tidak dikirim ke server. Parameter query TIDAK pernah dihapus atau diurutkan ulang.

export const matchKey = (href) => {
  try { const u = new URL(href); u.hash = ''; return u.href; } catch { return href; }
};

const fail = (reason) => ({ ok: false, reason });

export function parseHttpUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) return fail('Tempel URL terlebih dahulu.');
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\') || /^file:/i.test(s)) {
    return fail('Untuk PDF di komputer, gunakan tombol "PDF lokal".');
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
    if (/\s/.test(s) || !s.includes('.')) return fail('URL tidak valid.');
    s = 'https://' + s;
  }
  let u;
  try { u = new URL(s); } catch { return fail('URL tidak valid.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail('Hanya URL http:// atau https:// yang didukung.');
  if (!u.hostname) return fail('URL tidak valid.');
  if (u.username || u.password) return fail('URL yang memuat nama pengguna/kata sandi tidak diterima.');
  return { ok: true, url: u.href, key: matchKey(u.href), kind: /\.pdf$/i.test(u.pathname) ? 'pdf-url' : 'web' };
}

export function guessTitle(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return (u.hostname.replace(/^www\./, '') + (last ? ' / ' + last : '')).slice(0, 120);
  } catch { return url.slice(0, 120); }
}
