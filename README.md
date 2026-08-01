# Sistem Booking Lapangan — Jogokariyan Futsal, 4R Futsal & KALISI Mini Soccer

Sistem ringan (Node.js + Express + PostgreSQL, tanpa framework frontend berat) untuk
mengelola jadwal 3 tempat, menampilkan kalender ketersediaan ke pelanggan, mencatat
booking/cancel, mengelola admin, dan backup/restore database.

## Fitur

- Kalender bulanan per tempat, klik tanggal → muncul daftar jam kosong/terisi per lapangan.
- Halaman publik (`/`) untuk pelanggan: lihat jadwal, lihat nama tim yang sudah booking,
  pilih slot lalu klik tombol **Hubungi Admin via WhatsApp** (nomor WA berbeda per tempat,
  pesan otomatis terisi detail booking).
- Panel admin (`/admin.html`):
  - **Admin Utama**: bisa booking/cancel di ketiga tempat, kelola akun admin lain, dan
    satu-satunya yang bisa mengubah **Pengaturan** (jam, harga, no WA admin, notifikasi).
  - **Admin Khusus**: hanya bisa booking/cancel di satu tempat yang ditentukan.
  - Buat booking manual (isi nama, no WA, nama tim pelanggan, plus info pembayaran).
  - **Info pembayaran per booking** (hanya terlihat admin): status Belum Bayar/DP/Lunas,
    metode Cash/Transfer, kalau cash — siapa yang pegang dananya sekarang, kalau transfer —
    ke rekening mana. Bisa diedit kapan saja lewat modal "Detail Booking".
  - Batalkan booking (wajib isi alasan).
  - Riwayat lengkap: siapa yang booking, siapa yang edit, siapa yang cancel, kapan, dan
    detail perubahannya.
  - Data pelanggan (nama, no WA, nama tim) untuk dianalisis lebih lanjut.
  - **Pengaturan** (khusus admin utama): ubah jam operasional & durasi slot, ubah nomor
    WA admin per tempat, tambah/edit/hapus rentang harga, atur target notifikasi WA.
  - **Notifikasi WhatsApp otomatis**: setiap ada booking baru, booking diedit, atau
    booking dibatalkan, pesan otomatis terkirim ke nomor WA/grup WA yang sudah diatur —
    bisa berbeda-beda per tempat (mis. grup WA khusus 4R Futsal terpisah dari Jogokariyan).
  - Cetak jadwal harian & bulanan (halaman siap-cetak, tinggal `Ctrl+P` / tombol Cetak),
    termasuk status pembayaran di jadwal harian.
  - Backup database sekali klik, lihat daftar backup, unduh, hapus, dan restore
    (termasuk restore dari file yang diunggah dari komputer sendiri).
- Format tanggal & jam sesuai permintaan: nama hari & bulan Bahasa Indonesia
  (Ahad, Senin, ... ; Januari, Februari, ...), jam format 24 jam tanpa AM/PM
  (mis. `15:00`, `24:00`).
- Harga otomatis dihitung sesuai jam & venue (termasuk skema 1,5 jam per slot untuk
  KALISI Mini Soccer) dan mencegah bentrok booking (constraint unik di database).

## Struktur Proyek

```
futsal-booking/
├── db/schema.sql          # skema database + data awal (venue, lapangan, harga)
├── src/
│   ├── server.js          # entry point Express
│   ├── db.js               # koneksi PostgreSQL
│   ├── middleware/auth.js  # JWT & cek akses per-venue
│   ├── routes/              # venues, kalender, auth, bookings, customers, backup, print
│   └── utils/tanggal.js    # nama hari/bulan Indonesia, format jam, hitung harga/slot
├── public/                  # frontend statis (HTML/CSS/JS polos, tanpa build step)
├── scripts/
│   ├── create-admin.js     # buat akun admin dari terminal
│   ├── backup.sh           # backup via cron
│   └── restore.sh          # restore manual dari terminal
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Instalasi di Server dengan EasyPanel

EasyPanel mendukung deploy dari **Docker Compose** atau **Dockerfile + Git repo**.
Cara paling ringan dan konsisten adalah pakai `docker-compose.yml` yang sudah disediakan
(berisi service `app` dan `db` PostgreSQL).

### Langkah-langkah

1. **Push project ini ke Git repository** (GitHub/GitLab/Gitea) milik Anda, atau upload
   langsung ke server jika EasyPanel Anda mendukung upload folder.

2. **Di EasyPanel**, buat project baru → pilih **"Docker Compose"** sebagai tipe deploy,
   arahkan ke repo ini (atau tempel isi `docker-compose.yml`).

3. **Ubah nilai default sebelum deploy**, minimal:
   - `POSTGRES_PASSWORD` (di service `db`)
   - `DATABASE_URL` (samakan passwordnya dengan `POSTGRES_PASSWORD`)
   - `JWT_SECRET` (isi string acak panjang, jangan pakai contoh)

   Bisa langsung edit di `docker-compose.yml`, atau pindahkan ke Environment Variables
   di EasyPanel (lebih aman, tidak tersimpan di file).

4. **Arahkan domain/proxy EasyPanel ke port `3000`** pada service `app`.

5. **Deploy.** EasyPanel akan build image dari `Dockerfile` (berbasis `node:20-alpine`,
   sangat ringan) dan menjalankan PostgreSQL di container terpisah dengan volume
   persisten (`db_data`).

6. **Jalankan migrasi database** (sekali saja, setelah container `app` menyala).
   Di EasyPanel, buka terminal/console untuk container `app`, lalu jalankan:

   ```bash
   npm run migrate
   ```

   Ini akan membuat semua tabel dan mengisi data awal: 3 venue, lapangan
   (Hijau/Biru untuk kedua futsal, Lapangan Utama untuk mini soccer), dan seluruh
   aturan harga sesuai data yang diberikan.

7. **Login pertama kali** di `https://domain-anda.com/admin.html` dengan:
   - Username: `superadmin`
   - Password: `admin123`

   **Segera ganti password ini** lewat tombol "Ganti Password" di panel admin, dan
   segera ubah/hapus nomor WA admin default di tabel `venues` (lihat bagian
   "Konfigurasi nomor WA admin" di bawah).

### Konfigurasi nomor WA admin per tempat

Nomor WA default masih placeholder (`628110000001`, dst). Ubah lewat SQL langsung
(via console PostgreSQL di EasyPanel, atau `psql`):

```sql
UPDATE venues SET admin_wa = '6281234567890' WHERE slug = 'jogokariyan-futsal';
UPDATE venues SET admin_wa = '6281234567891' WHERE slug = '4r-futsal';
UPDATE venues SET admin_wa = '6281234567892' WHERE slug = 'kalisi-mini-soccer';
```

Format nomor: kode negara tanpa "+" atau "0" di depan, mis. `628123...` (bukan
`08123...`).

### Membuat akun admin tambahan

Sebagai admin utama, gunakan menu **Kelola Admin** di panel admin — atau lewat terminal:

```bash
# Admin utama (akses semua tempat)
node scripts/create-admin.js utama admin2 password_kuat "Nama Admin"

# Admin khusus (hanya 1 tempat, slug: jogokariyan-futsal / 4r-futsal / kalisi-mini-soccer)
node scripts/create-admin.js khusus admin4r password_kuat "Admin 4R" 4r-futsal
```

## Backup & Restore

### Lewat panel admin (paling mudah)
Tab **Backup & Restore** (khusus admin utama): tombol "Buat Backup Sekarang", daftar
file backup dengan opsi Unduh / Restore / Hapus, serta form unggah file backup dari
komputer sendiri untuk direstore ke server.

### Lewat terminal / cron (opsional, untuk backup terjadwal otomatis)
```bash
# Backup manual
./scripts/backup.sh

# Restore dari file tertentu (akan menimpa seluruh data saat ini!)
./scripts/restore.sh /app/backups/backup-booking-lapangan-2026-07-20_02-00-00.dump
```

Untuk backup otomatis harian, tambahkan ke crontab container atau host:
```
0 2 * * * /app/scripts/backup.sh >> /app/backups/backup.log 2>&1
```
File backup lebih dari 30 hari akan otomatis dibersihkan oleh `backup.sh`.

## Notifikasi WhatsApp

Sistem ini **tidak** menjalankan WhatsApp Web sendiri di server (berat & gampang putus).
Sebagai gantinya, sistem memanggil **WA Gateway** pihak ketiga yang sudah Anda hubungkan
ke nomor WhatsApp Anda sendiri.

### Rekomendasi: Fonnte (paling mudah untuk UMKM Indonesia)

1. Daftar di [fonnte.com](https://fonnte.com), scan QR untuk menghubungkan nomor WA Anda
   (bisa pakai nomor WA biasa, tidak harus WA Business)
2. Di menu **Device**, salin token perangkat Anda
3. Set environment variable di service App (EasyPanel):
   ```
   WA_GATEWAY_PROVIDER=fonnte
   WA_GATEWAY_URL=https://api.fonnte.com/send
   WA_GATEWAY_TOKEN=<token dari Fonnte>
   ```
4. Untuk kirim ke **grup WA**, cari ID grup lewat fitur "Device" > "Group ID" di Fonnte,
   lalu masukkan ID tersebut (bukan nomor HP) saat menambah target notifikasi tipe "Grup WA"

### Provider lain

Kalau Anda pakai provider lain (Wablas, WhaCenter, dll) yang API-nya berbeda bentuk:
- Set `WA_GATEWAY_PROVIDER=generic` — sistem akan POST JSON `{ target, message }` ke
  `WA_GATEWAY_URL` dengan header `Authorization: Bearer <WA_GATEWAY_TOKEN>`
- Kalau bentuk API provider Anda berbeda dari itu, sesuaikan langsung fungsi
  `kirimPesanMentah` di `src/utils/wa.js`

### Mengatur target notifikasi per tempat

Login sebagai admin utama → tab **Pengaturan** → pilih tempat → bagian **Notifikasi
WhatsApp** → tambahkan nomor WA pribadi dan/atau ID grup WA. Setiap tempat bisa punya
target berbeda-beda (misalnya grup WA khusus 4R Futsal terpisah dari grup Jogokariyan
Futsal). Ada tombol "Kirim Uji Coba" untuk memastikan koneksi ke gateway sudah benar,
dan log pengiriman (berhasil/gagal) bisa dicek lewat API `/api/pengaturan/notifikasi-log`.

Kalau `WA_GATEWAY_TOKEN` belum diisi atau pengiriman gagal, sistem tetap **tidak akan
membatalkan proses booking/edit/cancel** — kegagalan kirim WA hanya dicatat di log, tidak
mengganggu operasional inti.

## Mengelola Harga, Jam Operasional & Nomor WA Admin

Login sebagai admin utama → tab **Pengaturan** → pilih tempat (termasuk KALISI Mini
Soccer) di dropdown atas:
- **Jam Operasional & Nomor WA Admin**: ubah jam buka/tutup, durasi tiap slot booking
  (60 = per jam, 90 = per 1,5 jam, dst.), dan nomor WA admin tempat tersebut.
- **Daftar Harga per Rentang Jam**: tambah, ubah, atau hapus rentang harga. Untuk KALISI
  Mini Soccer, setiap baris mewakili satu slot 1,5 jam dengan harganya sendiri — pastikan
  rentang jam yang Anda atur menutupi seluruh jam operasional supaya tidak ada slot yang
  harganya kosong.

Perubahan langsung berlaku saat itu juga, tidak perlu restart atau redeploy.

## Link Terpisah per Tempat (Subdomain)

Selain domain utama (mis. `https://olahraga.lewat.web.id`) yang menampilkan ketiga
tempat dengan tab pilihan, sistem ini juga mendukung **domain khusus per tempat** yang
langsung menampilkan jadwal tempat itu saja (tanpa tab, tanpa perlu pilih dulu):

| Domain | Tempat |
|---|---|
| `jf.lewat.web.id` | Jogokariyan Futsal |
| `4r.lewat.web.id` | 4R Futsal |
| `kalisiminisoccer.lewat.web.id` | KALISI Mini Soccer |

Ini **backend yang sama, satu container yang sama** — bukan instalasi terpisah. Yang
perlu dilakukan hanya menambahkan domain-domain tersebut ke service App yang sudah ada
di EasyPanel, lalu sistem otomatis mendeteksi lewat domain mana pelanggan mengakses.

### Langkah di EasyPanel

1. Buka service **App** (yang sama dengan yang sudah jalan di `olahraga.lewat.web.id`)
2. Tab **Domains** → **Add Domain**, tambahkan satu per satu:
   - `jf.lewat.web.id`
   - `4r.lewat.web.id`
   - `kalisiminisoccer.lewat.web.id`
3. Untuk masing-masing, set **Proxy Port** ke `3000` (sama seperti domain utama)
4. Pastikan DNS masing-masing subdomain sudah diarahkan (A record) ke IP server Anda —
   kalau domain utama `lewat.web.id` sudah pakai wildcard DNS (`*.lewat.web.id`), biasanya
   subdomain baru otomatis langsung aktif tanpa perlu tambah DNS record lagi
5. Aktifkan HTTPS/Let's Encrypt untuk masing-masing domain di tab yang sama

Tidak perlu redeploy atau migrate database — cukup update kode frontend (lihat langkah
"Memperbarui Instalasi" di bawah) lalu tambahkan domainnya di EasyPanel.

### Menambah tempat baru di kemudian hari

Kalau suatu saat menambah tempat ke-4 dan mau dikasih subdomain sendiri juga, edit
`PETA_DOMAIN_VENUE` di awal file `public/js/app.js`:

```js
const PETA_DOMAIN_VENUE = {
  'jf.lewat.web.id': 'jogokariyan-futsal',
  '4r.lewat.web.id': '4r-futsal',
  'kalisiminisoccer.lewat.web.id': 'kalisi-mini-soccer',
  'tempatbaru.lewat.web.id': 'slug-tempat-baru', // tambahkan baris seperti ini
};
```

`slug-tempat-baru` harus persis sama dengan kolom `slug` di tabel `venues`.

## Memperbarui Instalasi yang Sudah Berjalan (Upgrade)

Kalau Anda sudah pernah deploy sistem ini sebelumnya dan ingin mengambil update terbaru
(fitur baru: pengaturan harga/jam, info pembayaran, notifikasi WA):

```bash
git pull                 # ambil kode terbaru
npm install               # pasang dependency baru (kalau ada)
npm run migrate           # jalankan migrasi database — AMAN dijalankan berkali-kali,
                           # tidak menghapus data yang sudah ada
```

Di EasyPanel: buka tab **Source** service App → **Deploy** ulang (atau tunggu auto-deploy
kalau sudah diaktifkan), lalu buka tab **Console** → jalankan `npm run migrate`.

## Cetak Jadwal

Di tab **Cetak Jadwal**, pilih tempat lalu tanggal (untuk jadwal harian) atau bulan
(untuk jadwal bulanan) → tombol "Buka & Cetak" akan membuka halaman siap-cetak di tab
baru. Gunakan `Ctrl+P` / tombol "Cetak Halaman Ini" di halaman tersebut untuk mencetak
atau menyimpan sebagai PDF.

## Menjalankan secara lokal (development, tanpa Docker)

```bash
# 1. Siapkan PostgreSQL lokal, buat database kosong
createdb booking_lapangan

# 2. Salin & sesuaikan environment
cp .env.example .env

# 3. Install dependency
npm install

# 4. Jalankan migrasi
npm run migrate

# 5. Jalankan server
npm start
```

Buka `http://localhost:3000` untuk halaman pelanggan, dan
`http://localhost:3000/admin.html` untuk panel admin.

## Catatan Keamanan

- Ganti `JWT_SECRET` dan password `superadmin` default segera setelah instalasi.
- Backup berisi seluruh data pelanggan (nama & nomor WA) — simpan file backup di
  tempat aman dan jangan bagikan sembarangan.
- Endpoint backup/restore hanya bisa diakses oleh akun dengan role `admin_utama`.
