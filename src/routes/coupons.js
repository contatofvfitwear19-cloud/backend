const express = require('express');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const validateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde um instante.' },
});

function round2(n) {
  return Math.round(n * 100) / 100;
}

function isExpired(coupon) {
  return coupon.expiresAt && new Date(coupon.expiresAt) < new Date();
}

function isMaxedOut(coupon) {
  return coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses;
}

// ------------------------------------------------------------------
// GET /api/coupons/welcome  (público — popup de boas-vindas)
// ------------------------------------------------------------------
router.get('/welcome', async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM `Coupon` WHERE category = 'boasvindas' AND active = 1 ORDER BY createdAt DESC LIMIT 1"
  );
  const coupon = rows[0];
  if (!coupon || isExpired(coupon) || isMaxedOut(coupon)) return res.json(null);

  res.json({
    code: coupon.code,
    title: coupon.title,
    discountType: coupon.discountType,
    value: coupon.value,
  });
});

// ------------------------------------------------------------------
// POST /api/coupons/validate  (público — valida cupom digitado no carrinho)
// ------------------------------------------------------------------
router.post('/validate', validateLimiter, async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const subtotal = Math.max(0, parseFloat(req.body.subtotal) || 0);
  const email = String(req.body.email || '').trim();

  if (!code) return res.status(400).json({ valid: false, error: 'Informe o código do cupom.' });

  const [rows] = await pool.query('SELECT * FROM `Coupon` WHERE code = ?', [code]);
  const coupon = rows[0];

  if (!coupon || !coupon.active) return res.json({ valid: false, error: 'Cupom inválido.' });
  if (isExpired(coupon)) return res.json({ valid: false, error: 'Este cupom expirou.' });
  if (isMaxedOut(coupon)) return res.json({ valid: false, error: 'Este cupom já atingiu o limite de usos.' });

  if (coupon.category === 'boasvindas') {
    if (!email) {
      return res.json({ valid: false, error: 'Informe seu e-mail para usar este cupom de boas-vindas.' });
    }
    const [prevOrders] = await pool.query(
      'SELECT id FROM `Order` WHERE LOWER(customerEmail) = LOWER(?) AND status <> ? LIMIT 1',
      [email, 'Cancelado']
    );
    if (prevOrders.length > 0) {
      return res.json({ valid: false, error: 'Este cupom de boas-vindas é só para o seu primeiro pedido.' });
    }
  }

  const discount = coupon.discountType === 'fixo'
    ? Math.min(coupon.value, subtotal)
    : round2(subtotal * (coupon.value / 100));

  res.json({
    valid: true,
    code: coupon.code,
    title: coupon.title,
    discountType: coupon.discountType,
    value: coupon.value,
    discount,
  });
});

// ------------------------------------------------------------------
// GET /api/coupons  (admin — lista todos)
// ------------------------------------------------------------------
router.get('/', requireAdmin, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM `Coupon` ORDER BY `createdAt` DESC');
  res.json(rows);
});

// ------------------------------------------------------------------
// POST /api/coupons  (admin — cria)
// ------------------------------------------------------------------
router.post('/', requireAdmin, async (req, res) => {
  const { title, code, category, discountType, value, maxUses, expiresAt, active } = req.body;

  const cleanCode = String(code || '').trim().toUpperCase();
  const cleanTitle = String(title || '').trim();

  if (!cleanTitle) return res.status(400).json({ error: 'Informe o título do cupom.' });
  if (!cleanCode) return res.status(400).json({ error: 'Informe o código do cupom.' });
  if (!['todos', 'exclusivo', 'boasvindas'].includes(category)) {
    return res.status(400).json({ error: 'Categoria inválida.' });
  }
  if (!['percentual', 'fixo'].includes(discountType)) {
    return res.status(400).json({ error: 'Tipo de desconto inválido.' });
  }
  if (!(parseFloat(value) > 0)) return res.status(400).json({ error: 'Informe um valor de desconto válido.' });

  const [existing] = await pool.query('SELECT id FROM `Coupon` WHERE code = ?', [cleanCode]);
  if (existing.length > 0) return res.status(409).json({ error: 'Já existe um cupom com esse código.' });

  const id = uuidv4();
  await pool.query(
    `INSERT INTO \`Coupon\`
      (id, code, title, category, discountType, value, maxUses, usesCount, active, expiresAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NOW(), NOW())`,
    [id, cleanCode, cleanTitle, category, discountType, parseFloat(value), maxUses || null, active ? 1 : 0, expiresAt || null]
  );

  res.status(201).json({ id });
});

// ------------------------------------------------------------------
// PUT /api/coupons/:id  (admin — edita)
// ------------------------------------------------------------------
router.put('/:id', requireAdmin, async (req, res) => {
  const { title, code, category, discountType, value, maxUses, expiresAt, active } = req.body;
  const cleanCode = String(code || '').trim().toUpperCase();
  const cleanTitle = String(title || '').trim();

  if (!cleanTitle) return res.status(400).json({ error: 'Informe o título do cupom.' });
  if (!cleanCode) return res.status(400).json({ error: 'Informe o código do cupom.' });

  const [existing] = await pool.query('SELECT id FROM `Coupon` WHERE code = ? AND id <> ?', [cleanCode, req.params.id]);
  if (existing.length > 0) return res.status(409).json({ error: 'Já existe outro cupom com esse código.' });

  const [result] = await pool.query(
    `UPDATE \`Coupon\` SET
      title = ?, code = ?, category = ?, discountType = ?, value = ?, maxUses = ?, expiresAt = ?, active = ?, updatedAt = NOW()
     WHERE id = ?`,
    [cleanTitle, cleanCode, category, discountType, parseFloat(value), maxUses || null, expiresAt || null, active ? 1 : 0, req.params.id]
  );

  if (result.affectedRows === 0) return res.status(404).json({ error: 'Cupom não encontrado.' });
  res.json({ ok: true });
});

// ------------------------------------------------------------------
// PATCH /api/coupons/:id/status  (admin)
// ------------------------------------------------------------------
router.patch('/:id/status', requireAdmin, async (req, res) => {
  const [result] = await pool.query(
    'UPDATE `Coupon` SET `active` = ?, `updatedAt` = NOW() WHERE `id` = ?',
    [req.body.active ? 1 : 0, req.params.id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Cupom não encontrado.' });
  res.json({ ok: true });
});

// ------------------------------------------------------------------
// DELETE /api/coupons/:id  (admin)
// ------------------------------------------------------------------
router.delete('/:id', requireAdmin, async (req, res) => {
  const [result] = await pool.query('DELETE FROM `Coupon` WHERE `id` = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Cupom não encontrado.' });
  res.json({ ok: true });
});

module.exports = router;
