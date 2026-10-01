import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {Principal, UsageEvent} from '@ai-knowledge-engine/accounts';
import {QueryRefused, type GameDb} from '@ai-knowledge-engine/gamedb';
import {DB_INSTRUCTIONS} from '../src/db-tools.ts';
import {buildServer, INSTRUCTIONS, type Services} from '../src/server.ts';

const fakeDb = {
  findTeam: async (q: string) => [{teamId: '6a8ed3fefd613b89d87727ba', name: `${q} FK`}],
  find: async () => {
    throw new QueryRefused('"email" kişisel/gizli bir alan; sorgulanamaz (filter)');
  },
  count: async () => 3,
  collections: () => [{name: 'teams', about: 'Takımlar', fieldsLimited: false}],
} as unknown as GameDb;

async function connect(principal: Principal, events: UsageEvent[]) {
  const services: Services = {
    areas: new Map([['backend', {store: {} as never, search: {} as never}]]),
    gamedb: fakeDb,
    usage: async e => void events.push(e),
  };
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer(services, {principal, client: 'test'}).connect(a);
  const client = new Client({name: 'test', version: '1'});
  await client.connect(b);
  return client;
}

describe('game database tools', () => {
  it('are offered only to people with database access', async () => {
    const plain = await connect({userId: 1, tokenId: 1, name: 'PM'}, []);
    assert.deepEqual((await plain.listTools()).tools.map(t => t.name).sort(), ['grep', 'list_docs', 'read_doc', 'search']);
    assert.equal(plain.getInstructions(), INSTRUCTIONS);

    const dev = await connect({userId: 2, tokenId: 2, name: 'Dev', dbAccess: true}, []);
    const names = (await dev.listTools()).tools.map(t => t.name);
    for (const t of ['find_team', 'team_overview', 'match_detail', 'league_table', 'db_collections', 'db_fields', 'db_find', 'db_count', 'db_aggregate']) assert.ok(names.includes(t), t);
    assert.equal(dev.getInstructions(), INSTRUCTIONS + DB_INSTRUCTIONS);
  });

  it('return data as JSON, refused queries as a readable error, and record the call', async () => {
    const events: UsageEvent[] = [];
    const dev = await connect({userId: 2, tokenId: 2, name: 'Dev', dbAccess: true}, events);
    const call = async (name: string, args: Record<string, unknown>) =>
      (await dev.callTool({name, arguments: args})) as {content: {text: string}[]; isError?: boolean};

    const team = await call('find_team', {query: 'Yıldız'});
    assert.match(team.content[0].text, /"name": "Yıldız FK"/);
    const refused = await call('db_find', {collection: 'users', filter: {email: 'x'}});
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /^Sorgu reddedildi: "email"/);
    assert.match((await call('db_count', {collection: 'league_fixtures', filter: {status: 'failed'}})).content[0].text, /"count": 3/);

    assert.deepEqual(
      events.map(e => [e.tool, e.result]),
      [
        ['find_team', {count: 1}],
        ['db_find', {count: 0, refused: true}],
        ['db_count', {count: 1}],
      ],
    );
    assert.equal(events[1].error?.startsWith('Sorgu reddedildi'), true);
  });
});
