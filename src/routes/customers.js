const express = require('express');
const router = express.Router();
const pool = require('../db');
const { wajibLogin } = require('../middleware/auth');

// GET /api/customers?cari=&tim=
router.get('/', wajibLogin, async (req, res) => {
  try {
    const kondisi = [];
    const params = [];
    if (req.query.cari) {
      params.push(`%${req.query.cari}%`);
      kondisi.push(`(nama ILIKE $${params.length} OR no_wa ILIKE $${params.length} OR nama_tim ILIKE $${params.length})`);
    }
    const where = kondisi.length ? `WHERE ${kondisi.join(' AND ')}` : '';
    const rows = (await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id AND b.status = 'booked') as total_booking_aktif,
              (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id) as total_booking_semua
       FROM customers c ${where} ORDER BY c.created_at DESC LIMIT 500`,
      params,
    )).rows;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil daftar pelanggan.' });
  }
});

// GET /api/customers/:id -> detail + riwayat booking pelanggan itu
router.get('/:id', wajibLogin, async (req, res) => {
  try {
    const cust = (await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id])).rows[0];
    if (!cust) return res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
    const riwayat = (await pool.query(
      `SELECT b.*, v.nama as venue_nama, ct.nama as court_nama
       FROM bookings b JOIN venues v ON v.id = b.venue_id JOIN courts ct ON ct.id = b.court_id
       WHERE b.customer_id = $1 ORDER BY b.tanggal DESC`,
      [req.params.id],
    )).rows;
    res.json({ ...cust, riwayat });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil detail pelanggan.' });
  }
});

module.exports = router;
