function readGroupFromQuery(req) {
  if (req && req.query && typeof req.query.group === 'string') {
    return req.query.group;
  }

  try {
    const rawUrl = req && req.url ? req.url : '/';
    const parsed = new URL(rawUrl, 'http://localhost');
    return parsed.searchParams.get('group') || '';
  } catch (error) {
    return '';
  }
}

function sanitizeGroup(groupRaw) {
  const value = String(groupRaw || '').trim().toLowerCase();
  if (!value) {
    return 'default';
  }

  const normalized = value.replace(/[^a-z0-9_-]/g, '');
  if (!normalized) {
    return 'default';
  }

  return normalized.slice(0, 32);
}

function getAthletesCollectionName(req) {
  return getCollectionNameByGroup('athletes', req);
}

function getConfirmadosCollectionName(req) {
  return getCollectionNameByGroup('confirmados', req);
}

function getCollectionNameByGroup(baseName, req) {
  const group = sanitizeGroup(readGroupFromQuery(req));
  if (group === 'default') {
    return baseName;
  }

  return `${baseName}_${group}`;
}

module.exports = {
  getAthletesCollectionName,
  getConfirmadosCollectionName
};
