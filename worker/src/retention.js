import { archiveStatsEvents } from './stats.js';

export function retentionCutoffs(now = new Date()) {
  const annual = new Date(now);
  const day = annual.getUTCDate();
  annual.setUTCDate(1);
  annual.setUTCFullYear(annual.getUTCFullYear() - 1);
  const lastDay = new Date(Date.UTC(annual.getUTCFullYear(), annual.getUTCMonth() + 1, 0)).getUTCDate();
  const currentLastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  annual.setUTCDate(Math.min(day, lastDay));
  const annualIso = annual.toISOString();
  // Feb 28 and Feb 29 of a leap year can share the same anniversary.
  // Compare time of day separately to avoid deleting a Feb 28 entry too early.
  let annualLeapIso = '';
  if (day === currentLastDay && lastDay > currentLastDay) {
    annual.setUTCDate(lastDay);
    annualLeapIso = annual.toISOString();
  }
  return {
    logsMs: now.getTime() - 90 * 86400000,
    logsIso: new Date(now.getTime() - 90 * 86400000).toISOString(),
    annualIso,
    annualLeapIso,
    annualQueryIso: annualLeapIso || annualIso,
  };
}

export async function pruneD1Data(env, cutoffs) {
  const archivedEvents = await archiveStatsEvents(env, cutoffs.logsIso);
  const existing = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  const tables = new Set((existing.results || []).map(row => row.name));
  const policies = [
    ['booking_mail_audit', 'created_at', cutoffs.logsMs],
    ['admin_sessions', 'last_seen', cutoffs.logsIso],
    ['contact_submissions', 'created_at', cutoffs.annualIso],
    ['client_consent_emails', 'updated_at', cutoffs.annualIso],
  ];
  const counts = { archivedEvents };
  for (const [table, field, cutoff] of policies) {
    if (!tables.has(table)) continue;
    const leapBoundary = cutoff === cutoffs.annualIso && cutoffs.annualLeapIso;
    const statement = env.DB.prepare(`DELETE FROM ${table} WHERE ${field} <= ?${leapBoundary
      ? ` OR (substr(${field}, 1, 10) = ? AND substr(${field}, 12) <= ?)` : ''}`);
    const result = await statement.bind(...(leapBoundary
      ? [cutoff, cutoffs.annualLeapIso.slice(0, 10), cutoffs.annualLeapIso.slice(11)] : [cutoff])).run();
    counts[table] = Number(result.meta?.changes || 0);
  }
  return counts;
}

export async function pruneRealtimeData(requestFirebase, cutoffs) {
  const counts = {};
  // At most 42 Firebase requests per run, within the free Worker subrequest budget.
  // Indexes avoid downloading entire consent/contact collections.
  for (const [collection, field] of [['cookie_consents', 'updated_at'], ['contactTickets', 'submittedAt']]) {
    const response = await requestFirebase(`${collection}.json`, {
      query: { orderBy: JSON.stringify(field), startAt: JSON.stringify(''), endAt: JSON.stringify(cutoffs.annualQueryIso), limitToFirst: '10' },
    });
    const records = await response.json();
    counts[collection] = 0;
    for (const key of Object.keys(records || {})) {
      const path = `${collection}/${encodeURIComponent(key)}.json`;
      // A user may renew a consent after it appears in the cleanup query.
      const current = await requestFirebase(path, { headers: { 'X-Firebase-ETag': 'true' } });
      const record = await current.json();
      const timestamp = Date.parse(record?.[field]);
      if (!Number.isFinite(timestamp)) continue;
      const iso = new Date(timestamp).toISOString();
      const expired = iso <= cutoffs.annualIso || (cutoffs.annualLeapIso &&
        iso.slice(0, 10) === cutoffs.annualLeapIso.slice(0, 10) && iso.slice(11) <= cutoffs.annualLeapIso.slice(11));
      if (!expired) continue;
      const etag = current.headers.get('etag');
      if (!etag) throw new Error('Firebase retention: missing ETag');
      const removed = await requestFirebase(path, { method: 'DELETE', headers: { 'if-match': etag } });
      if (removed.status !== 412) counts[collection]++;
    }
  }
  return counts;
}

export async function runDataRetention(env, requestFirebase, now = new Date()) {
  const cutoffs = retentionCutoffs(now);
  // Firebase failure must not stop cleanup of the separate D1 copy.
  const results = await Promise.allSettled([
    pruneD1Data(env, cutoffs),
    pruneRealtimeData(requestFirebase, cutoffs),
  ]);
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Data retention failed');
  return { d1: results[0].value, firebase: results[1].value };
}
