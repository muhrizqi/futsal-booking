const express = require('express');
const router = express.Router();
const pool = require('../db');
const { formatJam } = require('../utils/tanggal');

// GET /api/venues -> daftar semua tempat + lapangan + aturan harga (untuk halaman publik)
router.get('/', async (req, res) => {
  try {
    const venues = (await pool.query('SELECT * FROM venues ORDER BY id')).rows;
    const courts = (await pool.query('SELECT * FROM courts WHERE aktif = TRUE ORDER BY venue_id, id')).rows;
    const rules = (await pool.query('SELECT * FROM price_rules ORDER BY venue_id, urutan')).rows;

    const hasil = venues.map((v) => ({
      id: v.id,
      slug: v.slug,
      nama: v.nama,
      alamat: v.alamat,
      jenis: v.jenis,
      admin_wa: v.admin_wa,
      slot_menit: v.slot_menit,
      jam_buka: formatJam(v.jam_buka),
      jam_tutup: formatJam(v.jam_tutup),
      lapangan: courts.filter((c) => c.venue_id === v.id).map((c) => ({ id: c.id, nama: c.nama, warna: c.warna })),
      harga: rules.filter((r) => r.venue_id === v.id).map((r) => ({
        jam_mulai: formatJam(r.jam_mulai),
        jam_selesai: formatJam(r.jam_selesai),
        harga: Number(r.harga),
      })),
    }));

    res.json(hasil);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data tempat.' });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const v = (await pool.query('SELECT * FROM venues WHERE slug = $1', [req.params.slug])).rows[0];
    if (!v) return res.status(404).json({ error: 'Tempat tidak ditemukan.' });
    const courts = (await pool.query('SELECT * FROM courts WHERE venue_id = $1 AND aktif = TRUE ORDER BY id', [v.id])).rows;
    const rules = (await pool.query('SELECT * FROM price_rules WHERE venue_id = $1 ORDER BY urutan', [v.id])).rows;
    res.json({
      id: v.id,
      slug: v.slug,
      nama: v.nama,
      alamat: v.alamat,
      jenis: v.jenis,
      admin_wa: v.admin_wa,
      slot_menit: v.slot_menit,
      jam_buka: formatJam(v.jam_buka),
      jam_tutup: formatJam(v.jam_tutup),
      lapangan: courts.map((c) => ({ id: c.id, nama: c.nama, warna: c.warna })),
      harga: rules.map((r) => ({
        jam_mulai: formatJam(r.jam_mulai),
        jam_selesai: formatJam(r.jam_selesai),
        harga: Number(r.harga),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data tempat.' });
  }
});

module.exports = router;
