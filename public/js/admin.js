(() => {
  const state = {
    token: localStorage.getItem('bl_token') || null,
    user: JSON.parse(localStorage.getItem('bl_user') || 'null'),
    venues: [],
    venueAktif: null,
    tahun: null,
    bulan: null,
    tanggalDipilih: null,
    slotKontext: null, // dipakai saat buka modal booking/batal
  };

  const el = (id) => document.getElementById(id);
  const rupiah = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
  const hariIniISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  async function api(method, url, body) {
    const opt = { method, headers: {} };
    if (state.token) opt.headers.Authorization = `Bearer ${state.token}`;
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const res = await fetch(url, opt);
    const data = res.status === 204 ? {} : await res.json();
    if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan.');
    return data;
  }

  async function apiUpload(url, formData) {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal mengunggah.');
    return data;
  }

  // ---------------- LOGIN / LOGOUT ----------------
  function tampilkanLogin() {
    el('login-shell').classList.remove('hidden');
    el('app-shell').classList.add('hidden');
  }

  function tampilkanApp() {
    el('login-shell').classList.add('hidden');
    el('app-shell').classList.remove('hidden');
    el('user-info').textContent = `${state.user.nama} \u00b7 ${state.user.role === 'admin_utama' ? 'Admin Utama' : 'Admin Khusus'}`;
    if (state.user.role === 'admin_utama') {
      el('tab-kelola-admin').classList.remove('hidden');
      el('tab-pengaturan').classList.remove('hidden');
    }
    initApp();
  }

  el('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    el('login-error').innerHTML = '';
    try {
      const data = await api('POST', '/api/auth/login', {
        username: el('login-username').value.trim(),
        password: el('login-password').value,
      });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('bl_token', state.token);
      localStorage.setItem('bl_user', JSON.stringify(state.user));
      tampilkanApp();
    } catch (err) {
      el('login-error').innerHTML = `<div class="pesan-error">${err.message}</div>`;
    }
  });

  el('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('bl_token');
    localStorage.removeItem('bl_user');
    state.token = null; state.user = null;
    tampilkanLogin();
  });

  // ---------------- Penutup modal universal (klik di luar kotak / tombol Escape) ----------------
  // Ini jaring pengaman: kalau modal manapun terbuka dan pengguna tidak menemukan tombol "x",
  // klik area gelap di luar kotak atau tekan Escape akan menutupnya.
  document.querySelectorAll('.overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => {
      if (e.target === ov) ov.classList.add('hidden');
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.overlay:not(.hidden)').forEach((ov) => ov.classList.add('hidden'));
    }
  });

  // ---------------- TABS ----------------
  el('tab-nav').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    document.querySelectorAll('#tab-nav button').forEach((b) => b.classList.remove('aktif'));
    btn.classList.add('aktif');
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    el(`panel-${btn.dataset.tab}`).classList.remove('hidden');
    if (btn.dataset.tab === 'riwayat') muatRiwayat();
    if (btn.dataset.tab === 'pelanggan') muatPelanggan();
    if (btn.dataset.tab === 'backup') muatBackup();
    if (btn.dataset.tab === 'kelola-admin') muatAdmin();
    if (btn.dataset.tab === 'pengaturan') muatPengaturan();
  });

  // ---------------- INIT APP ----------------
  async function initApp() {
    const now = new Date();
    state.tahun = now.getFullYear();
    state.bulan = now.getMonth() + 1;

    const semuaVenue = await api('GET', '/api/venues');
    state.venues = state.user.role === 'admin_utama' ? semuaVenue : semuaVenue.filter((v) => v.id === state.user.venue_id);

    renderTabsVenue();
    pilihVenue(state.venues[0].slug);
    isiSelectVenueCetak();
    if (state.user.role === 'admin_utama') {
      el('pengaturan-venue-select').innerHTML = state.venues.map((v) => `<option value="${v.id}">${v.nama}</option>`).join('');
      el('pengaturan-venue-select').addEventListener('change', muatPengaturan);
    }

    el('btn-bulan-prev').addEventListener('click', () => gantiBulan(-1));
    el('btn-bulan-next').addEventListener('click', () => gantiBulan(1));
  }

  /** Ambil ulang data venue (dipakai setelah ubah jam/no WA di tab Pengaturan) tanpa memasang ulang event listener. */
  async function segarkanVenueCache() {
    const semuaVenue = await api('GET', '/api/venues');
    state.venues = state.user.role === 'admin_utama' ? semuaVenue : semuaVenue.filter((v) => v.id === state.user.venue_id);
    if (state.venueAktif) state.venueAktif = state.venues.find((v) => v.id === state.venueAktif.id) || state.venues[0];
    renderTabsVenue();
    if (state.venueAktif) renderVenueCardAdmin();
    isiSelectVenueCetak();
  }

  function renderVenueCardAdmin() {
    // Panel admin tidak menampilkan kartu info venue terpisah (info sudah ada di tab Pengaturan),
    // fungsi ini sengaja dibiarkan kosong sebagai titik perluasan di masa depan.
  }

  function renderTabsVenue() {
    const wrap = el('venue-tabs');
    wrap.innerHTML = '';
    state.venues.forEach((v) => {
      const btn = document.createElement('button');
      btn.className = 'venue-tab' + (state.venueAktif && state.venueAktif.slug === v.slug ? ' aktif' : '');
      btn.textContent = v.nama;
      btn.addEventListener('click', () => pilihVenue(v.slug));
      wrap.appendChild(btn);
    });
  }

  function pilihVenue(slug) {
    state.venueAktif = state.venues.find((v) => v.slug === slug);
    state.tanggalDipilih = null;
    renderTabsVenue();
    el('detail-hari').classList.add('hidden');
    muatKalenderBulan();
  }

  async function muatKalenderBulan() {
    el('kalender-judul').textContent = 'Memuat...';
    const data = await api('GET', `/api/kalender/${state.venueAktif.slug}/bulan?tahun=${state.tahun}&bulan=${state.bulan}`);
    el('kalender-judul').textContent = `${data.namaBulan} ${data.tahun}`;

    const grid = el('grid-kalender');
    grid.innerHTML = '';
    const offsetAwal = new Date(Date.UTC(state.tahun, state.bulan - 1, 1)).getUTCDay();
    for (let i = 0; i < offsetAwal; i += 1) {
      const kosong = document.createElement('div');
      kosong.className = 'sel-tanggal kosong-bulan';
      grid.appendChild(kosong);
    }
    data.hari.forEach((h) => {
      const sel = document.createElement('div');
      sel.className = `sel-tanggal status-${h.status}`;
      if (h.tanggal === hariIniISO()) sel.classList.add('hari-ini');
      if (h.tanggal === state.tanggalDipilih) sel.classList.add('dipilih');
      const ketLabel = h.status === 'kosong' ? 'Kosong' : (h.status === 'penuh' ? 'Penuh' : `${h.kosong} slot`);
      sel.innerHTML = `<span class="angka">${h.tanggalNum}</span><span class="ket">${ketLabel}</span>`;
      sel.addEventListener('click', () => pilihTanggal(h.tanggal));
      grid.appendChild(sel);
    });
  }

  function gantiBulan(delta) {
    state.bulan += delta;
    if (state.bulan > 12) { state.bulan = 1; state.tahun += 1; }
    if (state.bulan < 1) { state.bulan = 12; state.tahun -= 1; }
    muatKalenderBulan();
  }

  async function pilihTanggal(tanggal) {
    state.tanggalDipilih = tanggal;
    muatKalenderBulan();

    const data = await api('GET', `/api/kalender/${state.venueAktif.slug}/hari?tanggal=${tanggal}`);
    el('detail-hari').classList.remove('hidden');
    el('detail-judul-venue').textContent = data.venue.nama;
    el('detail-tanggal').textContent = data.namaTanggalPanjang;

    const wrap = el('detail-lapangan-list');
    wrap.innerHTML = '';
    data.lapangan.forEach((lap) => {
      const blok = document.createElement('div');
      blok.className = 'lapangan-blok';
      const slotsHtml = lap.slots.map((s) => {
        const dataAttr = `data-court-id="${lap.court_id}" data-court="${lap.nama}" data-warna="${lap.warna}" data-jm="${s.jam_mulai}" data-js="${s.jam_selesai}" data-harga="${s.harga}"`;
        if (s.status === 'kosong') {
          return `<div class="slot kosong" ${dataAttr}>
                    <div class="jam">${s.jam_mulai} \u2013 ${s.jam_selesai}</div>
                    <div class="harga">${rupiah(s.harga)}</div>
                  </div>`;
        }
        const labelBayar = { belum_bayar: 'Belum Bayar', dp: 'DP', lunas: 'Lunas' }[s.status_pembayaran] || 'Belum Bayar';
        return `<div class="slot terisi" ${dataAttr} data-booking-id="${s.booking_id}" data-nama="${s.nama_pelanggan || ''}" data-wa="${s.no_wa || ''}" data-tim="${s.nama_tim || ''}">
                  <div class="jam">${s.jam_mulai} \u2013 ${s.jam_selesai}</div>
                  <div class="harga">Terisi</div>
                  <div class="tim">${s.nama_tim || s.nama_pelanggan}<br><span class="text-faint">${s.no_wa || ''}</span></div>
                  <div class="info-bayar"><span class="badge bayar-${s.status_pembayaran || 'belum_bayar'}">${labelBayar}</span></div>
                </div>`;
      }).join('');
      blok.innerHTML = `<div class="lapangan-judul"><span class="dot-warna ${lap.warna}"></span>Lapangan ${lap.nama}</div>
                         <div class="slot-grid">${slotsHtml}</div>`;
      wrap.appendChild(blok);
    });

    wrap.querySelectorAll('.slot.kosong').forEach((elm) => elm.addEventListener('click', () => bukaModalBooking(elm)));
    wrap.querySelectorAll('.slot.terisi').forEach((elm) => elm.addEventListener('click', () => bukaModalDetail(elm)));
  }

  // ---------------- Helper: toggle field cash/transfer sesuai metode dipilih ----------------
  function pasangToggleMetode(prefix) {
    const metodeSel = el(`${prefix}-metode-bayar`);
    const cashWrap = el(`${prefix}-field-cash`);
    const transferWrap = el(`${prefix}-field-transfer`);
    metodeSel.addEventListener('change', () => {
      cashWrap.classList.toggle('hidden', metodeSel.value !== 'cash');
      transferWrap.classList.toggle('hidden', metodeSel.value !== 'transfer');
    });
  }
  pasangToggleMetode('booking');
  pasangToggleMetode('detail');

  // ---------------- MODAL BOOKING (buat baru) ----------------
  function bukaModalBooking(elm) {
    state.slotKontext = {
      venueId: state.venueAktif.id,
      courtId: elm.dataset.courtId,
      court: elm.dataset.court,
      jamMulai: elm.dataset.jm,
      jamSelesai: elm.dataset.js,
      harga: elm.dataset.harga,
    };
    el('booking-error').innerHTML = '';
    el('form-booking').reset();
    el('booking-field-cash').classList.add('hidden');
    el('booking-field-transfer').classList.add('hidden');
    el('booking-ringkasan-slot').textContent = `${state.venueAktif.nama} \u00b7 Lapangan ${state.slotKontext.court} \u00b7 ${state.tanggalDipilih} \u00b7 ${state.slotKontext.jamMulai}\u2013${state.slotKontext.jamSelesai} \u00b7 ${rupiah(state.slotKontext.harga)}`;
    el('modal-booking').classList.remove('hidden');
  }
  el('tutup-modal-booking').addEventListener('click', () => el('modal-booking').classList.add('hidden'));
  el('booking-batal').addEventListener('click', () => el('modal-booking').classList.add('hidden'));

  el('form-booking').addEventListener('submit', async (e) => {
    e.preventDefault();
    el('booking-error').innerHTML = '';
    try {
      await api('POST', '/api/bookings', {
        venue_id: state.slotKontext.venueId,
        court_id: state.slotKontext.courtId,
        tanggal: state.tanggalDipilih,
        jam_mulai: state.slotKontext.jamMulai,
        jam_selesai: state.slotKontext.jamSelesai,
        harga: state.slotKontext.harga,
        catatan: el('booking-catatan').value || null,
        customer: {
          nama: el('booking-nama').value.trim(),
          no_wa: el('booking-wa').value.trim(),
          nama_tim: el('booking-tim').value.trim() || null,
        },
        status_pembayaran: el('booking-status-bayar').value,
        metode_pembayaran: el('booking-metode-bayar').value || null,
        cash_dipegang_oleh: el('booking-cash-oleh').value.trim() || null,
        rekening_tujuan: el('booking-rekening').value.trim() || null,
        catatan_pembayaran: el('booking-catatan-bayar').value.trim() || null,
      });
      el('modal-booking').classList.add('hidden');
      pilihTanggal(state.tanggalDipilih);
    } catch (err) {
      el('booking-error').innerHTML = `<div class="pesan-error">${err.message}</div>`;
    }
  });

  // ---------------- MODAL DETAIL / EDIT / BATAL BOOKING ----------------
  async function bukaModalDetail(elm) {
    state.slotKontext = { bookingId: elm.dataset.bookingId, court: elm.dataset.court };
    el('detail-error').innerHTML = ''; el('detail-sukses').innerHTML = '';
    el('detail-alasan-batal').value = '';
    el('detail-ringkasan-slot').innerHTML = `${state.venueAktif.nama} \u00b7 Lapangan ${elm.dataset.court} \u00b7 ${state.tanggalDipilih} \u00b7 ${elm.dataset.jm}\u2013${elm.dataset.js}<br>Dipesan oleh: <b>${elm.dataset.tim || elm.dataset.nama}</b> (${elm.dataset.wa})`;
    el('modal-detail-booking').classList.remove('hidden');

    try {
      const b = await api('GET', `/api/bookings/${state.slotKontext.bookingId}`);
      el('detail-status-bayar').value = b.status_pembayaran || 'belum_bayar';
      el('detail-metode-bayar').value = b.metode_pembayaran || '';
      el('detail-cash-oleh').value = b.cash_dipegang_oleh || '';
      el('detail-rekening').value = b.rekening_tujuan || '';
      el('detail-catatan-bayar').value = b.catatan_pembayaran || '';
      el('detail-catatan').value = b.catatan || '';
      el('detail-field-cash').classList.toggle('hidden', b.metode_pembayaran !== 'cash');
      el('detail-field-transfer').classList.toggle('hidden', b.metode_pembayaran !== 'transfer');
    } catch (err) {
      el('detail-error').innerHTML = `<div class="pesan-error">${err.message}</div>`;
    }
  }
  el('tutup-modal-detail-booking').addEventListener('click', () => el('modal-detail-booking').classList.add('hidden'));

  el('form-detail-booking').addEventListener('submit', async (e) => {
    e.preventDefault();
    el('detail-error').innerHTML = ''; el('detail-sukses').innerHTML = '';
    try {
      await api('PUT', `/api/bookings/${state.slotKontext.bookingId}`, {
        status_pembayaran: el('detail-status-bayar').value,
        metode_pembayaran: el('detail-metode-bayar').value || null,
        cash_dipegang_oleh: el('detail-cash-oleh').value.trim() || null,
        rekening_tujuan: el('detail-rekening').value.trim() || null,
        catatan_pembayaran: el('detail-catatan-bayar').value.trim() || null,
        catatan: el('detail-catatan').value.trim() || null,
      });
      el('detail-sukses').innerHTML = '<div class="pesan-sukses">Perubahan disimpan.</div>';
      pilihTanggal(state.tanggalDipilih);
    } catch (err) {
      el('detail-error').innerHTML = `<div class="pesan-error">${err.message}</div>`;
    }
  });

  el('btn-batalkan-dari-detail').addEventListener('click', async () => {
    const alasan = el('detail-alasan-batal').value.trim();
    if (!alasan) { el('detail-error').innerHTML = '<div class="pesan-error">Mohon isi alasan pembatalan.</div>'; return; }
    if (!confirm('Yakin ingin membatalkan booking ini?')) return;
    el('detail-error').innerHTML = '';
    try {
      await api('POST', `/api/bookings/${state.slotKontext.bookingId}/cancel`, { alasan });
      el('modal-detail-booking').classList.add('hidden');
      pilihTanggal(state.tanggalDipilih);
    } catch (err) {
      el('detail-error').innerHTML = `<div class="pesan-error">${err.message}</div>`;
    }
  });

  // ---------------- RIWAYAT ----------------
  async function muatRiwayat() {
    const rows = await api('GET', '/api/bookings/history/log');
    const wrap = el('riwayat-list');
    if (rows.length === 0) { wrap.innerHTML = '<p class="text-dim">Belum ada riwayat.</p>'; return; }
    let html = '<table class="data-table"><tr><th>Waktu</th><th>Aksi</th><th>Tempat</th><th>Lapangan</th><th>Tanggal &amp; Jam</th><th>Tim/Pelanggan</th><th>Oleh</th><th>Keterangan</th></tr>';
    rows.forEach((r) => {
      const waktu = new Date(r.created_at).toLocaleString('id-ID');
      const petaBadge = { booking: '<span class="badge status-booked">Booking</span>', cancel: '<span class="badge status-cancelled">Batal</span>', edit: '<span class="badge status-edit">Edit</span>' };
      const badge = petaBadge[r.aksi] || r.aksi;
      html += `<tr><td class="mono">${waktu}</td><td>${badge}</td><td>${r.venue_nama}</td><td>${r.court_nama}</td><td>${r.tanggal} &middot; ${r.jam_mulai}-${r.jam_selesai}</td><td>${r.nama_tim || r.customer_nama}</td><td>${r.oleh_nama || '-'}</td><td>${r.keterangan || '-'}</td></tr>`;
    });
    html += '</table>';
    wrap.innerHTML = html;
  }

  // ---------------- PELANGGAN ----------------
  async function muatPelanggan() {
    const cari = el('cari-pelanggan').value.trim();
    const rows = await api('GET', `/api/customers${cari ? `?cari=${encodeURIComponent(cari)}` : ''}`);
    const wrap = el('pelanggan-list');
    if (rows.length === 0) { wrap.innerHTML = '<p class="text-dim mt">Belum ada data pelanggan.</p>'; return; }
    let html = '<table class="data-table mt"><tr><th>Nama</th><th>No. WA</th><th>Nama Tim</th><th>Booking Aktif</th><th>Total Booking</th></tr>';
    rows.forEach((c) => {
      html += `<tr><td>${c.nama}</td><td class="mono">${c.no_wa}</td><td>${c.nama_tim || '-'}</td><td>${c.total_booking_aktif}</td><td>${c.total_booking_semua}</td></tr>`;
    });
    html += '</table>';
    wrap.innerHTML = html;
  }
  let timerCari;
  el('cari-pelanggan').addEventListener('input', () => { clearTimeout(timerCari); timerCari = setTimeout(muatPelanggan, 300); });

  // ---------------- CETAK ----------------
  function isiSelectVenueCetak() {
    ['cetak-harian-venue', 'cetak-bulanan-venue'].forEach((id) => {
      const sel = el(id);
      sel.innerHTML = state.venues.map((v) => `<option value="${v.id}">${v.nama}</option>`).join('');
    });
    el('cetak-harian-tanggal').value = hariIniISO();
    const now = new Date();
    el('cetak-bulanan-bulan').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  el('btn-cetak-harian').addEventListener('click', () => {
    const venueId = el('cetak-harian-venue').value;
    const tanggal = el('cetak-harian-tanggal').value;
    if (!tanggal) return;
    window.open(`/api/print/harian?venue_id=${venueId}&tanggal=${tanggal}&token=${encodeURIComponent(state.token)}`, '_blank');
  });

  el('btn-cetak-bulanan').addEventListener('click', () => {
    const venueId = el('cetak-bulanan-venue').value;
    const [tahun, bulan] = (el('cetak-bulanan-bulan').value || '').split('-');
    if (!tahun || !bulan) return;
    window.open(`/api/print/bulanan?venue_id=${venueId}&tahun=${tahun}&bulan=${Number(bulan)}&token=${encodeURIComponent(state.token)}`, '_blank');
  });

  // ---------------- BACKUP & RESTORE ----------------
  function bisaKelolaBackup() { return state.user.role === 'admin_utama'; }

  async function muatBackup() {
    if (!bisaKelolaBackup()) {
      el('backup-hanya-utama').innerHTML = '<p class="text-dim">Hanya admin utama yang dapat mengelola backup &amp; restore.</p>';
      return;
    }
    const rows = await api('GET', '/api/backup');
    let html = '<table class="data-table mt"><tr><th>Nama File</th><th>Ukuran</th><th>Dibuat</th><th>Aksi</th></tr>';
    if (rows.length === 0) html += '<tr><td colspan="4">Belum ada file backup.</td></tr>';
    rows.forEach((f) => {
      html += `<tr>
        <td class="mono">${f.filename}</td>
        <td>${f.ukuran_kb} KB</td>
        <td>${new Date(f.dibuat).toLocaleString('id-ID')}</td>
        <td class="flex gap">
          <a class="btn btn-outline" style="padding:6px 12px; font-size:11px;" href="/api/backup/${encodeURIComponent(f.filename)}/download?token=${encodeURIComponent(state.token)}">Unduh</a>
          <button class="btn btn-gold" style="padding:6px 12px; font-size:11px;" data-restore="${f.filename}">Restore</button>
          <button class="btn btn-danger" style="padding:6px 12px; font-size:11px;" data-hapus="${f.filename}">Hapus</button>
        </td>
      </tr>`;
    });
    html += '</table>';
    el('backup-list').innerHTML = html;

    el('backup-list').querySelectorAll('[data-restore]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`PERINGATAN: Restore akan MENIMPA seluruh data saat ini dengan isi file "${btn.dataset.restore}". Lanjutkan?`)) return;
        try {
          await api('POST', `/api/backup/${encodeURIComponent(btn.dataset.restore)}/restore`, { konfirmasi: 'YAKIN' });
          el('backup-pesan').innerHTML = '<div class="pesan-sukses">Data berhasil dipulihkan dari backup. Muat ulang halaman untuk melihat data terbaru.</div>';
        } catch (err) {
          el('backup-pesan').innerHTML = `<div class="pesan-error">${err.message}</div>`;
        }
      });
    });
    el('backup-list').querySelectorAll('[data-hapus]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Hapus file backup "${btn.dataset.hapus}"?`)) return;
        await api('DELETE', `/api/backup/${encodeURIComponent(btn.dataset.hapus)}`);
        muatBackup();
      });
    });
  }

  el('btn-buat-backup').addEventListener('click', async () => {
    el('backup-pesan').innerHTML = '<div class="pesan-sukses">Sedang membuat backup...</div>';
    try {
      await api('POST', '/api/backup');
      el('backup-pesan').innerHTML = '<div class="pesan-sukses">Backup berhasil dibuat.</div>';
      muatBackup();
    } catch (err) {
      el('backup-pesan').innerHTML = `<div class="pesan-error">${err.message}</div>`;
    }
  });

  el('input-upload-backup').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const data = await apiUpload('/api/backup/upload', fd);
      el('backup-pesan').innerHTML = `<div class="pesan-sukses">File "${data.filename}" berhasil diunggah. Klik "Restore" pada file ini di daftar di bawah untuk memulihkan data.</div>`;
      muatBackup();
    } catch (err) {
      el('backup-pesan').innerHTML = `<div class="pesan-error">${err.message}</div>`;
    }
    e.target.value = '';
  });

  // ---------------- PENGATURAN (jam, harga, no WA admin, notifikasi WA) ----------------
  let pengaturanCache = [];

  async function muatPengaturan() {
    pengaturanCache = await api('GET', '/api/pengaturan/venues');
    renderPengaturan();
  }

  function venuePengaturanAktif() {
    const id = Number(el('pengaturan-venue-select').value || pengaturanCache[0]?.id);
    return pengaturanCache.find((v) => v.id === id) || pengaturanCache[0];
  }

  function renderPengaturan() {
    const v = venuePengaturanAktif();
    if (!v) { el('pengaturan-konten').innerHTML = '<p class="text-dim">Belum ada data.</p>'; return; }

    const hargaRows = v.harga.map((h) => `
      <div class="harga-row" data-harga-id="${h.id}">
        <input type="time" class="hr-mulai" value="${h.jam_mulai}">
        <input type="time" class="hr-selesai" value="${h.jam_selesai === '24:00' ? '00:00' : h.jam_selesai}">
        <input type="number" class="hr-harga" value="${h.harga}" min="0" step="1000">
        <button type="button" class="btn btn-outline hr-simpan" style="padding:8px 12px; font-size:11px;">Simpan</button>
        <button type="button" class="btn btn-danger hr-hapus" style="padding:8px 12px; font-size:11px;">Hapus</button>
      </div>`).join('');

    const notifRows = v.notifikasi.map((n) => `
      <div class="kartu-target" data-notif-id="${n.id}">
        <div class="info">
          <div class="label">${n.tipe === 'grup' ? 'Grup WA' : 'Nomor WA'}${n.label ? ' \u00b7 ' + n.label : ''}</div>
          <div class="mono">${n.tujuan}</div>
        </div>
        <div class="flex gap" style="align-items:center;">
          <label class="toggle-aktif"><input type="checkbox" class="notif-aktif" ${n.aktif ? 'checked' : ''}> Aktif</label>
          <button type="button" class="btn btn-outline notif-test" style="padding:6px 10px; font-size:11px;">Kirim Uji Coba</button>
          <button type="button" class="btn btn-danger notif-hapus" style="padding:6px 10px; font-size:11px;">Hapus</button>
        </div>
      </div>`).join('') || '<p class="text-dim" style="font-size:13px;">Belum ada target notifikasi untuk tempat ini.</p>';

    el('pengaturan-konten').innerHTML = `
      <div class="venue-card" style="display:block;">
        <h3 style="font-size:15px; margin-bottom:14px;">Jam Operasional &amp; Nomor WA Admin</h3>
        <div id="pengaturan-jam-error"></div>
        <div id="pengaturan-jam-sukses"></div>
        <div class="form-inline">
          <div><label>Jam Buka</label><input type="time" id="pg-jam-buka" value="${v.jam_buka}"></div>
          <div><label>Jam Tutup</label><input type="time" id="pg-jam-tutup" value="${v.jam_tutup === '24:00' ? '00:00' : v.jam_tutup}"></div>
          <div><label>Durasi Slot (menit)</label><input type="number" id="pg-slot-menit" value="${v.slot_menit}" step="15" min="15"></div>
          <div><label>No. WA Admin Tempat Ini</label><input type="text" id="pg-admin-wa" value="${v.admin_wa}" placeholder="628xxxxxxxxxx"></div>
        </div>
        <button class="btn btn-gold" id="btn-simpan-jam">Simpan</button>
        <p class="text-faint mt" style="font-size:12px;">Catatan: kalau jam tutup melewati tengah malam, isi <b>00:00</b> untuk artinya jam 24:00.</p>
      </div>

      <div class="venue-card" style="display:block; margin-top:18px;">
        <h3 style="font-size:15px; margin-bottom:14px;">Daftar Harga per Rentang Jam</h3>
        <div id="pengaturan-harga-error"></div>
        <div id="pengaturan-harga-list">${hargaRows}</div>
        <button class="btn btn-outline mt" id="btn-tambah-harga" style="padding:8px 14px; font-size:12px;">+ Tambah Rentang Harga</button>
      </div>

      <div class="venue-card" style="display:block; margin-top:18px;">
        <h3 style="font-size:15px; margin-bottom:6px;">Notifikasi WhatsApp</h3>
        <p class="text-dim" style="font-size:12px; margin-bottom:14px;">Setiap ada booking baru, edit, atau pembatalan di tempat ini, pesan otomatis akan dikirim ke nomor/grup di bawah.</p>
        <div id="pengaturan-notif-error"></div>
        <div id="pengaturan-notif-list">${notifRows}</div>
        <div class="form-inline mt">
          <div><label>Tipe</label><select id="notif-tipe"><option value="nomor">Nomor WA</option><option value="grup">Grup WA</option></select></div>
          <div><label>Nomor / ID Grup</label><input type="text" id="notif-tujuan" placeholder="628xxxx atau ID grup"></div>
          <div><label>Label (opsional)</label><input type="text" id="notif-label" placeholder="mis. Owner"></div>
        </div>
        <button class="btn btn-gold" id="btn-tambah-notif">Tambah Target</button>
        <p class="text-faint mt" style="font-size:12px;">ID grup didapat dari provider WA Gateway Anda (lihat README.md bagian Notifikasi WhatsApp).</p>
      </div>
    `;

    pasangEventPengaturan(v);
  }

  function pasangEventPengaturan(v) {
    el('btn-simpan-jam').addEventListener('click', async () => {
      el('pengaturan-jam-error').innerHTML = ''; el('pengaturan-jam-sukses').innerHTML = '';
      try {
        await api('PUT', `/api/pengaturan/venues/${v.id}`, {
          jam_buka: el('pg-jam-buka').value,
          jam_tutup: el('pg-jam-tutup').value === '00:00' ? '24:00' : el('pg-jam-tutup').value,
          slot_menit: Number(el('pg-slot-menit').value),
          admin_wa: el('pg-admin-wa').value.trim(),
        });
        el('pengaturan-jam-sukses').innerHTML = '<div class="pesan-sukses">Tersimpan.</div>';
        muatPengaturan();
        await segarkanVenueCache(); // perbarui cache venue (nama, admin_wa, jam) yang dipakai di tab lain, tanpa pasang ulang event listener
      } catch (err) {
        el('pengaturan-jam-error').innerHTML = `<div class="pesan-error">${err.message}</div>`;
      }
    });

    document.querySelectorAll('.harga-row').forEach((row) => {
      row.querySelector('.hr-simpan').addEventListener('click', async () => {
        el('pengaturan-harga-error').innerHTML = '';
        try {
          const selesai = row.querySelector('.hr-selesai').value;
          await api('PUT', `/api/pengaturan/harga/${row.dataset.hargaId}`, {
            jam_mulai: row.querySelector('.hr-mulai').value,
            jam_selesai: selesai === '00:00' ? '24:00' : selesai,
            harga: Number(row.querySelector('.hr-harga').value),
          });
          muatPengaturan();
        } catch (err) {
          el('pengaturan-harga-error').innerHTML = `<div class="pesan-error">${err.message}</div>`;
        }
      });
      row.querySelector('.hr-hapus').addEventListener('click', async () => {
        if (!confirm('Hapus rentang harga ini?')) return;
        await api('DELETE', `/api/pengaturan/harga/${row.dataset.hargaId}`);
        muatPengaturan();
      });
    });

    el('btn-tambah-harga').addEventListener('click', async () => {
      el('pengaturan-harga-error').innerHTML = '';
      try {
        await api('POST', `/api/pengaturan/venues/${v.id}/harga`, {
          jam_mulai: '06:00', jam_selesai: '07:00', harga: 0, urutan: v.harga.length + 1,
        });
        muatPengaturan();
      } catch (err) {
        el('pengaturan-harga-error').innerHTML = `<div class="pesan-error">${err.message}</div>`;
      }
    });

    document.querySelectorAll('[data-notif-id]').forEach((card) => {
      card.querySelector('.notif-aktif').addEventListener('change', async (e) => {
        await api('PUT', `/api/pengaturan/notifikasi/${card.dataset.notifId}`, { aktif: e.target.checked });
      });
      card.querySelector('.notif-test').addEventListener('click', async () => {
        el('pengaturan-notif-error').innerHTML = '';
        try {
          await api('POST', `/api/pengaturan/notifikasi/${card.dataset.notifId}/test`);
          el('pengaturan-notif-error').innerHTML = '<div class="pesan-sukses">Pesan uji coba terkirim.</div>';
        } catch (err) {
          el('pengaturan-notif-error').innerHTML = `<div class="pesan-error">${err.message}</div>`;
        }
      });
      card.querySelector('.notif-hapus').addEventListener('click', async () => {
        if (!confirm('Hapus target notifikasi ini?')) return;
        await api('DELETE', `/api/pengaturan/notifikasi/${card.dataset.notifId}`);
        muatPengaturan();
      });
    });

    el('btn-tambah-notif').addEventListener('click', async () => {
      el('pengaturan-notif-error').innerHTML = '';
      const tujuan = el('notif-tujuan').value.trim();
      if (!tujuan) { el('pengaturan-notif-error').innerHTML = '<div class="pesan-error">Nomor/ID grup wajib diisi.</div>'; return; }
      try {
        await api('POST', `/api/pengaturan/venues/${v.id}/notifikasi`, {
          tipe: el('notif-tipe').value,
          tujuan,
          label: el('notif-label').value.trim() || null,
        });
        muatPengaturan();
      } catch (err) {
        el('pengaturan-notif-error').innerHTML = `<div class="pesan-error">${err.message}</div>`;
      }
    });
  }

  // ---------------- KELOLA ADMIN ----------------
  let adminCache = [];

  async function muatAdmin() {
    adminCache = await api('GET', '/api/auth/users');
    let html = '<table class="data-table"><tr><th>Nama</th><th>Username</th><th>Role</th><th>Tempat</th><th>Status</th><th>Aksi</th></tr>';
    adminCache.forEach((u) => {
      const roleBadge = u.role === 'admin_utama' ? '<span class="badge role-utama">Admin Utama</span>' : '<span class="badge role-khusus">Admin Khusus</span>';
      const tombolNonaktif = u.aktif && u.id !== state.user.id
        ? `<button class="btn btn-outline" style="padding:6px 12px; font-size:11px;" data-nonaktifkan="${u.id}">Nonaktifkan</button>` : '';
      html += `<tr><td>${u.nama}</td><td class="mono">${u.username}</td><td>${roleBadge}</td><td>${u.venue_nama || '-'}</td><td>${u.aktif ? 'Aktif' : 'Nonaktif'}</td>
        <td class="flex gap">
          <button class="btn btn-outline" style="padding:6px 12px; font-size:11px;" data-edit="${u.id}">Edit</button>
          ${tombolNonaktif}
        </td></tr>`;
    });
    html += '</table>';
    el('admin-list').innerHTML = html;
    el('admin-list').querySelectorAll('[data-nonaktifkan]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Nonaktifkan admin ini?')) return;
        await api('PUT', `/api/auth/users/${btn.dataset.nonaktifkan}/nonaktifkan`);
        muatAdmin();
      });
    });
    el('admin-list').querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => bukaModalEditAdmin(Number(btn.dataset.edit)));
    });
  }

  function bukaModalEditAdmin(id) {
    const u = adminCache.find((x) => x.id === id);
    if (!u) return;
    el('edit-admin-error').innerHTML = '';
    el('ea-username').textContent = u.username;
    el('ea-nama').value = u.nama;
    el('ea-role').value = u.role;
    el('ea-aktif').checked = u.aktif;
    el('ea-password').value = '';
    el('ea-venue').innerHTML = state.venues.map((v) => `<option value="${v.id}" ${v.id === u.venue_id ? 'selected' : ''}>${v.nama}</option>`).join('');
    el('ea-venue-wrap').classList.toggle('hidden', u.role === 'admin_utama');

    const diriSendiri = id === state.user.id;
    el('ea-role').disabled = diriSendiri;
    el('ea-aktif').disabled = diriSendiri;
    el('form-edit-admin').dataset.editId = id;
    el('modal-edit-admin').classList.remove('hidden');
  }
  el('tutup-modal-edit-admin').addEventListener('click', () => el('modal-edit-admin').classList.add('hidden'));
  el('ea-batal').addEventListener('click', () => el('modal-edit-admin').classList.add('hidden'));
  el('ea-role').addEventListener('change', () => {
    el('ea-venue-wrap').classList.toggle('hidden', el('ea-role').value === 'admin_utama');
  });

  el('form-edit-admin').addEventListener('submit', async (e) => {
    e.preventDefault();
    el('edit-admin-error').innerHTML = '';
    const id = el('form-edit-admin').dataset.editId;
    try {
      const body = {
        nama: el('ea-nama').value.trim(),
        role: el('ea-role').value,
        venue_id: el('ea-role').value === 'admin_khusus' ? Number(el('ea-venue').value) : null,
        aktif: el('ea-aktif').checked,
      };
      if (el('ea-password').value) body.password = el('ea-password').value;
      await api('PUT', `/api/auth/users/${id}`, body);
      el('modal-edit-admin').classList.add('hidden');
      muatAdmin();
    } catch (err) {
      el('edit-admin-error').innerHTML = `<div class="pesan-error">${err.message}</div>`;
    }
  });

  el('btn-tambah-admin').addEventListener('click', () => {
    el('tambah-admin-error').innerHTML = '';
    el('form-tambah-admin').reset();
    el('ta-venue').innerHTML = state.venues.map((v) => `<option value="${v.id}">${v.nama}</option>`).join('');
    el('ta-venue-wrap').classList.remove('hidden');
    el('modal-tambah-admin').classList.remove('hidden');
  });
  el('tutup-modal-tambah-admin').addEventListener('click', () => el('modal-tambah-admin').classList.add('hidden'));
  el('ta-batal').addEventListener('click', () => el('modal-tambah-admin').classList.add('hidden'));
  el('ta-role').addEventListener('change', () => {
    el('ta-venue-wrap').classList.toggle('hidden', el('ta-role').value === 'admin_utama');
  });

  el('form-tambah-admin').addEventListener('submit', async (e) => {
    e.preventDefault();
    el('tambah-admin-error').innerHTML = '';
    try {
      await api('POST', '/api/auth/users', {
        nama: el('ta-nama').value.trim(),
        username: el('ta-username').value.trim(),
        password: el('ta-password').value,
        role: el('ta-role').value,
        venue_id: el('ta-role').value === 'admin_khusus' ? Number(el('ta-venue').value) : null,
      });
      el('modal-tambah-admin').classList.add('hidden');
      muatAdmin();
    } catch (err) {
      el('tambah-admin-error').innerHTML = `<div class="pesan-error">${err.message}</div>`;
    }
  });

  // ---------------- GANTI PASSWORD ----------------
  el('btn-ganti-password').addEventListener('click', () => {
    el('password-error').innerHTML = ''; el('password-sukses').innerHTML = '';
    el('form-password').reset();
    el('modal-password').classList.remove('hidden');
  });
  el('tutup-modal-password').addEventListener('click', () => el('modal-password').classList.add('hidden'));
  el('form-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    el('password-error').innerHTML = ''; el('password-sukses').innerHTML = '';
    try {
      await api('PUT', '/api/auth/ganti-password', {
        password_lama: el('password-lama').value,
        password_baru: el('password-baru').value,
      });
      el('password-sukses').innerHTML = '<div class="pesan-sukses">Password berhasil diganti.</div>';
      el('form-password').reset();
    } catch (err) {
      el('password-error').innerHTML = `<div class="pesan-error">${err.message}</div>`;
    }
  });

  // ---------------- START ----------------
  if (state.token && state.user) {
    tampilkanApp();
  } else {
    tampilkanLogin();
  }
})();
