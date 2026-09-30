/**
 * Against the local Postgres (compose.yaml), in a throwaway schema that is
 * dropped afterwards. Skipped when Postgres is not reachable.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {createDb, databaseUrl, migrate, type Db} from '../src/db.ts';
import {dailyTotals, overview, purgeUsage, recentQueries, recordUsage, usageSummary} from '../src/usage.ts';
import {addUser, findUser, issueToken, listTokens, listUsers, newToken, revokeToken, setUserDisabled, verifyToken} from '../src/users.ts';

const envFile = path.resolve(import.meta.dirname, '../../../.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

describe('newToken', () => {
  it('makes distinct tokens that carry their prefix', () => {
    const a = newToken();
    const b = newToken();
    assert.match(a.token, /^kb_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
    assert.ok(a.token.startsWith(`kb_${a.prefix}_`));
    assert.notEqual(a.token, b.token);
  });
});

let admin: Db | null = null;
try {
  admin = createDb({url: databaseUrl(process.env), max: 1});
  await admin.query('select 1');
} catch {
  await admin?.end().catch(() => {});
  admin = null;
}

describe('accounts (Postgres)', {skip: admin ? false : 'yerel Postgres yok (docker compose up -d postgres)'}, () => {
  const schema = `test_${process.pid}_${Date.now()}`;
  let db: Db;

  before(async () => {
    await admin!.query(`create schema ${schema}`);
    db = createDb({url: databaseUrl(process.env), schema});
  });
  after(async () => {
    await db.end();
    await admin!.query(`drop schema ${schema} cascade`);
    await admin!.end();
  });

  it('migrates once and is idempotent', async () => {
    assert.deepEqual(await migrate(db), ['001_accounts']);
    assert.deepEqual(await migrate(db), []);
  });

  it('issues a token that verifies to its user, stores only its hash', async () => {
    const u = await addUser(db, {name: 'Ahmet Yılmaz', email: 'ahmet@example.invalid', note: 'PM'});
    const t = await issueToken(db, u.id, 'laptop');
    assert.deepEqual(await verifyToken(db, t.token), {userId: u.id, tokenId: t.tokenId, name: 'Ahmet Yılmaz'});
    const {rows} = await db.query('select hash from tokens where id = $1', [t.tokenId]);
    assert.notEqual(rows[0].hash, t.token);
    assert.ok(!JSON.stringify(rows).includes(t.token.split('_')[2]));
    assert.equal((await listTokens(db, u.id))[0].label, 'laptop');
    assert.ok((await listTokens(db, u.id))[0].lastUsedAt, 'son kullanım işlenir');
  });

  it('rejects unknown, malformed and revoked tokens, and tokens of disabled users', async () => {
    const u = await addUser(db, {name: 'Zeynep', email: 'zeynep@example.invalid'});
    const t1 = await issueToken(db, u.id);
    const t2 = await issueToken(db, u.id);
    assert.equal(await verifyToken(db, newToken().token), null);
    assert.equal(await verifyToken(db, 'Bearer abc'), null);

    assert.equal(await revokeToken(db, `kb_${t1.prefix}`), true);
    assert.equal(await revokeToken(db, t1.prefix), false, 'ikinci kez iptal edilmez');
    assert.equal(await verifyToken(db, t1.token), null);
    assert.ok(await verifyToken(db, t2.token), 'diğer token çalışmaya devam eder');

    await setUserDisabled(db, u.id, true);
    assert.equal(await verifyToken(db, t2.token), null);
    await setUserDisabled(db, u.id, false);
    assert.ok(await verifyToken(db, t2.token));
  });

  it('finds users by id or e-mail (case-insensitive)', async () => {
    const u = await findUser(db, 'AHMET@example.invalid');
    assert.equal(u?.name, 'Ahmet Yılmaz');
    assert.equal((await findUser(db, String(u!.id)))?.email, 'ahmet@example.invalid');
    assert.equal(await findUser(db, 'yok@example.invalid'), null);
  });

  it('records calls with daily totals per person and tool', async () => {
    const u = (await findUser(db, 'ahmet@example.invalid'))!;
    const base = {userId: u.id, tokenId: null, durationMs: 120};
    await recordUsage(db, {...base, tool: 'search', input: {query: 'pvp hakkı'}, result: {count: 3, paths: ['flows/pvp/gunluk-hak.md']}});
    await recordUsage(db, {...base, tool: 'search', input: {query: 'bilinmeyen konu'}, result: {count: 0, paths: []}});
    await recordUsage(db, {...base, tool: 'read_doc', input: {path: 'x.md'}, result: {count: 0}, error: 'bulunamadı'});
    await recordUsage(db, {userId: null, tokenId: null, tool: 'search', input: {query: 'anonim'}, result: {count: 1}, durationMs: 5});

    const summary = await usageSummary(db, 30);
    assert.deepEqual(
      summary.filter(r => r.userId === u.id).map(r => [r.tool, r.calls, r.errors]),
      [
        ['read_doc', 1, 1],
        ['search', 2, 0],
      ],
    );
    assert.equal((await listUsers(db)).find(r => r.id === u.id)?.calls30d, 3);

    const empty = await recentQueries(db, {emptyOnly: true, tool: 'search'});
    assert.deepEqual(empty.map(r => r.input.query), ['bilinmeyen konu']);
    const mine = await recentQueries(db, {userId: u.id, limit: 2});
    assert.equal(mine.length, 2);
    assert.equal(mine[0].name, 'Ahmet Yılmaz');
  });

  it('gives daily totals with quiet days as zero, and an overview', async () => {
    const days = await dailyTotals(db, 7);
    assert.equal(days.length, 7);
    assert.match(days[6].day, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(days[6].calls, 3, 'bugün: kişiye bağlı 3 çağrı');
    assert.equal(days[6].errors, 1);
    assert.equal(days[0].calls, 0);
    const u = (await findUser(db, 'ahmet@example.invalid'))!;
    assert.equal((await dailyTotals(db, 1, u.id))[0].calls, 3);

    const o = await overview(db);
    assert.equal(o.users, 2);
    assert.equal(o.activeUsers7d, 1);
    assert.equal(o.callsToday, 3);
    assert.equal(o.calls30d, 3);
    assert.equal(o.emptySearches7d, 1);
  });

  it('purges old call details but keeps daily totals', async () => {
    const u = (await findUser(db, 'ahmet@example.invalid'))!;
    await recordUsage(db, {
      userId: u.id,
      tokenId: null,
      tool: 'grep',
      input: {pattern: 'eski'},
      result: {count: 1},
      durationMs: 3,
      at: new Date(Date.now() - 100 * 86_400_000),
    });
    assert.equal(await purgeUsage(db, 90), 1);
    assert.equal(await purgeUsage(db, 90), 0);
    const {rows} = await db.query("select sum(calls)::int as calls from usage_daily where tool = 'grep'");
    assert.equal(rows[0].calls, 1, 'günlük toplam kalır');
  });
});
