-- =====================================================================
-- MIGRASI 002 — Info Pembayaran, Riwayat Edit, Konfigurasi Notifikasi WA
-- Aman dijalankan berkali-kali (idempotent). Tidak menyentuh data yang sudah ada.
-- =====================================================================

-- (Catatan: constraint unik price_rules sekarang sudah ditangani di db/schema.sql,
--  dijalankan sebelum migrasi ini sehingga tidak perlu diulang di sini.)

-- ---------------------------------------------------------------------
-- Info pembayaran per booking (hanya terlihat oleh admin, tidak publik)
-- ---------------------------------------------------------------------
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status_pembayaran VARCHAR(20) NOT NULL DEFAULT 'belum_bayar';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS metode_pembayaran VARCHAR(20);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cash_dipegang_oleh VARCHAR(150);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rekening_tujuan VARCHAR(150);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS catatan_pembayaran TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_status_pembayaran') THEN
    ALTER TABLE bookings ADD CONSTRAINT chk_status_pembayaran
      CHECK (status_pembayaran IN ('belum_bayar','dp','lunas'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_metode_pembayaran') THEN
    ALTER TABLE bookings ADD CONSTRAINT chk_metode_pembayaran
      CHECK (metode_pembayaran IS NULL OR metode_pembayaran IN ('cash','transfer'));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Izinkan aksi 'edit' pada booking_history (sebelumnya hanya booking/cancel)
-- ---------------------------------------------------------------------
ALTER TABLE booking_history DROP CONSTRAINT IF EXISTS booking_history_aksi_check;
ALTER TABLE booking_history ADD CONSTRAINT booking_history_aksi_check
  CHECK (aksi IN ('booking','cancel','edit'));

-- ---------------------------------------------------------------------
-- Target notifikasi WA per venue (nomor pribadi atau ID grup WA)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifikasi_wa (
    id          SERIAL PRIMARY KEY,
    venue_id    INT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    tipe        VARCHAR(10) NOT NULL CHECK (tipe IN ('nomor','grup')),
    tujuan      VARCHAR(100) NOT NULL,  -- nomor WA (628xxx) atau ID grup
    label       VARCHAR(100),           -- nama untuk memudahkan admin, mis. "Owner 4R"
    aktif       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Log pengiriman notifikasi (agar admin bisa cek apakah pesan terkirim)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifikasi_log (
    id          SERIAL PRIMARY KEY,
    venue_id    INT REFERENCES venues(id),
    tujuan      VARCHAR(100),
    pesan       TEXT,
    status      VARCHAR(20) NOT NULL, -- 'terkirim' atau 'gagal'
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_log_venue ON notifikasi_log(venue_id);
CREATE INDEX IF NOT EXISTS idx_notif_wa_venue ON notifikasi_wa(venue_id);
