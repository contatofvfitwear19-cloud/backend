const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Trava tentativas de força bruta no login: no máximo 10 tentativas a cada 15 min por IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Informe usuário e senha.' });
  }

  const validUsername = username === process.env.ADMIN_USERNAME;
  // Sempre roda o bcrypt.compare mesmo se o usuário já estiver errado,
  // pra não dar pista de tempo de resposta sobre qual campo falhou.
  const hash = process.env.ADMIN_PASSWORD_HASH || '';
  const validPassword = hash ? await bcrypt.compare(password, hash) : false;

  if (!validUsername || !validPassword) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }

  const token = jwt.sign(
    { role: 'admin', username },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({ token });
});

module.exports = router;
