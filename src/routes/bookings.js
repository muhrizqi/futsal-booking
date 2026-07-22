const express = require('express');
const router = express.Router();
const pool = require('../db');
const { wajibLogin } = require('../middleware/auth');
const { kirimNotifikasiVenue } = require('../utils/wa');
const { formatTanggalPanjang } = require('../utils/tanggal');

function cekAksesVenueId(user, venueId) {
  if (user.role === 'admin_utama') return true;
  return user.role === 'admin_khusus' && user.venue_id === Number(venueId);
}

const RUPIAH = (n) => 'Rp' + Number(n).toLocaleString('id-ID');
const LABEL_STATUS_BAYAR = { belum_bayar: 'Belum Bayar', dp: 'DP', lunas: 'Lunas' };
const LABEL_METODE_BAYAR = { cash: 'Cash', transfer: 'Transfer' };

/** Validasi kombinasi field pembayaran, kembalikan pesan error atau null jika valid. */
function validasiPembayaran(body) {
  const {
    status_pembayaran, metode_pembayaran, cash_dipegang_oleh, rekening_tujuan,
  } = body;
  if (status_pembayaran && !['belum_bayar', 'dp', 'lunas'].includes(status_pembayaran)) {
    return 'Status pembayaran tidak valid.';
  }
  if (metode_pembayaran && !['cash', 'transfer'].includes(metode_pembayaran)) {
    return 'Metode pembayaran tidak valid.';
  }
  if (metode_pembayaran === 'cash' && status_pembayaran && status_pembayaran !== 'belum_bayar' && !cash_dipegang_oleh) {
    return 'Mohon isi siapa yang memegang dana cash.';
  }
  if (metode_pembayaran === 'transfer' && status_pembayaran && status_pembayaran !== 'belum_bayar' && !rekening_tujuan) {
    return 'Mohon isi rekening tujuan transfer.';
  }
  return null;
}

// POST /api/bookings -> buat booking baru
router.post('/', wajibLogin, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      venue_id, court_id, tanggal, jam_mulai, jam_selesai, harga, catatan,
      customer, // { nama, no_wa, nama_tim }
      status_pembayaran, metode_pembayaran, cash_dipegang_oleh, rekening_tujuan, catatan_pembayaran,
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
    const errPembayaran = validasiPembayaran(req.body);
    if (errPembayaran) return res.status(400).json({ error: errPembayaran });

    await client.query('BEGIN');

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
        `INSERT INTO bookings (venue_id, court_id, customer_id, tanggal, jam_mulai, jam_selesai, harga, dibuat_oleh, catatan,
                                status_pembayaran, metode_pembayaran, cash_dipegang_oleh, rekening_tujuan, catatan_pembayaran)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [venue_id, court_id, cust.id, tanggal, jam_mulai, jam_selesai, harga, req.user.id, catatan || null,
          status_pembayaran || 'belum_bayar', metode_pembayaran || null, cash_dipegang_oleh || null, rekening_tujuan || null, catatan_pembayaran || null],
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

    const venue = (await client.query('SELECT nama FROM venues WHERE id = $1', [venue_id])).rows[0];
    const court = (await client.query('SELECT nama FROM courts WHERE id = $1', [court_id])).rows[0];

    await client.query('COMMIT');

    const pesan = `*BOOKING BARU* \u2705\n\n`
      + `Tempat: ${venue.nama}\n`
      + `Lapangan: ${court.nama}\n`
      + `Tanggal: ${formatTanggalPanjang(tanggal)}\n`
      + `Jam: ${jam_mulai} - ${jam_selesai}\n`
      + `Harga: ${RUPIAH(harga)}\n\n`
      + `Pemesan: ${customer.nama}\n`
      + `Tim: ${customer.nama_tim || '-'}\n`
      + `No. WA: ${customer.no_wa}\n\n`
      + `Dibuat oleh admin: ${req.user.nama}`;
    kirimNotifikasiVenue(venue_id, pesan);

    res.status(201).json({ booking, customer: cust });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat booking.' });
  } finally {
    client.release();
  }
});

// GET /api/bookings/:id -> detail satu booking (untuk modal edit)
router.get('/:id', wajibLogin, async (req, res) => {
  const row = (await pool.query(
    `SELECT b.*, v.nama as venue_nama, ct.nama as court_nama, c.nama as customer_nama, c.no_wa, c.nama_tim
     FROM bookings b JOIN venues v ON v.id = b.venue_id JOIN courts ct ON ct.id = b.court_id JOIN customers c ON c.id = b.customer_id
     WHERE b.id = $1`,
    [req.params.id],
  )).rows[0];
  if (!row) return res.status(404).json({ error: 'Booking tidak ditemukan.' });
  if (!cekAksesVenueId(req.user, row.venue_id)) return res.status(403).json({ error: 'Anda tidak memiliki akses ke booking ini.' });
  res.json(row);
});

// PUT /api/bookings/:id -> edit catatan & info pembayaran booking (tidak mengubah jam/lapangan)
router.put('/:id', wajibLogin, async (req, res) => {
  const client = await pool.connect();
  try {
    const booking = (await client.query('SELECT * FROM bookings WHERE id = $1', [req.params.id])).rows[0];
    if (!booking) return res.status(404).json({ error: 'Booking tidak ditemukan.' });
    if (booking.status === 'cancelled') return res.status(400).json({ error: 'Booking yang sudah dibatalkan tidak dapat diedit.' });
    if (!cekAksesVenueId(req.user, booking.venue_id)) return res.status(403).json({ error: 'Anda tidak memiliki akses ke booking ini.' });

    const errPembayaran = validasiPembayaran(req.body);
    if (errPembayaran) return res.status(400).json({ error: errPembayaran });

    const {
      status_pembayaran, metode_pembayaran, cash_dipegang_oleh, rekening_tujuan, catatan_pembayaran, catatan,
    } = req.body;

    const perubahan = [];
    if (status_pembayaran !== undefined && status_pembayaran !== booking.status_pembayaran) {
      perubahan.push(`status pembayaran: ${LABEL_STATUS_BAYAR[booking.status_pembayaran]} -> ${LABEL_STATUS_BAYAR[status_pembayaran]}`);
    }
    if (metode_pembayaran !== undefined && metode_pembayaran !== booking.metode_pembayaran) {
      perubahan.push(`metode pembayaran: ${booking.metode_pembayaran ? LABEL_METODE_BAYAR[booking.metode_pembayaran] : '-'} -> ${metode_pembayaran ? LABEL_METODE_BAYAR[metode_pembayaran] : '-'}`);
    }
    if (cash_dipegang_oleh !== undefined && cash_dipegang_oleh !== booking.cash_dipegang_oleh) {
      perubahan.push(`dana cash dipegang: ${cash_dipegang_oleh || '-'}`);
    }
    if (rekening_tujuan !== undefined && rekening_tujuan !== booking.rekening_tujuan) {
      perubahan.push(`rekening tujuan: ${rekening_tujuan || '-'}`);
    }
    if (catatan !== undefined && catatan !== booking.catatan) {
      perubahan.push('catatan booking diperbarui');
    }
    if (catatan_pembayaran !== undefined && catatan_pembayaran !== booking.catatan_pembayaran) {
      perubahan.push('catatan pembayaran diperbarui');
    }

    if (perubahan.length === 0) {
      return res.json({ ok: true, pesan: 'Tidak ada perubahan.' });
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE bookings SET
        status_pembayaran = COALESCE($1, status_pembayaran),
        metode_pembayaran = $2,
        cash_dipegang_oleh = $3,
        rekening_tujuan = $4,
        catatan_pembayaran = COALESCE($5, catatan_pembayaran),
        catatan = COALESCE($6, catatan),
        updated_at = now()
       WHERE id = $7`,
      [
        status_pembayaran || null,
        metode_pembayaran !== undefined ? metode_pembayaran : booking.metode_pembayaran,
        cash_dipegang_oleh !== undefined ? cash_dipegang_oleh : booking.cash_dipegang_oleh,
        rekening_tujuan !== undefined ? rekening_tujuan : booking.rekening_tujuan,
        catatan_pembayaran || null,
        catatan || null,
        req.params.id,
      ],
    );

    const keterangan = perubahan.join('; ');
    await client.query(
      `INSERT INTO booking_history (booking_id, aksi, oleh_user_id, keterangan) VALUES ($1,'edit',$2,$3)`,
      [booking.id, req.user.id, keterangan],
    );

    const info = (await client.query(
      `SELECT b.*, b.tanggal::text as tanggal_str, v.nama as venue_nama, ct.nama as court_nama, c.nama as customer_nama, c.nama_tim
       FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN courts ct ON ct.id=b.court_id JOIN customers c ON c.id=b.customer_id
       WHERE b.id = $1`,
      [booking.id],
    )).rows[0];

    await client.query('COMMIT');

    const pesan = `*BOOKING DIEDIT* \u270f\ufe0f\n\n`
      + `Tempat: ${info.venue_nama}\n`
      + `Lapangan: ${info.court_nama}\n`
      + `Tanggal: ${formatTanggalPanjang(info.tanggal_str)}\n`
      + `Jam: ${info.jam_mulai} - ${info.jam_selesai}\n`
      + `Tim/Pemesan: ${info.nama_tim || info.customer_nama}\n\n`
      + `Perubahan: ${keterangan}\n\n`
      + `Diedit oleh admin: ${req.user.nama}`;
    kirimNotifikasiVenue(booking.venue_id, pesan);

    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan perubahan booking.' });
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

    const info = (await client.query(
      `SELECT b.*, b.tanggal::text as tanggal_str, v.nama as venue_nama, ct.nama as court_nama, c.nama as customer_nama, c.nama_tim
       FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN courts ct ON ct.id=b.court_id JOIN customers c ON c.id=b.customer_id
       WHERE b.id = $1`,
      [booking.id],
    )).rows[0];

    await client.query('COMMIT');

    const pesan = `*BOOKING DIBATALKAN* \u274c\n\n`
      + `Tempat: ${info.venue_nama}\n`
      + `Lapangan: ${info.court_nama}\n`
      + `Tanggal: ${formatTanggalPanjang(info.tanggal_str)}\n`
      + `Jam: ${info.jam_mulai} - ${info.jam_selesai}\n`
      + `Tim/Pemesan: ${info.nama_tim || info.customer_nama}\n`
      + `Alasan: ${alasan || '-'}\n\n`
      + `Dibatalkan oleh admin: ${req.user.nama}`;
    kirimNotifikasiVenue(booking.venue_id, pesan);

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

// GET /api/bookings/history/log -> log lengkap booking, edit & cancel
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
