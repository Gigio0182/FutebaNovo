const { getDb } = require('./_lib/firebase');
const { handleOptions, parseBody, sendJson } = require('./_lib/http');
const { requireAuth } = require('./_lib/auth');
const { getAthletesCollectionName, getConfirmadosCollectionName } = require('./_lib/group');

function isValidDate(dateText) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateText);
}

function normalizeNames(rawNames) {
  const lines = Array.isArray(rawNames) ? rawNames : [];

  const names = lines
    .map((line) => {
      const text = String(line || '');
      const match = text.match(/^\s*\d+\s*[-–—]\s*(.+)$/u);
      const candidate = match ? match[1] : text;

      return candidate
        .replace(/\(\s*avulso\s*\)/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    })
    .filter(Boolean)
    .map((name) => name.slice(0, 60));

  const uniqueByKey = new Map();
  names.forEach((name) => {
    const key = normalizeNameKey(name);
    if (!key || uniqueByKey.has(key)) {
      return;
    }
    uniqueByKey.set(key, name);
  });

  return Array.from(uniqueByKey.values());
}

function normalizeNameKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function mapNamesByKey(names) {
  const map = new Map();
  names.forEach((name) => {
    const key = normalizeNameKey(name);
    if (key && !map.has(key)) {
      map.set(key, name);
    }
  });
  return map;
}

async function syncAthletesGames(db, req, previousNames, nextNames, nowIso) {
  const athletesCollection = db.collection(getAthletesCollectionName(req));
  const athletesSnapshot = await athletesCollection.get();

  const athleteByKey = new Map();
  athletesSnapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    const key = normalizeNameKey(data.name);
    if (!key || athleteByKey.has(key)) {
      return;
    }
    athleteByKey.set(key, {
      ref: athletesCollection.doc(doc.id),
      data
    });
  });

  const previousMap = mapNamesByKey(previousNames);
  const nextMap = mapNamesByKey(nextNames);

  const previousKeys = new Set(previousMap.keys());
  const nextKeys = new Set(nextMap.keys());

  const keysToAdd = Array.from(nextKeys).filter((key) => !previousKeys.has(key));
  const keysToRemove = Array.from(previousKeys).filter((key) => !nextKeys.has(key));

  for (const key of keysToAdd) {
    const existing = athleteByKey.get(key);
    if (existing) {
      const currentGames = Number(existing.data.games || 0);
      await existing.ref.set(
        {
          games: currentGames + 1,
          updatedAt: nowIso
        },
        { merge: true }
      );
      existing.data.games = currentGames + 1;
      continue;
    }

    const displayName = nextMap.get(key);
    const created = await athletesCollection.add({
      name: displayName,
      goals: 0,
      assists: 0,
      games: 1,
      mvp: 0,
      worst: 0,
      createdAt: nowIso,
      updatedAt: nowIso
    });

    athleteByKey.set(key, {
      ref: athletesCollection.doc(created.id),
      data: {
        name: displayName,
        goals: 0,
        assists: 0,
        games: 1,
        mvp: 0,
        worst: 0
      }
    });
  }

  for (const key of keysToRemove) {
    const existing = athleteByKey.get(key);
    if (!existing) {
      continue;
    }

    const currentGames = Number(existing.data.games || 0);
    await existing.ref.set(
      {
        games: Math.max(0, currentGames - 1),
        updatedAt: nowIso
      },
      { merge: true }
    );
    existing.data.games = Math.max(0, currentGames - 1);
  }
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
      const previousNames = current.exists
        ? normalizeNames((current.data() || {}).names)
        : [];

      await syncAthletesGames(db, req, previousNames, names, now);

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

    if (req.method === 'DELETE') {
      const dateFromQuery = String((req.query && req.query.date) || '').trim();
      const body = dateFromQuery ? {} : await parseBody(req);
      const date = String(dateFromQuery || body.date || '').trim();

      if (!isValidDate(date)) {
        sendJson(res, 400, { error: 'Data invalida. Use o formato YYYY-MM-DD.' });
        return;
      }

      const docRef = confirmadosCollection.doc(date);
      const current = await docRef.get();
      if (current.exists) {
        const now = new Date().toISOString();
        const previousNames = normalizeNames((current.data() || {}).names);
        await syncAthletesGames(db, req, previousNames, [], now);
      }

      await docRef.delete();
      sendJson(res, 200, { ok: true, date });
      return;
    }

    sendJson(res, 405, { error: 'Metodo nao permitido.' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
};
