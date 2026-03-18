# App Futeba

Aplicacao para registrar atletas e atualizar estatisticas (gols, assistencias, jogos, MVP e pior em campo), com rankings.

## Funcionalidades

- Pagina de login em `/`.
- Pagina autenticada de cadastro em `/athletes`.
- Cadastro de atleta com nome.
- Lista de atletas com botoes de incremento/decremento para:
  - `goals`
  - `assists`
  - `games`
  - `mvp`
  - `worst`
- Ranking publico em `/ranking`.
- Pagina de goleadores em `/goleadores`.
- Pagina de garcons em `/garcons`.
- Suporte PWA (instalavel no celular) com cache offline de telas.
- Na tela de cadastro, alteracoes podem ser feitas offline e sincronizam automaticamente ao reconectar.

## Estrutura

- `public/index.html`: tela de login.
- `public/athletes.html`: tela autenticada de cadastro/listagem de atletas.
- `public/ranking.html`: tela de ranking.
- `public/goleadores.html`: ranking de gols.
- `public/garcons.html`: ranking de assistencias.
- `public/login.js`: fluxo de login.
- `public/athletes.js`: cadastro e incremento de estatisticas.
- `public/ranking.js`: renderizacao do ranking geral.
- `public/goleadores.js`: renderizacao da lista de goleadores.
- `public/garcons.js`: renderizacao da lista de garcons.
- `public/manifest.webmanifest`: manifesto PWA.
- `public/sw.js`: service worker para cache offline.
- `public/pwa.js`: registro do service worker.
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
- `http://localhost:3000/goleadores`
- `http://localhost:3000/garcons`

## Configuracao Firebase

1. No Firebase Console, mantenha o projeto atual para producao (main).
2. Crie um segundo projeto para nao-producao (compartilhado por DEV e QA).
3. Ative o Firestore Database nos dois projetos.
4. Gere uma Service Account (JSON) para cada projeto.
5. Opcao local: salve o arquivo como `firebase-service.json` na raiz do projeto.
6. Opcao Vercel (recomendada): use variavel de ambiente com Base64.

### Estrategia por branch

- `main` -> Vercel `Production` -> Firebase de producao (atual/default).
- `branch-DEV` e `branch-QA` -> Vercel `Preview` -> Firebase nao-producao.

### Precedencia de variaveis no backend

O backend procura credenciais nessa ordem:

1. `FIREBASE_SERVICE_ACCOUNT_BASE64_<AMBIENTE>` (ex.: `_PRODUCTION`, `_PREVIEW`, `_QA`).
2. `FIREBASE_SERVICE_ACCOUNT_JSON_<AMBIENTE>`.
3. Variaveis legadas `FIREBASE_SERVICE_ACCOUNT_BASE64` ou `FIREBASE_SERVICE_ACCOUNT_JSON`.
4. Arquivo local `firebase-service.json`.

`<AMBIENTE>` vem de `FIREBASE_ENVIRONMENT` (ou `VERCEL_ENV` quando nao informado).

## Gerar Base64 no PowerShell

### Producao

```powershell
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content .\firebase-service-prod.json -Raw)))
```

### Nao-producao (DEV/QA)

```powershell
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content .\firebase-service-preview.json -Raw)))
```

## Configurar na Vercel

No dashboard do projeto, configure por escopo:

### Production (branch `main`)

- `FIREBASE_SERVICE_ACCOUNT_BASE64_PRODUCTION` = Base64 do JSON de producao.
- `APP_ADMIN_PASSWORD` = senha forte.
- `APP_AUTH_SECRET` = string longa aleatoria.

### Preview (branches `branch-DEV` e `branch-QA`)

- `FIREBASE_SERVICE_ACCOUNT_BASE64_PREVIEW` = Base64 do JSON do Firebase nao-producao.
- `APP_ADMIN_PASSWORD` = senha de ambiente nao-producao.
- `APP_AUTH_SECRET` = segredo do ambiente nao-producao.

Opcionalmente, defina `FIREBASE_ENVIRONMENT=production` em Production e `FIREBASE_ENVIRONMENT=preview` em Preview. Sem isso, a Vercel ja expõe `VERCEL_ENV` e o backend usa esse valor automaticamente.

Depois rode o deploy:

```bash
npx vercel
```

## Arquivo de exemplo de variaveis

Use `.env.example` como referencia para setup local e de ambientes.

## Passo a passo de criacao no Firebase

1. Firebase Console -> Add project -> crie o projeto nao-producao (ex.: `app-futeba-preview`).
2. Build -> Firestore Database -> Create database.
3. Project settings -> Service accounts -> Generate new private key.
4. Salve o JSON fora do repositorio e gere Base64 com os comandos acima.

## Configuracao antiga (simples)

Tambem funciona manter apenas `FIREBASE_SERVICE_ACCOUNT_BASE64` por ambiente na Vercel (Production e Preview), sem sufixos. O suporte legado foi mantido para compatibilidade.

## Endpoints

- `POST /api/login`
- `POST /api/logout`
- `GET /api/athletes`
- `POST /api/athletes`
- `PUT /api/athletes` (atualiza com `delta` em `goals`, `assists`, `games`, `mvp` ou `worst` sem permitir negativo)
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
