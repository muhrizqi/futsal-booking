const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10, // pool kecil, cukup untuk skala 3 venue -> ringan di memori server
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Kesalahan tak terduga pada koneksi PostgreSQL:', err);
});

module.exports = pool;
