const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const decoded = Buffer.from(
      process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
      'base64'
    ).toString('utf8');
    return JSON.parse(decoded);
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  const localPath = path.join(process.cwd(), 'firebase-service.json');
  if (fs.existsSync(localPath)) {
    const raw = fs.readFileSync(localPath, 'utf8');
    return JSON.parse(raw);
  }

  throw new Error(
    'Credenciais Firebase nao encontradas. Configure FIREBASE_SERVICE_ACCOUNT_BASE64/FIREBASE_SERVICE_ACCOUNT_JSON ou o arquivo firebase-service.json.'
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
