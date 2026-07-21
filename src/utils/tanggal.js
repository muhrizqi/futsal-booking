// Utilitas format tanggal & jam Bahasa Indonesia + logika slot/harga lapangan

const NAMA_HARI = ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', "Jum'at", 'Sabtu'];
const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** dateStr format 'YYYY-MM-DD' -> objek Date (UTC-safe, tanpa pergeseran zona waktu) */
function parseTanggal(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function namaHari(dateStr) {
  const d = parseTanggal(dateStr);
  return NAMA_HARI[d.getUTCDay()];
}

function namaBulan(bulanIndex1to12) {
  return NAMA_BULAN[bulanIndex1to12 - 1];
}

/** Format tanggal panjang: "Senin, 20 Juli 2026" */
function formatTanggalPanjang(dateStr) {
  const d = parseTanggal(dateStr);
  return `${namaHari(dateStr)}, ${d.getUTCDate()} ${namaBulan(d.getUTCMonth() + 1)} ${d.getUTCFullYear()}`;
}

/** Ubah 'HH:MM:SS' atau 'HH:MM' dari database menjadi format jam 24:00 tanpa AM/PM, mis. "24:00" bukan "00:00" */
function formatJam(timeStr) {
  if (!timeStr) return '';
  let [h, m] = timeStr.split(':');
  // Postgres TIME menyimpan 24:00 sbg 00:00 di beberapa driver; jam operasional kita anggap 00:00 == 24:00 (akhir hari)
  if (h === '00' && m === '00') return '24:00';
  return `${h}:${m}`;
}

/** Tambah menit ke string 'HH:MM', mengembalikan 'HH:MM' (boleh sampai '24:00') */
function tambahMenit(hhmm, menit) {
  const [h, m] = hhmm.split(':').map(Number);
  let total = h * 60 + m + menit;
  if (total >= 24 * 60) {
    // batasi representasi ke 24:00 untuk akhir hari
    if (total === 24 * 60) return '24:00';
    total -= 24 * 60;
  }
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function hhmmToMenit(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return (h === 24 ? 24 : h) * 60 + m;
}

/**
 * Cari aturan harga yang berlaku untuk jam_mulai tertentu, dari daftar price_rules venue.
 * priceRules: [{jam_mulai:'06:00:00', jam_selesai:'15:00:00', harga: '115000.00'}, ...]
 */
function cariHarga(priceRules, jamMulaiHHMM) {
  const menitMulai = hhmmToMenit(jamMulaiHHMM);
  for (const r of priceRules) {
    const rStart = hhmmToMenit(formatJam(r.jam_mulai));
    let rEnd = hhmmToMenit(formatJam(r.jam_selesai));
    if (rEnd === 0) rEnd = 24 * 60; // jaga-jaga jika tersimpan sbg 00:00
    if (menitMulai >= rStart && menitMulai < rEnd) {
      return Number(r.harga);
    }
  }
  return null;
}

/**
 * Bangkitkan seluruh slot booking dalam 1 hari untuk sebuah venue,
 * berdasarkan slot_menit venue (60 = per jam, 90 = per 1.5 jam) dan price_rules-nya.
 * Return: [{ jam_mulai:'06:00', jam_selesai:'07:00', harga:115000 }, ...]
 */
function bangkitkanSlotHarian(jamBukaHHMM, jamTutupHHMM, slotMenit, priceRules) {
  const slots = [];
  let cursor = jamBukaHHMM;
  const tutupMenit = hhmmToMenit(jamTutupHHMM === '00:00' ? '24:00' : jamTutupHHMM);
  while (hhmmToMenit(cursor) < tutupMenit) {
    const akhir = tambahMenit(cursor, slotMenit);
    const harga = cariHarga(priceRules, cursor);
    slots.push({ jam_mulai: cursor, jam_selesai: akhir, harga });
    cursor = akhir;
  }
  return slots;
}

module.exports = {
  NAMA_HARI,
  NAMA_BULAN,
  namaHari,
  namaBulan,
  formatTanggalPanjang,
  formatJam,
  tambahMenit,
  hhmmToMenit,
  cariHarga,
  bangkitkanSlotHarian,
};
