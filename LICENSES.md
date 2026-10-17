# Lisensi dan pustaka pihak ketiga

## PDF.js (Mozilla) — `vendor/pdfjs/`
- Versi: **pdfjs-dist 4.10.38** (build `pdf.min.mjs` dan `pdf.worker.min.mjs`, tanpa perubahan).
- Lisensi: **Apache-2.0** (teks lengkap: `vendor/pdfjs/LICENSE`).
- Dipakai hanya untuk membaca metadata dan teks halaman 1–2 PDF lokal (ekstraksi sitasi otomatis). Dimuat dari berkas ekstensi,
  tidak ada CDN dan tidak ada permintaan jaringan.
- Cara memperbarui: `npm pack pdfjs-dist@<versi>`, ekstrak, salin `build/pdf.min.mjs`, `build/pdf.worker.min.mjs`, dan `LICENSE`
  ke `vendor/pdfjs/`, lalu perbarui versi di berkas ini dan jalankan `node --test tests/*.test.mjs`.
  Versi 4.x membutuhkan Edge/Chromium 120 atau lebih baru (lihat `minimum_chrome_version` di `manifest.json`).

## Kode lain
Renderer Markdown, editor blok, pengelola tab, logika sitasi, dan heuristik ekstraksi metadata ditulis sendiri tanpa pustaka tambahan.
