import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { archiveStatsEvents, handleStatsApi } from '../../worker/src/stats.js';
import { retentionCutoffs, pruneD1Data, pruneRealtimeData, runDataRetention } from '../../worker/src/retention.js';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const cutoffs = retentionCutoffs(NOW);

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../worker/schema.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: result.changes } }; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) {
          const item = await statement.all();
          item.meta = { changes: sqlite.prepare('SELECT changes() AS count').get().count };
          result.push(item);
        }
        sqlite.exec('COMMIT');
        return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { env: { DB: db }, sqlite };
}

function event(sqlite, id, type, date, path = '/Hotel/') {
  sqlite.prepare(`INSERT INTO analytics_events VALUES (?, ?, ?, 'hotel', 'Hotel', 'hotel', 'main-site', ?, ?)`)
    .run(id, 'client-' + id, type, path, date);
}

function stats(env, range) {
  return handleStatsApi({ env, request: new Request('https://api.test/api/stats/data'), url: new URL('https://api.test/api/stats/data?range=' + range), requireAdmin: async () => {}, respond: data => data });
}

test('archive preserves dashboard totals, daily series and pages, and is idempotent', async () => {
  const { env, sqlite } = database();
  event(sqlite, 'old-visit-1', 'visit', '2026-03-01T10:00:00.000Z');
  event(sqlite, 'old-visit-2', 'visit', '2026-03-01T11:00:00.000Z');
  event(sqlite, 'old-form', 'contact_form_submit', '2026-03-01T12:00:00.000Z');
  event(sqlite, 'boundary', 'contact_phone_click', cutoffs.logsIso);
  event(sqlite, 'recent', 'visit', NOW.toISOString());
  const before = await stats(env, 'all');
  assert.equal(await archiveStatsEvents(env, cutoffs.logsIso), 4);
  assert.equal(await archiveStatsEvents(env, cutoffs.logsIso), 0);
  const after = await stats(env, 'all');
  for (const field of ['totals', 'series', 'pageBreakdown', 'availableEvents', 'filteredEvents', 'conversionRate']) {
    assert.deepEqual(after[field], before[field], field);
  }
  assert.equal(after.recentEvents.length, 1);
  assert.equal(after.recentEvents[0].id, 'recent');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM analytics_events').get().count, 1);
  assert.equal(sqlite.prepare('SELECT SUM(count) AS count FROM analytics_daily').get().count, 4);
  assert.equal((await stats(env, '7')).totals.visits, 1);
  assert.equal((await stats(env, 'rok')).totals.visits, 3);
  sqlite.close();
});

test('failed archive deletion rolls back counters instead of losing or duplicating events', async () => {
  const { env, sqlite } = database();
  event(sqlite, 'old', 'visit', '2024-01-01T00:00:00.000Z');
  sqlite.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON analytics_events BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
  await assert.rejects(archiveStatsEvents(env, cutoffs.logsIso), /forced failure/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM analytics_daily').get().count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM analytics_events').get().count, 1);
  sqlite.exec('DROP TRIGGER fail_delete');
  assert.equal(await archiveStatsEvents(env, cutoffs.logsIso), 1);
  sqlite.close();
});

test('D1 removes expired contacts, consents and mail logs while keeping current records and reservations', async () => {
  const { env, sqlite } = database();
  for (const [name, date] of [['expired', cutoffs.annualIso], ['current', NOW.toISOString()]]) {
    sqlite.prepare("INSERT INTO contact_submissions (full_name,email,message,created_at) VALUES (?,'test@example.test','test',?)").run(name,date);
    sqlite.prepare("INSERT INTO client_consent_emails (email,created_at,updated_at) VALUES (?,?,?)").run(name + '@example.test', '2020-01-01T00:00:00.000Z', date);
  }
  for (const ms of [cutoffs.logsMs, NOW.getTime()]) {
    sqlite.prepare("INSERT INTO booking_mail_audit (service,event_key,recipient,subject,status,created_at) VALUES ('hotel','test','test@example.test','test','sent',?)").run(ms);
  }
  sqlite.prepare("INSERT INTO hotel_reservations (id,human_number,status,customer_name,email,date_from,date_to,created_at,updated_at) VALUES ('reservation',1,'confirmed','test','test@example.test','2020-01-01','2020-01-02',0,0)").run();
  await pruneD1Data(env, cutoffs);
  assert.equal(sqlite.prepare('SELECT full_name FROM contact_submissions').get().full_name, 'current');
  assert.equal(sqlite.prepare('SELECT email FROM client_consent_emails').get().email, 'current@example.test');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM booking_mail_audit').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM hotel_reservations').get().count, 1);
  await assert.rejects(runDataRetention(env, async () => { throw new Error('Firebase denied'); }, NOW), AggregateError);
  sqlite.close();
});

test('Firebase retains proofs for three years, contacts for one year, and protects concurrent changes', async () => {
  const deleted = [];
  const request = async (path, options = {}) => {
    if (options.query) {
      assert.equal(options.query.limitToFirst, '10');
      if (path === 'cookie_consents.json') {
        assert.equal(JSON.parse(options.query.endAt), cutoffs.consentEvidence.queryIso);
        return Response.json({ expired: {}, retained: {}, renewed: {}, raced: {} });
      }
      assert.equal(JSON.parse(options.query.endAt), cutoffs.annualQueryIso);
      return Response.json({ contact: {} });
    }
    if (options.method === 'DELETE') {
      assert.equal(options.headers['if-match'], '"v1"');
      if (path.includes('raced')) return new Response(null, { status: 412 });
      deleted.push(path);
      return Response.json(null);
    }
    const field = path.startsWith('cookie_consents') ? 'updated_at' : 'submittedAt';
    const cutoff = field === 'updated_at' ? cutoffs.consentEvidence.iso : cutoffs.annualIso;
    const timestamp = path.includes('renewed') ? NOW.toISOString() : path.includes('retained') ? '2024-10-09T12:00:00.000Z' : cutoff;
    return Response.json({ [field]: timestamp }, { headers: { etag: '"v1"' } });
  };
  assert.deepEqual(await pruneRealtimeData(request, cutoffs), { cookie_consents: 1, contactTickets: 1 });
  assert.deepEqual(deleted, ['cookie_consents/expired.json', 'contactTickets/contact.json']);
});

function browser(choice, initialNow = NOW.getTime()) {
  let now = initialNow;
  const storage = new Map([['sredzka-cookies-choice', JSON.stringify(choice)], ['sredzka-cookies-anonymous-user-id', 'anonymous-id']]);
  const calls = [];
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const window = { localStorage: { getItem: key => storage.get(key), setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key) }, location: { hostname: 'sredzka-korona.pl' }, crypto, dispatchEvent() {}, fetch: (...args) => { calls.push(args); return Promise.resolve(); }, gtag() {} };
  const context = { window, document: { cookie: '_ga=test' }, Date: Clock, CustomEvent: class {}, console };
  vm.runInNewContext(readFileSync(new URL('../../assets/js/cookie-consent-core.js', import.meta.url), 'utf8'), context);
  return { consent: window.sredzkaCookieConsent, storage, calls, advance: ms => { now += ms; } };
}

const choice = updated_at => ({ consent_id: 'consent-id', anonymous_user_id: 'anonymous-id', policy_version: '1.1', created_at: '2020-01-01T00:00:00.000Z', updated_at, analytics: true, marketing: true });

test('cookie decisions expire after 12 calendar months and visiting does not renew them', () => {
  const expired = browser(choice(cutoffs.annualIso));
  assert.equal(expired.consent.getValidChoice(), null);
  assert.equal(expired.storage.has('sredzka-cookies-choice'), false);
  assert.equal(expired.storage.has('sredzka-cookies-anonymous-user-id'), false);
  const current = browser(choice('2026-09-01T12:00:00.000Z'));
  assert.equal(current.consent.getValidChoice().updated_at, '2026-09-01T12:00:00.000Z');
  const seconds = current.consent.googleCookieOptions().cookie_expires;
  current.advance(86400000);
  assert.equal(current.consent.googleCookieOptions().cookie_expires, seconds - 86400);
  assert.equal(current.calls.length, 0);
  const record = current.consent.saveChoice({ analytics: false }, 'reject_all');
  assert.notEqual(record.consent_id, 'consent-id');
  assert.equal(record.anonymous_user_id, 'anonymous-id');
  assert.equal(record.created_at, record.updated_at);
  assert.equal(record.updated_at, '2026-10-10T12:00:00.000Z');
  assert.equal(current.calls.length, 1);
});

test('12-month expiry clamps leap day to the end of February', () => {
  const leap = browser(choice('2024-02-29T12:00:00.000Z'), Date.parse('2025-02-28T12:00:00.000Z'));
  assert.equal(leap.consent.getValidChoice(), null);
  assert.equal(retentionCutoffs(new Date('2024-02-29T12:00:00.000Z')).annualIso, '2023-02-28T12:00:00.000Z');
  assert.equal(retentionCutoffs(new Date('2025-02-28T12:00:00.000Z')).annualQueryIso, '2024-02-29T12:00:00.000Z');
  assert.equal(retentionCutoffs(new Date('2027-02-28T12:00:00.000Z')).consentEvidence.queryIso, '2024-02-29T12:00:00.000Z');
});

test('acceptance and withdrawal create separate minimal proofs without replacing earlier decisions', () => {
  const current = browser(choice('2026-09-01T12:00:00.000Z'));
  const accepted = current.consent.saveChoice({ analytics: true, marketing: true }, 'accept_all');
  current.advance(3600000);
  const withdrawn = current.consent.saveChoice({ analytics: false, marketing: false }, 'reject_all');
  assert.notEqual(accepted.consent_id, withdrawn.consent_id);
  assert.equal(accepted.anonymous_user_id, withdrawn.anonymous_user_id);
  const history = new Map(current.calls.map(([url, options]) => [url, JSON.parse(options.body)]));
  assert.equal(history.size, 2);
  const records = [...history.values()];
  assert.equal(records[0].analytics, true);
  assert.equal(records[0].action, 'accept_all');
  assert.equal(records[1].analytics, false);
  assert.equal(records[1].action, 'reject_all');
  assert.equal(records[1].policy_version, '1.1');
  assert.equal(current.consent.getValidChoice().consent_id, withdrawn.consent_id);
  const allowedFields = ['action','analytics','anonymous_user_id','consent_id','created_at','external_media','marketing','policy_version','updated_at'];
  for (const record of records) assert.deepEqual(Object.keys(record).sort(), allowedFields);
  current.advance(366 * 86400000);
  assert.equal(current.consent.getValidChoice(), null);
  // Expiring the local preference does not remove its independent remote proof.
  assert.equal(current.calls.length, 2);
  assert.equal(history.size, 2);
});

test('the revised policy requests a new decision without treating the old version as current consent', () => {
  const previous = { ...choice('2026-09-01T12:00:00.000Z'), policy_version: '1.0' };
  const current = browser(previous);
  assert.equal(current.consent.getValidChoice(), null);
  const record = current.consent.saveChoice({ analytics: false }, 'reject_all');
  assert.equal(record.policy_version, '1.1');
  assert.notEqual(record.consent_id, previous.consent_id);
  assert.equal(record.anonymous_user_id, previous.anonymous_user_id);
});

test('leap anniversaries delete both eligible days without deleting later decisions early', async () => {
  const { env, sqlite } = database();
  const boundary = retentionCutoffs(new Date('2025-02-28T12:00:00.000Z'));
  for (const day of ['28', '29']) {
    for (const hour of ['11', '13']) {
      const iso = `2024-02-${day}T${hour}:00:00.000Z`;
      sqlite.prepare("INSERT INTO contact_submissions (full_name,email,message,created_at) VALUES (?,'test@example.test','test',?)").run(day + hour, iso);
    }
  }
  await pruneD1Data(env, boundary);
  assert.deepEqual(sqlite.prepare('SELECT full_name FROM contact_submissions ORDER BY full_name').all().map(row => row.full_name), ['2813', '2913']);
  sqlite.close();
});
