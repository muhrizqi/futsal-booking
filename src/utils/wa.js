// Pengirim notifikasi WhatsApp lewat WA Gateway pihak ketiga (mis. Fonnte, WAHA, Wablas, dll).
// Sistem ini TIDAK menjalankan WhatsApp Web sendiri di sini (berat & tidak stabil untuk server kecil),
// melainkan memanggil API gateway yang sudah terhubung ke nomor WA Anda (baik itu SaaS seperti Fonnte,
// maupun self-hosted seperti WAHA yang jalan di service terpisah).
//
// Konfigurasi lewat environment variable:
//   WA_GATEWAY_PROVIDER = 'fonnte' (default), 'waha', atau 'generic'
//   WA_GATEWAY_URL       = URL endpoint kirim pesan
//   WA_GATEWAY_TOKEN     = token/API key dari provider Anda
//   WA_GATEWAY_SESSION   = (khusus WAHA) nama sesi, default 'default'
//
// Fonnte (SaaS, paling mudah untuk UMKM Indonesia):
//   Daftar di https://fonnte.com, hubungkan WA, dapatkan token di menu "Device".
//   WA_GATEWAY_PROVIDER=fonnte
//   WA_GATEWAY_URL=https://api.fonnte.com/send
//   WA_GATEWAY_TOKEN=<token dari Fonnte>
//
// WAHA (self-hosted, mis. dari service WAHA di EasyPanel):
//   WA_GATEWAY_PROVIDER=waha
//   WA_GATEWAY_URL=https://waha-anda.lewat.web.id/api/sendText
//   WA_GATEWAY_TOKEN=<X-Api-Key WAHA Anda, dari env WAHA_API_KEY service WAHA>
//   WA_GATEWAY_SESSION=default
//   Target nomor cukup diisi nomor polos (628xxx) seperti biasa di menu Pengaturan — sistem
//   otomatis menambahkan "@c.us". Untuk grup, isi ID grup lengkap (format "xxxxx@g.us"),
//   didapat lewat endpoint GET /api/default/chats atau dashboard WAHA.
//
// Provider lain yang punya API sendiri: set WA_GATEWAY_PROVIDER=generic, sistem akan
// POST JSON { target, message } ke WA_GATEWAY_URL dengan header Authorization: Bearer <token>.
// Sesuaikan src/utils/wa.js jika bentuk API provider Anda berbeda.

const pool = require('../db');

const PROVIDER = process.env.WA_GATEWAY_PROVIDER || 'fonnte';
const GATEWAY_URL = process.env.WA_GATEWAY_URL
  || (PROVIDER === 'fonnte' ? 'https://api.fonnte.com/send' : '');
const GATEWAY_TOKEN = process.env.WA_GATEWAY_TOKEN || '';
const WAHA_SESSION = process.env.WA_GATEWAY_SESSION || 'default';

/** Kirim satu pesan ke satu tujuan (nomor atau ID grup). Return { ok, error } */
async function kirimPesanMentah(tujuan, pesan) {
  if (!GATEWAY_TOKEN) {
    return { ok: false, error: 'WA_GATEWAY_TOKEN belum diatur di environment variable.' };
  }
  if (!GATEWAY_URL) {
    return { ok: false, error: 'WA_GATEWAY_URL belum diatur di environment variable.' };
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
    } else if (PROVIDER === 'waha') {
      // WAHA butuh chatId lengkap dengan sufiks JID: nomor pribadi -> "628xxx@c.us", grup -> "xxxx@g.us".
      // Kalau tujuan yang tersimpan sudah mengandung "@" (mis. ID grup), pakai apa adanya.
      const chatId = tujuan.includes('@') ? tujuan : `${tujuan}@c.us`;
      res = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { 'X-Api-Key': GATEWAY_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: WAHA_SESSION, chatId, text: pesan }),
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
