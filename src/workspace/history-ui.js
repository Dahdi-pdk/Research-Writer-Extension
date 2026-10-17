// Dialog "Riwayat versi": daftar titik pemulihan dokumen aktif + pratinjau + pulihkan.
const $ = (id) => document.getElementById(id);
const fmt = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
const kb = (n) => (n < 1024 ? `${n} karakter` : `${(n / 1024).toFixed(1)} KB`);

// getSnaps(): Promise<snapshot[]> terbaru dulu. onRestore(snap), onManual(): Promise. currentText(): isi editor sekarang.
export async function showHistory({ getSnaps, onRestore, onManual, currentText }) {
  const dlg = $('hist-dialog'), list = $('hist-list'), prev = $('hist-preview'), info = $('hist-info'), restore = $('hist-restore');
  let snaps = [], selected = null;
  const ac = new AbortController(); const sig = { signal: ac.signal };

  async function reload(selectId) {
    snaps = await getSnaps();
    selected = snaps.find((s) => s.id === selectId) || snaps[0] || null;
    render();
  }
  function render() {
    list.textContent = '';
    if (!snaps.length) list.appendChild(Object.assign(document.createElement('li'), { className: 'pick-empty', textContent: 'Belum ada titik pemulihan. Titik dibuat otomatis tiap ±5 menit saat Anda menulis, saat Simpan ke file, dan sebelum pemulihan.' }));
    for (const s of snaps) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pick-item'; b.setAttribute('aria-selected', String(selected && s.id === selected.id));
      b.append(Object.assign(document.createElement('span'), { className: 'pick-label', textContent: fmt.format(s.at) }),
        Object.assign(document.createElement('span'), { className: 'pick-title', textContent: `${s.label} · ${kb(s.chars)}` }));
      b.addEventListener('click', () => { selected = s; render(); });
      li.appendChild(b); list.appendChild(li);
    }
    prev.value = selected ? selected.content : '';
    const delta = selected ? selected.chars - currentText().length : 0;
    info.textContent = selected ? `Dibandingkan dengan isi sekarang: ${delta === 0 ? 'panjang sama' : (delta > 0 ? '+' : '') + delta + ' karakter'}.` : '';
    restore.disabled = !selected;
  }

  $('hist-close').addEventListener('click', () => dlg.close('close'), sig);
  $('hist-manual').addEventListener('click', async () => { const s = await onManual(); await reload(s && s.id); }, sig);
  restore.addEventListener('click', async () => { if (!selected) return; await onRestore(selected); dlg.close('restored'); }, sig);

  await reload();
  dlg.returnValue = '';
  dlg.showModal();
  await new Promise((res) => dlg.addEventListener('close', res, { once: true }));
  ac.abort();
}
