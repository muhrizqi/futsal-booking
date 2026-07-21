// Buat admin baru dari terminal.
// Pemakaian:
//   node scripts/create-admin.js utama <username> <password> "<Nama Lengkap>"
//   node scripts/create-admin.js khusus <username> <password> "<Nama Lengkap>" <venue_slug>
//
// Contoh:
//   node scripts/create-admin.js utama superadmin2 rahasia123 "Budi Admin"
//   node scripts/create-admin.js khusus admin4r rahasia123 "Admin 4R" 4r-futsal

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/db');

async function main() {
  const [tipe, username, password, nama, venueSlug] = process.argv.slice(2);

  if (!tipe || !username || !password || !nama || (tipe === 'khusus' && !venueSlug)) {
    console.log('Pemakaian:');
    console.log('  node scripts/create-admin.js utama <username> <password> "<Nama Lengkap>"');
    console.log('  node scripts/create-admin.js khusus <username> <password> "<Nama Lengkap>" <venue_slug>');
    process.exit(1);
  }

  const role = tipe === 'utama' ? 'admin_utama' : 'admin_khusus';
  let venueId = null;

  if (role === 'admin_khusus') {
    const v = (await pool.query('SELECT id FROM venues WHERE slug = $1', [venueSlug])).rows[0];
    if (!v) {
      console.error(`Venue dengan slug "${venueSlug}" tidak ditemukan. Slug yang tersedia: jogokariyan-futsal, 4r-futsal, kalisi-mini-soccer`);
      process.exit(1);
    }
    venueId = v.id;
  }

  const hash = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, nama, role, venue_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, username, nama, role, venue_id`,
      [username, hash, nama, role, venueId],
    );
    console.log('Admin berhasil dibuat:', result.rows[0]);
  } catch (err) {
    console.error('Gagal membuat admin:', err.message);
  } finally {
    await pool.end();
  }
}

main();
