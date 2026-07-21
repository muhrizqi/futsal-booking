// Jalankan: npm run migrate
// Menerapkan db/schema.sql ke database yang ditunjuk DATABASE_URL.
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sqlPath = path.join(__dirname, '..', '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Menjalankan migrasi skema database...');
  try {
    await pool.query(sql);
    console.log('Migrasi selesai. Tabel & data awal (venue, lapangan, harga) sudah siap.');
    console.log('Login admin utama default -> username: superadmin | password: admin123');
    console.log('SEGERA ganti password ini setelah login pertama kali.');
  } catch (err) {
    console.error('Migrasi gagal:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
