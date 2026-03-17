const { parseBody, sendJson, handleOptions } = require('./_lib/http');
const { issueToken, validatePassword } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Metodo nao permitido.' });
    return;
  }

  try {
    const body = await parseBody(req);
    const password = (body.password || '').trim();

    if (!validatePassword(password)) {
      sendJson(res, 401, { error: 'Senha invalida.' });
      return;
    }

    const token = issueToken();
    res.setHeader(
      'Set-Cookie',
      `auth_token=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`
    );
    sendJson(res, 200, { token });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
};
