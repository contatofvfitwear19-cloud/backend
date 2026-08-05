require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const multer = require('multer');

const authRoutes = require('./src/routes/auth');
const productsRoutes = require('./src/routes/products');
const ordersRoutes = require('./src/routes/orders');
const couponsRoutes = require('./src/routes/coupons');
const { UPLOAD_DIR } = require('./src/middleware/upload');

const app = express();

app.set('trust proxy', 1); // Hostinger normalmente fica atrás de proxy/CDN

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// --- CORS: só libera os domínios definidos em CORS_ORIGINS ---
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Origem não permitida pelo CORS.'));
  },
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limit geral, além dos específicos que já existem em login/orders/validate
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Serve as imagens enviadas pelo admin
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

app.get('/', (req, res) => res.send('API da FV Fitwear está rodando!'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/coupons', couponsRoutes);

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// --- Tratamento de erros central ---
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Erro no upload: ${err.message}` });
  }
  if (err.message === 'Origem não permitida pelo CORS.') {
    return res.status(403).json({ error: err.message });
  }
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno no servidor.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FV Fitwear backend rodando na porta ${PORT}`);
});
