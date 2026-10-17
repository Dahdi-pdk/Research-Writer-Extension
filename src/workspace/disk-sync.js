// Menilai apakah file di disk berubah di luar editor, dan apa yang harus dilakukan.
//  none          : tidak ada perubahan
//  touch         : hanya waktu modifikasi berubah, isi sama dengan versi tersimpan terakhir
//  adopt         : isi di disk sama dengan isi editor sekarang (mis. disimpan dari tempat lain) -> cukup selaraskan penanda
//  reload-offer  : disk berubah, editor tidak punya perubahan belum tersimpan -> tawarkan muat ulang
//  conflict      : disk berubah DAN editor punya perubahan belum tersimpan -> pengguna memutuskan
export function evaluateDisk({ doc, disk, hashText }) {
  if (!doc || !doc.handle || !doc.fileHash) return 'none';
  if (disk.lastModified === doc.fileModified) return 'none';
  const diskHash = hashText(disk.text);
  if (diskHash === doc.fileHash) return 'touch';
  if (diskHash === hashText(doc.content)) return 'adopt';
  return doc.fileHash !== hashText(doc.content) ? 'conflict' : 'reload-offer';
}
