const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// --- Usuário e senha fixos do admin ---
// Se quiser trocar depois, é só editar essas duas linhas e reiniciar o backend.
const ADMIN_USERNAME = 'fitwear';
const ADMIN_PASSWORD = '2502fit';

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

  const valid = username === ADMIN_USERNAME && password === ADMIN_PASSWORD;

  if (!valid) {
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
