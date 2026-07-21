-- =====================================================================
-- SISTEM BOOKING LAPANGAN — SKEMA DATABASE (PostgreSQL)
-- Jogokariyan Futsal, 4R Futsal, KALISI Mini Soccer
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- untuk gen_random_uuid jika diperlukan

-- ---------------------------------------------------------------------
-- VENUES (tempat)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS venues (
    id            SERIAL PRIMARY KEY,
    slug          VARCHAR(50) UNIQUE NOT NULL,
    nama          VARCHAR(150) NOT NULL,
    alamat        TEXT NOT NULL,
    jenis         VARCHAR(20) NOT NULL CHECK (jenis IN ('futsal','mini_soccer')),
    admin_wa      VARCHAR(25) NOT NULL,     -- nomor WA admin khusus tempat ini
    slot_menit    INT NOT NULL DEFAULT 60,  -- durasi 1 slot booking (60 = per jam, 90 = per 1.5 jam)
    jam_buka      TIME NOT NULL DEFAULT '06:00',
    jam_tutup     TIME NOT NULL DEFAULT '24:00',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- COURTS (lapangan per venue: Hijau / Biru / Lapangan Utama)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courts (
    id          SERIAL PRIMARY KEY,
    venue_id    INT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    nama        VARCHAR(50) NOT NULL,   -- 'Hijau', 'Biru', 'Lapangan Utama'
    warna       VARCHAR(20) NOT NULL DEFAULT 'default', -- kode warna tampilan: hijau/biru/netral
    aktif       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (venue_id, nama)
);

-- ---------------------------------------------------------------------
-- PRICE RULES (aturan harga per rentang jam per venue)
-- Untuk mini soccer, tiap baris mewakili satu SLOT tetap 1.5 jam
-- dengan harga sendiri (bukan tarif per-jam berjalan).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_rules (
    id           SERIAL PRIMARY KEY,
    venue_id     INT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    jam_mulai    TIME NOT NULL,
    jam_selesai  TIME NOT NULL,
    harga        NUMERIC(12,2) NOT NULL,
    urutan       INT NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- USERS (admin sistem)
-- role: 'admin_utama' (bisa booking di ketiga tempat)
--       'admin_khusus' (hanya bisa booking di satu venue -> venue_id wajib)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id             SERIAL PRIMARY KEY,
    username       VARCHAR(50) UNIQUE NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    nama           VARCHAR(150) NOT NULL,
    role           VARCHAR(20) NOT NULL CHECK (role IN ('admin_utama','admin_khusus')),
    venue_id       INT REFERENCES venues(id), -- NULL jika admin_utama
    aktif          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ( (role = 'admin_utama' AND venue_id IS NULL) OR (role = 'admin_khusus' AND venue_id IS NOT NULL) )
);

-- ---------------------------------------------------------------------
-- CUSTOMERS (pelanggan / tim yang dibantu booking oleh admin)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id          SERIAL PRIMARY KEY,
    nama        VARCHAR(150) NOT NULL,
    no_wa       VARCHAR(25) NOT NULL,
    nama_tim    VARCHAR(150),
    catatan     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_no_wa ON customers(no_wa);
CREATE INDEX IF NOT EXISTS idx_customers_tim ON customers(nama_tim);

-- ---------------------------------------------------------------------
-- BOOKINGS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
    id            SERIAL PRIMARY KEY,
    venue_id      INT NOT NULL REFERENCES venues(id),
    court_id      INT NOT NULL REFERENCES courts(id),
    customer_id   INT NOT NULL REFERENCES customers(id),
    tanggal       DATE NOT NULL,
    jam_mulai     TIME NOT NULL,
    jam_selesai   TIME NOT NULL,
    harga         NUMERIC(12,2) NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled')),
    dibuat_oleh   INT REFERENCES users(id),
    dibatalkan_oleh INT REFERENCES users(id),
    alasan_batal  TEXT,
    catatan       TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cegah bentrok jadwal: satu lapangan tidak boleh dibooking dobel di jam yang sama selama masih aktif (booked)
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_slot_active
    ON bookings (court_id, tanggal, jam_mulai)
    WHERE status = 'booked';

CREATE INDEX IF NOT EXISTS idx_bookings_tanggal ON bookings(tanggal);
CREATE INDEX IF NOT EXISTS idx_bookings_venue ON bookings(venue_id, tanggal);

-- ---------------------------------------------------------------------
-- BOOKING HISTORY (log semua aksi booking & cancel utk audit)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_history (
    id            SERIAL PRIMARY KEY,
    booking_id    INT REFERENCES bookings(id),
    aksi          VARCHAR(20) NOT NULL CHECK (aksi IN ('booking','cancel')),
    oleh_user_id  INT REFERENCES users(id),
    keterangan    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_history_booking ON booking_history(booking_id);

-- =====================================================================
-- SEED DATA — Venue, Courts, Harga sesuai data yang diberikan
-- =====================================================================

INSERT INTO venues (slug, nama, alamat, jenis, admin_wa, slot_menit, jam_buka, jam_tutup) VALUES
('jogokariyan-futsal', 'Jogokariyan Futsal', 'Jl. Jogokariyan No.65 Yogyakarta', 'futsal', '628110000001', 60, '06:00', '24:00'),
('4r-futsal', '4R Futsal', 'Jl. Parangtritis No.161 Yogyakarta', 'futsal', '628110000002', 60, '06:00', '24:00'),
('kalisi-mini-soccer', 'KALISI Mini Soccer', 'Jl. Kalisi 2, Nyemengan, Tirtonirmolo, Kec. Kasihan, Kabupaten Bantul, Daerah Istimewa Yogyakarta', 'mini_soccer', '628110000003', 90, '06:00', '24:00')
ON CONFLICT (slug) DO NOTHING;

-- Courts
INSERT INTO courts (venue_id, nama, warna)
SELECT id, 'Hijau', 'hijau' FROM venues WHERE slug = 'jogokariyan-futsal'
ON CONFLICT DO NOTHING;
INSERT INTO courts (venue_id, nama, warna)
SELECT id, 'Biru', 'biru' FROM venues WHERE slug = 'jogokariyan-futsal'
ON CONFLICT DO NOTHING;

INSERT INTO courts (venue_id, nama, warna)
SELECT id, 'Hijau', 'hijau' FROM venues WHERE slug = '4r-futsal'
ON CONFLICT DO NOTHING;
INSERT INTO courts (venue_id, nama, warna)
SELECT id, 'Biru', 'biru' FROM venues WHERE slug = '4r-futsal'
ON CONFLICT DO NOTHING;

INSERT INTO courts (venue_id, nama, warna)
SELECT id, 'Lapangan Utama', 'default' FROM venues WHERE slug = 'kalisi-mini-soccer'
ON CONFLICT DO NOTHING;

-- Harga Jogokariyan Futsal (per jam)
INSERT INTO price_rules (venue_id, jam_mulai, jam_selesai, harga, urutan)
SELECT id, '06:00', '15:00', 115000, 1 FROM venues WHERE slug = 'jogokariyan-futsal';
INSERT INTO price_rules (venue_id, jam_mulai, jam_selesai, harga, urutan)
SELECT id, '15:00', '24:00', 150000, 2 FROM venues WHERE slug = 'jogokariyan-futsal';

-- Harga 4R Futsal (per jam)
INSERT INTO price_rules (venue_id, jam_mulai, jam_selesai, harga, urutan)
SELECT id, '06:00', '12:00', 80000, 1 FROM venues WHERE slug = '4r-futsal';
INSERT INTO price_rules (venue_id, jam_mulai, jam_selesai, harga, urutan)
SELECT id, '12:00', '16:00', 100000, 2 FROM venues WHERE slug = '4r-futsal';
INSERT INTO price_rules (venue_id, jam_mulai, jam_selesai, harga, urutan)
SELECT id, '16:00', '24:00', 135000, 3 FROM venues WHERE slug = '4r-futsal';

-- Harga KALISI Mini Soccer (per slot 1.5 jam, sesuai rentang)
INSERT INTO price_rules (venue_id, jam_mulai, jam_selesai, harga, urutan)
SELECT id, '06:00', '09:00', 500000, 1 FROM venues WHERE slug = 'kalisi-mini-soccer';
INSERT INTO price_rules (venue_id, jam_mulai, jam_selesai, harga, urutan)
SELECT id, '09:00', '15:00', 300000, 2 FROM venues WHERE slug = 'kalisi-mini-soccer';
INSERT INTO price_rules (venue_id, jam_mulai, jam_selesai, harga, urutan)
SELECT id, '15:00', '16:30', 500000, 3 FROM venues WHERE slug = 'kalisi-mini-soccer';
INSERT INTO price_rules (venue_id, jam_mulai, jam_selesai, harga, urutan)
SELECT id, '16:30', '18:00', 700000, 4 FROM venues WHERE slug = 'kalisi-mini-soccer';
INSERT INTO price_rules (venue_id, jam_mulai, jam_selesai, harga, urutan)
SELECT id, '18:00', '24:00', 800000, 5 FROM venues WHERE slug = 'kalisi-mini-soccer';

-- Admin utama default (username: superadmin / password: ganti_password_ini)
-- Hash di bawah adalah bcrypt utk password "admin123" — WAJIB DIGANTI setelah install!
INSERT INTO users (username, password_hash, nama, role, venue_id)
VALUES ('superadmin', '$2b$10$DXafqnWMooUgPm3t67MSOeDv9qQQLxz.GBXUOsieOcv2Y.1TvwMze', 'Admin Utama', 'admin_utama', NULL)
ON CONFLICT (username) DO NOTHING;
