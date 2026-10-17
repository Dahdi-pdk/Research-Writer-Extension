// Logika sitasi (murni, tanpa DOM). Sintaks di dalam Markdown memakai gaya Pandoc/BibTeX:
//   [@kunci]   [@kunci, hlm. 5]   [@a; @b, hlm. 3]
// sehingga file .md tetap Markdown biasa dan kompatibel dengan alat lain (mis. Pandoc --citeproc).
import { nextFenceState } from './blocks.js';

const KEY_CHARS = '[A-Za-z0-9_][A-Za-z0-9_:.\\-]*';
const KEY_RE = new RegExp('^' + KEY_CHARS + '$');
export const isValidKey = (k) => KEY_RE.test(k);

// "@a, hlm. 3; @b" -> [{key:'a', locator:'hlm. 3'}, {key:'b', locator:''}] atau null bila bukan sitasi valid.
export function parseCitationGroup(inner) {
  const item = new RegExp('^@(' + KEY_CHARS + ')(?:,\\s*(.+))?$');
  const out = [];
  for (const part of inner.split(';')) {
    const m = part.trim().match(item);
    if (!m) return null;
    out.push({ key: m[1].replace(/[.:\-]+$/, ''), locator: m[2] ? m[2].trim() : '' });
  }
  return out.length ? out : null;
}

export function parseAuthors(text) {
  return String(text || '').split(/\n|;/).map((s) => s.trim()).filter(Boolean);
}

export function familyName(author) {
  const a = String(author).trim();
  const braced = a.match(/^\{(.+)\}$/);
  if (braced) return braced[1].trim();
  if (a.includes(',')) return a.split(',')[0].trim();
  const parts = a.split(/\s+/);
  return parts[parts.length - 1].replace(/[.,]+$/, '');
}

export function authorLabel(authors) {
  const n = (authors || []).map(familyName).filter(Boolean);
  if (n.length === 0) return '';
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} & ${n[1]}`;
  return `${n[0]} et al.`;
}

function shortTitle(title) {
  const words = String(title || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return '“' + words.slice(0, 4).join(' ') + (words.length > 4 ? '…' : '') + '”';
}

// Label dalam teks: "Vaswani et al., 2017". Tanpa metadata -> judul singkat dan "t.t." (tanpa tahun).
export function citeLabel(src) {
  return `${authorLabel(src.authors) || shortTitle(src.title)}, ${(src.year || '').trim() || 't.t.'}`;
}

export function citeTip(src) {
  const a = (src.authors || []).join('; ');
  return [a, src.year ? `(${src.year})` : '', src.title].filter(Boolean).join(' ') + ' — klik untuk membuka sumber';
}

const ascii = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Kunci otomatis: penulis pertama + tahun (mis. vaswani2017); unik terhadap kunci yang sudah dipakai.
export function makeKey(src, taken = new Set()) {
  const base = ascii((src.authors && src.authors[0] ? familyName(src.authors[0]) : '') || String(src.title || '').split(/\s+/)[0] || 'ref')
    .toLowerCase().replace(/[^a-z0-9]/g, '') || 'ref';
  const year = /^\d{4}/.test((src.year || '').trim()) ? src.year.trim().slice(0, 4) : '';
  let key = base + year;
  if (!taken.has(key)) return key;
  for (const c of 'abcdefghijklmnopqrstuvwxyz') if (!taken.has(key + c)) return key + c;
  let n = 2; while (taken.has(`${key}${n}`)) n++;
  return `${key}${n}`;
}

// Kunci yang dikutip di dokumen, urut kemunculan, tanpa duplikat; blok kode & kode inline diabaikan.
export function citedKeys(content) {
  const kept = [];
  let fence = null;
  for (const line of content.split('\n')) {
    const inFenceBefore = fence !== null;
    fence = nextFenceState(fence, line);
    if (!inFenceBefore && fence === null && !/^\s{0,3}(`{3,}|~{3,})/.test(line)) kept.push(line.replace(/`[^`\n]*`/g, ''));
  }
  const keys = [];
  for (const m of kept.join('\n').matchAll(/\[(@[^\]\n]+)\](?!\()/g)) {
    const items = parseCitationGroup(m[1]);
    if (items) for (const { key } of items) if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

function formatAuthors(authors) {
  const a = (authors || []).map((x) => String(x).replace(/^\{(.+)\}$/, '$1'));
  if (a.length <= 1) return a[0] || '';
  return a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1];
}

// Satu entri daftar pustaka (gaya APA sederhana). Tautan dibuat otomatis oleh renderer.
export function formatReference(src) {
  const authors = formatAuthors(src.authors);
  const year = (src.year || '').trim() || 't.t.';
  const head = authors ? `${authors} (${year}). ${src.title}.` : `${src.title} (${year}).`;
  const parts = [head];
  if (src.venue) parts.push(`*${src.venue}*.`);
  if (src.doi) parts.push(/^https?:\/\//i.test(src.doi) ? src.doi : `https://doi.org/${src.doi}`);
  else if (src.url) parts.push(src.url);
  else if (src.fileName) parts.push(`(berkas lokal: ${src.fileName})`);
  return parts.join(' ').replace(/\n/g, ' ');
}

// { markdown, missing } — entri terurut abjad menurut label; kunci tanpa sumber dilaporkan di `missing`.
export function buildBibliography(content, sources) {
  const byKey = new Map(sources.filter((s) => s.citeKey).map((s) => [s.citeKey, s]));
  const used = [], missing = [];
  for (const k of citedKeys(content)) (byKey.has(k) ? used : missing).push(k);
  const entries = used.map((k) => byKey.get(k))
    .sort((a, b) => citeLabel(a).localeCompare(citeLabel(b), 'id'))
    .map(formatReference);
  return { markdown: entries.length ? '## Daftar Pustaka\n\n' + entries.join('\n') : '', missing };
}

// Berapa kali tiap kunci dikutip di dokumen (kode & kode inline diabaikan) -> Map(kunci -> jumlah).
export function citationCounts(content) {
  const kept = [];
  let fence = null;
  for (const line of content.split('\n')) {
    const inFenceBefore = fence !== null;
    fence = nextFenceState(fence, line);
    if (!inFenceBefore && fence === null && !/^\s{0,3}(`{3,}|~{3,})/.test(line)) kept.push(line.replace(/`[^`\n]*`/g, ''));
  }
  const counts = new Map();
  for (const m of kept.join('\n').matchAll(/\[(@[^\]\n]+)\](?!\()/g)) {
    const items = parseCitationGroup(m[1]);
    if (items) for (const { key } of items) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// Memisahkan sumber: "dikutip" = kuncinya muncul di dokumen aktif; "rest" = hanya terdaftar.
// cited diurut menurut label (seperti daftar pustaka); rest mengikuti urutan penambahan.
export function partitionSources(sources, counts) {
  const cited = [], rest = [];
  for (const s of sources) (s.citeKey && counts.has(s.citeKey) ? cited : rest).push(s);
  cited.sort((a, b) => citeLabel(a).localeCompare(citeLabel(b), 'id'));
  return { cited, rest };
}
