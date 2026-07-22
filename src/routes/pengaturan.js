const express = require('express');
const router = express.Router();
const pool = require('../db');
const { wajibLogin } = require('../middleware/auth');
const { kirimPesanMentah } = require('../utils/wa');
const { formatJam } = require('../utils/tanggal');

// Semua pengaturan (harga, jam, no WA admin, notifikasi) hanya boleh diubah oleh admin utama,
// supaya tidak ada admin khusus yang tanpa sengaja mengubah tarif tempat lain.
function hanyaAdminUtama(req, res, next) {
  if (req.user.role !== 'admin_utama') return res.status(403).json({ error: 'Hanya admin utama yang dapat mengubah pengaturan.' });
  next();
}
router.use(wajibLogin, hanyaAdminUtama);

// ---------------------------------------------------------------------
// VENUE: jam operasional, durasi slot, nomor WA admin
// ---------------------------------------------------------------------

// GET /api/pengaturan/venues -> semua venue lengkap dgn harga & target notifikasi
router.get('/venues', async (req, res) => {
  try {
    const venues = (await pool.query('SELECT * FROM venues ORDER BY id')).rows;
    const rules = (await pool.query('SELECT * FROM price_rules ORDER BY venue_id, urutan, jam_mulai')).rows;
    const targets = (await pool.query('SELECT * FROM notifikasi_wa ORDER BY venue_id, id')).rows;

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
      harga: rules.filter((r) => r.venue_id === v.id).map((r) => ({
        id: r.id, jam_mulai: formatJam(r.jam_mulai), jam_selesai: formatJam(r.jam_selesai), harga: Number(r.harga), urutan: r.urutan,
      })),
      notifikasi: targets.filter((t) => t.venue_id === v.id),
    }));
    res.json(hasil);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data pengaturan.' });
  }
});

// PUT /api/pengaturan/venues/:id -> ubah jam buka/tutup, durasi slot, no WA admin, alamat
router.put('/venues/:id', async (req, res) => {
  try {
    const {
      jam_buka, jam_tutup, slot_menit, admin_wa, alamat,
    } = req.body;
    const kolom = [];
    const nilai = [];
    let i = 1;
    if (jam_buka) { kolom.push(`jam_buka = $${i++}`); nilai.push(jam_buka); }
    if (jam_tutup) { kolom.push(`jam_tutup = $${i++}`); nilai.push(jam_tutup === '24:00' ? '24:00' : jam_tutup); }
    if (slot_menit) { kolom.push(`slot_menit = $${i++}`); nilai.push(slot_menit); }
    if (admin_wa) { kolom.push(`admin_wa = $${i++}`); nilai.push(admin_wa.replace(/\D/g, '')); }
    if (alamat) { kolom.push(`alamat = $${i++}`); nilai.push(alamat); }
    if (kolom.length === 0) return res.status(400).json({ error: 'Tidak ada data yang diubah.' });

    nilai.push(req.params.id);
    await pool.query(`UPDATE venues SET ${kolom.join(', ')} WHERE id = $${i}`, nilai);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan pengaturan tempat.' });
  }
});

// ---------------------------------------------------------------------
// HARGA (price_rules)
// ---------------------------------------------------------------------

// POST /api/pengaturan/venues/:id/harga -> tambah aturan harga baru
router.post('/venues/:id/harga', async (req, res) => {
  try {
    const {
      jam_mulai, jam_selesai, harga, urutan,
    } = req.body;
    if (!jam_mulai || !jam_selesai || harga === undefined) return res.status(400).json({ error: 'Jam mulai, jam selesai, dan harga wajib diisi.' });
    const r = await pool.query(
      `INSERT INTO price_rules (venue_id, jam_mulai, jam_selesai, harga, urutan) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (venue_id, jam_mulai, jam_selesai) DO UPDATE SET harga = EXCLUDED.harga, urutan = EXCLUDED.urutan
       RETURNING *`,
      [req.params.id, jam_mulai, jam_selesai, harga, urutan || 0],
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menambah aturan harga.' });
  }
});

// PUT /api/pengaturan/harga/:id -> ubah aturan harga
router.put('/harga/:id', async (req, res) => {
  try {
    const {
      jam_mulai, jam_selesai, harga, urutan,
    } = req.body;
    const r = await pool.query(
      `UPDATE price_rules SET jam_mulai = COALESCE($1, jam_mulai), jam_selesai = COALESCE($2, jam_selesai),
       harga = COALESCE($3, harga), urutan = COALESCE($4, urutan) WHERE id = $5 RETURNING *`,
      [jam_mulai || null, jam_selesai || null, harga ?? null, urutan ?? null, req.params.id],
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Aturan harga tidak ditemukan.' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengubah aturan harga.' });
  }
});

// DELETE /api/pengaturan/harga/:id
router.delete('/harga/:id', async (req, res) => {
  await pool.query('DELETE FROM price_rules WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// NOTIFIKASI WA (target per venue)
// ---------------------------------------------------------------------

// POST /api/pengaturan/venues/:id/notifikasi -> tambah target baru
router.post('/venues/:id/notifikasi', async (req, res) => {
  try {
    const { tipe, tujuan, label } = req.body;
    if (!tipe || !tujuan) return res.status(400).json({ error: 'Tipe dan tujuan wajib diisi.' });
    if (!['nomor', 'grup'].includes(tipe)) return res.status(400).json({ error: 'Tipe harus "nomor" atau "grup".' });
    const tujuanBersih = tipe === 'nomor' ? tujuan.replace(/\D/g, '') : tujuan.trim();
    const r = await pool.query(
      `INSERT INTO notifikasi_wa (venue_id, tipe, tujuan, label) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, tipe, tujuanBersih, label || null],
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menambah target notifikasi.' });
  }
});

// PUT /api/pengaturan/notifikasi/:id -> ubah target (aktif/nonaktif, ganti tujuan/label)
router.put('/notifikasi/:id', async (req, res) => {
  try {
    const { tujuan, label, aktif } = req.body;
    const r = await pool.query(
      `UPDATE notifikasi_wa SET tujuan = COALESCE($1, tujuan), label = COALESCE($2, label),
       aktif = COALESCE($3, aktif) WHERE id = $4 RETURNING *`,
      [tujuan || null, label !== undefined ? label : null, aktif !== undefined ? aktif : null, req.params.id],
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Target notifikasi tidak ditemukan.' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengubah target notifikasi.' });
  }
});

// DELETE /api/pengaturan/notifikasi/:id
router.delete('/notifikasi/:id', async (req, res) => {
  await pool.query('DELETE FROM notifikasi_wa WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// POST /api/pengaturan/notifikasi/:id/test -> kirim pesan uji coba
router.post('/notifikasi/:id/test', async (req, res) => {
  try {
    const target = (await pool.query('SELECT * FROM notifikasi_wa WHERE id = $1', [req.params.id])).rows[0];
    if (!target) return res.status(404).json({ error: 'Target notifikasi tidak ditemukan.' });
    const hasil = await kirimPesanMentah(target.tujuan, 'Ini pesan uji coba dari Sistem Booking Lapangan. Jika Anda menerima ini, notifikasi WA sudah terhubung dengan benar.');
    await pool.query(
      `INSERT INTO notifikasi_log (venue_id, tujuan, pesan, status, error) VALUES ($1,$2,$3,$4,$5)`,
      [target.venue_id, target.tujuan, '[pesan uji coba]', hasil.ok ? 'terkirim' : 'gagal', hasil.error],
    );
    if (!hasil.ok) return res.status(502).json({ error: `Gagal mengirim: ${hasil.error}` });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengirim pesan uji coba.' });
  }
});

// GET /api/pengaturan/notifikasi-log?venue_id=
router.get('/notifikasi-log', async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.venue_id) { params.push(req.query.venue_id); where = 'WHERE nl.venue_id = $1'; }
  const rows = (await pool.query(
    `SELECT nl.*, v.nama as venue_nama FROM notifikasi_log nl LEFT JOIN venues v ON v.id = nl.venue_id
     ${where} ORDER BY nl.created_at DESC LIMIT 200`,
    params,
  )).rows;
  res.json(rows);
});

module.exports = router;
