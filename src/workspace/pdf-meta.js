// Ekstraksi metadata sitasi dari PDF secara offline (tanpa jaringan).
// Urutan sumber: metadata PDF (XMP/Info) -> teks halaman 1-2 (heuristik, ditandai "perkiraan") -> nama file.
// Heuristik TIDAK dijamin benar; hasilnya selalu perlu diperiksa pengguna.

const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'dos', 'das', 'du', 'le', 'la', 'al', 'el', 'bin', 'binti', 'ibn', 'bt', 'ter', 'ten']);
const GENERIC_AUTHOR = /^(user|users|admin|administrator|owner|pc|hp|acer|asus|lenovo|dell|laptop|windows|microsoft|unknown|anonymous|author|penulis|guest|default|office|word|xerox|scanner|scan|printer|canon|epson|brother|samsung|apple|mac|macbook|iphone|android|root|test|tester|student|mahasiswa|dosen|komputer|computer|home|work|name|nama|none|null|n\/a|adobe|acrobat|pdf|latex|tex)$/i;
const AFFILIATION = /(universit|department|departement|institut|faculty|fakultas|school of|laborator|centre|center|jurusan|program studi|prodi|college|hospital|research|technology|science|chemistry|engineering|journal|abstract|abstrak|keywords?|kata kunci|received|accepted|published|article|review|corresponding|email|e-mail|correspondence|available online)/i;
const HEADER_NOISE = /(doi:|https?:|www\.|©|copyright|journal homepage|contents lists available|sciencedirect|issn|\bvol\.|volume \d|\bpp\.|downloaded from|arxiv:|preprint|manuscript|proof|creative commons|license)/i;
const UC = '\\p{Lu}';

export const cleanSpaces = (s) => String(s ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
const wordCount = (s) => cleanSpaces(s).split(' ').filter(Boolean).length;

export function looksLikeRealTitle(t, fileName = '') {
  const s = cleanSpaces(t);
  if (s.length < 6 || s.length > 400) return false;
  if (/^microsoft (word|powerpoint|excel|office)\b/i.test(s)) return false;
  if (/\.(docx?|pdf|tex|dvi|pptx?|indd|odt|rtf|txt|xlsx?)$/i.test(s)) return false;
  if (/^(untitled|document|dokumen|slide|presentation|presentasi|print|scan|new document)\s*\d*$/i.test(s)) return false;
  if (!/\p{L}/u.test(s)) return false;
  if (/^[a-f0-9]{12,}$/i.test(s.replace(/[\s_-]/g, ''))) return false;
  const norm = (x) => x.toLowerCase().replace(/\.pdf$/, '').replace(/[^a-z0-9]+/g, '');
  if (fileName && norm(s) === norm(fileName)) return false;
  return true;
}

const isInitials = (p) => /^(\p{Lu}\.?[\s-]?){1,3}$/u.test(p.trim());

// "A. Vaswani; N. Shazeer" / "Vaswani A, Shazeer N" / "Smith, J." -> daftar nama bersih
export function splitAuthorList(raw) {
  let s = cleanSpaces(raw)
    .replace(/[*†‡§¶#∗⁎⁰¹²³⁴⁵⁶⁷⁸⁹]/g, '')
    .replace(/(?<=[\p{L}.])\d+(?:\s*,\s*\d+)*/gu, '')
    .replace(/\s+(?:and|dan|&)\s+/g, ', ');
  const parts = (s.includes(';') ? s.split(';') : s.split(/[,·•|]/)).map(cleanSpaces).filter(Boolean);
  const merged = [];
  for (const p of parts) {
    if (merged.length && isInitials(p) && !s.includes(';')) merged[merged.length - 1] += ', ' + p; // "Smith, J."
    else merged.push(p);
  }
  return merged;
}

export function isNameLike(part) {
  if (!part || /\d|@/.test(part) || AFFILIATION.test(part)) return false;
  const toks = part.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (toks.length < 2 || toks.length > 6) return false;
  return toks.every((t) => new RegExp(`^(${UC}[\\p{L}'’.\\-]*|${UC}\\.)$`, 'u').test(t) || PARTICLES.has(t.toLowerCase()));
}

// "Ashish Vaswani" -> "Vaswani, Ashish"; "Vaswani A" -> "Vaswani, A"; sudah berformat "Belakang, Depan" dibiarkan.
export function toFamilyGiven(name) {
  const n = cleanSpaces(name);
  if (n.includes(',')) return n;
  const t = n.split(' ');
  if (t.length === 1) return n;
  if (isInitials(t[t.length - 1]) && t.length > 1 && !isInitials(t[0])) return `${t.slice(0, -1).join(' ')}, ${t[t.length - 1]}`;
  let i = t.length - 1;
  while (i > 1 && PARTICLES.has(t[i - 1].toLowerCase())) i--;
  return `${t.slice(i).join(' ')}, ${t.slice(0, i).join(' ')}`;
}

// Penulis dari field metadata (Info/XMP): buang nama generik ("User", "HP", nama pengguna Windows).
export function authorsFromMetadata(raw) {
  const list = (Array.isArray(raw) ? raw : [raw]).flatMap((r) => splitAuthorList(String(r ?? '').replace(/\n/g, ';')));
  return list.filter((a) => {
    if (a.length < 3 || /\d|@|\.docx?|\.pdf/i.test(a)) return false;
    const flat = a.replace(/[,.]/g, ' ').trim();
    if (flat.split(/\s+/).every((tok) => GENERIC_AUTHOR.test(tok))) return false; // mis. "Windows User"
    if (/^\p{Ll}+$/u.test(flat)) return false; // satu kata huruf kecil = nama pengguna
    return /\p{Lu}/u.test(a);
  }).map(toFamilyGiven);
}

export function findDoi(text) {
  const m = String(text || '').match(/\b10\.\d{4,9}\/[^\s"'<>\]]+/);
  return m ? m[0].replace(/[.,;:)\]}>]+$/, '') : '';
}

// Tahun terbit dari teks halaman. Mengembalikan { year, why } (why: untuk keterangan ke pengguna).
export function guessYear(text, nowYear = new Date().getFullYear()) {
  const ok = (y) => y >= 1900 && y <= nowYear + 1;
  const strong = [], weak = [];
  const grab = (re, bucket, label) => { for (const m of text.matchAll(re)) { const y = Number(m[m.length - 1]); if (ok(y)) bucket.push({ y, label }); } };
  grab(/(?:©|\(c\)|copyright)\s*(?:by\s*)?(?:the\s*)?(?:\p{L}+\s+){0,3}?((?:19|20)\d{2})/giu, strong, '©');
  grab(/arxiv:\d{4}\.\d{4,5}(?:v\d+)?\s*\[[^\]]+\]\s*\d{1,2}\s+\p{L}+\s+((?:19|20)\d{2})/giu, strong, 'tanggal arXiv');
  grab(/(?:published(?: online)?|available online|publication date|diterbitkan|terbit)[^\n]{0,50}?((?:19|20)\d{2})/giu, strong, 'tanggal terbit');
  grab(/(?:accepted|diterima)[^\n]{0,40}?((?:19|20)\d{2})/giu, weak, 'tanggal diterima');
  grab(/(?:received|revised|submitted)[^\n]{0,40}?((?:19|20)\d{2})/giu, weak, 'tanggal diterima');
  if (strong.length) { const b = strong.reduce((a, c) => (c.y > a.y ? c : a)); return { year: String(b.y), why: b.label }; }
  if (weak.length) { const b = weak.reduce((a, c) => (c.y > a.y ? c : a)); return { year: String(b.y), why: b.label }; }
  const freq = new Map();
  for (const m of text.matchAll(/\b((?:19|20)\d{2})\b/g)) { const y = Number(m[1]); if (ok(y) && y >= 1950) freq.set(y, (freq.get(y) || 0) + 1); }
  if (freq.size) { const [y] = [...freq].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]; return { year: String(y), why: 'tahun yang paling sering muncul' }; }
  return { year: '', why: '' };
}

// Gaya Elsevier: "Journal of Hazardous Materials, 123 (2020) 456-789" pada field Subject.
export function parseSubject(subject) {
  const s = cleanSpaces(subject);
  const m = s.match(/^(.{4,120}?),?\s*(?:vol\.?\s*)?\d+[^()]{0,30}\(((?:19|20)\d{2})\)/i);
  return m ? { venue: m[1].replace(/[,.\s]+$/, ''), year: m[2] } : null;
}

// items pdf.js -> baris teks [{ text, size, y, x0 }] dari atas ke bawah.
export function itemsToLines(items) {
  const cells = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const size = Math.abs(it.height) || Math.hypot(it.transform[2], it.transform[3]) || 0;
    cells.push({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, size });
  }
  cells.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const c of cells) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - c.y) <= Math.max(2, 0.45 * Math.min(last.size || c.size, c.size || last.size))) {
      last.cells.push(c); last.size = Math.max(last.size, c.size);
    } else lines.push({ y: c.y, size: c.size, cells: [c] });
  }
  return lines.map((l) => {
    l.cells.sort((a, b) => a.x - b.x);
    let text = '', prevEnd = null;
    for (const c of l.cells) {
      if (prevEnd !== null && c.x - prevEnd > 2 * l.size) text += ' | ';        // kolom terpisah (mis. nama penulis berdampingan)
      else if (prevEnd !== null && c.x - prevEnd > 0.18 * l.size && !text.endsWith(' ') && !c.s.startsWith(' ')) text += ' ';
      text += c.s; prevEnd = c.x + c.w;
    }
    return { text: cleanSpaces(text), size: Math.round(l.size * 10) / 10, y: l.y, x0: l.cells[0].x };
  }).filter((l) => l.text);
}

// Judul = blok baris berfont terbesar (>= 3 kata) di bagian atas halaman 1.
export function pickTitleBlock(lines, pageHeight) {
  const okLine = (l) => l.y > pageHeight * 0.3 && !HEADER_NOISE.test(l.text) && l.text.length >= 4;
  const cand = lines.filter((l) => okLine(l) && wordCount(l.text) >= 3 && l.text.length >= 12 && l.text.length <= 260
    && !/^(abstract|abstrak|keywords?|kata kunci|article info|a r t i c l e)/i.test(l.text));
  if (!cand.length) return null;
  const maxSize = Math.max(...cand.map((l) => l.size));
  const startIdx = lines.indexOf(cand.find((l) => l.size >= maxSize * 0.92));
  const parts = [lines[startIdx]];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i], prev = lines[i - 1];
    if (l.size >= maxSize * 0.92 && prev.y - l.y <= maxSize * 2.6 && !HEADER_NOISE.test(l.text)) parts.push(l); else break;
  }
  let text = '';
  for (const p of parts) {
    if (text.endsWith('-') && /^\p{Ll}/u.test(p.text)) text = text.slice(0, -1) + p.text;
    else text += (text ? ' ' : '') + p.text.replace(/ \| /g, ' ');
  }
  return { text: cleanSpaces(text), endIndex: startIdx + parts.length - 1, size: maxSize };
}

export function pickAuthorsFromLines(lines, fromIndex, titleSize) {
  const names = [];
  let authorSize = 0;
  for (let i = fromIndex; i < Math.min(lines.length, fromIndex + 5); i++) {
    const l = lines[i];
    if (/^(abstract|abstrak|keywords?|kata kunci|article info)/i.test(l.text) || l.size > titleSize) break;
    if (names.length && l.size < authorSize * 0.92) break; // font lebih kecil setelah nama = afiliasi
    if (HEADER_NOISE.test(l.text) && !names.length) continue;
    const parts = splitAuthorList(l.text);
    const good = parts.filter(isNameLike);
    if (parts.length && good.length >= Math.ceil(parts.length * 0.6)) { if (!names.length) authorSize = l.size; names.push(...good.map(toFamilyGiven)); }
    else if (names.length) break;
  }
  return [...new Set(names)];
}

const stripExt = (n) => cleanSpaces(String(n || '').replace(/\.pdf$/i, '').replace(/[_]+/g, ' '));

// Menggabungkan semua petunjuk. xmp: { title, creators[], doi, publication, coverDate, identifier }.
export function buildMetadata({ info = {}, xmp = {}, lines = [], text = '', pageHeight = 800, fileName = '', nowYear = new Date().getFullYear() }) {
  const r = { title: '', authors: [], year: '', venue: '', doi: '', from: {}, notes: [] };
  const hasText = text.trim().length > 40;

  // Judul
  const metaTitle = [info.Title, xmp.title].map(cleanSpaces).find((t) => looksLikeRealTitle(t, fileName));
  const block = hasText ? pickTitleBlock(lines, pageHeight) : null;
  if (metaTitle) { r.title = metaTitle; r.from.title = 'metadata PDF'; }
  else if (block) { r.title = block.text; r.from.title = 'halaman 1 (perkiraan)'; }
  else if (stripExt(fileName)) { r.title = stripExt(fileName); r.from.title = 'nama file'; }

  // Penulis
  const metaAuthors = authorsFromMetadata([...(xmp.creators || []), info.Author].filter(Boolean));
  if (metaAuthors.length) { r.authors = metaAuthors; r.from.authors = 'metadata PDF'; }
  else if (block) {
    const a = pickAuthorsFromLines(lines, block.endIndex + 1, block.size);
    if (a.length) { r.authors = a; r.from.authors = 'halaman 1 (perkiraan)'; }
  }

  // DOI
  const metaDoi = findDoi([xmp.doi, xmp.identifier, info.Subject, info.Keywords, info.doi].filter(Boolean).join(' '));
  if (metaDoi) { r.doi = metaDoi; r.from.doi = 'metadata PDF'; }
  else { const d = findDoi(text); if (d) { r.doi = d; r.from.doi = 'halaman 1-2'; } }

  // Tahun & jurnal
  const subj = parseSubject(info.Subject || '');
  const xmpYear = (String(xmp.coverDate || '').match(/\b((?:19|20)\d{2})\b/) || [])[1];
  if (subj) { r.venue = subj.venue; r.from.venue = 'metadata PDF'; }
  if (xmp.publication && !r.venue) { r.venue = cleanSpaces(xmp.publication); r.from.venue = 'metadata PDF'; }
  if (subj) { r.year = subj.year; r.from.year = 'metadata PDF'; }
  else if (xmpYear) { r.year = xmpYear; r.from.year = 'metadata PDF'; }
  else {
    const g = guessYear(text, nowYear);
    if (g.year) { r.year = g.year; r.from.year = `halaman 1-2 (${g.why}, perkiraan)`; }
  }

  if (!hasText) r.notes.push('PDF tampaknya hasil pindai (tanpa teks); hanya metadata berkas yang bisa dibaca. Isi detail secara manual.');
  r.found = ['title', 'authors', 'year', 'venue', 'doi'].filter((k) => (Array.isArray(r[k]) ? r[k].length : r[k]) && r.from[k] && r.from[k] !== 'nama file');
  return r;
}

let pdfjsPromise = null;
export function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../../vendor/pdfjs/pdf.min.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return m;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

const xmpGet = (md, name) => { try { return md && md.has && md.has(name) ? md.get(name) : null; } catch { return null; } };

// Membaca File PDF dan mengembalikan hasil buildMetadata. pdfjs dapat disuntikkan (untuk tes).
export async function extractFromFile(file, pdfjs) {
  const lib = pdfjs || (await loadPdfJs());
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await lib.getDocument({ data, isEvalSupported: false, verbosity: 0, useWorkerFetch: false }).promise;
  try {
    const m = await doc.getMetadata().catch(() => ({ info: {}, metadata: null }));
    const md = m.metadata;
    const creators = String(xmpGet(md, 'dc:creator') || '').split(/\n|;/).map(cleanSpaces).filter(Boolean);
    const xmp = {
      title: xmpGet(md, 'dc:title') || '', creators, doi: xmpGet(md, 'prism:doi') || '',
      identifier: xmpGet(md, 'dc:identifier') || '', publication: xmpGet(md, 'prism:publicationname') || xmpGet(md, 'prism:publicationName') || '',
      coverDate: xmpGet(md, 'prism:coverdate') || xmpGet(md, 'prism:coverDate') || xmpGet(md, 'prism:publicationdate') || ''
    };
    let lines1 = [], text = '', pageHeight = 800;
    for (let p = 1; p <= Math.min(doc.numPages, 2); p++) {
      const page = await doc.getPage(p);
      const lines = itemsToLines((await page.getTextContent()).items);
      if (p === 1) { lines1 = lines; pageHeight = page.getViewport({ scale: 1 }).height; }
      text += lines.map((l) => l.text).join('\n') + '\n';
    }
    return buildMetadata({ info: m.info || {}, xmp, lines: lines1, text, pageHeight, fileName: file.name || '' });
  } finally { await doc.destroy(); }
}
