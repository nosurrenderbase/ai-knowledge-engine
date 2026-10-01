/**
 * Against a real MongoDB (a throwaway database): MONGO_TEST_URI, e.g.
 *   docker run --rm -d -p 27099:27017 mongo:8.2 && MONGO_TEST_URI=mongodb://127.0.0.1:27099 npm test -w @ai-knowledge-engine/gamedb
 * Skipped when the variable is not set.
 */
import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {MongoClient, ObjectId} from 'mongodb';
import {GameDb} from '../src/gamedb.ts';
import {QueryRefused} from '../src/guard.ts';

const uri = process.env.MONGO_TEST_URI;
const dbName = `gamedb_test_${process.pid}`;

describe('GameDb (gerçek MongoDB)', {skip: !uri && 'MONGO_TEST_URI yok'}, () => {
  let admin: MongoClient;
  let gdb: GameDb;
  const owner = new ObjectId();
  const [t1, t2] = [new ObjectId(), new ObjectId()];
  const league = new ObjectId();
  const [f1, f2, f3] = [new ObjectId(), new ObjectId(), new ObjectId()];

  before(async () => {
    admin = new MongoClient(uri!);
    const db = admin.db(dbName);
    await db.collection('users').insertOne({_id: owner, email: 'p@x.com', phone: '+90', boss: {name: 'Kara Başkan'}, fcmTokens: [{token: 'tok'}], isPro: true});
    await db.collection('teams').insertMany([
      {_id: t1, name: 'Yıldız FK', ownerId: owner, matchTactics: {press: 'high'}},
      {_id: t2, name: 'Deniz SK', ownerId: null},
    ]);
    await db.collection('team_leagues').insertOne({teamId: t1, currentLeagueDefinitionId: 'amateur', isBot: false, stats: {wins: 3}});
    await db.collection('teamPlayers').insertMany([
      {teamId: t1, squadSlot: 1, name: 'Kaleci', overall: 70, detailedStats: {big: 1}},
      {teamId: t1, squadSlot: 25, name: 'Kadro dışı', overall: 60},
    ]);
    await db.collection('leagues').insertOne({_id: league, name: 'Lig 1', teamIds: [t1, t2], startedAt: new Date()});
    await db.collection('league_fixtures').insertMany([
      {_id: f1, leagueId: league, homeTeamId: t1, awayTeamId: t2, homeGoals: 2, awayGoals: 1, status: 'completed', matchDate: new Date('2026-09-28'), tickDataUrl: 'https://bucket/x', stats: {possession: 55}},
      {_id: f2, leagueId: league, homeTeamId: t2, awayTeamId: t1, homeGoals: 0, awayGoals: 0, status: 'completed', matchDate: new Date('2026-09-29')},
      {_id: f3, leagueId: league, homeTeamId: t1, awayTeamId: t2, homeGoals: 0, awayGoals: 0, status: 'failed', matchDate: new Date('2026-09-30'), retryCount: 3},
    ]);
    await db.collection('match_input_snapshots').insertOne({fixtureId: f1, engineVersion: 'abc', seed: 7});
    await db.collection('iap_receipts').insertOne({x: 1});
    gdb = new GameDb(uri!, dbName);
  });
  after(async () => {
    await admin.db(dbName).dropDatabase();
    await admin.close();
    await gdb.close();
  });

  it('finds with guards: allowlisted users fields, string ids, denied collections and fields', async () => {
    const users = (await gdb.find({collection: 'users', filter: {_id: owner.toHexString()}})) as Record<string, unknown>[];
    assert.deepEqual(Object.keys(users[0]).sort(), ['_id', 'boss', 'isPro']);
    const fx = (await gdb.find({collection: 'league_fixtures', filter: {homeTeamId: t1.toHexString()}, sort: {matchDate: 1}})) as Record<string, unknown>[];
    assert.equal(fx.length, 2);
    assert.ok(!('tickDataUrl' in fx[0]), 'tekrar dosyası adresi dönmez');
    await assert.rejects(gdb.find({collection: 'iap_receipts'}), QueryRefused);
    await assert.rejects(gdb.find({collection: 'users', filter: {email: 'p@x.com'}}), QueryRefused);
    assert.equal(await gdb.count('league_fixtures', {status: 'failed'}), 1);
  });

  it('aggregates within the allowed collections and never returns users fields outside the allowlist', async () => {
    const byStatus = (await gdb.aggregate('league_fixtures', [{$group: {_id: '$status', n: {$sum: 1}}}, {$sort: {_id: 1}}])) as {_id: string; n: number}[];
    assert.deepEqual(byStatus, [{_id: 'completed', n: 2}, {_id: 'failed', n: 1}]);
    const viaRoot = (await gdb.aggregate('users', [{$replaceRoot: {newRoot: {all: '$$ROOT'}}}])) as {all: Record<string, unknown>}[];
    assert.deepEqual(Object.keys(viaRoot[0].all).sort(), ['_id', 'boss', 'isPro']);
    const fields = await gdb.fields('teamPlayers');
    assert.ok(fields['detailedStats.big']);
  });

  it('builds the ready-made views', async () => {
    const found = (await gdb.findTeam('kara başkan')) as Record<string, unknown>[];
    assert.equal(found.length, 1);
    assert.equal(found[0].name, 'Yıldız FK');
    assert.equal(found[0].president, 'Kara Başkan');
    assert.equal(found[0].tier, 'amateur');
    assert.equal(((await gdb.findTeam('deniz')) as Record<string, unknown>[])[0].name, 'Deniz SK');

    const ov = (await gdb.teamOverview(t1.toHexString())) as {squad: Record<string, unknown>[]; recentMatches: Record<string, unknown>[]};
    assert.deepEqual(ov.squad.map(p => p.name), ['Kaleci'], 'yalnız maç günü kadrosu (1-18)');
    assert.ok(!('detailedStats' in ov.squad[0]));
    assert.equal(ov.recentMatches[0].away, 'Deniz SK');

    const md = (await gdb.matchDetail(f1.toHexString())) as {kind: string; fixture: Record<string, unknown>; inputSnapshot: Record<string, unknown>};
    assert.equal(md.kind, 'lig');
    assert.equal(md.fixture.home, 'Yıldız FK');
    assert.equal(md.inputSnapshot.seed, 7);

    const lt = (await gdb.leagueTable(t1.toHexString())) as {table: {team: string; points: number; played: number}[]; fixtureStatus: Record<string, number>};
    assert.deepEqual(lt.table.map(r => [r.team, r.played, r.points]), [['Yıldız FK', 2, 4], ['Deniz SK', 2, 1]]);
    assert.deepEqual(lt.fixtureStatus, {completed: 2, failed: 1});
  });
});
