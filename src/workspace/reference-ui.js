// Dialog "Detail referensi" dan "Sisipkan sitasi" (elemen <dialog> di index.html).
import { citeLabel, parseAuthors, isValidKey } from './citations.js';

const $ = (id) => document.getElementById(id);
const closed = (dlg) => new Promise((res) => dlg.addEventListener('close', () => res(dlg.returnValue), { once: true }));

// Mengembalikan { title, authors, year, venue, doi, citeKey } atau null bila dibatalkan.
export async function editReference(src, isKeyTaken, note = '') {
  const dlg = $('ref-dialog');
  const f = { title: $('ref-title'), authors: $('ref-authors'), year: $('ref-year'), venue: $('ref-venue'),
    doi: $('ref-doi'), key: $('ref-key'), url: $('ref-url') };
  const err = $('ref-error');
  f.title.value = src.title || '';
  f.authors.value = (src.authors || []).join('\n');
  f.year.value = src.year || ''; f.venue.value = src.venue || ''; f.doi.value = src.doi || '';
  f.key.value = src.citeKey || '';
  f.url.value = src.kind === 'pdf-local' ? `(berkas lokal) ${src.fileName || ''}` : src.url || '';
  err.hidden = true; dlg.returnValue = '';
  const noteEl = $('ref-note'); noteEl.textContent = note; noteEl.hidden = !note;

  const draft = () => ({ title: f.title.value, authors: parseAuthors(f.authors.value), year: f.year.value.trim() });
  const preview = () => { $('ref-preview').textContent = '(' + citeLabel(draft()) + ')'; };
  const ac = new AbortController();
  for (const el of [f.title, f.authors, f.year]) el.addEventListener('input', preview, { signal: ac.signal });
  $('ref-cancel').addEventListener('click', () => dlg.close('cancel'), { signal: ac.signal });
  $('ref-save').addEventListener('click', () => {
    const key = f.key.value.trim();
    let msg = '';
    if (!f.title.value.trim()) msg = 'Judul tidak boleh kosong.';
    else if (key && !isValidKey(key)) msg = 'Kunci hanya boleh berisi huruf, angka, _ : . - dan harus diawali huruf/angka/_.';
    else if (key && isKeyTaken(key)) msg = `Kunci "${key}" sudah dipakai sumber lain.`;
    err.textContent = msg; err.hidden = !msg;
    if (!msg) dlg.close('ok');
  }, { signal: ac.signal });

  preview();
  dlg.showModal();
  f.title.focus();
  const result = await closed(dlg);
  ac.abort();
  if (result !== 'ok') return null;
  return { title: f.title.value.trim().slice(0, 300), authors: parseAuthors(f.authors.value), year: f.year.value.trim(),
    venue: f.venue.value.trim(), doi: f.doi.value.trim(), citeKey: f.key.value.trim() };
}

// Mengembalikan { sources:[...], locator } atau null.
export async function pickSources(all) {
  const dlg = $('pick-dialog'), search = $('pick-search'), list = $('pick-list'), loc = $('pick-locator'), ok = $('pick-ok');
  const selected = new Set();
  search.value = ''; loc.value = ''; dlg.returnValue = '';
  const ac = new AbortController(); const sig = { signal: ac.signal };

  const sync = () => {
    ok.disabled = selected.size === 0;
    loc.disabled = selected.size !== 1;
    if (selected.size !== 1) loc.value = '';
  };
  function render() {
    const q = search.value.trim().toLowerCase();
    list.textContent = '';
    const shown = all.filter((s) => !q || [s.title, (s.authors || []).join(' '), s.year, s.citeKey, s.url].join(' ').toLowerCase().includes(q));
    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'pick-empty';
      li.textContent = all.length ? 'Tidak ada sumber yang cocok.' : 'Belum ada sumber. Tambahkan di tab Sumber (URL atau PDF lokal).';
      list.appendChild(li);
    }
    for (const s of shown) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pick-item'; b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(selected.has(s.id)));
      const l = document.createElement('span'); l.className = 'pick-label'; l.textContent = citeLabel(s);
      const t = document.createElement('span'); t.className = 'pick-title'; t.textContent = s.title;
      b.append(l, t);
      b.addEventListener('click', () => { selected.has(s.id) ? selected.delete(s.id) : selected.add(s.id); b.setAttribute('aria-selected', String(selected.has(s.id))); sync(); });
      li.appendChild(b); list.appendChild(li);
    }
    sync();
  }
  search.addEventListener('input', render, sig);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { const f = list.querySelector('.pick-item'); if (f) { e.preventDefault(); f.focus(); } }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (!selected.size) { const f = list.querySelector('.pick-item'); if (!f) return; f.click(); }
      dlg.close('ok');
    }
  }, sig);
  list.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll('.pick-item')], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? items[i - 1] : search).focus(); }
  }, sig);
  $('pick-cancel').addEventListener('click', () => dlg.close('cancel'), sig);
  ok.addEventListener('click', () => { if (selected.size) dlg.close('ok'); }, sig);

  render();
  dlg.showModal();
  search.focus();
  const result = await closed(dlg);
  ac.abort();
  if (result !== 'ok' || !selected.size) return null;
  const locator = selected.size === 1 ? loc.value.replace(/[\[\];\n]/g, ' ').trim() : '';
  return { sources: all.filter((s) => selected.has(s.id)), locator };
}
