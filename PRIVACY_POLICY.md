# Kebijakan Privasi — ResearchWriter

Terakhir diperbarui: 18 Oktober 2026

ResearchWriter adalah ekstensi browser untuk menulis dokumen ilmiah dan mengelola sumber referensi. Kebijakan ini menjelaskan data apa yang ditangani.

## Ringkasan
ResearchWriter **tidak mengumpulkan, mengirim, menjual, atau membagikan data pribadi apa pun**. Ekstensi tidak memiliki server, akun pengguna, iklan, analitik, atau telemetri, dan tidak melakukan permintaan jaringan sendiri.

## Data yang disimpan di perangkat Anda
Data berikut hanya disimpan secara lokal di profil browser Anda (IndexedDB dan `chrome.storage.local`) dan tidak pernah meninggalkan perangkat:
- isi dokumen Markdown, riwayat versi, dan titik pemulihan;
- daftar sumber referensi (URL, referensi ke berkas PDF lokal, serta metadata seperti judul, penulis, tahun, jurnal, DOI);
- preferensi tampilan (tema, lebar panel, dokumen aktif).

Menghapus data ekstensi atau mencopot ekstensi dari browser menghapus data ini. Dokumen yang Anda simpan ke berkas `.md` berada di lokasi pilihan Anda dan sepenuhnya menjadi milik Anda.

## Akses berkas
Berkas Markdown, PDF, dan folder hanya diakses setelah Anda memilihnya lewat dialog berkas browser. Isi PDF dibaca di perangkat (halaman 1–2) untuk mengekstrak metadata sitasi dan tidak diunggah.

## Izin browser
- `storage`: menyimpan preferensi.
- `tabs`: membaca URL, judul, dan status tab untuk mengenali serta mengaktifkan tab sumber yang sudah terbuka. Ekstensi tidak membaca isi halaman web dan tidak mengirim daftar tab ke pihak mana pun.

## Pihak ketiga
Ekstensi membundel PDF.js (Mozilla, lisensi Apache-2.0) secara lokal. Tidak ada layanan, CDN, atau skrip pihak ketiga yang dimuat dari internet. Tautan di dokumen atau daftar sumber hanya dibuka di tab browser saat Anda mengkliknya, dan situs tujuan tunduk pada kebijakannya sendiri.

## Anak-anak
Ekstensi tidak ditujukan khusus untuk anak-anak dan tidak mengumpulkan data dari siapa pun.

## Perubahan
Perubahan kebijakan akan dicantumkan di halaman ini dengan tanggal pembaruan baru.

## Kontak
[ISI: nama pengembang/organisasi] · [ISI: alamat email]

---

# Privacy Policy — ResearchWriter (English)

Last updated: October 18, 2026

ResearchWriter does **not collect, transmit, sell, or share any personal data**. It has no server, accounts, ads, analytics, or telemetry, and makes no network requests of its own.

**Stored on your device only** (IndexedDB and `chrome.storage.local`): document text and version history, the reference source list (URLs, references to local PDF files, citation metadata), and display preferences. Uninstalling the extension or clearing its data removes them. Files you save as `.md` live where you choose.

**File access:** Markdown files, PDFs, and folders are accessed only after you pick them in the browser's file dialog. PDF text (pages 1–2) is read on-device to extract citation metadata and is never uploaded.

**Permissions:** `storage` saves preferences; `tabs` reads tab URL/title/status so the extension can recognise and activate already-open source tabs. It does not read page contents or share tab information.

**Third parties:** PDF.js (Mozilla, Apache-2.0) is bundled locally. No third-party services, CDNs, or remote scripts are loaded.

**Contact:** [FILL IN: developer/organization name] · [FILL IN: email]
