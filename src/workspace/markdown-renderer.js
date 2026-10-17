// Renderer Markdown kecil tanpa dependensi.
// Keamanan: semua teks di-escape lebih dulu; hanya tag yang dibuat renderer ini yang
// menjadi HTML. URL tautan/gambar divalidasi lewat daftar skema yang diizinkan.

import { parseCitationGroup } from './citations.js';
import { highlight } from './highlight.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let CITE = null;    // (kunci) => { label, tip } | null — pencari sumber untuk sitasi [@kunci]
let BREAKS = false; // true: baris baru dalam paragraf menjadi <br> (gaya catatan)

export function safeUrl(url, { allowData = false } = {}) {
  const u = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
  if (allowData && /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(u)) return u;
  return null; // javascript:, file:, chrome-extension:, #anchor, relatif, dll. ditolak
}

function inline(text) {
  const stash = [];
  const hold = (html) => { stash.push(html); return `\u0000${stash.length - 1}\u0000`; };

  let s = text.replace(/\u0000/g, '');
  // 1) kode inline
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, code) => hold(`<code>${esc(code.trim())}</code>`));
  // 2) gambar
  s = s.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_, alt, url) => {
    const data = safeUrl(url, { allowData: true });
    if (data && data.startsWith('data:')) return hold(`<img src="${esc(data)}" alt="${esc(alt)}">`);
    const link = safeUrl(url);
    if (link) return hold(`<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">[gambar: ${esc(alt || link)}]</a>`);
    return hold(esc(alt));
  });
  // 2b) sitasi [@kunci] / [@a; @b, hlm. 3]
  s = s.replace(/\[(@[^\]\n]+)\](?!\()/g, (full, inner) => {
    const items = parseCitationGroup(inner);
    if (!items) return full;
    const html = items.map(({ key, locator }) => {
      const info = CITE ? CITE(key) : null;
      const label = info ? info.label : '?' + key;
      const tip = info ? info.tip || '' : 'Sumber dengan kunci ini tidak ada di daftar sumber';
      return `<span class="cite${info ? '' : ' missing'}" role="link" tabindex="0" data-cite="${esc(key)}" title="${esc(tip)}">${esc(label)}${locator ? ', ' + esc(locator) : ''}</span>`;
    }).join('; ');
    return hold(`(${html})`);
  });
  // 3) tautan
  s = s.replace(/\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_, label, url) => {
    const link = safeUrl(url);
    const inner = inline(label);
    return link ? hold(`<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${inner}</a>`) : hold(inner);
  });
  // 3b) URL telanjang -> tautan
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>]+)/g, (full, pre, url) => {
    const trail = url.match(/[.,;:!?)\]]+$/);
    const clean = trail ? url.slice(0, -trail[0].length) : url;
    const link = safeUrl(clean);
    if (!link) return full;
    return pre + hold(`<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(clean)}</a>`) + (trail ? trail[0] : '');
  });
  // 4) escape sisanya lalu format
  s = esc(s);
  s = s.replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
       .replace(/(^|[^\w])__(?=\S)([\s\S]+?)(?<=\S)__(?!\w)/g, '$1<strong>$2</strong>')
       .replace(/\*(?=[^\s*])([\s\S]+?)(?<=[^\s*])\*/g, '<em>$1</em>')
       .replace(/(^|[^\w])_(?=[^\s_])([\s\S]+?)(?<=[^\s_])_(?!\w)/g, '$1<em>$2</em>')
       .replace(/~~(?=\S)([\s\S]+?)(?<=\S)~~/g, '<del>$1</del>')
       .replace(BREAKS ? /\n/g : / {2,}\n/g, '<br>\n');
  // 5) kembalikan placeholder (bisa bersarang)
  for (let i = 0; i < 4; i++) {
    s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => stash[Number(n)] ?? '');
  }
  return s;
}

const isHr = (l) => /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l);
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)/;

function splitRow(row) {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1);
  return r.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}
const isTableStart = (lines, i) =>
  i + 1 < lines.length && lines[i].includes('|') && lines[i + 1].includes('-') &&
  TABLE_DELIM.test(lines[i + 1]) && (lines[i + 1].includes('|') || lines[i].includes('|'));

function isBlockStart(lines, i) {
  const l = lines[i];
  return FENCE_RE.test(l) || /^\s{0,3}#{1,6}\s+/.test(l) || isHr(l) || /^\s{0,3}>/.test(l) ||
    (LIST_RE.test(l)) || isTableStart(lines, i);
}

function buildList(items) {
  let html = '';
  const stack = [];
  for (const it of items) {
    const tag = it.ordered ? 'ol' : 'ul';
    while (stack.length && it.indent < stack[stack.length - 1].indent) {
      html += `</li></${stack.pop().tag}>`;
    }
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) { html += `<${tag}${tag === 'ol' && it.num !== null && it.num !== 1 ? ` start="${it.num}"` : ''}>`; stack.push({ indent: it.indent, tag }); }
    else html += '</li>';
    const task = it.task !== null;
    html += `<li${task ? ' class="task"' : ''}>${task ? `<input type="checkbox" disabled${it.task ? ' checked' : ''}> ` : ''}${inline(it.text)}`;
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

function parseList(lines, i) {
  const items = [];
  while (i < lines.length) {
    const l = lines[i];
    const m = isHr(l) ? null : l.match(LIST_RE);
    if (m) {
      let text = m[3]; let task = null;
      const t = text.match(/^\[([ xX])\]\s+(.*)$/);
      if (t) { task = t[1] !== ' '; text = t[2]; }
      items.push({ indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), num: /\d/.test(m[2]) ? parseInt(m[2], 10) : null, text, task });
      i++; continue;
    }
    if (/^\s*$/.test(l) && i + 1 < lines.length && LIST_RE.test(lines[i + 1]) && !isHr(lines[i + 1])) { i++; continue; }
    if (/^\s+\S/.test(l) && items.length) { items[items.length - 1].text += ' ' + l.trim(); i++; continue; }
    break;
  }
  return { html: buildList(items), next: i };
}

function renderBlocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }

    let m = line.match(FENCE_RE);
    if (m) {
      const fence = m[1]; const lang = m[2]; const buf = [];
      const closeRe = new RegExp(`^\\s{0,3}${fence[0]}{${fence.length},}\\s*$`);
      i++;
      while (i < lines.length && !closeRe.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code${lang ? ` class="language-${esc(lang)}"` : ''}>${highlight(buf.join('\n'), lang)}</code></pre>`);
      continue;
    }
    m = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*$/);
    if (m) { out.push(`<h${m[1].length} data-line="${i}">${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (isHr(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s{0,3}>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) { buf.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++; }
      out.push(`<blockquote>${renderBlocks(buf)}</blockquote>`);
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = splitRow(lines[i]);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) { rows.push(splitRow(lines[i])); i++; }
      const cell = (tag, c, k) => `<${tag}${aligns[k] ? ` align="${aligns[k]}"` : ''}>${inline(c ?? '')}</${tag}>`;
      out.push(`<table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>${
        rows.map((r) => `<tr>${head.map((_, k) => cell('td', r[k], k)).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (LIST_RE.test(line)) {
      const { html, next } = parseList(lines, i);
      out.push(html); i = next; continue;
    }
    // paragraf
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines, i)) { buf.push(lines[i]); i++; }
    out.push(`<p>${inline(buf.join('\n'))}</p>`);
  }
  return out.join('\n');
}

export function renderMarkdown(source, opts = {}) {
  BREAKS = !!opts.breaks;
  CITE = typeof opts.cite === 'function' ? opts.cite : null;
  try {
    const lines = String(source).replace(/\r\n?/g, '\n').replace(/\u0000/g, '').split('\n');
    return renderBlocks(lines);
  } finally { BREAKS = false; CITE = null; }
}
