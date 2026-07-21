const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { wajibLogin } = require('../middleware/auth');

function hanyaAdminUtama(req, res, next) {
  if (req.user.role !== 'admin_utama') return res.status(403).json({ error: 'Hanya admin utama yang dapat melakukan aksi ini.' });
  next();
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi.' });

    const user = (await pool.query('SELECT * FROM users WHERE username = $1 AND aktif = TRUE', [username])).rows[0];
    if (!user) return res.status(401).json({ error: 'Username atau password salah.' });

    const cocok = await bcrypt.compare(password, user.password_hash);
    if (!cocok) return res.status(401).json({ error: 'Username atau password salah.' });

    const payload = {
      id: user.id, username: user.username, nama: user.nama, role: user.role, venue_id: user.venue_id,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: payload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal melakukan login.' });
  }
});

// GET /api/auth/me
router.get('/me', wajibLogin, (req, res) => res.json({ user: req.user }));

// GET /api/auth/users -> daftar admin (hanya admin utama)
router.get('/users', wajibLogin, hanyaAdminUtama, async (req, res) => {
  const rows = (await pool.query(
    `SELECT u.id, u.username, u.nama, u.role, u.venue_id, u.aktif, v.nama as venue_nama
     FROM users u LEFT JOIN venues v ON v.id = u.venue_id ORDER BY u.id`,
  )).rows;
  res.json(rows);
});

// POST /api/auth/users -> buat admin baru (hanya admin utama)
router.post('/users', wajibLogin, hanyaAdminUtama, async (req, res) => {
  try {
    const {
      username, password, nama, role, venue_id,
    } = req.body;
    if (!username || !password || !nama || !role) return res.status(400).json({ error: 'Data belum lengkap.' });
    if (!['admin_utama', 'admin_khusus'].includes(role)) return res.status(400).json({ error: 'Role tidak valid.' });
    if (role === 'admin_khusus' && !venue_id) return res.status(400).json({ error: 'Admin khusus wajib memilih satu tempat.' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, nama, role, venue_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, username, nama, role, venue_id`,
      [username, hash, nama, role, role === 'admin_utama' ? null : venue_id],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username sudah digunakan.' });
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat admin baru.' });
  }
});

// PUT /api/auth/users/:id/nonaktifkan -> nonaktifkan admin (hanya admin utama)
router.put('/users/:id/nonaktifkan', wajibLogin, hanyaAdminUtama, async (req, res) => {
  await pool.query('UPDATE users SET aktif = FALSE WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// PUT /api/auth/ganti-password -> admin ganti password sendiri
router.put('/ganti-password', wajibLogin, async (req, res) => {
  const { password_lama, password_baru } = req.body;
  if (!password_lama || !password_baru) return res.status(400).json({ error: 'Password lama dan baru wajib diisi.' });
  const user = (await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id])).rows[0];
  const cocok = await bcrypt.compare(password_lama, user.password_hash);
  if (!cocok) return res.status(401).json({ error: 'Password lama salah.' });
  const hash = await bcrypt.hash(password_baru, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
