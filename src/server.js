require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const venuesRouter = require('./routes/venues');
const kalenderRouter = require('./routes/kalender');
const authRouter = require('./routes/auth');
const bookingsRouter = require('./routes/bookings');
const customersRouter = require('./routes/customers');
const backupRouter = require('./routes/backup');
const printRouter = require('./routes/print');
const pengaturanRouter = require('./routes/pengaturan');

const app = express();

app.use(cors());
app.use(express.json());

// API
app.use('/api/venues', venuesRouter);
app.use('/api/kalender', kalenderRouter);
app.use('/api/auth', authRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/backup', backupRouter);
app.use('/api/print', printRouter);
app.use('/api/pengaturan', pengaturanRouter);

app.get('/api/health', (req, res) => res.json({ ok: true, waktu: new Date().toISOString() }));

// Frontend statis (halaman pelanggan & admin)
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server sistem booking lapangan berjalan di port ${PORT}`);
});
