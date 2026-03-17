const { getDb } = require('./_lib/firebase');
const { handleOptions, parseBody, sendJson } = require('./_lib/http');
const { requireAuth } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) {
    return;
  }

  if (!requireAuth(req, res)) {
    return;
  }

  try {
    const db = getDb();

    if (req.method === 'GET') {
      const snapshot = await db
        .collection('athletes')
        .orderBy('name', 'asc')
        .get();

      const athletes = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));

      sendJson(res, 200, { athletes });
      return;
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const name = (body.name || '').trim();

      if (!name) {
        sendJson(res, 400, { error: 'Nome do atleta e obrigatorio.' });
        return;
      }

      const created = await db.collection('athletes').add({
        name,
        createdAt: new Date().toISOString()
      });

      sendJson(res, 201, {
        athlete: {
          id: created.id,
          name
        }
      });
      return;
    }

    sendJson(res, 405, { error: 'Metodo nao permitido.' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
};
