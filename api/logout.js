const { handleOptions, sendJson } = require('./_lib/http');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Metodo nao permitido.' });
    return;
  }

  res.setHeader(
    'Set-Cookie',
    'auth_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
  );
  sendJson(res, 200, { ok: true });
};
