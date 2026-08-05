# FV Fitwear — Backend

Backend em Node.js + Express + MySQL pra loja FV Fitwear. Feito pra rodar como
"Node.js App" na Hostinger, no subdomínio `fvfitwear.fvfitwear.com.br`, usando
o mesmo banco MySQL que você já tem lá.

## O que mudou em relação ao que existia antes

- **Login do admin não fica mais fixo no HTML.** Agora existe `POST /api/auth/login`,
  que devolve um token (JWT). O painel guarda esse token no `sessionStorage` e
  manda ele em toda chamada. Se o token expirar ou for inválido, o admin é
  jogado de volta pro login.
- **Toda rota que cria/edita/apaga (produtos, pedidos, cupons) exige esse token.**
  Antes, qualquer pessoa que soubesse a URL conseguia editar/apagar produtos e
  pedidos direto pela API, sem senha nenhuma.
- **Upload de imagem valida o tipo de arquivo de verdade** (por assinatura do
  arquivo, não pela extensão que o navegador manda) e gera nomes aleatórios —
  ninguém consegue subir um `.php` disfarçado de imagem.
- **Estoque por variante (cor + tamanho) é controlado com trava de linha
  (`FOR UPDATE`) dentro de uma transação.** Isso impede que dois clientes
  comprem a última unidade ao mesmo tempo e o estoque fique negativo.
- **Preço e desconto de cupom são recalculados no servidor**, não confiam mais
  no valor que vem do navegador do cliente.

## Estrutura

```
server.js                  → arquivo principal
src/db/pool.js             → conexão com o MySQL
src/middleware/auth.js      → confere o token JWT do admin
src/middleware/upload.js    → upload de imagens (multer)
src/routes/auth.js          → POST /api/auth/login
src/routes/products.js      → produtos (público + admin)
src/routes/orders.js        → pedidos (checkout público + admin)
src/routes/coupons.js       → cupons (público + admin)
database/schema.sql         → estrutura das tabelas (sem dados), só de referência
uploads/                    → fotos dos produtos ficam salvas aqui
```

## Rodando localmente

```bash
npm install
cp .env.example .env
# edite o .env com os dados do seu banco

# gere o hash da sua senha de admin:
node -e "console.log(require('bcryptjs').hashSync('SUA_SENHA_AQUI', 10))"
# cole o resultado em ADMIN_PASSWORD_HASH no .env

# gere um segredo JWT forte:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# cole em JWT_SECRET no .env

npm start
```

O servidor sobe em `http://localhost:3000` (ou na porta que você definir em `PORT`).

## Subindo pro GitHub

```bash
git init
git add .
git commit -m "Backend inicial FV Fitwear"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/fvfitwear-backend.git
git push -u origin main
```

O `.env` **não vai** junto (está no `.gitignore`) — é só o `.env.example` que
sobe, como modelo. As fotos da pasta `uploads/` também não vão pro Git (só o
`.gitkeep` pra pasta existir); elas ficam vivas direto no servidor.

## Deploy na Hostinger

1. No hPanel, vá em **Sites > [seu subdomínio fvfitwear.fvfitwear.com.br] > Node.js**.
2. Configure:
   - **Application root**: a pasta onde você vai colocar esses arquivos (ou
     clonar o repositório do GitHub).
   - **Application startup file**: `server.js`
   - **Node.js version**: 18 ou superior.
3. Clique em **NPM Install** (ou rode `npm install` pelo terminal SSH, se tiver).
4. Configure as variáveis de ambiente na própria tela da Hostinger (ou suba um
   `.env` manualmente pelo Gerenciador de Arquivos, dentro da pasta da
   aplicação) com os mesmos campos do `.env.example`, usando os dados do banco
   MySQL que você já tem lá.
5. Clique em **Restart** pra aplicar.
6. Teste: `https://fvfitwear.fvfitwear.com.br/api/health` deve responder
   `{"ok":true}`.

⚠️ **Atenção com a pasta `uploads/`**: se você atualizar o código depois (novo
push/deploy), não apague essa pasta — é nela que ficam as fotos dos produtos
já cadastrados. Se preferir, você também pode apontar `UPLOAD_DIR` pra um
caminho fora da pasta do app, mas o padrão já funciona bem contanto que você
não sobrescreva a pasta inteira num deploy.

## Domínio do frontend (CORS)

No `.env`, `CORS_ORIGINS` precisa ter exatamente o(s) domínio(s) de onde o
site é servido (ex: `https://fvfitwear.com.br,https://www.fvfitwear.com.br`).
Se esquecer, o navegador vai bloquear as chamadas do site pro backend.

## Endpoints

### Público
- `GET  /api/products` — lista produtos ativos
- `GET  /api/products/:id` — detalhe do produto (com variantes)
- `POST /api/orders` — cria pedido (checkout)
- `GET  /api/coupons/welcome` — cupom de boas-vindas ativo (se houver)
- `POST /api/coupons/validate` — valida cupom digitado no carrinho
- `POST /api/auth/login` — login do admin

### Admin (precisa de `Authorization: Bearer <token>`)
- `GET    /api/products?all=true`
- `POST   /api/products` · `PUT /api/products/:id` · `PATCH /api/products/:id/status` · `DELETE /api/products/:id`
- `GET    /api/orders` · `PATCH /api/orders/:id/status` · `DELETE /api/orders/:id`
- `GET    /api/coupons` · `POST /api/coupons` · `PUT /api/coupons/:id` · `PATCH /api/coupons/:id/status` · `DELETE /api/coupons/:id`
