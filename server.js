const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

const pool = mysql.createPool({
    host: '127.0.0.1',
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

app.use(cors({
    origin: [
        'https://fvfitwear.com.br',
        'https://www.fvfitwear.com.br',
        'https://fvfitwear.fvfitwear.com.br'
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer: aceita até 10 imagens (campo "images") + 1 imagem legada (campo "image")
const upload = multer({ dest: 'uploads/' });
const uploadFields = upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'image', maxCount: 1 }
]);

app.get('/', (req, res) => {
    res.send('API da FV Fitwear está rodando!');
});

// Rota de diagnóstico: abra essa URL no navegador pra confirmar que o
// servidor está rodando a versão mais recente do código (com a checagem
// de cliente recorrente no cupom de boas-vindas).
app.get('/api/_debug/version', (req, res) => {
    res.json({
        feature: 'checagem-cliente-recorrente-cupom-boasvindas',
        version: '2026-08-04-v2',
        ok: true
    });
});

// ──────────────────────────────────────────────────────────────
// HELPERS: ESTOQUE POR VARIANTE (COR + TAMANHO)
// ──────────────────────────────────────────────────────────────
function parseVariants(raw) {
    if (!raw) return [];
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map(v => ({
                color: (v.color || '').toString().trim(),
                size: (v.size || '').toString().trim(),
                stock: parseInt(v.stock) || 0
            }))
            .filter(v => v.color && v.size);
    } catch (e) {
        return [];
    }
}

async function saveProductVariants(productId, variantsList) {
    await pool.execute('DELETE FROM ProductVariant WHERE productId = ?', [productId]);
    for (const v of variantsList) {
        await pool.execute(
            'INSERT INTO ProductVariant (id, productId, color, size, stock) VALUES (?, ?, ?, ?, ?)',
            [uuidv4(), productId, v.color, v.size, v.stock]
        );
    }
}

async function getProductVariants(productId) {
    const [rows] = await pool.execute('SELECT * FROM ProductVariant WHERE productId = ?', [productId]);
    return rows;
}

// ──────────────────────────────────────────────────────────────
// CRIAR PRODUTO (suporta múltiplas imagens + descrição)
// ──────────────────────────────────────────────────────────────
app.post('/api/products', uploadFields, async (req, res) => {
    try {
        const { name, price, stock, category, colors, sizes, description, variants } = req.body;
        const id = uuidv4();
        const now = new Date();

        let allImageUrls = [];

        if (req.files && req.files['image'] && req.files['image'][0]) {
            allImageUrls.push(`https://fvfitwear.fvfitwear.com.br/uploads/${req.files['image'][0].filename}`);
        }
        if (req.files && req.files['images']) {
            req.files['images'].forEach(f => {
                allImageUrls.push(`https://fvfitwear.fvfitwear.com.br/uploads/${f.filename}`);
            });
        }

        const imageUrl = allImageUrls[0] || '';
        // Garante que imageUrls sempre contém todas as imagens (sem duplicatas)
        const uniqueImageUrls = [...new Set(allImageUrls)];
        const imageUrls = uniqueImageUrls.join(',');

        // Estoque por variante (Cor + Tamanho + Quantidade)
        const variantsList = parseVariants(variants);
        const finalColors = variantsList.length > 0 ? [...new Set(variantsList.map(v => v.color))].join(',') : colors;
        const finalSizes = variantsList.length > 0 ? [...new Set(variantsList.map(v => v.size))].join(',') : sizes;
        const finalStock = variantsList.length > 0
            ? variantsList.reduce((sum, v) => sum + (parseInt(v.stock) || 0), 0)
            : parseInt(stock);

        await pool.execute(
            `INSERT INTO Product 
                (id, name, price, stock, category, colors, sizes, imageUrl, imageUrls, description, active, createdAt, updatedAt) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            [id, name, parseFloat(price), finalStock, category || 'geral', finalColors, finalSizes, imageUrl, imageUrls, description || '', now, now]
        );

        if (variantsList.length > 0) {
            await saveProductVariants(id, variantsList);
        }

        const [rows] = await pool.execute('SELECT * FROM Product WHERE id = ?', [id]);
        const product = rows[0];
        product.variants = await getProductVariants(id);
        res.status(201).json(product);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao criar o produto' });
    }
});

// ──────────────────────────────────────────────────────────────
// LISTAR PRODUTOS
// ──────────────────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
    try {
        const { all } = req.query;
        let query = 'SELECT * FROM Product';
        if (all !== 'true') query += ' WHERE active = 1';
        query += ' ORDER BY createdAt DESC';
        const [rows] = await pool.execute(query);

        if (rows.length > 0) {
            const ids = rows.map(r => r.id);
            const placeholders = ids.map(() => '?').join(',');
            const [variantRows] = await pool.query(
                `SELECT * FROM ProductVariant WHERE productId IN (${placeholders})`,
                ids
            );
            const variantsByProduct = {};
            variantRows.forEach(v => {
                if (!variantsByProduct[v.productId]) variantsByProduct[v.productId] = [];
                variantsByProduct[v.productId].push(v);
            });
            rows.forEach(r => { r.variants = variantsByProduct[r.id] || []; });
        }

        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar produtos' });
    }
});

// ──────────────────────────────────────────────────────────────
// BUSCAR PRODUTO POR ID
// ──────────────────────────────────────────────────────────────
app.get('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.execute('SELECT * FROM Product WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado' });
        const product = rows[0];
        product.variants = await getProductVariants(id);
        res.json(product);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar o produto' });
    }
});

// ──────────────────────────────────────────────────────────────
// ALTERAR STATUS ATIVO/INATIVO
// ──────────────────────────────────────────────────────────────
app.patch('/api/products/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { active } = req.body;
        await pool.execute(
            'UPDATE Product SET active = ?, updatedAt = ? WHERE id = ?',
            [active ? 1 : 0, new Date(), id]
        );
        const [rows] = await pool.execute('SELECT * FROM Product WHERE id = ?', [id]);
        res.json(rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao alterar status do produto' });
    }
});

// ──────────────────────────────────────────────────────────────
// ATUALIZAR PRODUTO (suporta múltiplas imagens + descrição)
// ──────────────────────────────────────────────────────────────
app.put('/api/products/:id', uploadFields, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, stock, category, colors, sizes, description, existingImageUrls, variants } = req.body;

        // Estoque por variante (Cor + Tamanho + Quantidade)
        const variantsList = parseVariants(variants);
        const finalColors = variantsList.length > 0 ? [...new Set(variantsList.map(v => v.color))].join(',') : colors;
        const finalSizes = variantsList.length > 0 ? [...new Set(variantsList.map(v => v.size))].join(',') : sizes;
        const finalStock = variantsList.length > 0
            ? variantsList.reduce((sum, v) => sum + (parseInt(v.stock) || 0), 0)
            : parseInt(stock);

        // URLs das fotos existentes (enviadas pelo frontend ao editar)
        const existingUrls = existingImageUrls
            ? existingImageUrls.split(',').map(u => u.trim()).filter(Boolean)
            : [];

        // Novas fotos enviadas agora
        let newImageUrls = [];
        if (req.files && req.files['image'] && req.files['image'][0]) {
            newImageUrls.push(`https://fvfitwear.fvfitwear.com.br/uploads/${req.files['image'][0].filename}`);
        }
        if (req.files && req.files['images']) {
            req.files['images'].forEach(f => {
                newImageUrls.push(`https://fvfitwear.fvfitwear.com.br/uploads/${f.filename}`);
            });
        }

        // Junta fotos novas (se houver) com as existentes que sobraram (o front manda em
        // existingImageUrls só as que o usuário NÃO excluiu na tela de edição).
        // Sempre atualiza imageUrl/imageUrls, mesmo sem foto nova, pra exclusões serem salvas de verdade.
        const merged = [...new Set([...newImageUrls, ...existingUrls])];
        const imageUrl = merged[0] || '';
        const imageUrls = merged.join(',');

        const imageQuery = `UPDATE Product 
            SET name=?, price=?, stock=?, category=?, colors=?, sizes=?, description=?, imageUrl=?, imageUrls=?, updatedAt=? 
            WHERE id=?`;
        const params = [name, parseFloat(price), finalStock, category, finalColors, finalSizes, description || '', imageUrl, imageUrls, new Date(), id];

        await pool.execute(imageQuery, params);

        if (variantsList.length > 0) {
            await saveProductVariants(id, variantsList);
        }

        const [rows] = await pool.execute('SELECT * FROM Product WHERE id = ?', [id]);
        const product = rows[0];
        product.variants = await getProductVariants(id);
        res.json(product);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao atualizar o produto' });
    }
});


// ──────────────────────────────────────────────────────────────
// DELETAR PRODUTO
// ──────────────────────────────────────────────────────────────
app.delete('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute('DELETE FROM OrderItem WHERE productId = ?', [id]);
        await pool.execute('DELETE FROM ProductVariant WHERE productId = ?', [id]);
        await pool.execute('DELETE FROM Product WHERE id = ?', [id]);
        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao excluir o produto' });
    }
});

// ──────────────────────────────────────────────────────────────
// DELETAR PEDIDO
// ──────────────────────────────────────────────────────────────
app.delete('/api/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute('DELETE FROM OrderItem WHERE orderId = ?', [id]);
        await pool.execute('DELETE FROM `Order` WHERE id = ?', [id]);
        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao excluir o pedido' });
    }
});

// ──────────────────────────────────────────────────────────────
// HELPERS: CUPONS
// ──────────────────────────────────────────────────────────────
function calcularDesconto(coupon, subtotal) {
    if (coupon.discountType === 'fixo') {
        return Math.min(parseFloat(coupon.value), subtotal);
    }
    return +(subtotal * (parseFloat(coupon.value) / 100)).toFixed(2);
}

// Retorna null se o cupom pode ser usado, ou uma string com o motivo do bloqueio
function motivoCupomInvalido(coupon) {
    if (!coupon.active) return 'Este cupom está inativo.';
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) return 'Este cupom expirou.';
    if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) return 'Este cupom atingiu o limite de usos.';
    return null;
}

// Verifica se já existe QUALQUER pedido anterior com este e-mail (cliente recorrente,
// independente de ter usado cupom ou não). É essa checagem que define quem é "novo".
async function emailJaComprou(email) {
    if (!email) return false;
    const [rows] = await pool.execute(
        'SELECT id FROM `Order` WHERE LOWER(customerEmail) = LOWER(?) LIMIT 1',
        [email.trim()]
    );
    const jaComprou = rows.length > 0;
    console.log(`[boasvindas-check] e-mail="${email.trim()}" jaComprou=${jaComprou} (${rows.length} pedido(s) encontrado(s))`);
    return jaComprou;
}

// ──────────────────────────────────────────────────────────────
// CRIAR CUPOM
// ──────────────────────────────────────────────────────────────
app.post('/api/coupons', async (req, res) => {
    try {
        const { code, title, category, discountType, value, maxUses, expiresAt, active } = req.body;
        if (!code || !title || value === undefined || value === null || value === '') {
            return res.status(400).json({ error: 'Preencha código, título e valor do desconto.' });
        }

        const id = uuidv4();
        const now = new Date();
        const normalizedCode = code.trim().toUpperCase();

        await pool.execute(
            `INSERT INTO Coupon (id, code, title, category, discountType, value, maxUses, usesCount, active, expiresAt, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
            [
                id,
                normalizedCode,
                title,
                category || 'todos',
                discountType || 'percentual',
                parseFloat(value),
                (maxUses === '' || maxUses === undefined || maxUses === null) ? null : parseInt(maxUses),
                active === false || active === 'false' ? 0 : 1,
                expiresAt || null,
                now,
                now
            ]
        );

        const [rows] = await pool.execute('SELECT * FROM Coupon WHERE id = ?', [id]);
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error(error);
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Já existe um cupom com esse código.' });
        res.status(500).json({ error: 'Erro ao criar cupom' });
    }
});

// ──────────────────────────────────────────────────────────────
// LISTAR CUPONS (admin)
// ──────────────────────────────────────────────────────────────
app.get('/api/coupons', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM Coupon ORDER BY createdAt DESC');
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar cupons' });
    }
});

// ──────────────────────────────────────────────────────────────
// CUPOM DE BOAS-VINDAS ATIVO (rota pública, usada no popup do site)
// ──────────────────────────────────────────────────────────────
app.get('/api/coupons/welcome', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT * FROM Coupon WHERE category = 'boasvindas' ORDER BY createdAt DESC LIMIT 1`
        );
        if (rows.length === 0) return res.json(null);
        const coupon = rows[0];
        if (motivoCupomInvalido(coupon)) return res.json(null);
        res.json(coupon);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar cupom de boas-vindas' });
    }
});

// ──────────────────────────────────────────────────────────────
// ATUALIZAR CUPOM
// ──────────────────────────────────────────────────────────────
app.put('/api/coupons/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { code, title, category, discountType, value, maxUses, expiresAt, active } = req.body;
        const normalizedCode = code.trim().toUpperCase();

        await pool.execute(
            `UPDATE Coupon 
                SET code=?, title=?, category=?, discountType=?, value=?, maxUses=?, active=?, expiresAt=?, updatedAt=? 
             WHERE id=?`,
            [
                normalizedCode,
                title,
                category || 'todos',
                discountType || 'percentual',
                parseFloat(value),
                (maxUses === '' || maxUses === undefined || maxUses === null) ? null : parseInt(maxUses),
                active === false || active === 'false' ? 0 : 1,
                expiresAt || null,
                new Date(),
                id
            ]
        );

        const [rows] = await pool.execute('SELECT * FROM Coupon WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Cupom não encontrado' });
        res.json(rows[0]);
    } catch (error) {
        console.error(error);
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Já existe um cupom com esse código.' });
        res.status(500).json({ error: 'Erro ao atualizar cupom' });
    }
});

// ──────────────────────────────────────────────────────────────
// ATIVAR / DESATIVAR CUPOM
// ──────────────────────────────────────────────────────────────
app.patch('/api/coupons/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { active } = req.body;
        await pool.execute('UPDATE Coupon SET active = ?, updatedAt = ? WHERE id = ?', [active ? 1 : 0, new Date(), id]);
        const [rows] = await pool.execute('SELECT * FROM Coupon WHERE id = ?', [id]);
        res.json(rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao alterar status do cupom' });
    }
});

// ──────────────────────────────────────────────────────────────
// EXCLUIR CUPOM
// ──────────────────────────────────────────────────────────────
app.delete('/api/coupons/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute('DELETE FROM Coupon WHERE id = ?', [id]);
        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao excluir cupom' });
    }
});

// ──────────────────────────────────────────────────────────────
// VERIFICAR SE O CLIENTE JÁ COMPROU ANTES (chamado quando o cliente
// preenche o e-mail no carrinho, pra saber se ele é novo ou recorrente)
// ──────────────────────────────────────────────────────────────
app.post('/api/customers/check', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !email.trim()) {
            return res.status(400).json({ error: 'Informe um e-mail.' });
        }
        const hasPurchased = await emailJaComprou(email);
        res.json({ hasPurchased });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao verificar cliente' });
    }
});

// ──────────────────────────────────────────────────────────────
// VALIDAR CUPOM (chamado quando o cliente aplica o código no carrinho)
// ──────────────────────────────────────────────────────────────
app.post('/api/coupons/validate', async (req, res) => {
    try {
        const { code, subtotal, email } = req.body;
        if (!code) return res.status(400).json({ valid: false, error: 'Informe um código de cupom.' });

        const normalizedCode = code.trim().toUpperCase();
        const [rows] = await pool.execute('SELECT * FROM Coupon WHERE code = ?', [normalizedCode]);
        if (rows.length === 0) return res.status(404).json({ valid: false, error: 'Cupom não encontrado.' });

        const coupon = rows[0];
        const motivo = motivoCupomInvalido(coupon);
        if (motivo) return res.status(400).json({ valid: false, error: motivo });

        if (coupon.category === 'boasvindas') {
            if (!email) {
                console.log(`[boasvindas-check] tentativa de aplicar "${coupon.code}" sem e-mail — bloqueado`);
                return res.status(400).json({ valid: false, error: 'Preencha seu e-mail para usar o cupom de boas-vindas.' });
            }
            const jaComprou = await emailJaComprou(email);
            if (jaComprou) {
                return res.status(400).json({ valid: false, error: 'Este cupom de boas-vindas é válido apenas para o seu primeiro pedido. Notamos que este e-mail já possui compras anteriores.' });
            }
        }

        const subtotalValue = parseFloat(subtotal) || 0;
        const discount = calcularDesconto(coupon, subtotalValue);

        res.json({
            valid: true,
            code: coupon.code,
            title: coupon.title,
            discountType: coupon.discountType,
            value: coupon.value,
            discount
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ valid: false, error: 'Erro ao validar cupom' });
    }
});

// ──────────────────────────────────────────────────────────────
// CRIAR PEDIDO
// TAREFA 4: total calculado no backend (sem duplicação)
// TAREFA 5: campos region, cep, bairro, cidade salvos no pedido
// TAREFA 6: cupom revalidado no servidor e desconto aplicado no total
// ──────────────────────────────────────────────────────────────
app.post('/api/orders', async (req, res) => {
    try {
        const {
            address,
            paymentMethod,
            items,
            customerName,
            customerEmail,
            region,
            cep,
            bairro,
            cidade,
            shippingFee,
            couponCode
        } = req.body;

        // Calcula subtotal no backend a partir dos itens
        let subtotal = 0;
        for (const item of items) {
            const qty = parseInt(item.quantity) || 1;
            const price = parseFloat(item.price) || 0;
            subtotal += price * qty;
        }

        // Adiciona frete enviado pelo frontend (já validado lá)
        const frete = parseFloat(shippingFee) || 0;

        // Revalida o cupom no servidor — nunca confia no desconto calculado no front
        let couponDiscount = 0;
        let appliedCode = '';
        let couponRow = null;

        if (couponCode) {
            const normalizedCode = couponCode.trim().toUpperCase();
            const [couponRows] = await pool.execute('SELECT * FROM Coupon WHERE code = ?', [normalizedCode]);
            if (couponRows.length > 0) {
                couponRow = couponRows[0];
                const motivo = motivoCupomInvalido(couponRow);
                let bloqueadoBoasVindas = false;
                if (couponRow.category === 'boasvindas') {
                    if (!customerEmail) {
                        bloqueadoBoasVindas = true;
                        console.log('[boasvindas-check] pedido sem e-mail tentou usar cupom de boas-vindas — bloqueado');
                    } else {
                        bloqueadoBoasVindas = await emailJaComprou(customerEmail);
                    }
                }
                if (!motivo && !bloqueadoBoasVindas) {
                    couponDiscount = calcularDesconto(couponRow, subtotal);
                    appliedCode = couponRow.code;
                } else {
                    couponRow = null; // cupom não pôde ser aplicado, ignora
                }
            }
        }

        const total = Math.max(subtotal + frete - couponDiscount, 0);

        const orderId = uuidv4();
        const now = new Date();

        await pool.execute(
            `INSERT INTO \`Order\` 
                (id, address, paymentMethod, total, status, customerName, customerEmail, region, cep, bairro, cidade, shippingFee, subtotal, couponCode, couponDiscount, createdAt) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                orderId,
                address,
                paymentMethod,
                total,
                'Pendente',
                customerName || '',
                customerEmail || '',
                region || 'tupi',
                cep || '',
                bairro || '',
                cidade || '',
                frete,
                subtotal,
                appliedCode,
                couponDiscount,
                now
            ]
        );

        for (const item of items) {
            const itemId = uuidv4();
            const qty = parseInt(item.quantity) || 1;
            await pool.execute(
                `INSERT INTO OrderItem 
                    (id, orderId, productId, name, price, quantity, size, color) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [itemId, orderId, item.productId, item.name, parseFloat(item.price), qty, item.size, item.color]
            );
            await pool.execute(
                'UPDATE Product SET stock = stock - ?, updatedAt = ? WHERE id = ?',
                [qty, now, item.productId]
            );
            if (item.color && item.size) {
                await pool.execute(
                    'UPDATE ProductVariant SET stock = stock - ? WHERE productId = ? AND color = ? AND size = ?',
                    [qty, item.productId, item.color, item.size]
                );
            }
        }

        // Só incrementa o contador de usos se o cupom foi de fato aplicado
        if (couponRow && appliedCode) {
            await pool.execute('UPDATE Coupon SET usesCount = usesCount + 1 WHERE id = ?', [couponRow.id]);
        }

        const [orderRows] = await pool.execute('SELECT * FROM `Order` WHERE id = ?', [orderId]);
        res.status(201).json(orderRows[0]);
    } catch (error) {
        console.error('Erro ao salvar pedido:', error);
        res.status(500).json({ error: 'Erro ao criar o pedido' });
    }
});

// ──────────────────────────────────────────────────────────────
// LISTAR PEDIDOS
// ──────────────────────────────────────────────────────────────
app.get('/api/orders', async (req, res) => {
    try {
        const [orders] = await pool.execute('SELECT * FROM `Order` ORDER BY createdAt DESC');
        for (const order of orders) {
            const [items] = await pool.execute('SELECT * FROM OrderItem WHERE orderId = ?', [order.id]);
            order.items = items;
        }
        res.json(orders);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar pedidos' });
    }
});

// ──────────────────────────────────────────────────────────────
// ATUALIZAR STATUS DO PEDIDO (com reversão de estoque)
// ──────────────────────────────────────────────────────────────
app.patch('/api/orders/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const [orderRows] = await pool.execute('SELECT * FROM `Order` WHERE id = ?', [id]);
        if (orderRows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });

        const order = orderRows[0];
        const [items] = await pool.execute('SELECT * FROM OrderItem WHERE orderId = ?', [id]);
        const now = new Date();

        // Cancela pedido: devolve estoque
        if (status === 'Cancelado' && order.status !== 'Cancelado') {
            for (const item of items) {
                await pool.execute(
                    'UPDATE Product SET stock = stock + ?, updatedAt = ? WHERE id = ?',
                    [item.quantity, now, item.productId]
                );
                if (item.color && item.size) {
                    await pool.execute(
                        'UPDATE ProductVariant SET stock = stock + ? WHERE productId = ? AND color = ? AND size = ?',
                        [item.quantity, item.productId, item.color, item.size]
                    );
                }
            }
        }

        // Reativa pedido cancelado: desconta estoque novamente
        if (order.status === 'Cancelado' && status !== 'Cancelado') {
            for (const item of items) {
                await pool.execute(
                    'UPDATE Product SET stock = stock - ?, updatedAt = ? WHERE id = ?',
                    [item.quantity, now, item.productId]
                );
                if (item.color && item.size) {
                    await pool.execute(
                        'UPDATE ProductVariant SET stock = stock - ? WHERE productId = ? AND color = ? AND size = ?',
                        [item.quantity, item.productId, item.color, item.size]
                    );
                }
            }
        }

        await pool.execute('UPDATE `Order` SET status = ? WHERE id = ?', [status, id]);
        const [updated] = await pool.execute('SELECT * FROM `Order` WHERE id = ?', [id]);
        res.json(updated[0]);
    } catch (error) {
        console.error('Erro ao atualizar status do pedido:', error);
        res.status(500).json({ error: 'Erro ao atualizar status do pedido' });
    }
});

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
