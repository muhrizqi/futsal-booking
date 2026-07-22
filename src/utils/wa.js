// Pengirim notifikasi WhatsApp lewat WA Gateway pihak ketiga (mis. Fonnte, Wablas, dll).
// Sistem ini TIDAK menjalankan WhatsApp Web sendiri (berat & tidak stabil untuk server kecil),
// melainkan memanggil API gateway yang sudah terhubung ke nomor WA Anda.
//
// Konfigurasi lewat environment variable:
//   WA_GATEWAY_PROVIDER = 'fonnte' (default) atau 'generic'
//   WA_GATEWAY_URL       = URL endpoint kirim pesan
//   WA_GATEWAY_TOKEN     = token/API key dari provider Anda
//
// Fonnte (paling mudah untuk UMKM Indonesia, mendukung kirim ke grup lewat ID grup):
//   Daftar di https://fonnte.com, hubungkan WA, dapatkan token di menu "Device".
//   WA_GATEWAY_PROVIDER=fonnte
//   WA_GATEWAY_URL=https://api.fonnte.com/send
//   WA_GATEWAY_TOKEN=<token dari Fonnte>
//
// Provider lain yang punya API sendiri: set WA_GATEWAY_PROVIDER=generic, sistem akan
// POST JSON { target, message } ke WA_GATEWAY_URL dengan header Authorization: Bearer <token>.
// Sesuaikan src/utils/wa.js jika bentuk API provider Anda berbeda.

const pool = require('../db');

const PROVIDER = process.env.WA_GATEWAY_PROVIDER || 'fonnte';
const GATEWAY_URL = process.env.WA_GATEWAY_URL || 'https://api.fonnte.com/send';
const GATEWAY_TOKEN = process.env.WA_GATEWAY_TOKEN || '';

/** Kirim satu pesan ke satu tujuan (nomor atau ID grup). Return { ok, error } */
async function kirimPesanMentah(tujuan, pesan) {
  if (!GATEWAY_TOKEN) {
    return { ok: false, error: 'WA_GATEWAY_TOKEN belum diatur di environment variable.' };
  }
  try {
    let res;
    if (PROVIDER === 'fonnte') {
      const body = new URLSearchParams({ target: tujuan, message: pesan });
      res = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { Authorization: GATEWAY_TOKEN, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } else {
      res = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${GATEWAY_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: tujuan, message: pesan }),
      });
    }
    const teks = await res.text();
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${teks.slice(0, 300)}` };
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Kirim pesan ke semua target notifikasi aktif milik sebuah venue, lalu catat hasilnya
 * ke tabel notifikasi_log. Tidak melempar error ke pemanggil (supaya kegagalan kirim WA
 * tidak sampai membatalkan proses booking/cancel/edit).
 */
async function kirimNotifikasiVenue(venueId, pesan) {
  try {
    const targets = (await pool.query(
      'SELECT * FROM notifikasi_wa WHERE venue_id = $1 AND aktif = TRUE',
      [venueId],
    )).rows;

    for (const t of targets) {
      // eslint-disable-next-line no-await-in-loop
      const hasil = await kirimPesanMentah(t.tujuan, pesan);
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `INSERT INTO notifikasi_log (venue_id, tujuan, pesan, status, error)
         VALUES ($1,$2,$3,$4,$5)`,
        [venueId, t.tujuan, pesan, hasil.ok ? 'terkirim' : 'gagal', hasil.error],
      );
    }
  } catch (err) {
    console.error('Gagal mengirim notifikasi WA:', err.message);
  }
}

module.exports = { kirimPesanMentah, kirimNotifikasiVenue };
