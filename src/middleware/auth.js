const jwt = require('jsonwebtoken');

function wajibLogin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Silakan login terlebih dahulu.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, username, nama, role, venue_id }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesi login tidak valid atau sudah kedaluwarsa.' });
  }
}

/** Pastikan admin_khusus hanya bisa mengakses venue miliknya; admin_utama bebas akses semua venue. */
function cekAksesVenue(req, res, next) {
  const venueId = Number(req.params.venueId || req.body.venue_id);
  if (req.user.role === 'admin_utama') return next();
  if (req.user.role === 'admin_khusus' && req.user.venue_id === venueId) return next();
  return res.status(403).json({ error: 'Anda tidak memiliki akses ke tempat ini.' });
}

module.exports = { wajibLogin, cekAksesVenue };
