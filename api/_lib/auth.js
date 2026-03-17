const crypto = require('crypto');
const { sendJson } = require('./http');

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function getSecret() {
  return process.env.APP_AUTH_SECRET || 'change-me-now';
}

function getPassword() {
  return process.env.APP_ADMIN_PASSWORD || '123456';
}

function sign(data) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(data)
    .digest('base64url');
}

function issueToken() {
  const payload = {
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  };
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(payloadPart);
  return `${payloadPart}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) {
    return false;
  }

  const [payloadPart, signature] = token.split('.');
  if (!payloadPart || !signature) {
    return false;
  }

  const expected = sign(payloadPart);
  if (expected !== signature) {
    return false;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    return payload.role === 'admin';
  } catch (error) {
    return false;
  }
}

function validatePassword(password) {
  return password === getPassword();
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  return header.slice(7).trim();
}

function requireAuth(req, res) {
  const token = getBearerToken(req);
  if (!verifyToken(token)) {
    sendJson(res, 401, { error: 'Nao autorizado. Faca login primeiro.' });
    return false;
  }
  return true;
}

module.exports = {
  issueToken,
  requireAuth,
  validatePassword
};
