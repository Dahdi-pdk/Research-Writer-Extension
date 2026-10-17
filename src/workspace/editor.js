// Editor Markdown berbasis blok dengan render langsung (konsep "klik blok = sunting, keluar = render").
// - Blok tidak aktif tampil sebagai hasil render; blok aktif menjadi <textarea> berisi teks Markdown asli.
// - Teks dokumen tetap satu string Markdown biasa (tanpa penanda tambahan), lihat blocks.js.
import { renderMarkdown } from './markdown-renderer.js';
import { splitBlocks, joinBlocks, hasOpenFence } from './blocks.js';
import { extractHeadings } from './outline.js';

const HISTORY_MAX = 50;

export function createEditor({ container, root, sourceArea, onChange, onState, notify, cite, onCite, onLink, suggest, acceptSuggestion, onScroll }) {
  let blocks = splitBlocks('');
  let editing = -1;          // indeks blok yang sedang disunting
  let editBase = '';         // isi dokumen saat blok mulai disunting (untuk riwayat)
  let suppress = 0;          // >0: abaikan blur yang timbul dari operasi DOM kita sendiri
  let history = [], future = [];
  let sourceMode = false, sourceBase = '';

  const render = (raw) => renderMarkdown(raw, { breaks: true, cite });
  const getContent = () => (sourceMode ? sourceArea.value : joinBlocks(blocks));
  const withoutBlur = (fn) => { suppress++; try { fn(); } finally { suppress--; } };
  const emit = () => onChange && onChange(getContent());
  const emitState = () => onState && onState({ mode: sourceMode ? 'source' : editing >= 0 ? 'edit' : 'view', blocks: blocks.length });
  /* ---------- Saran sitasi saat mengetik "[@" ---------- */
  let sug = null; // { items, index, ta }
  const sugEl = document.createElement('div');
  sugEl.className = 'suggest'; sugEl.hidden = true; sugEl.setAttribute('role', 'listbox');
  document.body.appendChild(sugEl);

  function closeSuggest() { sug = null; sugEl.hidden = true; sugEl.textContent = ''; }

  function placeSuggest(ta, idx) {
    const cs = getComputedStyle(ta);
    const mirror = document.createElement('div');
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'boxSizing', 'tabSize'])
      mirror.style[p] = cs[p];
    Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '-9999px', width: ta.clientWidth + 'px' });
    mirror.textContent = ta.value.slice(0, idx);
    const mark = document.createElement('span'); mark.textContent = '\u200b';
    mirror.appendChild(mark); document.body.appendChild(mirror);
    const r = ta.getBoundingClientRect(), lh = parseFloat(cs.lineHeight) || 24;
    const x = r.left + mark.offsetLeft, y = r.top + mark.offsetTop + lh;
    mirror.remove();
    sugEl.style.left = Math.max(8, Math.min(x, window.innerWidth - 440)) + 'px';
    const h = sugEl.offsetHeight || 0;
    sugEl.style.top = (y + h > window.innerHeight - 8 ? Math.max(8, y - lh - h) : y) + 'px';
  }

  function renderSuggest() {
    sugEl.textContent = '';
    sug.items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'sug-item'; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(i === sug.index));
      const l = document.createElement('span'); l.className = 'sug-label'; l.textContent = it.label;
      const t = document.createElement('span'); t.className = 'sug-title'; t.textContent = it.title;
      row.append(l, t);
      row.addEventListener('mousedown', (e) => e.preventDefault()); // tetap fokus di editor
      row.addEventListener('click', () => acceptSuggest(i));
      sugEl.appendChild(row);
    });
  }

  function updateSuggest(ta) {
    if (!suggest) return;
    const caret = ta.selectionStart;
    if (ta.selectionEnd !== caret) { closeSuggest(); return; }
    const m = ta.value.slice(0, caret).match(/\[(?:[^\]\n]*;\s*)?@([A-Za-z0-9_:.\-]*)$/);
    const items = m ? suggest(m[1]) : null;
    if (!items || !items.length) { closeSuggest(); return; }
    sug = { items, index: 0, ta };
    renderSuggest(); sugEl.hidden = false;
    placeSuggest(ta, caret);
  }

  async function acceptSuggest(i) {
    if (!sug) return;
    const { items, ta } = sug;
    closeSuggest();
    let key;
    try { key = await acceptSuggestion(items[i]); }
    catch (e) { notify && notify('Gagal memakai sumber itu: ' + (e && e.message ? e.message : e)); return; }
    if (!key || !ta.isConnected) return;
    const caret = ta.selectionStart; // teks bisa berubah selama await: hitung ulang dari kursor
    const m = ta.value.slice(0, caret).match(/@([A-Za-z0-9_:.\-]*)$/);
    const start = m ? caret - m[0].length : caret;
    const hasClose = ta.value[caret] === ']';
    replaceRange(ta, start, caret, '@' + key + (hasClose ? '' : ']'));
    if (hasClose) { const p = start + 1 + key.length + 1; ta.setSelectionRange(p, p); }
  }

  function handleSuggestKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sug.index = (sug.index + (e.key === 'ArrowDown' ? 1 : sug.items.length - 1)) % sug.items.length;
      renderSuggest(); return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); acceptSuggest(sug.index); return true; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSuggest(); return true; }
    return false;
  }

  const autoGrow = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  const currentTextarea = () => (editing >= 0 && root.children[editing] ? root.children[editing].querySelector('textarea') : null);
  const reindex = () => Array.from(root.children).forEach((el, k) => { el.dataset.i = String(k); });

  function pushHistory(text) {
    history.push(text);
    if (history.length > HISTORY_MAX) history.shift();
    future = [];
  }

  /* ---------- DOM blok ---------- */
  function buildBlock(i) {
    const b = blocks[i];
    const wrap = document.createElement('div');
    wrap.className = 'block';
    wrap.dataset.i = String(i);
    if (i === editing) {
      wrap.classList.add('editing');
      const ta = document.createElement('textarea');
      ta.value = b.raw; ta.rows = 1; ta.spellcheck = false;
      ta.setAttribute('aria-label', 'Sumber Markdown blok');
      ta.addEventListener('input', () => { blocks[editing].raw = ta.value; autoGrow(ta); emit(); updateSuggest(ta); });
      ta.addEventListener('blur', () => {
        if (suppress) return;
        closeSuggest();
        if (typeof document.hasFocus === 'function' && !document.hasFocus()) return; // pindah jendela: tetap mode sunting
        leaveEdit();
      });
      ta.addEventListener('keydown', onKeydown);
      wrap.appendChild(ta);
    } else {
      const view = document.createElement('div');
      view.className = 'view';
      view.tabIndex = 0;
      view.setAttribute('aria-label', 'Blok. Tekan Enter untuk menyunting.');
      view.innerHTML = render(b.raw);
      view.addEventListener('click', (e) => {
        const c = e.target.closest('.cite');
        if (c) { e.preventDefault(); onCite && onCite(c.dataset.cite); return; }
        const a = e.target.closest('a');
        if (a) { if (onLink && onLink(a.href) === true) e.preventDefault(); return; }
        const sel = window.getSelection && window.getSelection();
        if (sel && !sel.isCollapsed) return; // sedang memilih teks untuk disalin
        startEdit(Number(wrap.dataset.i), 'end');
      });
      view.addEventListener('keydown', (e) => {
        if (e.target.classList && e.target.classList.contains('cite') && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault(); onCite && onCite(e.target.dataset.cite); return;
        }
        if (e.target === view && e.key === 'Enter') { e.preventDefault(); startEdit(Number(wrap.dataset.i), 'end'); }
      });
      wrap.appendChild(view);
    }
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'block-del'; del.textContent = '✕';
    del.title = 'Hapus blok (Ctrl+Shift+Backspace)'; del.setAttribute('aria-label', 'Hapus blok');
    del.addEventListener('mousedown', (e) => e.preventDefault());
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteBlock(Number(wrap.dataset.i)); });
    wrap.appendChild(del);
    return wrap;
  }

  function renderAll() {
    withoutBlur(() => {
      root.textContent = '';
      const frag = document.createDocumentFragment();
      blocks.forEach((_, i) => frag.appendChild(buildBlock(i)));
      root.appendChild(frag);
    });
  }
  function replaceBlockEl(i) {
    withoutBlur(() => root.replaceChild(buildBlock(i), root.children[i]));
  }

  /* ---------- Mulai / selesai menyunting ---------- */
  function startEdit(i, caret = 'end') {
    if (sourceMode || i < 0 || i >= blocks.length) return;
    if (editing === i) { const t = currentTextarea(); if (t) t.focus(); return; }
    if (editing >= 0) { const prev = editing; const d = leaveEdit(); if (i > prev) i += d; }
    if (i < 0 || i >= blocks.length) return;
    editing = i;
    editBase = joinBlocks(blocks);
    replaceBlockEl(i);
    const ta = currentTextarea();
    ta.focus();
    const pos = caret === 'end' ? ta.value.length : caret === 'start' ? 0 : Math.min(caret, ta.value.length);
    ta.setSelectionRange(pos, pos);
    autoGrow(ta);
    if (ta.scrollIntoView) ta.scrollIntoView({ block: 'nearest' });
    emitState();
  }

  // Mengembalikan perubahan jumlah blok (blok bisa terpecah atau dihapus bila kosong).
  function leaveEdit() {
    if (editing < 0) return 0;
    const i = editing;
    editing = -1;
    let delta = 0;
    withoutBlur(() => {
      const b = blocks[i];
      if (joinBlocks(blocks) !== editBase) pushHistory(editBase);
      const old = root.children[i];
      if (b.raw.trim() === '' && blocks.length > 1) {
        blocks.splice(i, 1);
        root.removeChild(old);
        delta = -1;
      } else {
        const pieces = splitBlocks(b.raw + b.tail); // lossless
        blocks.splice(i, 1, ...pieces);
        delta = pieces.length - 1;
        const frag = document.createDocumentFragment();
        for (let k = 0; k < pieces.length; k++) frag.appendChild(buildBlock(i + k));
        root.replaceChild(frag, old);
      }
      reindex();
    });
    emitState();
    return delta;
  }

  function newBlockBelow() {
    const i = editing;
    if (i < 0) return;
    blocks[i].raw = blocks[i].raw.replace(/\n+$/, '');
    const d = leaveEdit();
    const k = i + d + 1;
    const prev = blocks[k - 1];
    if (prev && prev.tail === '') prev.tail = '\n'; // pastikan ada baris kosong pemisah
    blocks.splice(k, 0, { raw: '', tail: '' });
    withoutBlur(() => { root.insertBefore(buildBlock(k), root.children[k] || null); reindex(); });
    emit();
    startEdit(k, 'start');
  }

  function appendBlockAtEnd() {
    if (editing >= 0) leaveEdit();
    const last = blocks.length - 1;
    if (blocks[last].raw.trim() === '') { startEdit(last, 'end'); return; }
    const k = blocks.length;
    if (blocks[k - 1].tail === '') blocks[k - 1].tail = '\n';
    blocks.push({ raw: '', tail: '' });
    withoutBlur(() => { root.appendChild(buildBlock(k)); reindex(); });
    emit();
    startEdit(k, 'start');
  }

  function deleteBlock(i) {
    const wasEditing = editing === i;
    if (editing >= 0 && !wasEditing) { const prev = editing; const d = leaveEdit(); if (i > prev) i += d; }
    pushHistory(joinBlocks(blocks));
    withoutBlur(() => {
      if (wasEditing) editing = -1;
      if (blocks.length === 1) { blocks[0] = { raw: '', tail: '' }; replaceBlockEl(0); }
      else { blocks.splice(i, 1); root.removeChild(root.children[i]); reindex(); }
    });
    emit(); emitState();
    notify && notify('Blok dihapus', { label: 'Urungkan', run: undo });
  }

  function mergeWithPrevious() {
    const i = editing;
    if (i <= 0) return;
    pushHistory(joinBlocks(blocks));
    const prev = blocks[i - 1], cur = blocks[i];
    const caret = prev.raw.length;
    prev.raw = prev.raw + (cur.raw ? '\n' + cur.raw : '');
    prev.tail = cur.tail;
    blocks.splice(i, 1);
    withoutBlur(() => { editing = -1; root.removeChild(root.children[i]); reindex(); });
    editing = i - 1;
    editBase = joinBlocks(blocks);
    replaceBlockEl(i - 1);
    const ta = currentTextarea();
    ta.focus(); ta.setSelectionRange(caret, caret); autoGrow(ta);
    emit(); emitState();
  }

  /* ---------- Posisi kursor & penyisipan (dipakai sitasi) ---------- */
  const blockLen = (b) => b.raw.length + b.tail.length + 1; // +1 untuk "\n" pemisah antarblok

  // Offset kursor di seluruh dokumen, atau null bila tidak ada blok yang sedang disunting.
  function getCaretOffset() {
    if (sourceMode) return sourceArea.selectionStart;
    const ta = currentTextarea();
    if (!ta) return null;
    let off = 0;
    for (let i = 0; i < editing; i++) off += blockLen(blocks[i]);
    return off + ta.selectionStart;
  }

  // Menyisipkan teks pada offset dokumen (tahan terhadap pergeseran indeks blok), lalu melanjutkan menyunting setelahnya.
  function insertAt(offset, text) {
    if (sourceMode) { replaceRange(sourceArea, offset, offset, text); return; }
    const content = joinBlocks(blocks);
    const o = Math.min(Math.max(0, offset), content.length);
    pushHistory(content);
    blocks = splitBlocks(content.slice(0, o) + text + content.slice(o));
    editing = -1;
    renderAll();
    emit();
    focusAt(o + text.length);
  }

  // Menyunting blok yang memuat offset dokumen tertentu, kursor diletakkan di offset itu.
  function focusAt(p) {
    if (sourceMode) { sourceArea.focus(); sourceArea.setSelectionRange(p, p); return; }
    let start = 0;
    for (let i = 0; i < blocks.length; i++) {
      const len = blocks[i].raw.length;
      if (p <= start + len || i === blocks.length - 1) { startEdit(i, Math.min(Math.max(p - start, 0), len)); return; }
      start += blockLen(blocks[i]);
    }
  }

  // Render ulang blok yang tidak sedang disunting (mis. setelah detail sumber berubah).
  function rerender() {
    if (sourceMode) return;
    withoutBlur(() => {
      for (let i = 0; i < blocks.length; i++) if (i !== editing) root.replaceChild(buildBlock(i), root.children[i]);
    });
  }

  /* ---------- Outline, posisi gulir, pemindahan blok ---------- */
  const raf = (f) => (typeof window !== 'undefined' && window.requestAnimationFrame ? window.requestAnimationFrame(f) : setTimeout(f, 16));

  function getHeadings() { return extractHeadings(sourceMode ? splitBlocks(sourceArea.value) : blocks); }

  function getHeadingTops(headings) {
    const ct = container.getBoundingClientRect().top;
    return headings.map((h) => { const el = root.children[h.block]; return el ? el.getBoundingClientRect().top - ct : Infinity; });
  }

  function revealBlock(i, offset) {
    if (sourceMode) {
      if (offset == null) return;
      sourceArea.focus(); sourceArea.setSelectionRange(offset, offset);
      const line = sourceArea.value.slice(0, offset).split('\n').length - 1;
      sourceArea.scrollTop = Math.max(0, line * (parseFloat(getComputedStyle(sourceArea).lineHeight) || 23) - 60);
      return;
    }
    const el = root.children[i];
    if (!el) return;
    const top = Math.max(0, el.offsetTop - 16);
    if (container.scrollTo) container.scrollTo({ top, behavior: 'smooth' }); else container.scrollTop = top;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1400);
  }

  function getScrollAnchor() {
    if (sourceMode) return null;
    const top = container.scrollTop;
    for (let i = 0; i < root.children.length; i++) {
      const el = root.children[i];
      if (el.offsetTop + el.offsetHeight > top) return { block: i, dy: top - el.offsetTop };
    }
    return { block: 0, dy: 0 };
  }
  function restoreScrollAnchor(a) {
    if (!a || sourceMode || !root.children.length) return;
    const el = root.children[Math.min(a.block, root.children.length - 1)];
    container.scrollTop = Math.max(0, el.offsetTop + (a.dy || 0));
  }

  let scrollQueued = false;
  container.addEventListener('scroll', () => {
    if (scrollQueued || !onScroll) return;
    scrollQueued = true;
    raf(() => { scrollQueued = false; onScroll(); });
  }, { passive: true });

  // Mengganti seluruh isi (mis. muat ulang dari disk / pulihkan versi) dengan tetap menyimpan riwayat urungkan.
  function replaceContent(text) {
    if (sourceMode) { sourceArea.value = text; emit(); return; }
    if (editing >= 0) leaveEdit();
    const cur = joinBlocks(blocks);
    if (text === cur) return;
    pushHistory(cur);
    load(text);
  }

  // Alt+↑/↓: menukar isi blok aktif dengan tetangganya (jarak baris kosong antarblok tetap di tempatnya).
  function moveBlock(dir) {
    const i = editing, j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const caret = currentTextarea().selectionStart;
    pushHistory(joinBlocks(blocks));
    [blocks[i].raw, blocks[j].raw] = [blocks[j].raw, blocks[i].raw];
    editing = -1;
    renderAll();
    emit();
    startEdit(j, caret);
  }

  /* ---------- Riwayat tingkat dokumen ---------- */
  function load(text) {
    blocks = splitBlocks(text);
    editing = -1;
    renderAll();
    emit(); emitState();
  }
  function undo() {
    if (sourceMode) return false;
    if (editing >= 0) leaveEdit();
    if (!history.length) return false;
    future.push(joinBlocks(blocks));
    load(history.pop());
    return true;
  }
  function redo() {
    if (sourceMode) return false;
    if (editing >= 0) leaveEdit();
    if (!future.length) return false;
    history.push(joinBlocks(blocks));
    load(future.pop());
    return true;
  }

  /* ---------- Penyuntingan teks (bantu) ---------- */
  function replaceRange(ta, start, end, text, selStart = start + text.length, selEnd = selStart) {
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try { ok = text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok) { // cadangan bila execCommand tidak tersedia (kehilangan undo bawaan textarea saja)
      ta.setRangeText(text, start, end, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ta.setSelectionRange(selStart, selEnd);
  }

  function wrapSel(ta, mark) {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, sel = v.slice(s, e), n = mark.length;
    const single = mark === '*';
    if (s >= n && v.slice(s - n, s) === mark && v.slice(e, e + n) === mark && !(single && (v[s - 2] === '*' || v[e + 1] === '*'))) {
      replaceRange(ta, s - n, e + n, sel, s - n, s - n + sel.length); return;
    }
    if (sel.length >= 2 * n && sel.startsWith(mark) && sel.endsWith(mark) && !(single && (sel[1] === '*'))) {
      replaceRange(ta, s, e, sel.slice(n, -n), s, e - 2 * n); return;
    }
    replaceRange(ta, s, e, mark + sel + mark, s + n, s + n + sel.length);
  }

  function lineRange(ta) {
    const v = ta.value, s = ta.selectionStart;
    let e = ta.selectionEnd;
    if (e > s && v[e - 1] === '\n') e--;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = v.indexOf('\n', e);
    if (le === -1) le = v.length;
    return { ls, le };
  }
  function transformLines(ta, fn) {
    const { ls, le } = lineRange(ta);
    const lines = ta.value.slice(ls, le).split('\n');
    const text = fn(lines).join('\n');
    const collapsed = ta.selectionStart === ta.selectionEnd;
    replaceRange(ta, ls, le, text, collapsed ? ls + text.length : ls, ls + text.length);
  }
  const nonBlank = (l) => l.trim() !== '';
  const stripList = (l) => l.replace(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '$1');

  const FORMATS = {
    h1: (ta) => heading(ta, 1), h2: (ta) => heading(ta, 2), h3: (ta) => heading(ta, 3),
    bold: (ta) => wrapSel(ta, '**'), italic: (ta) => wrapSel(ta, '*'),
    strike: (ta) => wrapSel(ta, '~~'), code: (ta) => wrapSel(ta, '`'),
    ul: (ta) => transformLines(ta, (ls) => ls.every((l) => !nonBlank(l) || /^\s*[-*+]\s+/.test(l))
      ? ls.map((l) => l.replace(/^(\s*)[-*+]\s+(?:\[[ xX]\]\s+)?/, '$1'))
      : ls.map((l) => (nonBlank(l) ? stripList(l).replace(/^(\s*)/, '$1- ') : l))),
    ol: (ta) => transformLines(ta, (ls) => {
      if (ls.every((l) => !nonBlank(l) || /^\s*\d+[.)]\s+/.test(l))) return ls.map((l) => l.replace(/^(\s*)\d+[.)]\s+/, '$1'));
      let n = 0; return ls.map((l) => nonBlank(l) ? l.replace(/^(\s*)(?:[-*+]|\d+[.)])\s+/, '$1').replace(/^(\s*)/, `$1${++n}. `) : l);
    }),
    task: (ta) => transformLines(ta, (ls) => ls.every((l) => !nonBlank(l) || /^\s*[-*+]\s+\[[ xX]\]\s+/.test(l))
      ? ls.map((l) => l.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, '$1'))
      : ls.map((l) => nonBlank(l) ? stripList(l).replace(/^(\s*)/, '$1- [ ] ') : l)),
    quote: (ta) => transformLines(ta, (ls) => ls.every((l) => !nonBlank(l) || /^\s*>/.test(l))
      ? ls.map((l) => l.replace(/^(\s*)>\s?/, '$1')) : ls.map((l) => nonBlank(l) ? '> ' + l : l)),
    codeblock(ta) {
      const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, sel = v.slice(s, e);
      const lead = s > 0 && v[s - 1] !== '\n' ? '\n' : '';
      if (sel) replaceRange(ta, s, e, lead + '```\n' + sel + '\n```', s + lead.length + 4, s + lead.length + 4 + sel.length);
      else replaceRange(ta, s, e, lead + '```\n\n```', s + lead.length + 4);
    },
    link(ta) {
      const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
      if (sel) replaceRange(ta, s, e, `[${sel}](https://)`, s + sel.length + 4, s + sel.length + 12);
      else replaceRange(ta, s, e, '[teks](https://)', s + 1, s + 5);
    },
    table(ta) {
      const v = ta.value, s = ta.selectionStart;
      const lead = s > 0 && v[s - 1] !== '\n' ? '\n\n' : '';
      replaceRange(ta, s, ta.selectionEnd, lead + '| Kolom A | Kolom B |\n| --- | --- |\n| isi | isi |');
    },
    hr(ta) {
      const v = ta.value, s = ta.selectionStart;
      replaceRange(ta, s, ta.selectionEnd, (v.trim() === '' ? '' : '\n\n') + '---\n\n');
    }
  };
  function heading(ta, level) {
    transformLines(ta, (ls) => ls.map((l) => {
      const m = l.match(/^(#{1,6})\s+/);
      if (m && m[1].length === level) return l.slice(m[0].length);
      return '#'.repeat(level) + ' ' + l.replace(/^#{1,6}\s+/, '');
    }));
  }

  function indentSelection(ta, outdent) {
    const { ls, le } = lineRange(ta);
    const s = ta.selectionStart, e = ta.selectionEnd;
    const collapsed = s === e;
    const lineText = ta.value.slice(ls, le);
    const isList = /^\s*(?:[-*+]|\d+[.)])\s+/.test(lineText);
    if (collapsed && !outdent && !isList) { replaceRange(ta, s, e, '  '); return; }
    const lines = lineText.split('\n');
    const out = lines.map((l) => (outdent ? l.replace(/^(?: {1,2}|\t)/, '') : '  ' + l));
    const text = out.join('\n');
    const firstDelta = out[0].length - lines[0].length;
    replaceRange(ta, ls, le, text, collapsed ? Math.max(ls, s + firstDelta) : ls, collapsed ? Math.max(ls, s + firstDelta) : ls + text.length);
  }

  function handleEnter(ta) {
    const v = ta.value, s = ta.selectionStart;
    if (s !== ta.selectionEnd) return false;
    if (hasOpenFence(v.slice(0, s))) return false;
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    let lineEnd = v.indexOf('\n', s); if (lineEnd === -1) lineEnd = v.length;
    const line = v.slice(lineStart, lineEnd);
    const atLineEnd = s === lineEnd;
    const m = line.match(/^(\s*)((\d{1,9})([.)])|[-*+])\s+(\[[ xX]\]\s+)?(.*)$/);
    if (m && atLineEnd) {
      if (m[6].trim() === '') { replaceRange(ta, lineStart, lineEnd, '', lineStart); return true; } // item kosong: keluar dari daftar
      const marker = m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2];
      replaceRange(ta, s, s, `\n${m[1]}${marker} ${m[5] ? '[ ] ' : ''}`);
      return true;
    }
    const singleLine = atLineEnd && s === v.length && !v.includes('\n');
    if (singleLine && (/^#{1,6}\s+\S/.test(line) || /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim()))) { newBlockBelow(); return true; }
    if (s === v.length && /\n$/.test(v) && v.trim() !== '') { newBlockBelow(); return true; } // Enter dua kali di akhir = blok baru
    return false;
  }

  function onKeydown(e) {
    if (e.isComposing) return;
    if (sug && handleSuggestKey(e)) return;
    const ta = e.target, mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    const run = (name) => { e.preventDefault(); FORMATS[name](ta); };
    if (e.key === 'Escape') { e.preventDefault(); ta.blur(); return; }
    if (mod && e.shiftKey) {
      if (e.key === 'Backspace') { e.preventDefault(); deleteBlock(editing); return; }
      if (key === 'x') return run('strike');
      if (key === 'c') return run('codeblock');
      if (e.code === 'Digit1') return run('h1');
      if (e.code === 'Digit2') return run('h2');
      if (e.code === 'Digit3') return run('h3');
    }
    if (mod && !e.shiftKey) {
      if (key === 'b') return run('bold');
      if (key === 'i') return run('italic');
      if (key === 'k') return run('link');
      if (e.key === 'Enter') { e.preventDefault(); newBlockBelow(); return; }
    }
    if (e.altKey && !mod && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveBlock(e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.key === 'Tab' && !mod && !e.altKey) { e.preventDefault(); indentSelection(ta, e.shiftKey); return; }
    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey) { if (handleEnter(ta)) e.preventDefault(); return; }
    const plain = !mod && !e.shiftKey && !e.altKey && ta.selectionStart === ta.selectionEnd;
    if (e.key === 'Backspace' && plain && ta.selectionStart === 0) { e.preventDefault(); mergeWithPrevious(); return; }
    if (e.key === 'ArrowUp' && plain && editing > 0 && !ta.value.slice(0, ta.selectionStart).includes('\n')) { e.preventDefault(); startEdit(editing - 1, 'end'); return; }
    if (e.key === 'ArrowDown' && plain && editing < blocks.length - 1 && !ta.value.slice(ta.selectionEnd).includes('\n')) { e.preventDefault(); startEdit(editing + 1, 'start'); }
  }

  /* ---------- Mode sumber (seluruh dokumen sebagai teks) ---------- */
  function setSourceMode(on) {
    if (on === sourceMode) return;
    if (on) {
      if (editing >= 0) leaveEdit();
      sourceArea.value = joinBlocks(blocks);
      sourceBase = sourceArea.value;
      sourceMode = true;
      container.classList.add('source-mode');
      sourceArea.focus();
    } else {
      const text = sourceArea.value;
      if (text !== sourceBase) pushHistory(sourceBase);
      sourceMode = false;
      container.classList.remove('source-mode');
      blocks = splitBlocks(text);
      renderAll();
    }
    emitState();
  }
  sourceArea.addEventListener('input', () => emit());

  /* ---------- Event global ---------- */
  container.addEventListener('click', (e) => {
    if (!sourceMode && (e.target === container || e.target === root)) appendBlockAtEnd();
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (mod && !e.shiftKey && key === 'z') { e.preventDefault(); undo(); }
    else if (mod && (key === 'y' || (e.shiftKey && key === 'z'))) { e.preventDefault(); redo(); }
  });

  return {
    getContent,
    setContent(text) {
      history = []; future = [];
      blocks = splitBlocks(text); editing = -1;
      if (sourceMode) { sourceArea.value = text; sourceBase = text; }
      renderAll(); emitState();
      container.scrollTop = 0;
    },
    commit: () => { if (editing >= 0) leaveEdit(); },
    getCaretOffset, insertAt, focusAt, rerender,
    getHeadings, getHeadingTops, revealBlock, getScrollAnchor, restoreScrollAnchor, replaceContent, moveBlock,
    undo, redo,
    isSourceMode: () => sourceMode,
    toggleSource: () => setSourceMode(!sourceMode),
    focusStart() { if (sourceMode) sourceArea.focus(); else startEdit(0, 'start'); },
    format(cmd) {
      if (!FORMATS[cmd]) return;
      let ta;
      if (sourceMode) ta = sourceArea;
      else { if (editing < 0) startEdit(blocks.length - 1, 'end'); ta = currentTextarea(); }
      if (ta) FORMATS[cmd](ta);
    }
  };
}
