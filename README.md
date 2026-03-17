# App Futeba

Aplicacao para registrar atletas e atualizar estatisticas (gols, assistencias e jogos), com ranking consolidado.

## Funcionalidades

- Pagina de login em `/`.
- Pagina autenticada de cadastro em `/athletes`.
- Cadastro de atleta com nome.
- Lista de atletas com botoes de incremento para:
  - `goals`
  - `assists`
  - `games`
- Ranking publico em `/ranking`:
  - `points = goals * 2 + assists`

## Estrutura

- `public/index.html`: tela de login.
- `public/athletes.html`: tela autenticada de cadastro/listagem de atletas.
- `public/ranking.html`: tela de ranking.
- `public/login.js`: fluxo de login.
- `public/athletes.js`: cadastro e incremento de estatisticas.
- `api/athletes.js`: API de atletas.
- `api/ranking.js`: API de ranking.
- `api/_lib/firebase.js`: inicializacao do Firebase Admin.

## Rodar local com Vercel

```bash
npm install
npx vercel dev
```

Acesse:

- `http://localhost:3000/`
- `http://localhost:3000/athletes`
- `http://localhost:3000/ranking`

## Configuracao Firebase

1. No Firebase Console, crie um projeto.
2. Ative o Firestore Database.
3. Gere uma Service Account (JSON).
4. Opcao local: salve o arquivo como `firebase-service.json` na raiz do projeto.
5. Opcao Vercel (recomendada): use variavel de ambiente com Base64.

### Gerar Base64 no PowerShell

```powershell
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content .\firebase-service.json -Raw)))
```

## Configurar na Vercel

No dashboard do projeto, adicione:

- `FIREBASE_SERVICE_ACCOUNT_BASE64` = valor Base64 do JSON da service account.
- `APP_ADMIN_PASSWORD` = senha de acesso do app (senha forte).
- `APP_AUTH_SECRET` = segredo para assinatura de token (string longa aleatoria).

Depois rode o deploy:

```bash
npx vercel
```

## Endpoints

- `POST /api/login`
- `GET /api/athletes`
- `POST /api/athletes`
- `PUT /api/athletes` (incrementa `goals`, `assists` ou `games`)
- `GET /api/ranking`

## Autenticacao Simples

- Login por senha em `POST /api/login` com retorno de token Bearer.
- `GET /api/ranking` e publico (sem login).
- `GET /api/athletes`, `POST /api/athletes` e `PUT /api/athletes` exigem token valido no header `Authorization`.
- Defaults de desenvolvimento (troque em producao):
  - `APP_ADMIN_PASSWORD=123456`
  - `APP_AUTH_SECRET=change-me-now`

## GitHub Pessoal

Sim, vale usar GitHub para versionamento e deploy. Para garantir uso da conta pessoal:

1. Configure identidade local deste repositorio:

```bash
git config user.name "SEU_NOME"
git config user.email "seu-email-pessoal@..."
```

2. Crie um PAT (Personal Access Token) na conta pessoal do GitHub.
3. Aponte o remoto para seu repositorio pessoal:

```bash
git remote add origin https://github.com/SEU_USUARIO/meu-app-futebol.git
```

4. No `git push`, autentique com a conta pessoal.
5. Nunca suba `firebase-service.json` (ja protegido no `.gitignore`).
