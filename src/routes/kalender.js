const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../db');
const {
  namaHari, namaBulan, formatTanggalPanjang, formatJam, bangkitkanSlotHarian,
} = require('../utils/tanggal');

/** Auth opsional: kalau ada token valid, isi req.user; kalau tidak, tetap lanjut (akses publik). */
function authOpsional(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try { req.user = jwt.verify(token, process.env.JWT_SECRET); } catch (e) { /* abaikan token tidak valid */ }
  }
  next();
}

async function ambilVenue(slug) {
  const v = (await pool.query('SELECT * FROM venues WHERE slug = $1', [slug])).rows[0];
  return v || null;
}

// GET /api/kalender/:slug/bulan?tahun=2026&bulan=7
// Ringkasan tiap tanggal dalam sebulan: total slot vs jumlah slot yang sudah terisi (semua lapangan digabung)
router.get('/:slug/bulan', async (req, res) => {
  try {
    const venue = await ambilVenue(req.params.slug);
    if (!venue) return res.status(404).json({ error: 'Tempat tidak ditemukan.' });

    const tahun = parseInt(req.query.tahun, 10);
    const bulan = parseInt(req.query.bulan, 10); // 1-12
    if (!tahun || !bulan) return res.status(400).json({ error: 'Parameter tahun dan bulan wajib diisi.' });

    const courts = (await pool.query('SELECT id FROM courts WHERE venue_id = $1 AND aktif = TRUE', [venue.id])).rows;
    const rules = (await pool.query('SELECT * FROM price_rules WHERE venue_id = $1 ORDER BY urutan', [venue.id])).rows;
    const slotPerHari = bangkitkanSlotHarian(formatJam(venue.jam_buka), formatJam(venue.jam_tutup), venue.slot_menit, rules).length;
    const totalSlotHariIni = slotPerHari * courts.length;

    const jumlahHari = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
    const tglAwal = `${tahun}-${String(bulan).padStart(2, '0')}-01`;
    const tglAkhir = `${tahun}-${String(bulan).padStart(2, '0')}-${String(jumlahHari).padStart(2, '0')}`;

    const terisiRows = (await pool.query(
      `SELECT tanggal::text as tanggal, COUNT(*)::int as jumlah
       FROM bookings
       WHERE venue_id = $1 AND status = 'booked' AND tanggal BETWEEN $2 AND $3
       GROUP BY tanggal`,
      [venue.id, tglAwal, tglAkhir],
    )).rows;
    const peta = {};
    terisiRows.forEach((r) => { peta[r.tanggal] = r.jumlah; });

    const hari = [];
    for (let d = 1; d <= jumlahHari; d += 1) {
      const tgl = `${tahun}-${String(bulan).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const terisi = peta[tgl] || 0;
      hari.push({
        tanggal: tgl,
        tanggalNum: d,
        namaHari: namaHari(tgl),
        totalSlot: totalSlotHariIni,
        terisi,
        kosong: totalSlotHariIni - terisi,
        status: terisi === 0 ? 'kosong' : (terisi >= totalSlotHariIni ? 'penuh' : 'sebagian'),
      });
    }

    res.json({
      venue: { id: venue.id, slug: venue.slug, nama: venue.nama },
      tahun,
      bulan,
      namaBulan: namaBulan(bulan),
      hari,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil ringkasan kalender.' });
  }
});

// GET /api/kalender/:slug/hari?tanggal=2026-07-20
// Detail slot per lapangan pada satu tanggal: kosong / terisi (+ nama tim jika terisi)
router.get('/:slug/hari', authOpsional, async (req, res) => {
  try {
    const venue = await ambilVenue(req.params.slug);
    if (!venue) return res.status(404).json({ error: 'Tempat tidak ditemukan.' });

    const tanggal = req.query.tanggal;
    if (!tanggal || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
      return res.status(400).json({ error: 'Parameter tanggal wajib diisi, format YYYY-MM-DD.' });
    }

    const courts = (await pool.query('SELECT * FROM courts WHERE venue_id = $1 AND aktif = TRUE ORDER BY id', [venue.id])).rows;
    const rules = (await pool.query('SELECT * FROM price_rules WHERE venue_id = $1 ORDER BY urutan', [venue.id])).rows;
    const slotTemplate = bangkitkanSlotHarian(formatJam(venue.jam_buka), formatJam(venue.jam_tutup), venue.slot_menit, rules);

    const bookedRows = (await pool.query(
      `SELECT b.id, b.court_id, b.jam_mulai::text as jam_mulai, b.jam_selesai::text as jam_selesai,
              b.harga, b.status_pembayaran, b.metode_pembayaran, b.cash_dipegang_oleh, b.rekening_tujuan, b.catatan_pembayaran, b.catatan,
              c.nama_tim, c.nama as nama_pelanggan, c.no_wa
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       WHERE b.venue_id = $1 AND b.tanggal = $2 AND b.status = 'booked'`,
      [venue.id, tanggal],
    )).rows;

    const isAdmin = !!req.user;

    const hasilLapangan = courts.map((court) => {
      const bookedDiLapanganIni = bookedRows.filter((b) => b.court_id === court.id);
      const slots = slotTemplate.map((s) => {
        const bk = bookedDiLapanganIni.find((b) => formatJam(b.jam_mulai) === s.jam_mulai);
        if (bk) {
          const info = { jam_mulai: s.jam_mulai, jam_selesai: s.jam_selesai, harga: s.harga, status: 'terisi', nama_tim: bk.nama_tim || bk.nama_pelanggan };
          if (isAdmin) {
            info.booking_id = bk.id;
            info.nama_pelanggan = bk.nama_pelanggan;
            info.no_wa = bk.no_wa;
            info.status_pembayaran = bk.status_pembayaran;
            info.metode_pembayaran = bk.metode_pembayaran;
            info.cash_dipegang_oleh = bk.cash_dipegang_oleh;
            info.rekening_tujuan = bk.rekening_tujuan;
            info.catatan_pembayaran = bk.catatan_pembayaran;
            info.catatan = bk.catatan;
          }
          return info;
        }
        return { jam_mulai: s.jam_mulai, jam_selesai: s.jam_selesai, harga: s.harga, status: 'kosong' };
      });
      return { court_id: court.id, nama: court.nama, warna: court.warna, slots };
    });

    res.json({
      venue: { id: venue.id, slug: venue.slug, nama: venue.nama, admin_wa: venue.admin_wa },
      tanggal,
      namaTanggalPanjang: formatTanggalPanjang(tanggal),
      lapangan: hasilLapangan,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil jadwal harian.' });
  }
});

module.exports = router;
