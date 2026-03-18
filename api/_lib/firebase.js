const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function normalizeEnvName(value) {
  if (!value) {
    return null;
  }

  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
}

function getEnvVariants() {
  const variants = [];
  const explicit = normalizeEnvName(process.env.FIREBASE_ENVIRONMENT);
  const vercel = normalizeEnvName(process.env.VERCEL_ENV);

  if (explicit) {
    variants.push(explicit);
  }

  if (vercel && !variants.includes(vercel)) {
    variants.push(vercel);
  }

  return variants;
}

function parseBase64Json(value, varName) {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (error) {
    throw new Error(`Variavel ${varName} invalida: nao foi possivel decodificar JSON Base64.`);
  }
}

function parseRawJson(value, varName) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Variavel ${varName} invalida: JSON malformado.`);
  }
}

function loadServiceAccount() {
  const envVariants = getEnvVariants();
  const base64Vars = envVariants.map(
    (envName) => `FIREBASE_SERVICE_ACCOUNT_BASE64_${envName}`
  );
  const jsonVars = envVariants.map(
    (envName) => `FIREBASE_SERVICE_ACCOUNT_JSON_${envName}`
  );

  // Legacy vars are kept for backward compatibility and local setup.
  base64Vars.push('FIREBASE_SERVICE_ACCOUNT_BASE64');
  jsonVars.push('FIREBASE_SERVICE_ACCOUNT_JSON');

  for (const varName of base64Vars) {
    if (process.env[varName]) {
      return parseBase64Json(process.env[varName], varName);
    }
  }

  for (const varName of jsonVars) {
    if (process.env[varName]) {
      return parseRawJson(process.env[varName], varName);
    }
  }

  const localPath = path.join(process.cwd(), 'firebase-service.json');
  if (fs.existsSync(localPath)) {
    const raw = fs.readFileSync(localPath, 'utf8');
    return JSON.parse(raw);
  }

  throw new Error(
    'Credenciais Firebase nao encontradas. Configure FIREBASE_SERVICE_ACCOUNT_BASE64_<AMBIENTE>/FIREBASE_SERVICE_ACCOUNT_JSON_<AMBIENTE>, as variaveis legadas FIREBASE_SERVICE_ACCOUNT_BASE64/FIREBASE_SERVICE_ACCOUNT_JSON ou o arquivo firebase-service.json.'
  );
}

function getDb() {
  if (!admin.apps.length) {
    const serviceAccount = loadServiceAccount();

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  return admin.firestore();
}

module.exports = {
  getDb
};
