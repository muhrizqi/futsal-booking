(() => {
  // Peta domain khusus -> slug venue. Kalau pelanggan mengakses lewat salah satu domain ini,
  // halaman otomatis terkunci ke tempat itu saja (tab pilihan tempat disembunyikan).
  // Domain lain (mis. domain utama olahraga.lewat.web.id) tetap menampilkan ketiga tempat.
  const PETA_DOMAIN_VENUE = {
    'jf.lewat.web.id': 'jogokariyan-futsal',
    '4r.lewat.web.id': '4r-futsal',
    'kalisiminisoccer.lewat.web.id': 'kalisi-mini-soccer',
  };

  const state = {
    venues: [],
    venueAktif: null,
    tahun: null,
    bulan: null, // 1-12
    tanggalDipilih: null,
    slotDipilih: null, // { court_nama, jam_mulai, jam_selesai, harga, warna }
    venueTerkunci: PETA_DOMAIN_VENUE[window.location.hostname] || null,
  };

  const el = (id) => document.getElementById(id);
  const rupiah = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');

  const hariIniISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  async function apiGet(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error((await res.json()).error || 'Gagal memuat data.');
    return res.json();
  }

  async function init() {
    const now = new Date();
    state.tahun = now.getFullYear();
    state.bulan = now.getMonth() + 1;

    state.venues = await apiGet('/api/venues');

    if (state.venueTerkunci) {
      const v = state.venues.find((x) => x.slug === state.venueTerkunci);
      if (v) {
        el('venue-tabs').classList.add('hidden'); // domain khusus -> tidak perlu tab pilihan tempat
        document.title = `Jadwal ${v.nama} — Booking Lapangan Jogja`;
        el('brand-sub').textContent = v.nama;
        el('hero-desc').textContent = `Klik tanggal di kalender untuk lihat jam yang masih kosong di ${v.nama}. Sudah cocok? Hubungi admin langsung lewat WhatsApp untuk konfirmasi booking.`;
        pilihVenue(v.slug);
      } else {
        // fallback jaga-jaga kalau slug di peta domain tidak ditemukan di data venue
        renderTabsVenue();
        pilihVenue(state.venues[0].slug);
      }
    } else {
      renderTabsVenue();
      pilihVenue(state.venues[0].slug);
    }

    el('btn-bulan-prev').addEventListener('click', () => gantiBulan(-1));
    el('btn-bulan-next').addEventListener('click', () => gantiBulan(1));
    el('btn-batal-pilih').addEventListener('click', batalPilihSlot);
  }

  function renderTabsVenue() {
    if (state.venueTerkunci) return; // domain khusus -> tab tidak pernah dirender
    const wrap = el('venue-tabs');
    wrap.innerHTML = '';
    state.venues.forEach((v) => {
      const btn = document.createElement('button');
      btn.className = 'venue-tab' + (state.venueAktif && state.venueAktif.slug === v.slug ? ' aktif' : '');
      btn.innerHTML = `${v.nama}<span class="sub">${v.jenis === 'futsal' ? v.lapangan.length + ' lapangan' : 'Mini Soccer'}</span>`;
      btn.addEventListener('click', () => pilihVenue(v.slug));
      wrap.appendChild(btn);
    });
  }

  function pilihVenue(slug) {
    state.venueAktif = state.venues.find((v) => v.slug === slug);
    state.tanggalDipilih = null;
    state.slotDipilih = null;
    renderTabsVenue();
    renderVenueCard();
    el('detail-hari').classList.add('hidden');
    sembunyikanPanel();
    muatKalenderBulan();
  }

  function renderVenueCard() {
    const v = state.venueAktif;
    const chips = v.harga.map((h) => `<span class="harga-chip">${h.jam_mulai}\u2013${h.jam_selesai} &middot; ${rupiah(h.harga)}${v.jenis === 'mini_soccer' ? ' /1,5 jam' : ' /jam'}</span>`).join('');
    el('venue-card').innerHTML = `
      <div>
        <h3 style="font-size:18px; margin-bottom:6px;">${v.nama}</h3>
        <div class="alamat">${v.alamat}</div>
      </div>
      <div class="harga-list">${chips}</div>
    `;
  }

  async function muatKalenderBulan() {
    el('kalender-judul').textContent = 'Memuat...';
    const data = await apiGet(`/api/kalender/${state.venueAktif.slug}/bulan?tahun=${state.tahun}&bulan=${state.bulan}`);
    el('kalender-judul').textContent = `${data.namaBulan} ${data.tahun}`;

    const grid = el('grid-kalender');
    grid.innerHTML = '';

    const offsetAwal = new Date(Date.UTC(state.tahun, state.bulan - 1, 1)).getUTCDay(); // 0=Ahad
    for (let i = 0; i < offsetAwal; i += 1) {
      const kosong = document.createElement('div');
      kosong.className = 'sel-tanggal kosong-bulan';
      grid.appendChild(kosong);
    }

    data.hari.forEach((h) => {
      const sel = document.createElement('div');
      const sudahLewat = h.tanggal < hariIniISO();
      sel.className = `sel-tanggal status-${h.status}`;
      if (h.tanggal === hariIniISO()) sel.classList.add('hari-ini');
      if (h.tanggal === state.tanggalDipilih) sel.classList.add('dipilih');
      if (sudahLewat) {
        sel.classList.add('lewat');
        sel.innerHTML = `<span class="angka">${h.tanggalNum}</span><span class="ket">Sudah lewat</span>`;
      } else {
        const ketLabel = h.status === 'kosong' ? 'Kosong' : (h.status === 'penuh' ? 'Penuh' : `${h.kosong} slot`);
        sel.innerHTML = `<span class="angka">${h.tanggalNum}</span><span class="ket">${ketLabel}</span>`;
        sel.addEventListener('click', () => pilihTanggal(h.tanggal));
      }
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
    state.slotDipilih = null;
    sembunyikanPanel();
    muatKalenderBulan(); // refresh highlight tanggal terpilih

    const data = await apiGet(`/api/kalender/${state.venueAktif.slug}/hari?tanggal=${tanggal}`);
    el('detail-hari').classList.remove('hidden');
    el('detail-judul-venue').textContent = data.venue.nama;
    el('detail-tanggal').textContent = data.namaTanggalPanjang;

    const wrap = el('detail-lapangan-list');
    wrap.innerHTML = '';
    data.lapangan.forEach((lap) => {
      const blok = document.createElement('div');
      blok.className = 'lapangan-blok';
      const slotsHtml = lap.slots.map((s) => {
        if (s.status === 'kosong') {
          return `<div class="slot kosong" data-court="${lap.nama}" data-warna="${lap.warna}" data-jm="${s.jam_mulai}" data-js="${s.jam_selesai}" data-harga="${s.harga}">
                    <div class="jam">${s.jam_mulai} \u2013 ${s.jam_selesai}</div>
                    <div class="harga">${rupiah(s.harga)}</div>
                  </div>`;
        }
        return `<div class="slot terisi">
                  <div class="jam">${s.jam_mulai} \u2013 ${s.jam_selesai}</div>
                  <div class="harga">Tidak tersedia</div>
                  <div class="tim">Tim: ${s.nama_tim || '-'}</div>
                </div>`;
      }).join('');
      blok.innerHTML = `<div class="lapangan-judul"><span class="dot-warna ${lap.warna}"></span>Lapangan ${lap.nama}</div>
                         <div class="slot-grid">${slotsHtml}</div>`;
      wrap.appendChild(blok);
    });

    wrap.querySelectorAll('.slot.kosong').forEach((elm) => {
      elm.addEventListener('click', () => pilihSlot(elm));
    });

    el('detail-hari').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function pilihSlot(elm) {
    document.querySelectorAll('.slot.dipilih').forEach((s) => s.classList.remove('dipilih'));
    elm.classList.add('dipilih');
    state.slotDipilih = {
      court: elm.dataset.court,
      jamMulai: elm.dataset.jm,
      jamSelesai: elm.dataset.js,
      harga: elm.dataset.harga,
    };
    tampilkanPanel();
  }

  function batalPilihSlot() {
    document.querySelectorAll('.slot.dipilih').forEach((s) => s.classList.remove('dipilih'));
    state.slotDipilih = null;
    sembunyikanPanel();
  }

  function tampilkanPanel() {
    const v = state.venueAktif;
    const s = state.slotDipilih;
    el('panel-pilihan').classList.remove('hidden');
    el('panel-ringkasan').innerHTML = `<b>${v.nama}</b> &middot; Lapangan ${s.court} &middot; ${state.tanggalDipilih} &middot; ${s.jamMulai}\u2013${s.jamSelesai} &middot; ${rupiah(s.harga)}`;

    const pesan = `Halo Admin ${v.nama}, saya ingin booking:%0A`
      + `Lapangan: ${s.court}%0A`
      + `Tanggal: ${state.tanggalDipilih}%0A`
      + `Jam: ${s.jamMulai} - ${s.jamSelesai}%0A`
      + `Harga: ${rupiah(s.harga)}%0A%0A`
      + `Mohon info ketersediaan & cara pembayarannya. Terima kasih.`;
    el('btn-hubungi-admin').href = `https://wa.me/${v.admin_wa}?text=${pesan}`;
  }

  function sembunyikanPanel() {
    el('panel-pilihan').classList.add('hidden');
  }

  init().catch((err) => {
    console.error(err);
    el('kalender-judul').textContent = 'Gagal memuat data. Coba muat ulang halaman.';
  });
})();
