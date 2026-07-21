const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const multer = require('multer');
const { wajibLogin } = require('../middleware/auth');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: BACKUP_DIR,
    filename: (req, file, cb) => cb(null, `upload-${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // maks 500MB
});

function hanyaAdminUtama(req, res, next) {
  if (req.user.role !== 'admin_utama') return res.status(403).json({ error: 'Hanya admin utama yang dapat mengelola backup.' });
  next();
}

function parseDbUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

// POST /api/backup -> jalankan pg_dump, simpan file .dump ke BACKUP_DIR
router.post('/', wajibLogin, hanyaAdminUtama, async (req, res) => {
  try {
    const db = parseDbUrl(process.env.DATABASE_URL);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-booking-lapangan-${stamp}.dump`;
    const filepath = path.join(BACKUP_DIR, filename);

    const env = { ...process.env, PGPASSWORD: db.password };
    const args = [
      '-h', db.host, '-p', db.port, '-U', db.user, '-Fc', '-f', filepath, db.database,
    ];

    execFile('pg_dump', args, { env }, (err, stdout, stderr) => {
      if (err) {
        console.error('pg_dump gagal:', stderr || err.message);
        return res.status(500).json({ error: 'Gagal membuat backup. Pastikan pg_dump terpasang di server.' });
      }
      res.status(201).json({ ok: true, filename });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat backup.' });
  }
});

// GET /api/backup -> daftar file backup yang tersedia
router.get('/', wajibLogin, hanyaAdminUtama, (req, res) => {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.dump'))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { filename: f, ukuran_kb: Math.round(stat.size / 1024), dibuat: stat.mtime };
    })
    .sort((a, b) => new Date(b.dibuat) - new Date(a.dibuat));
  res.json(files);
});

// GET /api/backup/:filename/download -> unduh file backup
router.get('/:filename/download', wajibLogin, hanyaAdminUtama, (req, res) => {
  const filename = path.basename(req.params.filename); // cegah path traversal
  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File backup tidak ditemukan.' });
  res.download(filepath, filename);
});

// DELETE /api/backup/:filename -> hapus file backup lama
router.delete('/:filename', wajibLogin, hanyaAdminUtama, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File backup tidak ditemukan.' });
  fs.unlinkSync(filepath);
  res.json({ ok: true });
});

// POST /api/backup/upload -> unggah file backup (.dump) dari komputer admin ke server, untuk kemudian direstore
router.post('/upload', wajibLogin, hanyaAdminUtama, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Tidak ada file yang diunggah.' });
  res.status(201).json({ ok: true, filename: req.file.filename });
});

// POST /api/backup/:filename/restore -> pulihkan database dari salah satu file backup yang ada di server
// PERINGATAN: aksi ini menimpa seluruh data yang ada saat ini.
router.post('/:filename/restore', wajibLogin, hanyaAdminUtama, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File backup tidak ditemukan.' });
  if (req.body.konfirmasi !== 'YAKIN') {
    return res.status(400).json({ error: 'Konfirmasi diperlukan. Kirim { "konfirmasi": "YAKIN" } untuk melanjutkan.' });
  }

  const db = parseDbUrl(process.env.DATABASE_URL);
  const env = { ...process.env, PGPASSWORD: db.password };
  const args = [
    '-h', db.host, '-p', db.port, '-U', db.user, '-d', db.database, '--clean', '--if-exists', filepath,
  ];
  execFile('pg_restore', args, { env }, (err, stdout, stderr) => {
    if (err) {
      console.error('pg_restore gagal:', stderr || err.message);
      return res.status(500).json({ error: 'Gagal memulihkan data. Pastikan pg_restore terpasang di server.' });
    }
    res.json({ ok: true, pesan: 'Data berhasil dipulihkan dari backup.' });
  });
});

module.exports = router;
