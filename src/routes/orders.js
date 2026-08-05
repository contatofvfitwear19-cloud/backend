const express = require('express');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Evita flood de pedidos falsos vindos de bots (30 pedidos por IP a cada 10 min é bem folgado pra uso real)
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente novamente.' },
});

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ------------------------------------------------------------------
// POST /api/orders  (público — checkout do cliente)
// ------------------------------------------------------------------
router.post('/', orderLimiter, async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];

  const address = String(body.address || '').trim();
  const paymentMethod = String(body.paymentMethod || '').trim();
  const customerName = String(body.customerName || '').trim();
  const customerEmail = String(body.customerEmail || '').trim();
  const region = String(body.region || '').trim();
  const cep = String(body.cep || '').trim();
  const bairro = String(body.bairro || '').trim();
  const cidade = String(body.cidade || '').trim();
  const shippingFee = Math.max(0, parseFloat(body.shippingFee) || 0);
  const requestedCouponCode = String(body.couponCode || '').trim().toUpperCase();

  if (!address) return res.status(400).json({ error: 'Endereço é obrigatório.' });
  if (!paymentMethod) return res.status(400).json({ error: 'Forma de pagamento é obrigatória.' });
  if (!customerName) return res.status(400).json({ error: 'Nome do cliente é obrigatório.' });
  if (items.length === 0) return res.status(400).json({ error: 'O carrinho está vazio.' });

  for (const it of items) {
    if (!it.productId || !it.size || !it.color || !(parseInt(it.quantity, 10) > 0)) {
      return res.status(400).json({ error: 'Item do carrinho inválido.' });
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let subtotal = 0;
    const resolvedItems = [];
    const stockTouchedProductIds = new Set();

    for (const it of items) {
      const quantity = parseInt(it.quantity, 10);

      const [productRows] = await conn.query(
        'SELECT id, name, price FROM `Product` WHERE id = ? FOR UPDATE',
        [it.productId]
      );
      if (productRows.length === 0) {
        throw Object.assign(new Error(`Produto não encontrado (${it.name || it.productId}).`), { status: 409 });
      }
      const product = productRows[0];

      const [variantRows] = await conn.query(
        'SELECT id, stock FROM `ProductVariant` WHERE productId = ? AND color = ? AND size = ? FOR UPDATE',
        [it.productId, it.color, it.size]
      );
      if (variantRows.length === 0 || variantRows[0].stock < quantity) {
        throw Object.assign(
          new Error(`Estoque insuficiente para ${product.name} (${it.color} / ${it.size}).`),
          { status: 409 }
        );
      }

      subtotal += product.price * quantity;
      resolvedItems.push({
        productId: it.productId,
        name: product.name,
        price: product.price,
        quantity,
        size: it.size,
        color: it.color,
      });
      stockTouchedProductIds.add(it.productId);

      await conn.query(
        'UPDATE `ProductVariant` SET stock = stock - ? WHERE productId = ? AND color = ? AND size = ?',
        [quantity, it.productId, it.color, it.size]
      );
    }

    // Recalcula o estoque total do produto (soma das variantes) pra manter Product.stock coerente
    for (const productId of stockTouchedProductIds) {
      await conn.query(
        `UPDATE \`Product\` p
         SET p.stock = (SELECT COALESCE(SUM(stock), 0) FROM \`ProductVariant\` WHERE productId = p.id)
         WHERE p.id = ?`,
        [productId]
      );
    }

    // --- Cupom: revalida tudo no servidor, nunca confia no desconto calculado pelo navegador ---
    let couponCode = '';
    let couponDiscount = 0;

    if (requestedCouponCode) {
      const [couponRows] = await conn.query('SELECT * FROM `Coupon` WHERE code = ? FOR UPDATE', [requestedCouponCode]);
      const coupon = couponRows[0];

      let valid = !!coupon && !!coupon.active;
      if (valid && coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) valid = false;
      if (valid && coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) valid = false;

      if (valid && coupon.category === 'boasvindas') {
        if (!customerEmail) {
          valid = false;
        } else {
          const [prevOrders] = await conn.query(
            'SELECT id FROM `Order` WHERE LOWER(customerEmail) = LOWER(?) AND status <> ? LIMIT 1',
            [customerEmail, 'Cancelado']
          );
          if (prevOrders.length > 0) valid = false;
        }
      }

      if (valid) {
        couponDiscount = coupon.discountType === 'fixo'
          ? Math.min(coupon.value, subtotal)
          : round2(subtotal * (coupon.value / 100));
        couponCode = coupon.code;

        await conn.query('UPDATE `Coupon` SET usesCount = usesCount + 1 WHERE id = ?', [coupon.id]);
      }
      // se inválido, o pedido segue sem cupom (mesmo comportamento do front antigo)
    }

    const total = Math.max(round2(subtotal + shippingFee - couponDiscount), 0);
    const orderId = uuidv4();

    await conn.query(
      `INSERT INTO \`Order\`
        (id, address, paymentMethod, total, status, customerName, customerEmail, region, cep, bairro, cidade,
         createdAt, shippingFee, subtotal, couponCode, couponDiscount)
       VALUES (?, ?, ?, ?, 'Pendente', ?, ?, ?, ?, ?, ?, NOW(3), ?, ?, ?, ?)`,
      [orderId, address, paymentMethod, total, customerName, customerEmail, region, cep, bairro, cidade,
        shippingFee, round2(subtotal), couponCode, couponDiscount]
    );

    for (const item of resolvedItems) {
      await conn.query(
        `INSERT INTO \`OrderItem\` (id, orderId, productId, name, price, quantity, size, color)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), orderId, item.productId, item.name, item.price, item.quantity, item.size, item.color]
      );
    }

    await conn.commit();
    res.status(201).json({ id: orderId, total, subtotal: round2(subtotal), couponCode, couponDiscount });
  } catch (err) {
    await conn.rollback();
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  } finally {
    conn.release();
  }
});

// ------------------------------------------------------------------
// GET /api/orders  (admin — lista pedidos com os itens)
// ------------------------------------------------------------------
router.get('/', requireAdmin, async (req, res) => {
  const [orders] = await pool.query('SELECT * FROM `Order` ORDER BY `createdAt` DESC');
  if (orders.length === 0) return res.json([]);

  const ids = orders.map((o) => o.id);
  const [items] = await pool.query(
    `SELECT * FROM \`OrderItem\` WHERE orderId IN (${ids.map(() => '?').join(',')})`,
    ids
  );

  const itemsByOrder = {};
  for (const item of items) {
    if (!itemsByOrder[item.orderId]) itemsByOrder[item.orderId] = [];
    itemsByOrder[item.orderId].push(item);
  }

  res.json(orders.map((o) => ({ ...o, items: itemsByOrder[o.id] || [] })));
});

// ------------------------------------------------------------------
// PATCH /api/orders/:id/status  (admin)
// Cancelar devolve o estoque; reativar um pedido cancelado desconta de novo.
// ------------------------------------------------------------------
router.patch('/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  const allowed = ['Pendente', 'Pronto para Envio', 'Finalizado / Pago', 'Cancelado'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Status inválido.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orderRows] = await conn.query('SELECT * FROM `Order` WHERE `id` = ? FOR UPDATE', [req.params.id]);
    if (orderRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }
    const order = orderRows[0];
    const [items] = await conn.query('SELECT * FROM `OrderItem` WHERE `orderId` = ?', [req.params.id]);

    const touchedProductIds = new Set();

    // Cancelando agora: devolve estoque de cada item
    if (status === 'Cancelado' && order.status !== 'Cancelado') {
      for (const item of items) {
        await conn.query(
          'UPDATE `ProductVariant` SET stock = stock + ? WHERE productId = ? AND color = ? AND size = ?',
          [item.quantity, item.productId, item.color, item.size]
        );
        touchedProductIds.add(item.productId);
      }
    }

    // Reativando um pedido que estava cancelado: desconta o estoque de novo
    if (order.status === 'Cancelado' && status !== 'Cancelado') {
      for (const item of items) {
        await conn.query(
          'UPDATE `ProductVariant` SET stock = stock - ? WHERE productId = ? AND color = ? AND size = ?',
          [item.quantity, item.productId, item.color, item.size]
        );
        touchedProductIds.add(item.productId);
      }
    }

    for (const productId of touchedProductIds) {
      await conn.query(
        `UPDATE \`Product\` p
         SET p.stock = (SELECT COALESCE(SUM(stock), 0) FROM \`ProductVariant\` WHERE productId = p.id)
         WHERE p.id = ?`,
        [productId]
      );
    }

    await conn.query('UPDATE `Order` SET status = ? WHERE id = ?', [status, req.params.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ------------------------------------------------------------------
// DELETE /api/orders/:id  (admin)
// ------------------------------------------------------------------
router.delete('/:id', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM `OrderItem` WHERE `orderId` = ?', [req.params.id]);
    const [result] = await conn.query('DELETE FROM `Order` WHERE `id` = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

module.exports = router;
