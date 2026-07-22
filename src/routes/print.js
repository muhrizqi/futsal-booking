const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { wajibLogin } = require('../middleware/auth');

// Cetak dibuka di tab baru, jadi izinkan token dikirim lewat query string (?token=...) selain header Authorization
router.use((req, res, next) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
});
const {
  namaBulan, formatTanggalPanjang, formatJam, bangkitkanSlotHarian, namaHari,
} = require('../utils/tanggal');

function cekAksesVenueId(user, venueId) {
  if (user.role === 'admin_utama') return true;
  return user.role === 'admin_khusus' && user.venue_id === Number(venueId);
}

function bungkusHtml(judul, isi) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>${judul}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 20px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 0 0 16px; color: #555; font-weight: normal; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 22px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; text-align: left; }
  th { background: #f0f0f0; }
  .terisi { background: #ffe1e1; }
  .kosong { background: #e6f8ec; }
  .badge-hijau { color: #1a7a3c; font-weight: 600; }
  .badge-biru { color: #1a4f9c; font-weight: 600; }
  .cetak-tombol { margin-bottom: 16px; }
  .cetak-tombol button { padding: 8px 16px; font-size: 14px; cursor: pointer; }
  @media print { .cetak-tombol { display: none; } }
  .venue-block { margin-bottom: 26px; page-break-inside: avoid; }
</style>
</head>
<body>
<div class="cetak-tombol"><button onclick="window.print()">Cetak Halaman Ini</button></div>
${isi}
</body>
</html>`;
}

// GET /api/print/harian?venue_id=&tanggal=YYYY-MM-DD
router.get('/harian', wajibLogin, async (req, res) => {
  try {
    const { venue_id, tanggal } = req.query;
    if (!venue_id || !tanggal) return res.status(400).send('Parameter venue_id dan tanggal wajib diisi.');
    if (!cekAksesVenueId(req.user, venue_id)) return res.status(403).send('Anda tidak memiliki akses ke tempat ini.');

    const venue = (await pool.query('SELECT * FROM venues WHERE id = $1', [venue_id])).rows[0];
    if (!venue) return res.status(404).send('Tempat tidak ditemukan.');

    const courts = (await pool.query('SELECT * FROM courts WHERE venue_id = $1 AND aktif = TRUE ORDER BY id', [venue_id])).rows;
    const rules = (await pool.query('SELECT * FROM price_rules WHERE venue_id = $1 ORDER BY urutan', [venue_id])).rows;
    const slotTemplate = bangkitkanSlotHarian(formatJam(venue.jam_buka), formatJam(venue.jam_tutup), venue.slot_menit, rules);

    const bookedRows = (await pool.query(
      `SELECT b.court_id, b.jam_mulai::text as jam_mulai, b.status_pembayaran, c.nama_tim, c.nama as nama_pelanggan, c.no_wa
       FROM bookings b JOIN customers c ON c.id = b.customer_id
       WHERE b.venue_id = $1 AND b.tanggal = $2 AND b.status = 'booked'`,
      [venue_id, tanggal],
    )).rows;

    const LABEL_BAYAR = { belum_bayar: 'Belum Bayar', dp: 'DP', lunas: 'Lunas' };

    let tabel = '';
    courts.forEach((court) => {
      tabel += `<h3>Lapangan ${court.nama}</h3><table><tr><th>Jam</th><th>Status</th><th>Tim / Pelanggan</th><th>No. WA</th><th>Pembayaran</th></tr>`;
      slotTemplate.forEach((s) => {
        const bk = bookedRows.find((b) => b.court_id === court.id && formatJam(b.jam_mulai) === s.jam_mulai);
        if (bk) {
          tabel += `<tr class="terisi"><td>${s.jam_mulai} - ${s.jam_selesai}</td><td>Terisi</td><td>${bk.nama_tim || bk.nama_pelanggan}</td><td>${bk.no_wa}</td><td>${LABEL_BAYAR[bk.status_pembayaran] || '-'}</td></tr>`;
        } else {
          tabel += `<tr class="kosong"><td>${s.jam_mulai} - ${s.jam_selesai}</td><td>Kosong</td><td>-</td><td>-</td><td>-</td></tr>`;
        }
      });
      tabel += '</table>';
    });

    const html = bungkusHtml(
      `Jadwal Harian - ${venue.nama}`,
      `<h1>Jadwal Harian — ${venue.nama}</h1><h2>${formatTanggalPanjang(tanggal)}</h2>${tabel}`,
    );
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal membuat jadwal cetak harian.');
  }
});

// GET /api/print/bulanan?venue_id=&tahun=&bulan=
router.get('/bulanan', wajibLogin, async (req, res) => {
  try {
    const { venue_id, tahun, bulan } = req.query;
    if (!venue_id || !tahun || !bulan) return res.status(400).send('Parameter venue_id, tahun, dan bulan wajib diisi.');
    if (!cekAksesVenueId(req.user, venue_id)) return res.status(403).send('Anda tidak memiliki akses ke tempat ini.');

    const venue = (await pool.query('SELECT * FROM venues WHERE id = $1', [venue_id])).rows[0];
    if (!venue) return res.status(404).send('Tempat tidak ditemukan.');

    const courts = (await pool.query('SELECT * FROM courts WHERE venue_id = $1 AND aktif = TRUE ORDER BY id', [venue_id])).rows;

    const jumlahHari = new Date(Date.UTC(Number(tahun), Number(bulan), 0)).getUTCDate();
    const tglAwal = `${tahun}-${String(bulan).padStart(2, '0')}-01`;
    const tglAkhir = `${tahun}-${String(bulan).padStart(2, '0')}-${String(jumlahHari).padStart(2, '0')}`;

    const rows = (await pool.query(
      `SELECT b.court_id, b.tanggal::text as tanggal, b.jam_mulai::text as jam_mulai, b.jam_selesai::text as jam_selesai,
              c.nama_tim, c.nama as nama_pelanggan, ct.nama as court_nama
       FROM bookings b JOIN customers c ON c.id = b.customer_id JOIN courts ct ON ct.id = b.court_id
       WHERE b.venue_id = $1 AND b.status = 'booked' AND b.tanggal BETWEEN $2 AND $3
       ORDER BY b.tanggal, ct.id, b.jam_mulai`,
      [venue_id, tglAwal, tglAkhir],
    )).rows;

    let tabel = '<table><tr><th>Tanggal</th><th>Hari</th><th>Lapangan</th><th>Jam</th><th>Tim / Pelanggan</th></tr>';
    if (rows.length === 0) {
      tabel += '<tr><td colspan="5">Belum ada booking pada bulan ini.</td></tr>';
    } else {
      rows.forEach((r) => {
        tabel += `<tr><td>${r.tanggal.split('-').reverse().join('-')}</td><td>${namaHari(r.tanggal)}</td><td>${r.court_nama}</td><td>${formatJam(r.jam_mulai)} - ${formatJam(r.jam_selesai)}</td><td>${r.nama_tim || r.nama_pelanggan}</td></tr>`;
      });
    }
    tabel += '</table>';

    const html = bungkusHtml(
      `Jadwal Bulanan - ${venue.nama}`,
      `<h1>Jadwal Bulanan — ${venue.nama}</h1><h2>${namaBulan(Number(bulan))} ${tahun}</h2>${tabel}`,
    );
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal membuat jadwal cetak bulanan.');
  }
});

module.exports = router;
