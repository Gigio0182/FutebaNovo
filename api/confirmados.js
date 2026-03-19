const { getDb } = require('./_lib/firebase');
const { handleOptions, parseBody, sendJson } = require('./_lib/http');
const { requireAuth } = require('./_lib/auth');
const { getConfirmadosCollectionName } = require('./_lib/group');

function isValidDate(dateText) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateText);
}

function normalizeNames(rawNames) {
  const lines = Array.isArray(rawNames) ? rawNames : [];

  const names = lines
    .map((line) =>
      String(line || '')
        .replace(/^\s*[-*\d.)]+\s*/, '')
        .trim()
    )
    .filter(Boolean)
    .map((name) => name.slice(0, 60));

  return Array.from(new Set(names));
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) {
    return;
  }

  if (!requireAuth(req, res)) {
    return;
  }

  try {
    const db = getDb();
    const confirmadosCollection = db.collection(getConfirmadosCollectionName(req));

    if (req.method === 'GET') {
      const dateRaw = String((req.query && req.query.date) || '').trim();

      if (dateRaw) {
        if (!isValidDate(dateRaw)) {
          sendJson(res, 400, { error: 'Data invalida. Use o formato YYYY-MM-DD.' });
          return;
        }

        const doc = await confirmadosCollection.doc(dateRaw).get();
        if (!doc.exists) {
          sendJson(res, 200, { records: [] });
          return;
        }

        const data = doc.data() || {};
        sendJson(res, 200, {
          records: [
            {
              date: dateRaw,
              names: Array.isArray(data.names) ? data.names : [],
              count: Array.isArray(data.names) ? data.names.length : 0,
              updatedAt: data.updatedAt || null
            }
          ]
        });
        return;
      }

      const snapshot = await confirmadosCollection.orderBy('date', 'desc').limit(24).get();
      const records = snapshot.docs.map((doc) => {
        const data = doc.data() || {};
        const names = Array.isArray(data.names) ? data.names : [];
        return {
          date: data.date || doc.id,
          names,
          count: names.length,
          updatedAt: data.updatedAt || null
        };
      });

      sendJson(res, 200, { records });
      return;
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const date = String(body.date || '').trim();
      const names = normalizeNames(body.names);

      if (!isValidDate(date)) {
        sendJson(res, 400, { error: 'Data invalida. Use o formato YYYY-MM-DD.' });
        return;
      }

      if (!names.length) {
        sendJson(res, 400, { error: 'Informe pelo menos um atleta confirmado.' });
        return;
      }

      const now = new Date().toISOString();
      const docRef = confirmadosCollection.doc(date);
      const current = await docRef.get();

      await docRef.set(
        {
          date,
          names,
          createdAt: current.exists ? current.data().createdAt || now : now,
          updatedAt: now
        },
        { merge: true }
      );

      sendJson(res, 200, { ok: true, date, count: names.length });
      return;
    }

    sendJson(res, 405, { error: 'Metodo nao permitido.' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
};
