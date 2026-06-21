const { getDb } = require('./_lib/firebase');
const { handleOptions, parseBody, sendJson } = require('./_lib/http');
const { requireAuth } = require('./_lib/auth');
const { getAthletesCollectionName, getConfirmadosCollectionName } = require('./_lib/group');
const { sanitizeAthleteName, normalizeNameKey } = require('./_lib/names');
const cache = require('./_lib/cache');

function isValidDate(dateText) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateText);
}

function normalizeMatchStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'started' || normalized === 'finished') {
    return normalized;
  }

  return 'not-started';
}

function normalizeMatchTimer(rawTimer, matchStatus, fallbackIso) {
  const source = rawTimer && typeof rawTimer === 'object' ? rawTimer : {};
  const normalizedStatus = String(source.status || '').trim().toLowerCase();
  const elapsedSeconds = Math.max(0, Math.floor(Number(source.elapsedSeconds || 0)));
  const startedAtCandidate = String(source.startedAt || '').trim();
  const startedAt = startedAtCandidate && !Number.isNaN(Date.parse(startedAtCandidate))
    ? startedAtCandidate
    : '';
  const defaultStartedAt = startedAt || String(fallbackIso || '').trim();

  if (matchStatus === 'started') {
    if (normalizedStatus === 'paused') {
      return {
        status: 'paused',
        elapsedSeconds,
        startedAt: ''
      };
    }

    return {
      status: 'running',
      elapsedSeconds,
      startedAt: defaultStartedAt || new Date().toISOString()
    };
  }

  return {
    status: 'paused',
    elapsedSeconds,
    startedAt: ''
  };
}

function getMatchTimerElapsedSeconds(timer, nowIso) {
  const source = timer && typeof timer === 'object' ? timer : {};
  const elapsedSeconds = Math.max(0, Math.floor(Number(source.elapsedSeconds || 0)));
  const status = String(source.status || '').trim().toLowerCase();
  const startedAt = String(source.startedAt || '').trim();

  if (status !== 'running' || !startedAt) {
    return elapsedSeconds;
  }

  const startedAtMs = Date.parse(startedAt);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(startedAtMs) || Number.isNaN(nowMs)) {
    return elapsedSeconds;
  }

  return elapsedSeconds + Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
}

function pauseMatchTimer(timer, nowIso) {
  return {
    status: 'paused',
    elapsedSeconds: getMatchTimerElapsedSeconds(timer, nowIso),
    startedAt: ''
  };
}

function resumeMatchTimer(timer, nowIso) {
  return {
    status: 'running',
    elapsedSeconds: getMatchTimerElapsedSeconds(timer, nowIso),
    startedAt: nowIso
  };
}

function normalizeTeamName(value, fallback) {
  const normalized = String(value || '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 40);

  return normalized || fallback;
}

function normalizeNames(rawNames) {
  const lines = Array.isArray(rawNames) ? rawNames : [];

  const names = lines
    .map((line) => {
      const text = String(line || '');
      // Aceita: 1- geo, 1 - geo, 1. geo, 1: geo, 1) geo, 1, geo, etc
      const match = text.match(/^\s*\d+\s*[-–—.:,;)]\s*(.+)$/u);
      const candidate = match ? match[1] : text;

      return sanitizeAthleteName(candidate
        .replace(/\(\s*avulso\s*\)/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim());
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

function normalizeRoster(rawRoster, namesMap) {
  if (!Array.isArray(rawRoster)) {
    return [];
  }

  return normalizeTeams(rawRoster, namesMap);
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

function normalizeEvents(rawEvents, namesMap) {
  const source = Array.isArray(rawEvents) ? rawEvents : [];
  const normalized = [];

  source.forEach((event, index) => {
    if (!event || typeof event !== 'object') {
      return;
    }

    const playerName = String(event.playerName || event.name || event.scorer || '').trim();
    const playerKey = normalizeNameKey(playerName);
    const scoringTeam = String(event.scoringTeam || '').trim().toUpperCase();
    const playerTeam = String(event.playerTeam || '').trim().toUpperCase();
    const assistName = String(event.assistName || event.assist || '').trim();
    const assistKey = normalizeNameKey(assistName);

    if (!playerKey || !namesMap.has(playerKey) || (scoringTeam !== 'A' && scoringTeam !== 'B')) {
      return;
    }

    normalized.push({
      id: String(event.id || `${playerKey}-${scoringTeam}-${assistKey || 'na'}-${String(event.createdAt || index)}`),
      type: 'goal',
      playerName: namesMap.get(playerKey),
      playerKey,
      playerTeam: playerTeam === 'A' || playerTeam === 'B' ? playerTeam : '',
      scoringTeam,
      assistName: assistKey && namesMap.has(assistKey) ? namesMap.get(assistKey) : '',
      assistKey: assistKey && namesMap.has(assistKey) ? assistKey : '',
      matchElapsedSeconds: Math.max(0, Math.floor(Number(event.matchElapsedSeconds || event.elapsedSeconds || 0))),
      ownGoal: Boolean(event.ownGoal),
      createdAt: String(event.createdAt || event.updatedAt || '')
    });
  });

  return normalized;
}

function calculateTeamScoreFromEvents(events, teamKey, fallbackStatsByTeam) {
  const sourceEvents = Array.isArray(events) ? events : [];
  if (sourceEvents.length) {
    return sourceEvents.reduce((total, event) => total + (event && event.scoringTeam === teamKey ? 1 : 0), 0);
  }

  return calculateTeamScore(fallbackStatsByTeam, teamKey);
}

function buildGoalStatsFromEvents(namesMap, events) {
  const statsByName = {};
  const statsByTeam = { A: {}, B: {} };

  (Array.isArray(events) ? events : []).forEach((event) => {
    if (!event || event.ownGoal || event.type !== 'goal') {
      return;
    }

    const playerKey = normalizeNameKey(event.playerName);
    if (!playerKey || !namesMap.has(playerKey)) {
      return;
    }

    const scoringTeam = event.scoringTeam === 'A' || event.scoringTeam === 'B' ? event.scoringTeam : '';
    if (!scoringTeam) {
      return;
    }

    statsByName[playerKey] = Number(statsByName[playerKey] || 0) + 1;
    statsByTeam[scoringTeam][playerKey] = Number(statsByTeam[scoringTeam][playerKey] || 0) + 1;
  });

  return { statsByName, statsByTeam };
}

function buildAssistStatsFromEvents(namesMap, events) {
  const statsByName = {};
  const statsByTeam = { A: {}, B: {} };

  (Array.isArray(events) ? events : []).forEach((event) => {
    if (!event || event.ownGoal || event.type !== 'goal' || !event.assistName) {
      return;
    }

    const assistKey = normalizeNameKey(event.assistName);
    if (!assistKey || !namesMap.has(assistKey)) {
      return;
    }

    const assistTeam = event.playerTeam === 'A' || event.playerTeam === 'B' ? event.playerTeam : event.scoringTeam;
    if (assistTeam !== 'A' && assistTeam !== 'B') {
      return;
    }

    statsByName[assistKey] = Number(statsByName[assistKey] || 0) + 1;
    statsByTeam[assistTeam][assistKey] = Number(statsByTeam[assistTeam][assistKey] || 0) + 1;
  });

  return { statsByName, statsByTeam };
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

  const collectionName = getAthletesCollectionName(req);
  const athletesCollection = db.collection(collectionName);
  let athletes = cache.getAthletes(collectionName);

  if (!athletes) {
    const snapshot = await athletesCollection.orderBy('name', 'asc').get();
    athletes = cache.setAthletes(
      collectionName,
      snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }))
    );
  }

  const targetKey = normalizeNameKey(athleteName);
  const targetDoc = athletes.find((athlete) => normalizeNameKey((athlete || {}).name) === targetKey) || null;

  if (!targetDoc) {
    const created = await athletesCollection.add({
      name: athleteName,
      goals: field === 'goals' ? Math.max(0, delta) : 0,
      assists: field === 'assists' ? Math.max(0, delta) : 0,
      games: 0,
      mvp: field === 'mvp' ? Math.max(0, delta) : 0,
      worst: field === 'worst' ? Math.max(0, delta) : 0,
      defender: field === 'defender' ? Math.max(0, delta) : 0,
      createdAt: nowIso,
      updatedAt: nowIso
    });

    cache.upsertAthlete(collectionName, {
      id: created.id,
      name: athleteName,
      goals: field === 'goals' ? Math.max(0, delta) : 0,
      assists: field === 'assists' ? Math.max(0, delta) : 0,
      games: 0,
      mvp: field === 'mvp' ? Math.max(0, delta) : 0,
      worst: field === 'worst' ? Math.max(0, delta) : 0,
      defender: field === 'defender' ? Math.max(0, delta) : 0,
      createdAt: nowIso,
      updatedAt: nowIso
    });

    return created.id;
  }

  const currentValue = Number(targetDoc[field] || 0);
  const nextValue = Math.max(0, currentValue + delta);
  await athletesCollection.doc(targetDoc.id).set(
    {
      [field]: nextValue,
      updatedAt: nowIso
    },
    { merge: true }
  );

  cache.upsertAthlete(collectionName, {
    ...targetDoc,
    [field]: nextValue,
    updatedAt: nowIso
  });

  return targetDoc.id;
}

async function applySingleChoiceMetricSelection(db, req, metricByName, selectedName, namesMap, field, nowIso) {
  const nextMetricByName = { ...metricByName };
  const selectedKey = selectedName ? normalizeNameKey(selectedName) : '';
  const previousSelectedKeys = Object.entries(nextMetricByName)
    .filter(([, value]) => Number(value || 0) > 0)
    .map(([key]) => key);

  Object.keys(nextMetricByName).forEach((key) => {
    nextMetricByName[key] = 0;
  });

  if (selectedKey && namesMap.has(selectedKey)) {
    nextMetricByName[selectedKey] = 1;
  }

  const previousSet = new Set(previousSelectedKeys);
  for (const prevKey of previousSelectedKeys) {
    if (prevKey !== selectedKey && namesMap.has(prevKey)) {
      await incrementAthleteMetric(db, req, namesMap.get(prevKey), field, -1, nowIso);
    }
  }

  if (selectedKey && !previousSet.has(selectedKey) && namesMap.has(selectedKey)) {
    await incrementAthleteMetric(db, req, namesMap.get(selectedKey), field, 1, nowIso);
  }

  return nextMetricByName;
}

async function syncAthletesGames(db, req, previousNames, nextNames, nowIso) {
  const collectionName = getAthletesCollectionName(req);
  const athletesCollection = db.collection(collectionName);
  let athletes = cache.getAthletes(collectionName);

  if (!athletes) {
    const athletesSnapshot = await athletesCollection.orderBy('name', 'asc').get();
    athletes = cache.setAthletes(
      collectionName,
      athletesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }))
    );
  }

  const athleteByKey = new Map();
  athletes.forEach((athlete) => {
    const data = athlete || {};
    const key = normalizeNameKey(data.name);
    if (!key || athleteByKey.has(key)) {
      return;
    }
    athleteByKey.set(key, {
      ref: athletesCollection.doc(data.id),
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
      cache.upsertAthlete(collectionName, {
        ...existing.data,
        games: currentGames + 1,
        updatedAt: nowIso
      });
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
      defender: 0,
      createdAt: nowIso,
      updatedAt: nowIso
    });

    cache.upsertAthlete(collectionName, {
      id: created.id,
      name: displayName,
      goals: 0,
      assists: 0,
      games: 1,
      mvp: 0,
      worst: 0,
      defender: 0,
      createdAt: nowIso,
      updatedAt: nowIso
    });

    athleteByKey.set(key, {
      ref: athletesCollection.doc(created.id),
      data: {
        id: created.id,
        name: displayName,
        goals: 0,
        assists: 0,
        games: 1,
        mvp: 0,
        worst: 0,
        defender: 0
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
    cache.upsertAthlete(collectionName, {
      ...existing.data,
      games: Math.max(0, currentGames - 1),
      updatedAt: nowIso
    });
  }
}

async function resetMatchMetrics(db, req, namesMap, events, mvpByName, worstByName, defenderByName, nowIso) {
  const goalDeltasByKey = new Map();
  const assistDeltasByKey = new Map();

  (Array.isArray(events) ? events : []).forEach((event) => {
    if (!event || event.type !== 'goal' || event.ownGoal) {
      return;
    }

    const playerKey = normalizeNameKey(event.playerName);
    if (playerKey && namesMap.has(playerKey)) {
      goalDeltasByKey.set(playerKey, Number(goalDeltasByKey.get(playerKey) || 0) - 1);
    }

    const assistKey = normalizeNameKey(event.assistName);
    if (assistKey && namesMap.has(assistKey)) {
      assistDeltasByKey.set(assistKey, Number(assistDeltasByKey.get(assistKey) || 0) - 1);
    }
  });

  for (const [key, delta] of goalDeltasByKey.entries()) {
    await incrementAthleteMetric(db, req, namesMap.get(key), 'goals', delta, nowIso);
  }

  for (const [key, delta] of assistDeltasByKey.entries()) {
    await incrementAthleteMetric(db, req, namesMap.get(key), 'assists', delta, nowIso);
  }

  const selectedMvpKeys = Object.entries(mvpByName && typeof mvpByName === 'object' ? mvpByName : {})
    .filter(([, value]) => Number(value || 0) > 0)
    .map(([key]) => key)
    .filter((key) => namesMap.has(key));

  const selectedWorstKeys = Object.entries(worstByName && typeof worstByName === 'object' ? worstByName : {})
    .filter(([, value]) => Number(value || 0) > 0)
    .map(([key]) => key)
    .filter((key) => namesMap.has(key));

  const selectedDefenderKeys = Object.entries(defenderByName && typeof defenderByName === 'object' ? defenderByName : {})
    .filter(([, value]) => Number(value || 0) > 0)
    .map(([key]) => key)
    .filter((key) => namesMap.has(key));

  for (const key of selectedMvpKeys) {
    await incrementAthleteMetric(db, req, namesMap.get(key), 'mvp', -1, nowIso);
  }

  for (const key of selectedWorstKeys) {
    await incrementAthleteMetric(db, req, namesMap.get(key), 'worst', -1, nowIso);
  }

  for (const key of selectedDefenderKeys) {
    await incrementAthleteMetric(db, req, namesMap.get(key), 'defender', -1, nowIso);
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
      const now = new Date().toISOString();
      const dateRaw = String((req.query && req.query.date) || '').trim();
      const serverNow = now;

      if (dateRaw) {
        if (!isValidDate(dateRaw)) {
          sendJson(res, 400, { error: 'Data invalida. Use o formato YYYY-MM-DD.' });
          return;
        }

        const doc = await confirmadosCollection.doc(dateRaw).get();
        if (!doc.exists) {
          sendJson(res, 200, { serverNow, records: [] });
          return;
        }

        const data = doc.data() || {};
        const names = Array.isArray(data.names) ? data.names : [];
        const namesMap = mapNamesByKey(names);
        const teamA = normalizeTeams(data.teamA, namesMap);
        const teamB = normalizeTeams(data.teamB, namesMap);
        const events = normalizeEvents(data.events, namesMap);
        const eventGoalStats = buildGoalStatsFromEvents(namesMap, events);
        const eventAssistStats = buildAssistStatsFromEvents(namesMap, events);
        const goalsByName = events.length ? eventGoalStats.statsByName : normalizeGoalsByName(data.goalsByName, namesMap);
        const assistsByName = events.length ? eventAssistStats.statsByName : normalizeAssistsByName(data.assistsByName, namesMap);
        let goalsByTeamName = events.length ? eventGoalStats.statsByTeam : normalizeStatsByTeam(data.goalsByTeamName, namesMap);
        let assistsByTeamName = events.length ? eventAssistStats.statsByTeam : normalizeStatsByTeam(data.assistsByTeamName, namesMap);
        if (!events.length && !Object.keys(goalsByTeamName.A).length && !Object.keys(goalsByTeamName.B).length) {
          goalsByTeamName = buildStatsByTeamFromMembership(namesMap, teamA, teamB, goalsByName);
        }
        if (!events.length && !Object.keys(assistsByTeamName.A).length && !Object.keys(assistsByTeamName.B).length) {
          assistsByTeamName = buildStatsByTeamFromMembership(namesMap, teamA, teamB, assistsByName);
        }
        const mvpByName = normalizeMetricByName(data.mvpByName, namesMap);
        const worstByName = normalizeMetricByName(data.worstByName, namesMap);
        const defenderByName = normalizeMetricByName(data.defenderByName, namesMap);
        const matchTimer = normalizeMatchTimer(data.matchTimer, normalizeMatchStatus(data.matchStatus), data.updatedAt || data.createdAt || new Date().toISOString());
        const scoreA = calculateTeamScoreFromEvents(events, 'A', goalsByTeamName);
        const scoreB = calculateTeamScoreFromEvents(events, 'B', goalsByTeamName);
        sendJson(res, 200, {
          serverNow,
          records: [
            {
              date: dateRaw,
              names,
              count: names.length,
              matchStatus: normalizeMatchStatus(data.matchStatus),
              teamNameA: normalizeTeamName(data.teamNameA, 'Time A'),
              teamNameB: normalizeTeamName(data.teamNameB, 'Time B'),
              teamA,
              teamB,
              scoreA,
              scoreB,
              matchTimer,
              goalsByName,
              assistsByName,
              goalsByTeamName,
              assistsByTeamName,
              events,
              mvpByName,
              worstByName,
              defenderByName,
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
        const events = normalizeEvents(data.events, namesMap);
        const eventGoalStats = buildGoalStatsFromEvents(namesMap, events);
        const eventAssistStats = buildAssistStatsFromEvents(namesMap, events);
        const goalsByName = events.length ? eventGoalStats.statsByName : normalizeGoalsByName(data.goalsByName, namesMap);
        const assistsByName = events.length ? eventAssistStats.statsByName : normalizeAssistsByName(data.assistsByName, namesMap);
        let goalsByTeamName = events.length ? eventGoalStats.statsByTeam : normalizeStatsByTeam(data.goalsByTeamName, namesMap);
        let assistsByTeamName = events.length ? eventAssistStats.statsByTeam : normalizeStatsByTeam(data.assistsByTeamName, namesMap);
        if (!events.length && !Object.keys(goalsByTeamName.A).length && !Object.keys(goalsByTeamName.B).length) {
          goalsByTeamName = buildStatsByTeamFromMembership(namesMap, teamA, teamB, goalsByName);
        }
        if (!events.length && !Object.keys(assistsByTeamName.A).length && !Object.keys(assistsByTeamName.B).length) {
          assistsByTeamName = buildStatsByTeamFromMembership(namesMap, teamA, teamB, assistsByName);
        }
        const mvpByName = normalizeMetricByName(data.mvpByName, namesMap);
        const worstByName = normalizeMetricByName(data.worstByName, namesMap);
        const defenderByName = normalizeMetricByName(data.defenderByName, namesMap);
        const matchTimer = normalizeMatchTimer(data.matchTimer, normalizeMatchStatus(data.matchStatus), data.updatedAt || data.createdAt || now);
        const scoreA = calculateTeamScoreFromEvents(events, 'A', goalsByTeamName);
        const scoreB = calculateTeamScoreFromEvents(events, 'B', goalsByTeamName);
        return {
          date: data.date || doc.id,
          names,
          count: names.length,
          matchStatus: normalizeMatchStatus(data.matchStatus),
          teamNameA: normalizeTeamName(data.teamNameA, 'Time A'),
          teamNameB: normalizeTeamName(data.teamNameB, 'Time B'),
          teamA,
          teamB,
          scoreA,
          scoreB,
          matchTimer,
          goalsByName,
          assistsByName,
          goalsByTeamName,
          assistsByTeamName,
          events,
          mvpByName,
          worstByName,
          defenderByName,
          updatedAt: data.updatedAt || null
        };
      });

      sendJson(res, 200, { serverNow, records });
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
      const namesMap = mapNamesByKey(names);
      const currentData = current.exists ? current.data() || {} : {};
      const teamNameA = normalizeTeamName(currentData.teamNameA, 'Time A');
      const teamNameB = normalizeTeamName(currentData.teamNameB, 'Time B');
      const teamA = normalizeTeams(currentData.teamA, namesMap);
      const teamB = normalizeTeams(currentData.teamB, namesMap);
      const events = normalizeEvents(currentData.events, namesMap);
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
      const existingTimer = normalizeMatchTimer(currentData.matchTimer, matchStatus, currentData.updatedAt || currentData.createdAt || now);
      const matchTimer = existingTimer;
      const scoreA = calculateTeamScoreFromEvents(events, 'A', goalsByTeamName);
      const scoreB = calculateTeamScoreFromEvents(events, 'B', goalsByTeamName);

      await syncAthletesGames(db, req, previousNames, names, now);

      await docRef.set(
        {
          date,
          names,
          teamNameA,
          teamNameB,
          teamA,
          teamB,
          goalsByName,
          assistsByName,
          goalsByTeamName,
          assistsByTeamName,
          mvpByName,
          worstByName,
          matchStatus,
          matchTimer,
          events,
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
      const body = await parseBody(req);
      const action = String(body.action || '').trim();
      const date = String(body.date || '').trim();
      const rawName = String(body.name || '').trim();
      const team = String(body.team || '').trim().toUpperCase();

      if (action === 'reset-match' && !requireAuth(req, res)) {
        return;
      }

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
      const actionsWithoutName = new Set(['clear-mvp', 'clear-worst', 'clear-defender', 'set-match-status', 'toggle-match-status', 'start-match', 'finalize-match', 'pause-match-timer', 'resume-match-timer', 'reset-match']);

      if (!canonicalName && !actionsWithoutName.has(action)) {
        sendJson(res, 400, { error: 'Atleta nao encontrado na lista de confirmados da data.' });
        return;
      }

      const now = new Date().toISOString();
      const teamNameA = normalizeTeamName(data.teamNameA, 'Time A');
      const teamNameB = normalizeTeamName(data.teamNameB, 'Time B');
      const teamA = normalizeTeams(data.teamA, namesMap);
      const teamB = normalizeTeams(data.teamB, namesMap);
      const events = normalizeEvents(data.events, namesMap);
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
      const defenderByName = normalizeMetricByName(data.defenderByName, namesMap);
      let matchStatus = normalizeMatchStatus(data.matchStatus);
      let matchTimer = normalizeMatchTimer(data.matchTimer, matchStatus, data.updatedAt || data.createdAt || now);
      let scoreA = calculateTeamScoreFromEvents(events, 'A', goalsByTeamName);
      let scoreB = calculateTeamScoreFromEvents(events, 'B', goalsByTeamName);

      if (action === 'set-match-status' || action === 'toggle-match-status') {
        const nextStatus = action === 'toggle-match-status'
          ? (matchStatus === 'started' ? 'not-started' : 'started')
          : normalizeMatchStatus(body.status);

        matchStatus = nextStatus;

        const nextTimer = matchStatus === 'started'
          ? resumeMatchTimer(matchTimer, now)
          : pauseMatchTimer(matchTimer, now);

        await docRef.set(
          {
            matchStatus,
            matchTimer: nextTimer,
            updatedAt: now
          },
          { merge: true }
        );

        sendJson(res, 200, {
          ok: true,
          date,
          matchStatus,
          matchTimer: nextTimer
        });
        return;
      }

      if (action === 'start-match') {
        const nextTeamNameA = normalizeTeamName(body.teamNameA, 'Time A');
        const nextTeamNameB = normalizeTeamName(body.teamNameB, 'Time B');
        const nextTeamA = normalizeRoster(body.teamA, namesMap);
        const nextTeamB = normalizeRoster(body.teamB, namesMap);
        const teamAKeys = new Set(nextTeamA.map((name) => normalizeNameKey(name)));
        const hasOverlap = nextTeamB.some((name) => teamAKeys.has(normalizeNameKey(name)));
        const currentMatchAlreadyStarted = normalizeMatchStatus(data.matchStatus) === 'started';
        const startedMatchesSnapshot = await confirmadosCollection.where('matchStatus', '==', 'started').limit(10).get();
        const anotherStartedMatchExists = startedMatchesSnapshot.docs.some((doc) => String(doc.id || doc.data().date || '') !== date);

        if (!nextTeamA.length) {
          sendJson(res, 400, { error: 'Selecione pelo menos um atleta para o Time A.' });
          return;
        }

        if (!nextTeamB.length) {
          sendJson(res, 400, { error: 'Selecione pelo menos um atleta para o Time B.' });
          return;
        }

        if (hasOverlap) {
          sendJson(res, 400, { error: 'Um atleta nao pode estar nos dois times.' });
          return;
        }

        if (!currentMatchAlreadyStarted && anotherStartedMatchExists) {
          sendJson(res, 400, { error: 'Ja existe uma partida iniciada. Finalize ou desative a atual antes de iniciar outra.' });
          return;
        }

        matchStatus = 'started';
        matchTimer = currentMatchAlreadyStarted
          ? normalizeMatchTimer(data.matchTimer, matchStatus, data.updatedAt || data.createdAt || now)
          : {
              status: 'running',
              elapsedSeconds: 0,
              startedAt: now
            };

        await docRef.set(
          {
            teamNameA: nextTeamNameA,
            teamNameB: nextTeamNameB,
            teamA: nextTeamA,
            teamB: nextTeamB,
            matchStatus,
            matchTimer,
            events,
            scoreA,
            scoreB,
            updatedAt: now
          },
          { merge: true }
        );

        sendJson(res, 200, {
          ok: true,
          date,
          matchStatus,
          teamNameA: nextTeamNameA,
          teamNameB: nextTeamNameB,
          teamA: nextTeamA,
          teamB: nextTeamB,
          matchTimer,
          events,
          scoreA,
          scoreB
        });
        return;
      }

      if (action === 'finalize-match') {
        const nextTeamNameA = normalizeTeamName(body.teamNameA, teamNameA);
        const nextTeamNameB = normalizeTeamName(body.teamNameB, teamNameB);
        const nextTeamA = normalizeRoster(body.teamA, namesMap);
        const nextTeamB = normalizeRoster(body.teamB, namesMap);
        const nextMvpName = String(body.mvpName || '').trim();
        const nextWorstName = String(body.worstName || '').trim();
        const nextDefenderName = String(body.defenderName || '').trim();

        if (matchStatus !== 'started') {
          sendJson(res, 400, { error: 'A partida precisa estar iniciada para ser finalizada.' });
          return;
        }

        if (nextMvpName && nextWorstName && normalizeNameKey(nextMvpName) === normalizeNameKey(nextWorstName)) {
          sendJson(res, 400, { error: 'MVP e pior em campo nao podem ser o mesmo atleta.' });
          return;
        }

        const nextMvpByName = await applySingleChoiceMetricSelection(db, req, mvpByName, nextMvpName, namesMap, 'mvp', now);
        const nextWorstByName = await applySingleChoiceMetricSelection(db, req, worstByName, nextWorstName, namesMap, 'worst', now);
        const nextDefenderByName = await applySingleChoiceMetricSelection(db, req, defenderByName, nextDefenderName, namesMap, 'defender', now);

        matchStatus = 'finished';

        await docRef.set(
          {
            teamNameA: nextTeamNameA,
            teamNameB: nextTeamNameB,
            teamA: nextTeamA,
            teamB: nextTeamB,
            matchStatus,
            mvpByName: nextMvpByName,
            worstByName: nextWorstByName,
            defenderByName: nextDefenderByName,
            matchTimer: pauseMatchTimer(matchTimer, now),
            scoreA,
            scoreB,
            updatedAt: now
          },
          { merge: true }
        );

        sendJson(res, 200, {
          ok: true,
          date,
          matchStatus,
          teamNameA: nextTeamNameA,
          teamNameB: nextTeamNameB,
          teamA: nextTeamA,
          teamB: nextTeamB,
          mvpByName: nextMvpByName,
          worstByName: nextWorstByName,
          defenderByName: nextDefenderByName,
          matchTimer: pauseMatchTimer(matchTimer, now),
          scoreA,
          scoreB
        });
        return;
      }

      if (action === 'reset-match') {
        await resetMatchMetrics(db, req, namesMap, events, mvpByName, worstByName, defenderByName, now);

        const nextGoalsByTeamName = { A: {}, B: {} };
        const nextAssistsByTeamName = { A: {}, B: {} };

        await docRef.set(
          {
            goalsByName: {},
            assistsByName: {},
            goalsByTeamName: nextGoalsByTeamName,
            assistsByTeamName: nextAssistsByTeamName,
            events: [],
            mvpByName: {},
            worstByName: {},
            matchStatus: 'not-started',
            matchTimer: {
              status: 'paused',
              elapsedSeconds: 0,
              startedAt: ''
            },
            scoreA: 0,
            scoreB: 0,
            updatedAt: now
          },
          { merge: true }
        );

        sendJson(res, 200, {
          ok: true,
          date,
          matchStatus: 'not-started',
          scoreA: 0,
          scoreB: 0,
          events: []
        });
        return;
      }

      if (action === 'pause-match-timer' || action === 'resume-match-timer') {
        if (matchStatus !== 'started') {
          sendJson(res, 400, { error: 'O cronometro so pode ser alterado com a partida iniciada.' });
          return;
        }

        const isPausing = action === 'pause-match-timer';
        if (isPausing && String(matchTimer.status || '') !== 'running') {
          sendJson(res, 400, { error: 'O cronometro ja esta pausado.' });
          return;
        }

        if (!isPausing && String(matchTimer.status || '') === 'running') {
          sendJson(res, 400, { error: 'O cronometro ja esta em execucao.' });
          return;
        }

        const nextTimer = isPausing
          ? pauseMatchTimer(matchTimer, now)
          : resumeMatchTimer(matchTimer, now);

        await docRef.set(
          {
            matchTimer: nextTimer,
            updatedAt: now
          },
          { merge: true }
        );

        sendJson(res, 200, {
          ok: true,
          date,
          matchTimer: nextTimer
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
        if (matchStatus !== 'started') {
          sendJson(res, 400, { error: 'A partida precisa estar iniciada para registrar eventos.' });
          return;
        }

        const key = normalizeNameKey(canonicalName);
        const targetTeam = String(body.team || '').trim().toUpperCase();
        const ownGoal = Boolean(body.ownGoal);
        const rawAssistName = String(body.assistName || '').trim();
        const assistKey = normalizeNameKey(rawAssistName);
        const assistCanonical = assistKey ? namesMap.get(assistKey) : '';
        const inTeamA = teamA.some((name) => normalizeNameKey(name) === key);
        const inTeamB = teamB.some((name) => normalizeNameKey(name) === key);
        const eventElapsedSeconds = getMatchTimerElapsedSeconds(matchTimer, now);

        if (!inTeamA && !inTeamB) {
          sendJson(res, 400, { error: 'Defina o time do atleta antes de registrar gol.' });
          return;
        }

        let playerTeam = '';
        if (targetTeam === 'A' || targetTeam === 'B') {
          if ((targetTeam === 'A' && !inTeamA) || (targetTeam === 'B' && !inTeamB)) {
            sendJson(res, 400, { error: 'Atleta nao pertence ao time informado para registrar gol.' });
            return;
          }
          playerTeam = targetTeam;
        } else if (inTeamA && !inTeamB) {
          playerTeam = 'A';
        } else if (inTeamB && !inTeamA) {
          playerTeam = 'B';
        } else {
          sendJson(res, 400, { error: 'Atleta esta nos dois times. Informe o time do gol.' });
          return;
        }

        const scoringTeam = ownGoal
          ? (playerTeam === 'A' ? 'B' : 'A')
          : playerTeam;

        if (scoringTeam !== 'A' && scoringTeam !== 'B') {
          sendJson(res, 400, { error: 'Nao foi possivel identificar o time do gol.' });
          return;
        }

        if (!ownGoal) {
          if (assistCanonical) {
            const assistKeyTeam = teamA.some((name) => normalizeNameKey(name) === assistKey)
              ? 'A'
              : teamB.some((name) => normalizeNameKey(name) === assistKey)
                ? 'B'
                : '';

            if (!assistKeyTeam || assistKeyTeam !== scoringTeam) {
              sendJson(res, 400, { error: 'A assistencia deve ser de um atleta do mesmo time.' });
              return;
            }
          }

          goalsByName[key] = Number(goalsByName[key] || 0) + 1;
          goalsByTeamName[scoringTeam][key] = Number(goalsByTeamName[scoringTeam][key] || 0) + 1;

          if (assistCanonical) {
            assistsByName[assistKey] = Number(assistsByName[assistKey] || 0) + 1;
            assistsByTeamName[scoringTeam][assistKey] = Number(assistsByTeamName[scoringTeam][assistKey] || 0) + 1;
            await incrementAthleteMetric(db, req, assistCanonical, 'assists', 1, now);
          }
        }

        const event = {
          id: `${now}-${events.length + 1}`,
          type: 'goal',
          playerName: canonicalName,
          playerTeam,
          scoringTeam,
          assistName: ownGoal ? '' : assistCanonical,
          ownGoal,
          matchElapsedSeconds: eventElapsedSeconds,
          createdAt: now
        };

        events.push(event);
        scoreA = calculateTeamScoreFromEvents(events, 'A', goalsByTeamName);
        scoreB = calculateTeamScoreFromEvents(events, 'B', goalsByTeamName);

        await docRef.set(
          {
            goalsByName,
            goalsByTeamName,
            scoreA,
            scoreB,
            assistsByName,
            assistsByTeamName,
            events,
            updatedAt: now
          },
          { merge: true }
        );

        if (!ownGoal) {
          await incrementAthleteMetric(db, req, canonicalName, 'goals', 1, now);
        }

        sendJson(res, 200, {
          ok: true,
          date,
          name: canonicalName,
          goals: goalsByName[key] || 0,
          scoreA,
          scoreB,
          goalsByName,
          goalsByTeamName,
          assistsByName,
          assistsByTeamName,
          events
        });
        return;
      }

      if (action === 'remove-goal') {
        if (matchStatus !== 'started') {
          sendJson(res, 400, { error: 'A partida precisa estar iniciada para alterar eventos.' });
          return;
        }

        const key = normalizeNameKey(canonicalName);
        const targetTeam = String(body.team || '').trim().toUpperCase();
        const ownGoal = Boolean(body.ownGoal);
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

        const eventIndex = [...events].reverse().findIndex((event) => {
          if (!event || event.type !== 'goal' || normalizeNameKey(event.playerName) !== key) {
            return false;
          }

          if (ownGoal && !event.ownGoal) {
            return false;
          }

          if (targetTeam && event.scoringTeam !== targetTeam && event.playerTeam !== targetTeam) {
            return false;
          }

          return true;
        });

        if (eventIndex < 0) {
          sendJson(res, 400, { error: 'Nao ha gol registrado para desfazer.' });
          return;
        }

        const realIndex = events.length - 1 - eventIndex;
        const [removedEvent] = events.splice(realIndex, 1);

        if (!removedEvent.ownGoal) {
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
          await incrementAthleteMetric(db, req, canonicalName, 'goals', -1, now);
        }

        if (removedEvent.assistName) {
          const assistKey = normalizeNameKey(removedEvent.assistName);
          const currentAssists = Number(assistsByName[assistKey] || 0);
          const teamAssistCount = Number(assistsByTeamName[scoringTeam][assistKey] || 0);
          assistsByName[assistKey] = Math.max(0, currentAssists - 1);
          assistsByTeamName[scoringTeam][assistKey] = Math.max(0, teamAssistCount - 1);
          await incrementAthleteMetric(db, req, removedEvent.assistName, 'assists', -1, now);
        }

        scoreA = calculateTeamScoreFromEvents(events, 'A', goalsByTeamName);
        scoreB = calculateTeamScoreFromEvents(events, 'B', goalsByTeamName);

        await docRef.set(
          {
            goalsByName,
            goalsByTeamName,
            assistsByName,
            assistsByTeamName,
            events,
            scoreA,
            scoreB,
            updatedAt: now
          },
          { merge: true }
        );

        sendJson(res, 200, {
          ok: true,
          date,
          name: canonicalName,
          goals: goalsByName[key] || 0,
          scoreA,
          scoreB,
          goalsByName,
          goalsByTeamName,
          assistsByName,
          assistsByTeamName,
          events
        });
        return;
      }

      if (action === 'add-assist') {
        if (matchStatus !== 'started') {
          sendJson(res, 400, { error: 'A partida precisa estar iniciada para registrar eventos.' });
          return;
        }

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
        if (matchStatus !== 'started') {
          sendJson(res, 400, { error: 'A partida precisa estar iniciada para alterar eventos.' });
          return;
        }

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

      if (action === 'set-defender' || action === 'clear-defender') {
        const selectedKey = action === 'set-defender' ? normalizeNameKey(canonicalName) : '';
        const previousSelectedKeys = Object.entries(defenderByName)
          .filter(([, value]) => Number(value || 0) > 0)
          .map(([key]) => key);

        Object.keys(defenderByName).forEach((key) => {
          defenderByName[key] = 0;
        });

        if (selectedKey) {
          defenderByName[selectedKey] = 1;
        }

        await docRef.set(
          {
            defenderByName,
            updatedAt: now
          },
          { merge: true }
        );

        const previousSet = new Set(previousSelectedKeys);
        for (const prevKey of previousSelectedKeys) {
          if (prevKey !== selectedKey && namesMap.has(prevKey)) {
            await incrementAthleteMetric(db, req, namesMap.get(prevKey), 'defender', -1, now);
          }
        }
        if (selectedKey && !previousSet.has(selectedKey) && namesMap.has(selectedKey)) {
          await incrementAthleteMetric(db, req, namesMap.get(selectedKey), 'defender', 1, now);
        }

        sendJson(res, 200, {
          ok: true,
          date,
          name: selectedKey ? namesMap.get(selectedKey) : '',
          defenderByName
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
