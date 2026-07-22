// Jalankan: npm run migrate
// Menerapkan db/schema.sql lalu semua file di db/migrations/ (urut nama file) ke database DATABASE_URL.
// Aman dijalankan berkali-kali — dipakai baik untuk instalasi baru maupun update sistem yang sudah berjalan.
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const dbDir = path.join(__dirname, '..', '..', 'db');
  const schemaPath = path.join(dbDir, 'schema.sql');
  const migrationsDir = path.join(dbDir, 'migrations');

  try {
    console.log('Menjalankan skema utama (db/schema.sql)...');
    await pool.query(fs.readFileSync(schemaPath, 'utf8'));
    console.log('Skema utama selesai.');

    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        console.log(`Menjalankan migrasi: ${file} ...`);
        // eslint-disable-next-line no-await-in-loop
        await pool.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
        console.log(`Migrasi ${file} selesai.`);
      }
    }

    console.log('\nSemua migrasi selesai. Database sudah siap dipakai.');
    console.log('Login admin utama default -> username: superadmin | password: admin123');
    console.log('SEGERA ganti password ini setelah login pertama kali (jika ini instalasi baru).');
  } catch (err) {
    console.error('Migrasi gagal:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
