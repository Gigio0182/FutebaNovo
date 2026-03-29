const { getDb } = require('./_lib/firebase');
const { handleOptions, parseBody, sendJson } = require('./_lib/http');
const { requireAuth } = require('./_lib/auth');
const { getAthletesCollectionName, getConfirmadosCollectionName } = require('./_lib/group');

function isValidDate(dateText) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateText);
}

function normalizeMatchStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'started' ? 'started' : 'not-started';
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

function normalizeTeams(rawTeam, namesMap) {
  const list = Array.isArray(rawTeam) ? rawTeam : [];
  const usedKeys = new Set();
  const normalized = [];

  list.forEach((name) => {
    const key = normalizeNameKey(name);
    if (!key || usedKeys.has(key) || !namesMap.has(key)) {
      return;
    }
    usedKeys.add(key);
    normalized.push(namesMap.get(key));
  });

  return normalized;
}

function normalizeGoalsByName(rawGoals, namesMap) {
  const source = rawGoals && typeof rawGoals === 'object' ? rawGoals : {};
  const normalized = {};

  Object.entries(source).forEach(([key, value]) => {
    const normalizedKey = normalizeNameKey(key);
    if (!normalizedKey || !namesMap.has(normalizedKey)) {
      return;
    }

    const current = Number(value || 0);
    normalized[normalizedKey] = Math.max(0, current);
  });

  return normalized;
}

function normalizeAssistsByName(rawAssists, namesMap) {
  const source = rawAssists && typeof rawAssists === 'object' ? rawAssists : {};
  const normalized = {};

  Object.entries(source).forEach(([key, value]) => {
    const normalizedKey = normalizeNameKey(key);
    if (!normalizedKey || !namesMap.has(normalizedKey)) {
      return;
    }

    const current = Number(value || 0);
    normalized[normalizedKey] = Math.max(0, current);
  });

  return normalized;
}

function normalizeMetricByName(rawMetric, namesMap) {
  const source = rawMetric && typeof rawMetric === 'object' ? rawMetric : {};
  const normalized = {};

  Object.entries(source).forEach(([key, value]) => {
    const normalizedKey = normalizeNameKey(key);
    if (!normalizedKey || !namesMap.has(normalizedKey)) {
      return;
    }

    const current = Number(value || 0);
    normalized[normalizedKey] = current > 0 ? 1 : 0;
  });

  return normalized;
}

function normalizeStatsByTeam(rawStatsByTeam, namesMap) {
  const source = rawStatsByTeam && typeof rawStatsByTeam === 'object' ? rawStatsByTeam : {};
  const normalized = { A: {}, B: {} };

  ['A', 'B'].forEach((team) => {
    const teamStats = source[team] && typeof source[team] === 'object' ? source[team] : {};
    Object.entries(teamStats).forEach(([key, value]) => {
      const normalizedKey = normalizeNameKey(key);
      if (!normalizedKey || !namesMap.has(normalizedKey)) {
        return;
      }

      const current = Number(value || 0);
      normalized[team][normalizedKey] = Math.max(0, current);
    });
  });

  return normalized;
}

function buildStatsByTeamFromMembership(namesMap, teamA, teamB, statsByName) {
  const fallback = { A: {}, B: {} };
  const byName = statsByName && typeof statsByName === 'object' ? statsByName : {};

  const pushTeamStats = (teamKey, teamNames) => {
    const team = Array.isArray(teamNames) ? teamNames : [];
    team.forEach((name) => {
      const key = normalizeNameKey(name);
      if (!key || !namesMap.has(key)) {
        return;
      }

      fallback[teamKey][key] = Number(byName[key] || 0);
    });
  };

  pushTeamStats('A', teamA);
  pushTeamStats('B', teamB);
  return fallback;
}

function calculateTeamScore(statsByTeam, teamKey) {
  const source = statsByTeam && typeof statsByTeam === 'object' ? statsByTeam : {};
  const teamStats = source[teamKey] && typeof source[teamKey] === 'object' ? source[teamKey] : {};

  return Object.values(teamStats).reduce((total, value) => total + Number(value || 0), 0);
}

async function incrementAthleteMetric(db, req, athleteName, field, delta, nowIso) {
  if (!athleteName || !field || !delta) {
    return;
  }

  const athletesCollection = db.collection(getAthletesCollectionName(req));
  const snapshot = await athletesCollection.get();
  const targetKey = normalizeNameKey(athleteName);
  let targetDoc = null;

  snapshot.docs.forEach((doc) => {
    if (targetDoc) {
      return;
    }
    const data = doc.data() || {};
    const key = normalizeNameKey(data.name);
    if (key === targetKey) {
      targetDoc = { id: doc.id, data };
    }
  });

  if (!targetDoc) {
    const created = await athletesCollection.add({
      name: athleteName,
      goals: field === 'goals' ? Math.max(0, delta) : 0,
      assists: field === 'assists' ? Math.max(0, delta) : 0,
      games: 0,
      mvp: field === 'mvp' ? Math.max(0, delta) : 0,
      worst: field === 'worst' ? Math.max(0, delta) : 0,
      createdAt: nowIso,
      updatedAt: nowIso
    });

    return created.id;
  }

  const currentValue = Number(targetDoc.data[field] || 0);
  const nextValue = Math.max(0, currentValue + delta);
  await athletesCollection.doc(targetDoc.id).set(
    {
      [field]: nextValue,
      updatedAt: nowIso
    },
    { merge: true }
  );

  return targetDoc.id;
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
        const names = Array.isArray(data.names) ? data.names : [];
        const namesMap = mapNamesByKey(names);
        const teamA = normalizeTeams(data.teamA, namesMap);
        const teamB = normalizeTeams(data.teamB, namesMap);
        const goalsByName = normalizeGoalsByName(data.goalsByName, namesMap);
        const assistsByName = normalizeAssistsByName(data.assistsByName, namesMap);
        let goalsByTeamName = normalizeStatsByTeam(data.goalsByTeamName, namesMap);
        let assistsByTeamName = normalizeStatsByTeam(data.assistsByTeamName, namesMap);
        if (!Object.keys(goalsByTeamName.A).length && !Object.keys(goalsByTeamName.B).length) {
          goalsByTeamName = buildStatsByTeamFromMembership(namesMap, teamA, teamB, goalsByName);
        }
        if (!Object.keys(assistsByTeamName.A).length && !Object.keys(assistsByTeamName.B).length) {
          assistsByTeamName = buildStatsByTeamFromMembership(namesMap, teamA, teamB, assistsByName);
        }
        const mvpByName = normalizeMetricByName(data.mvpByName, namesMap);
        const worstByName = normalizeMetricByName(data.worstByName, namesMap);
        sendJson(res, 200, {
          records: [
            {
              date: dateRaw,
              names,
              count: names.length,
              matchStatus: normalizeMatchStatus(data.matchStatus),
              teamA,
              teamB,
              scoreA: calculateTeamScore(goalsByTeamName, 'A'),
              scoreB: calculateTeamScore(goalsByTeamName, 'B'),
              goalsByName,
              assistsByName,
              goalsByTeamName,
              assistsByTeamName,
              mvpByName,
              worstByName,
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
        const namesMap = mapNamesByKey(names);
        const teamA = normalizeTeams(data.teamA, namesMap);
        const teamB = normalizeTeams(data.teamB, namesMap);
        const goalsByName = normalizeGoalsByName(data.goalsByName, namesMap);
        const assistsByName = normalizeAssistsByName(data.assistsByName, namesMap);
        let goalsByTeamName = normalizeStatsByTeam(data.goalsByTeamName, namesMap);
        let assistsByTeamName = normalizeStatsByTeam(data.assistsByTeamName, namesMap);
        if (!Object.keys(goalsByTeamName.A).length && !Object.keys(goalsByTeamName.B).length) {
          goalsByTeamName = buildStatsByTeamFromMembership(namesMap, teamA, teamB, goalsByName);
        }
        if (!Object.keys(assistsByTeamName.A).length && !Object.keys(assistsByTeamName.B).length) {
          assistsByTeamName = buildStatsByTeamFromMembership(namesMap, teamA, teamB, assistsByName);
        }
        const mvpByName = normalizeMetricByName(data.mvpByName, namesMap);
        const worstByName = normalizeMetricByName(data.worstByName, namesMap);
        return {
          date: data.date || doc.id,
          names,
          count: names.length,
          matchStatus: normalizeMatchStatus(data.matchStatus),
          teamA,
          teamB,
          scoreA: calculateTeamScore(goalsByTeamName, 'A'),
          scoreB: calculateTeamScore(goalsByTeamName, 'B'),
          goalsByName,
          assistsByName,
          goalsByTeamName,
          assistsByTeamName,
          mvpByName,
          worstByName,
          updatedAt: data.updatedAt || null
        };
      });

      sendJson(res, 200, { records });
      return;
    }

    if (req.method === 'POST') {
      if (!requireAuth(req, res)) {
        return;
      }

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
      const namesMap = mapNamesByKey(names);
      const currentData = current.exists ? current.data() || {} : {};
      const teamA = normalizeTeams(currentData.teamA, namesMap);
      const teamB = normalizeTeams(currentData.teamB, namesMap);
      const goalsByName = normalizeGoalsByName(currentData.goalsByName, namesMap);
      const assistsByName = normalizeAssistsByName(currentData.assistsByName, namesMap);
      let goalsByTeamName = normalizeStatsByTeam(currentData.goalsByTeamName, namesMap);
      let assistsByTeamName = normalizeStatsByTeam(currentData.assistsByTeamName, namesMap);
      if (!Object.keys(goalsByTeamName.A).length && !Object.keys(goalsByTeamName.B).length) {
        goalsByTeamName = buildStatsByTeamFromMembership(namesMap, teamA, teamB, goalsByName);
      }
      if (!Object.keys(assistsByTeamName.A).length && !Object.keys(assistsByTeamName.B).length) {
        assistsByTeamName = buildStatsByTeamFromMembership(namesMap, teamA, teamB, assistsByName);
      }
      const mvpByName = normalizeMetricByName(currentData.mvpByName, namesMap);
      const worstByName = normalizeMetricByName(currentData.worstByName, namesMap);
      const matchStatus = normalizeMatchStatus(currentData.matchStatus);
      const scoreA = calculateTeamScore(goalsByTeamName, 'A');
      const scoreB = calculateTeamScore(goalsByTeamName, 'B');

      await syncAthletesGames(db, req, previousNames, names, now);

      await docRef.set(
        {
          date,
          names,
          teamA,
          teamB,
          goalsByName,
          assistsByName,
          goalsByTeamName,
          assistsByTeamName,
          mvpByName,
          worstByName,
          matchStatus,
          scoreA,
          scoreB,
          createdAt: current.exists ? current.data().createdAt || now : now,
          updatedAt: now
        },
        { merge: true }
      );

      sendJson(res, 200, { ok: true, date, count: names.length });
      return;
    }

    if (req.method === 'PUT') {
      if (!requireAuth(req, res)) {
        return;
      }

      const body = await parseBody(req);
      const action = String(body.action || '').trim();
      const date = String(body.date || '').trim();
      const rawName = String(body.name || '').trim();
      const team = String(body.team || '').trim().toUpperCase();

      if (!isValidDate(date)) {
        sendJson(res, 400, { error: 'Data invalida. Use o formato YYYY-MM-DD.' });
        return;
      }

      const docRef = confirmadosCollection.doc(date);
      const current = await docRef.get();
      if (!current.exists) {
        sendJson(res, 404, { error: 'Partida nao encontrada para a data informada.' });
        return;
      }

      const data = current.data() || {};
      const names = normalizeNames(data.names);
      const namesMap = mapNamesByKey(names);
      const nameKey = normalizeNameKey(rawName);
      const canonicalName = namesMap.get(nameKey);
      const actionsWithoutName = new Set(['clear-mvp', 'clear-worst']);

      if (!canonicalName && !actionsWithoutName.has(action)) {
        sendJson(res, 400, { error: 'Atleta nao encontrado na lista de confirmados da data.' });
        return;
      }

      const now = new Date().toISOString();
      const teamA = normalizeTeams(data.teamA, namesMap);
      const teamB = normalizeTeams(data.teamB, namesMap);
      const goalsByName = normalizeGoalsByName(data.goalsByName, namesMap);
      const assistsByName = normalizeAssistsByName(data.assistsByName, namesMap);
      let goalsByTeamName = normalizeStatsByTeam(data.goalsByTeamName, namesMap);
      let assistsByTeamName = normalizeStatsByTeam(data.assistsByTeamName, namesMap);
      if (!Object.keys(goalsByTeamName.A).length && !Object.keys(goalsByTeamName.B).length) {
        goalsByTeamName = buildStatsByTeamFromMembership(namesMap, teamA, teamB, goalsByName);
      }
      if (!Object.keys(assistsByTeamName.A).length && !Object.keys(assistsByTeamName.B).length) {
        assistsByTeamName = buildStatsByTeamFromMembership(namesMap, teamA, teamB, assistsByName);
      }
      const mvpByName = normalizeMetricByName(data.mvpByName, namesMap);
      const worstByName = normalizeMetricByName(data.worstByName, namesMap);
      let matchStatus = normalizeMatchStatus(data.matchStatus);
      let scoreA = calculateTeamScore(goalsByTeamName, 'A');
      let scoreB = calculateTeamScore(goalsByTeamName, 'B');

      if (action === 'set-match-status' || action === 'toggle-match-status') {
        const nextStatus = action === 'toggle-match-status'
          ? (matchStatus === 'started' ? 'not-started' : 'started')
          : normalizeMatchStatus(body.status);

        matchStatus = nextStatus;

        await docRef.set(
          {
            matchStatus,
            updatedAt: now
          },
          { merge: true }
        );

        sendJson(res, 200, {
          ok: true,
          date,
          matchStatus
        });
        return;
      }

      if (action === 'set-team' || action === 'toggle-team') {
        if (team !== 'A' && team !== 'B') {
          sendJson(res, 400, { error: 'Time invalido. Use A ou B.' });
          return;
        }

        const key = normalizeNameKey(canonicalName);
        const inTeamA = teamA.some((name) => normalizeNameKey(name) === key);
        const inTeamB = teamB.some((name) => normalizeNameKey(name) === key);
        let nextTeamA = teamA;
        let nextTeamB = teamB;

        if (action === 'set-team') {
          nextTeamA = teamA.filter((name) => normalizeNameKey(name) !== key);
          nextTeamB = teamB.filter((name) => normalizeNameKey(name) !== key);

          if (team === 'A') {
            nextTeamA.push(canonicalName);
          }

          if (team === 'B') {
            nextTeamB.push(canonicalName);
          }
        } else if (team === 'A') {
          nextTeamA = inTeamA
            ? teamA.filter((name) => normalizeNameKey(name) !== key)
            : [...teamA, canonicalName];
        } else if (team === 'B') {
          nextTeamB = inTeamB
            ? teamB.filter((name) => normalizeNameKey(name) !== key)
            : [...teamB, canonicalName];
        }

        scoreA = calculateTeamScore(goalsByTeamName, 'A');
        scoreB = calculateTeamScore(goalsByTeamName, 'B');

        await docRef.set(
          {
            teamA: nextTeamA,
            teamB: nextTeamB,
            goalsByTeamName,
            assistsByTeamName,
            scoreA,
            scoreB,
            updatedAt: now
          },
          { merge: true }
        );

        sendJson(res, 200, {
          ok: true,
          date,
          teamA: nextTeamA,
          teamB: nextTeamB,
          scoreA,
          scoreB
        });
        return;
      }

      if (action === 'add-goal') {
        const key = normalizeNameKey(canonicalName);
        const targetTeam = String(body.team || '').trim().toUpperCase();
        const inTeamA = teamA.some((name) => normalizeNameKey(name) === key);
        const inTeamB = teamB.some((name) => normalizeNameKey(name) === key);

        if (!inTeamA && !inTeamB) {
          sendJson(res, 400, { error: 'Defina o time do atleta antes de registrar gol.' });
          return;
        }

        let scoringTeam = '';
        if (targetTeam === 'A' || targetTeam === 'B') {
          if ((targetTeam === 'A' && !inTeamA) || (targetTeam === 'B' && !inTeamB)) {
            sendJson(res, 400, { error: 'Atleta nao pertence ao time informado para registrar gol.' });
            return;
          }
          scoringTeam = targetTeam;
        } else if (inTeamA && !inTeamB) {
          scoringTeam = 'A';
        } else if (inTeamB && !inTeamA) {
          scoringTeam = 'B';
        } else {
          sendJson(res, 400, { error: 'Atleta esta nos dois times. Informe o time do gol.' });
          return;
        }

        goalsByName[key] = Number(goalsByName[key] || 0) + 1;
        goalsByTeamName[scoringTeam][key] = Number(goalsByTeamName[scoringTeam][key] || 0) + 1;
        scoreA = calculateTeamScore(goalsByTeamName, 'A');
        scoreB = calculateTeamScore(goalsByTeamName, 'B');

        await docRef.set(
          {
            goalsByName,
            goalsByTeamName,
            scoreA,
            scoreB,
            updatedAt: now
          },
          { merge: true }
        );

        await incrementAthleteMetric(db, req, canonicalName, 'goals', 1, now);

        sendJson(res, 200, {
          ok: true,
          date,
          name: canonicalName,
          goals: goalsByName[key],
          scoreA,
          scoreB,
          goalsByName,
          goalsByTeamName
        });
        return;
      }

      if (action === 'remove-goal') {
        const key = normalizeNameKey(canonicalName);
        const targetTeam = String(body.team || '').trim().toUpperCase();
        const inTeamA = teamA.some((name) => normalizeNameKey(name) === key);
        const inTeamB = teamB.some((name) => normalizeNameKey(name) === key);

        if (!inTeamA && !inTeamB) {
          sendJson(res, 400, { error: 'Defina o time do atleta antes de desfazer gol.' });
          return;
        }

        let scoringTeam = '';
        if (targetTeam === 'A' || targetTeam === 'B') {
          if ((targetTeam === 'A' && !inTeamA) || (targetTeam === 'B' && !inTeamB)) {
            sendJson(res, 400, { error: 'Atleta nao pertence ao time informado para desfazer gol.' });
            return;
          }
          scoringTeam = targetTeam;
        } else if (inTeamA && !inTeamB) {
          scoringTeam = 'A';
        } else if (inTeamB && !inTeamA) {
          scoringTeam = 'B';
        } else {
          sendJson(res, 400, { error: 'Atleta esta nos dois times. Informe o time do gol para desfazer.' });
          return;
        }

        const currentGoals = Number(goalsByName[key] || 0);
        if (currentGoals <= 0) {
          sendJson(res, 400, { error: 'Nao ha gol registrado para desfazer.' });
          return;
        }

        const teamGoalCount = Number(goalsByTeamName[scoringTeam][key] || 0);
        if (teamGoalCount <= 0) {
          sendJson(res, 400, { error: 'Nao ha gol registrado nesse time para desfazer.' });
          return;
        }

        goalsByName[key] = currentGoals - 1;
        goalsByTeamName[scoringTeam][key] = teamGoalCount - 1;
        scoreA = calculateTeamScore(goalsByTeamName, 'A');
        scoreB = calculateTeamScore(goalsByTeamName, 'B');

        await docRef.set(
          {
            goalsByName,
            goalsByTeamName,
            scoreA,
            scoreB,
            updatedAt: now
          },
          { merge: true }
        );

        await incrementAthleteMetric(db, req, canonicalName, 'goals', -1, now);

        sendJson(res, 200, {
          ok: true,
          date,
          name: canonicalName,
          goals: goalsByName[key],
          scoreA,
          scoreB,
          goalsByName,
          goalsByTeamName
        });
        return;
      }

      if (action === 'add-assist') {
        const key = normalizeNameKey(canonicalName);
        const targetTeam = String(body.team || '').trim().toUpperCase();
        const inTeamA = teamA.some((name) => normalizeNameKey(name) === key);
        const inTeamB = teamB.some((name) => normalizeNameKey(name) === key);

        if (!inTeamA && !inTeamB) {
          sendJson(res, 400, { error: 'Defina o time do atleta antes de registrar assistencia.' });
          return;
        }

        let assistTeam = '';
        if (targetTeam === 'A' || targetTeam === 'B') {
          if ((targetTeam === 'A' && !inTeamA) || (targetTeam === 'B' && !inTeamB)) {
            sendJson(res, 400, { error: 'Atleta nao pertence ao time informado para registrar assistencia.' });
            return;
          }
          assistTeam = targetTeam;
        } else if (inTeamA && !inTeamB) {
          assistTeam = 'A';
        } else if (inTeamB && !inTeamA) {
          assistTeam = 'B';
        } else {
          sendJson(res, 400, { error: 'Atleta esta nos dois times. Informe o time da assistencia.' });
          return;
        }

        assistsByName[key] = Number(assistsByName[key] || 0) + 1;
        assistsByTeamName[assistTeam][key] = Number(assistsByTeamName[assistTeam][key] || 0) + 1;

        await docRef.set(
          {
            assistsByName,
            assistsByTeamName,
            updatedAt: now
          },
          { merge: true }
        );

        await incrementAthleteMetric(db, req, canonicalName, 'assists', 1, now);

        sendJson(res, 200, {
          ok: true,
          date,
          name: canonicalName,
          assists: assistsByName[key],
          assistsByName,
          assistsByTeamName
        });
        return;
      }

      if (action === 'remove-assist') {
        const key = normalizeNameKey(canonicalName);
        const targetTeam = String(body.team || '').trim().toUpperCase();
        const inTeamA = teamA.some((name) => normalizeNameKey(name) === key);
        const inTeamB = teamB.some((name) => normalizeNameKey(name) === key);

        if (!inTeamA && !inTeamB) {
          sendJson(res, 400, { error: 'Defina o time do atleta antes de desfazer assistencia.' });
          return;
        }

        let assistTeam = '';
        if (targetTeam === 'A' || targetTeam === 'B') {
          if ((targetTeam === 'A' && !inTeamA) || (targetTeam === 'B' && !inTeamB)) {
            sendJson(res, 400, { error: 'Atleta nao pertence ao time informado para desfazer assistencia.' });
            return;
          }
          assistTeam = targetTeam;
        } else if (inTeamA && !inTeamB) {
          assistTeam = 'A';
        } else if (inTeamB && !inTeamA) {
          assistTeam = 'B';
        } else {
          sendJson(res, 400, { error: 'Atleta esta nos dois times. Informe o time da assistencia para desfazer.' });
          return;
        }

        const currentAssists = Number(assistsByName[key] || 0);
        if (currentAssists <= 0) {
          sendJson(res, 400, { error: 'Nao ha assistencia registrada para desfazer.' });
          return;
        }

        const teamAssistCount = Number(assistsByTeamName[assistTeam][key] || 0);
        if (teamAssistCount <= 0) {
          sendJson(res, 400, { error: 'Nao ha assistencia registrada nesse time para desfazer.' });
          return;
        }

        assistsByName[key] = currentAssists - 1;
        assistsByTeamName[assistTeam][key] = teamAssistCount - 1;

        await docRef.set(
          {
            assistsByName,
            assistsByTeamName,
            updatedAt: now
          },
          { merge: true }
        );

        await incrementAthleteMetric(db, req, canonicalName, 'assists', -1, now);

        sendJson(res, 200, {
          ok: true,
          date,
          name: canonicalName,
          assists: assistsByName[key],
          assistsByName,
          assistsByTeamName
        });
        return;
      }

      if (action === 'toggle-mvp') {
        const key = normalizeNameKey(canonicalName);
        const currentMvp = Number(mvpByName[key] || 0) > 0 ? 1 : 0;
        const nextMvp = currentMvp ? 0 : 1;
        const delta = nextMvp - currentMvp;
        mvpByName[key] = nextMvp;

        await docRef.set(
          {
            mvpByName,
            updatedAt: now
          },
          { merge: true }
        );

        if (delta !== 0) {
          await incrementAthleteMetric(db, req, canonicalName, 'mvp', delta, now);
        }

        sendJson(res, 200, {
          ok: true,
          date,
          name: canonicalName,
          mvp: nextMvp,
          mvpByName
        });
        return;
      }

      if (action === 'set-mvp' || action === 'clear-mvp') {
        const selectedKey = action === 'set-mvp' ? normalizeNameKey(canonicalName) : '';
        const previousSelectedKeys = Object.entries(mvpByName)
          .filter(([, value]) => Number(value || 0) > 0)
          .map(([key]) => key);

        Object.keys(mvpByName).forEach((key) => {
          mvpByName[key] = 0;
        });

        if (selectedKey) {
          mvpByName[selectedKey] = 1;
        }

        await docRef.set(
          {
            mvpByName,
            updatedAt: now
          },
          { merge: true }
        );

        const previousSet = new Set(previousSelectedKeys);
        for (const prevKey of previousSelectedKeys) {
          if (prevKey !== selectedKey && namesMap.has(prevKey)) {
            await incrementAthleteMetric(db, req, namesMap.get(prevKey), 'mvp', -1, now);
          }
        }
        if (selectedKey && !previousSet.has(selectedKey) && namesMap.has(selectedKey)) {
          await incrementAthleteMetric(db, req, namesMap.get(selectedKey), 'mvp', 1, now);
        }

        sendJson(res, 200, {
          ok: true,
          date,
          name: selectedKey ? namesMap.get(selectedKey) : '',
          mvpByName
        });
        return;
      }

      if (action === 'toggle-worst') {
        const key = normalizeNameKey(canonicalName);
        const currentWorst = Number(worstByName[key] || 0) > 0 ? 1 : 0;
        const nextWorst = currentWorst ? 0 : 1;
        const delta = nextWorst - currentWorst;
        worstByName[key] = nextWorst;

        await docRef.set(
          {
            worstByName,
            updatedAt: now
          },
          { merge: true }
        );

        if (delta !== 0) {
          await incrementAthleteMetric(db, req, canonicalName, 'worst', delta, now);
        }

        sendJson(res, 200, {
          ok: true,
          date,
          name: canonicalName,
          worst: nextWorst,
          worstByName
        });
        return;
      }

      if (action === 'set-worst' || action === 'clear-worst') {
        const selectedKey = action === 'set-worst' ? normalizeNameKey(canonicalName) : '';
        const previousSelectedKeys = Object.entries(worstByName)
          .filter(([, value]) => Number(value || 0) > 0)
          .map(([key]) => key);

        Object.keys(worstByName).forEach((key) => {
          worstByName[key] = 0;
        });

        if (selectedKey) {
          worstByName[selectedKey] = 1;
        }

        await docRef.set(
          {
            worstByName,
            updatedAt: now
          },
          { merge: true }
        );

        const previousSet = new Set(previousSelectedKeys);
        for (const prevKey of previousSelectedKeys) {
          if (prevKey !== selectedKey && namesMap.has(prevKey)) {
            await incrementAthleteMetric(db, req, namesMap.get(prevKey), 'worst', -1, now);
          }
        }
        if (selectedKey && !previousSet.has(selectedKey) && namesMap.has(selectedKey)) {
          await incrementAthleteMetric(db, req, namesMap.get(selectedKey), 'worst', 1, now);
        }

        sendJson(res, 200, {
          ok: true,
          date,
          name: selectedKey ? namesMap.get(selectedKey) : '',
          worstByName
        });
        return;
      }

      sendJson(res, 400, { error: 'Acao invalida para atualizacao.' });
      return;
    }

    if (req.method === 'DELETE') {
      if (!requireAuth(req, res)) {
        return;
      }

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
