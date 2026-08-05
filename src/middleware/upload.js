const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Só aceita esses tipos de imagem, e escolhe a extensão pelo mimetype real
// (nunca confia no nome/extensão que o navegador manda)
const ALLOWED_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED_MIME[file.mimetype] || '';
    const randomName = crypto.randomBytes(16).toString('hex');
    cb(null, `${randomName}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME[file.mimetype]) {
    return cb(new Error('Tipo de arquivo não permitido. Envie apenas JPG, PNG, WEBP ou GIF.'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 6 * 1024 * 1024, // 6MB por arquivo
    files: 11, // 1 imagem principal + até 10 extras
  },
});

module.exports = { upload, UPLOAD_DIR };
