const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

function fileUrl(filename) {
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  return `${base}/uploads/${filename}`;
}

function dedupeKeepOrder(arr) {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

function parseVariantsPayload(raw) {
  let variants;
  try {
    variants = JSON.parse(raw || '[]');
  } catch {
    throw Object.assign(new Error('Campo de variantes inválido.'), { status: 400 });
  }
  if (!Array.isArray(variants) || variants.length === 0) {
    throw Object.assign(new Error('Adicione pelo menos uma variante (cor + tamanho + estoque).'), { status: 400 });
  }
  return variants.map((v) => ({
    color: String(v.color || '').trim(),
    size: String(v.size || '').trim(),
    stock: Math.max(0, parseInt(v.stock, 10) || 0),
  })).filter((v) => v.color && v.size);
}

// ------------------------------------------------------------------
// GET /api/products  (público: só produtos ativos)
// GET /api/products?all=true  (admin: todos, inclusive ocultos)
// ------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  const wantAll = req.query.all === 'true';

  const runQuery = async () => {
    const sql = wantAll
      ? 'SELECT * FROM `Product` ORDER BY `createdAt` DESC'
      : 'SELECT * FROM `Product` WHERE `active` = 1 ORDER BY `createdAt` DESC';
    const [rows] = await pool.query(sql);
    res.json(rows);
  };

  if (wantAll) {
    return requireAdmin(req, res, () => runQuery().catch(next));
  }
  return runQuery().catch(next);
});

// ------------------------------------------------------------------
// GET /api/products/:id  (público — usado na página do produto e no admin)
// ------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM `Product` WHERE `id` = ?', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });

  const [variants] = await pool.query(
    'SELECT `id`, `color`, `size`, `stock` FROM `ProductVariant` WHERE `productId` = ?',
    [req.params.id]
  );

  res.json({ ...rows[0], variants });
});

// ------------------------------------------------------------------
// POST /api/products  (admin — cria produto novo)
// ------------------------------------------------------------------
router.post(
  '/',
  requireAdmin,
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'images', maxCount: 10 }]),
  async (req, res) => {
    const name = String(req.body.name || '').trim();
    const price = parseFloat(req.body.price);
    const category = String(req.body.category || 'geral').trim();
    const description = String(req.body.description || '').trim();

    if (!name) return res.status(400).json({ error: 'Informe o nome do produto.' });
    if (!price || price <= 0) return res.status(400).json({ error: 'Informe um preço válido.' });

    const mainFile = req.files?.image?.[0];
    if (!mainFile) return res.status(400).json({ error: 'Escolha a foto principal do produto.' });

    const variants = parseVariantsPayload(req.body.variants);
    if (variants.length === 0) return res.status(400).json({ error: 'Adicione pelo menos um tamanho com estoque.' });

    const extraFiles = req.files?.images || [];
    const imageUrls = [fileUrl(mainFile.filename), ...extraFiles.map((f) => fileUrl(f.filename))];

    const colors = dedupeKeepOrder(variants.map((v) => v.color)).join(',');
    const sizes = dedupeKeepOrder(variants.map((v) => v.size)).join(',');
    const stock = variants.reduce((sum, v) => sum + v.stock, 0);

    const id = uuidv4();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `INSERT INTO \`Product\`
          (id, name, price, stock, category, colors, sizes, imageUrl, active, createdAt, updatedAt, imageUrls, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(3), NOW(3), ?, ?)`,
        [id, name, price, stock, category, colors, sizes, imageUrls[0], imageUrls.join(','), description]
      );

      for (const v of variants) {
        await conn.query(
          'INSERT INTO `ProductVariant` (id, productId, color, size, stock) VALUES (?, ?, ?, ?, ?)',
          [uuidv4(), id, v.color, v.size, v.stock]
        );
      }

      await conn.commit();
      res.status(201).json({ id });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
);

// ------------------------------------------------------------------
// PUT /api/products/:id  (admin — edita produto existente)
// ------------------------------------------------------------------
router.put(
  '/:id',
  requireAdmin,
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'images', maxCount: 10 }]),
  async (req, res) => {
    const { id } = req.params;
    const [existingRows] = await pool.query('SELECT * FROM `Product` WHERE `id` = ?', [id]);
    if (existingRows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });

    const name = String(req.body.name || '').trim();
    const price = parseFloat(req.body.price);
    const category = String(req.body.category || 'geral').trim();
    const description = String(req.body.description || '').trim();

    if (!name) return res.status(400).json({ error: 'Informe o nome do produto.' });
    if (!price || price <= 0) return res.status(400).json({ error: 'Informe um preço válido.' });

    const variants = parseVariantsPayload(req.body.variants);
    if (variants.length === 0) return res.status(400).json({ error: 'Adicione pelo menos um tamanho com estoque.' });

    const existingImageUrls = String(req.body.existingImageUrls || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const mainFile = req.files?.image?.[0];
    const extraFiles = req.files?.images || [];

    let finalImages = [];
    if (mainFile) finalImages.push(fileUrl(mainFile.filename));
    finalImages.push(...existingImageUrls);
    finalImages.push(...extraFiles.map((f) => fileUrl(f.filename)));
    finalImages = dedupeKeepOrder(finalImages);

    if (finalImages.length === 0) {
      return res.status(400).json({ error: 'O produto precisa ter pelo menos uma foto.' });
    }

    const colors = dedupeKeepOrder(variants.map((v) => v.color)).join(',');
    const sizes = dedupeKeepOrder(variants.map((v) => v.size)).join(',');
    const stock = variants.reduce((sum, v) => sum + v.stock, 0);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `UPDATE \`Product\` SET
          name = ?, price = ?, stock = ?, category = ?, colors = ?, sizes = ?,
          imageUrl = ?, imageUrls = ?, description = ?, updatedAt = NOW(3)
         WHERE id = ?`,
        [name, price, stock, category, colors, sizes, finalImages[0], finalImages.join(','), description, id]
      );

      await conn.query('DELETE FROM `ProductVariant` WHERE `productId` = ?', [id]);
      for (const v of variants) {
        await conn.query(
          'INSERT INTO `ProductVariant` (id, productId, color, size, stock) VALUES (?, ?, ?, ?, ?)',
          [uuidv4(), id, v.color, v.size, v.stock]
        );
      }

      await conn.commit();
      res.json({ ok: true });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
);

// ------------------------------------------------------------------
// PATCH /api/products/:id/status  (admin — mostrar/ocultar)
// ------------------------------------------------------------------
router.patch('/:id/status', requireAdmin, async (req, res) => {
  const { active } = req.body;
  const [result] = await pool.query(
    'UPDATE `Product` SET `active` = ?, `updatedAt` = NOW(3) WHERE `id` = ?',
    [active ? 1 : 0, req.params.id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
  res.json({ ok: true });
});

// ------------------------------------------------------------------
// DELETE /api/products/:id  (admin)
// ------------------------------------------------------------------
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM `Product` WHERE `id` = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    if (err.errno === 1451) {
      return res.status(409).json({
        error: 'Não é possível excluir: este produto já tem pedidos vinculados. Oculte-o em vez de excluir.',
      });
    }
    throw err;
  }
});

module.exports = router;
