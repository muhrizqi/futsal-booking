const express = require('express');
const router = express.Router();
const pool = require('../db');
const { wajibLogin } = require('../middleware/auth');

function cekAksesVenueId(user, venueId) {
  if (user.role === 'admin_utama') return true;
  return user.role === 'admin_khusus' && user.venue_id === Number(venueId);
}

// POST /api/bookings -> buat booking baru
router.post('/', wajibLogin, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      venue_id, court_id, tanggal, jam_mulai, jam_selesai, harga, catatan,
      customer, // { nama, no_wa, nama_tim }
    } = req.body;

    if (!venue_id || !court_id || !tanggal || !jam_mulai || !jam_selesai || harga === undefined) {
      return res.status(400).json({ error: 'Data booking belum lengkap.' });
    }
    if (!cekAksesVenueId(req.user, venue_id)) {
      return res.status(403).json({ error: 'Anda tidak memiliki akses booking di tempat ini.' });
    }
    if (!customer || !customer.nama || !customer.no_wa) {
      return res.status(400).json({ error: 'Nama dan nomor WA pelanggan wajib diisi.' });
    }

    await client.query('BEGIN');

    // Cari atau buat data pelanggan (dicocokkan dari no WA)
    let cust = (await client.query('SELECT * FROM customers WHERE no_wa = $1 AND nama_tim IS NOT DISTINCT FROM $2', [customer.no_wa, customer.nama_tim || null])).rows[0];
    if (!cust) {
      cust = (await client.query(
        'INSERT INTO customers (nama, no_wa, nama_tim) VALUES ($1,$2,$3) RETURNING *',
        [customer.nama, customer.no_wa, customer.nama_tim || null],
      )).rows[0];
    }

    let booking;
    try {
      booking = (await client.query(
        `INSERT INTO bookings (venue_id, court_id, customer_id, tanggal, jam_mulai, jam_selesai, harga, dibuat_oleh, catatan)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [venue_id, court_id, cust.id, tanggal, jam_mulai, jam_selesai, harga, req.user.id, catatan || null],
      )).rows[0];
    } catch (e) {
      if (e.code === '23505') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Jadwal ini baru saja dibooking pihak lain. Silakan pilih jadwal lain.' });
      }
      throw e;
    }

    await client.query(
      `INSERT INTO booking_history (booking_id, aksi, oleh_user_id, keterangan)
       VALUES ($1,'booking',$2,$3)`,
      [booking.id, req.user.id, `Booking dibuat untuk tim "${customer.nama_tim || customer.nama}"`],
    );

    await client.query('COMMIT');
    res.status(201).json({ booking, customer: cust });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat booking.' });
  } finally {
    client.release();
  }
});

// POST /api/bookings/:id/cancel
router.post('/:id/cancel', wajibLogin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { alasan } = req.body;
    const booking = (await client.query('SELECT * FROM bookings WHERE id = $1', [req.params.id])).rows[0];
    if (!booking) return res.status(404).json({ error: 'Booking tidak ditemukan.' });
    if (booking.status === 'cancelled') return res.status(400).json({ error: 'Booking sudah dibatalkan sebelumnya.' });
    if (!cekAksesVenueId(req.user, booking.venue_id)) {
      return res.status(403).json({ error: 'Anda tidak memiliki akses ke booking ini.' });
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE bookings SET status = 'cancelled', dibatalkan_oleh = $1, alasan_batal = $2, updated_at = now() WHERE id = $3`,
      [req.user.id, alasan || null, booking.id],
    );
    await client.query(
      `INSERT INTO booking_history (booking_id, aksi, oleh_user_id, keterangan) VALUES ($1,'cancel',$2,$3)`,
      [booking.id, req.user.id, alasan || null],
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Gagal membatalkan booking.' });
  } finally {
    client.release();
  }
});

// GET /api/bookings?venue_id=&tanggal=&status=
router.get('/', wajibLogin, async (req, res) => {
  try {
    const kondisi = [];
    const params = [];
    if (req.user.role === 'admin_khusus') {
      params.push(req.user.venue_id);
      kondisi.push(`b.venue_id = $${params.length}`);
    } else if (req.query.venue_id) {
      params.push(req.query.venue_id);
      kondisi.push(`b.venue_id = $${params.length}`);
    }
    if (req.query.tanggal) {
      params.push(req.query.tanggal);
      kondisi.push(`b.tanggal = $${params.length}`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      kondisi.push(`b.status = $${params.length}`);
    }
    const where = kondisi.length ? `WHERE ${kondisi.join(' AND ')}` : '';
    const rows = (await pool.query(
      `SELECT b.*, v.nama as venue_nama, ct.nama as court_nama, c.nama as customer_nama, c.no_wa, c.nama_tim,
              u1.nama as dibuat_oleh_nama, u2.nama as dibatalkan_oleh_nama
       FROM bookings b
       JOIN venues v ON v.id = b.venue_id
       JOIN courts ct ON ct.id = b.court_id
       JOIN customers c ON c.id = b.customer_id
       LEFT JOIN users u1 ON u1.id = b.dibuat_oleh
       LEFT JOIN users u2 ON u2.id = b.dibatalkan_oleh
       ${where}
       ORDER BY b.tanggal DESC, b.jam_mulai DESC`,
      params,
    )).rows;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil daftar booking.' });
  }
});

// GET /api/bookings/history -> log lengkap booking & cancel (untuk semua admin lihat siapa booking/cancel)
router.get('/history/log', wajibLogin, async (req, res) => {
  try {
    const kondisi = [];
    const params = [];
    if (req.user.role === 'admin_khusus') {
      params.push(req.user.venue_id);
      kondisi.push(`b.venue_id = $${params.length}`);
    } else if (req.query.venue_id) {
      params.push(req.query.venue_id);
      kondisi.push(`b.venue_id = $${params.length}`);
    }
    const where = kondisi.length ? `WHERE ${kondisi.join(' AND ')}` : '';
    const rows = (await pool.query(
      `SELECT h.id, h.aksi, h.keterangan, h.created_at,
              b.id as booking_id, b.tanggal, b.jam_mulai, b.jam_selesai, b.status,
              v.nama as venue_nama, ct.nama as court_nama, c.nama_tim, c.nama as customer_nama,
              u.nama as oleh_nama, u.role as oleh_role
       FROM booking_history h
       JOIN bookings b ON b.id = h.booking_id
       JOIN venues v ON v.id = b.venue_id
       JOIN courts ct ON ct.id = b.court_id
       JOIN customers c ON c.id = b.customer_id
       LEFT JOIN users u ON u.id = h.oleh_user_id
       ${where}
       ORDER BY h.created_at DESC
       LIMIT 500`,
      params,
    )).rows;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil riwayat booking.' });
  }
});

module.exports = router;
