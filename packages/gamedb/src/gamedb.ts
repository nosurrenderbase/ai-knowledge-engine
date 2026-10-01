/**
 * Read-only access to the game database for the MCP server: guarded generic
 * queries (find, count, aggregate, field overview) over the allowed
 * collections, and a few ready-made views (team lookup, team overview, match
 * detail, league table). Every query goes through checkQuery, runs with a time
 * limit on a secondary when there is one, and every result through redact.
 */
import {MongoClient, ObjectId, type Db, type Document, type Filter, type Sort} from 'mongodb';
import {allowedCollection, checkQuery, prepareFilter, preparePipeline, QueryRefused, redact} from './guard.ts';
import {COLLECTIONS, LIMITS} from './policy.ts';

export interface FindInput {
  collection: string;
  filter?: unknown;
  projection?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  limit?: number;
  skip?: number;
}

export interface Standing {
  teamId: string;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

const HEAVY_PLAYER_FIELDS = ['detailedStats', 'trainingHistory', 'avatar', 'attacking', 'skill', 'movement', 'power', 'mentality', 'defending', 'goalkeeping', 'detailedSkillBoosts'];
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isHex = (s: string) => /^[0-9a-f]{24}$/i.test(s);
/** Matches an id stored either as ObjectId or as its hex string. */
const anyId = (id: string) => (isHex(id) ? {$in: [id, new ObjectId(id)]} : id);
const hex = (v: unknown) => (v instanceof ObjectId ? v.toHexString() : String(v ?? ''));

export class GameDb {
  private readonly client: MongoClient;
  private readonly dbName?: string;

  constructor(uri: string, dbName?: string) {
    this.client = new MongoClient(uri, {
      readPreference: 'secondaryPreferred',
      appName: 'efsane-baskan-mcp',
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
    });
    this.dbName = dbName;
  }

  private get db(): Db {
    return this.client.db(this.dbName);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async ping(): Promise<boolean> {
    try {
      await this.db.command({ping: 1});
      return true;
    } catch {
      return false;
    }
  }

  /** The collections that may be queried, with what they hold and the document explaining them. */
  collections(): {name: string; about: string; doc?: string; fieldsLimited: boolean}[] {
    return Object.entries(COLLECTIONS).map(([name, p]) => ({name, about: p.about, doc: p.doc, fieldsLimited: Boolean(p.fields)}));
  }

  private coll(name: string) {
    if (!allowedCollection(name)) throw new QueryRefused(`"${name}" koleksiyonu okunamaz; izinli koleksiyonlar için db_collections`);
    return this.db.collection(name);
  }

  /** The collection's allowlist as an inclusion projection, intersected with the caller's. */
  private projectionFor(collection: string, projection?: Record<string, unknown>): Document | undefined {
    const allow = COLLECTIONS[collection].fields;
    if (!allow) return projection;
    const wanted = projection && Object.values(projection).some(v => v === 1 || v === true) ? Object.keys(projection).filter(k => allow.includes(k.split('.')[0])) : allow;
    return Object.fromEntries((wanted.length ? wanted : ['_id']).map(k => [k, 1]));
  }

  async find(input: FindInput): Promise<unknown[]> {
    const filter = prepareFilter(input.filter);
    checkQuery(filter, 'filter');
    checkQuery(input.projection ?? {}, 'projection');
    checkQuery(input.sort ?? {}, 'sort');
    const limit = Math.min(Math.max(1, input.limit ?? LIMITS.defaultFind), LIMITS.maxFind);
    const docs = await this.coll(input.collection)
      .find(filter as Filter<Document>, {projection: this.projectionFor(input.collection, input.projection), maxTimeMS: LIMITS.maxTimeMS, comment: 'efsane-baskan-mcp'})
      .sort((input.sort ?? {}) as Sort)
      .skip(Math.max(0, input.skip ?? 0))
      .limit(limit)
      .toArray();
    return docs.map(d => redact(d, input.collection));
  }

  async count(collection: string, filter?: unknown): Promise<number> {
    const f = prepareFilter(filter);
    checkQuery(f, 'filter');
    return this.coll(collection).countDocuments(f as Filter<Document>, {maxTimeMS: LIMITS.maxTimeMS});
  }

  async aggregate(collection: string, pipeline: unknown): Promise<unknown[]> {
    const stages = preparePipeline(pipeline);
    checkQuery(stages, 'pipeline');
    const allow = COLLECTIONS[collection]?.fields;
    const full = [...(allow ? [{$project: Object.fromEntries(allow.map(k => [k, 1]))}] : []), ...stages, {$limit: LIMITS.maxAggregate}];
    const docs = await this.coll(collection).aggregate(full, {maxTimeMS: LIMITS.maxTimeMS, allowDiskUse: false, comment: 'efsane-baskan-mcp'}).toArray();
    return docs.map(d => redact(d));
  }

  /** Field paths and their types, from a sample of documents (to write correct queries). */
  async fields(collection: string, sample = 20): Promise<Record<string, string[]>> {
    const docs = await this.aggregate(collection, [{$sample: {size: Math.min(sample, 50)}}]);
    const out: Record<string, Set<string>> = {};
    const walk = (v: unknown, p: string, depth: number) => {
      const type = v === null ? 'null' : v instanceof ObjectId ? 'ObjectId' : v instanceof Date ? 'Date' : Array.isArray(v) ? 'array' : typeof v;
      if (p) (out[p] ??= new Set()).add(type);
      if (depth >= 3) return;
      if (Array.isArray(v)) {
        if (v[0] && typeof v[0] === 'object') walk(v[0], `${p}[]`, depth + 1);
      } else if (type === 'object' && v) for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k, depth + 1);
    };
    for (const d of docs) walk(d, '', 0);
    return Object.fromEntries(Object.entries(out).sort().map(([k, s]) => [k, [...s]]));
  }

  // ── Ready-made views ──────────────────────────────────────────────────────

  /** Teams by name, president name or id. */
  async findTeam(query: string): Promise<unknown[]> {
    const q = query.trim();
    if (!q) return [];
    const teams = this.db.collection('teams');
    const byId = isHex(q) ? await teams.find({$or: [{_id: new ObjectId(q)}, {ownerId: anyId(q)}]}).limit(10).toArray() : [];
    const byName = await teams.find({name: {$regex: escapeRegex(q), $options: 'i'}}, {maxTimeMS: LIMITS.maxTimeMS}).limit(10).toArray();
    const owners = await this.db
      .collection('users')
      .find({'boss.name': {$regex: escapeRegex(q), $options: 'i'}}, {projection: {_id: 1}, maxTimeMS: LIMITS.maxTimeMS})
      .limit(10)
      .toArray();
    const byOwner = owners.length ? await teams.find({ownerId: {$in: owners.map(o => o._id)}}).limit(10).toArray() : [];
    const seen = new Set<string>();
    const all = [...byId, ...byName, ...byOwner].filter(t => !seen.has(hex(t._id)) && seen.add(hex(t._id)));
    return Promise.all(all.slice(0, 15).map(t => this.teamCard(t)));
  }

  private async teamCard(t: Document): Promise<unknown> {
    const owner = t.ownerId ? await this.db.collection('users').findOne({_id: t.ownerId}, {projection: {boss: 1}}) : null;
    const tl = await this.db.collection('team_leagues').findOne({teamId: anyId(hex(t._id))}, {projection: {currentLeagueDefinitionId: 1, current: 1, isBot: 1, stats: 1}});
    return redact({
      teamId: t._id,
      name: t.name,
      ownerId: t.ownerId ?? null,
      president: owner?.boss?.name ?? null,
      isBot: tl?.isBot ?? null,
      tier: tl?.currentLeagueDefinitionId ?? null,
      currentLeague: tl?.current ?? null,
      lifetime: tl?.stats ?? null,
    });
  }

  /** A team at a glance: settings, president, league row, match-day squad (slots 1-18), recent matches. */
  async teamOverview(teamId: string): Promise<unknown> {
    if (!isHex(teamId)) throw new QueryRefused('teamId 24 haneli bir id olmalı (önce find_team)');
    const team = await this.db.collection('teams').findOne({_id: new ObjectId(teamId)});
    if (!team) return null;
    const squad = await this.db
      .collection('teamPlayers')
      .find({teamId: anyId(teamId), squadSlot: {$gte: 1, $lte: 18}}, {projection: Object.fromEntries(HEAVY_PLAYER_FIELDS.map(f => [f, 0]))})
      .sort({squadSlot: 1})
      .toArray();
    const recent = await this.db
      .collection('league_fixtures')
      .find({$or: [{homeTeamId: anyId(teamId)}, {awayTeamId: anyId(teamId)}]}, {projection: {stats: 0}})
      .sort({matchDate: -1})
      .limit(8)
      .toArray();
    const names = await this.teamNames(recent.flatMap(f => [f.homeTeamId, f.awayTeamId]));
    return redact({
      team: redact(team, 'teams'),
      card: await this.teamCard(team),
      squad,
      recentMatches: recent.map(f => ({...f, home: names.get(hex(f.homeTeamId)), away: names.get(hex(f.awayTeamId))})),
    });
  }

  private async teamNames(ids: unknown[]): Promise<Map<string, string>> {
    const hexes = [...new Set(ids.map(hex).filter(isHex))];
    const docs = hexes.length ? await this.db.collection('teams').find({_id: {$in: hexes.map(h => new ObjectId(h))}}, {projection: {name: 1}}).toArray() : [];
    return new Map(docs.map(d => [hex(d._id), String(d.name)]));
  }

  /** One league match (or PvP match) with its stats and the engine's input snapshot. */
  async matchDetail(id: string): Promise<unknown> {
    if (!isHex(id)) throw new QueryRefused('maç id 24 haneli bir id olmalı');
    const fixture = await this.db.collection('league_fixtures').findOne({$or: [{_id: new ObjectId(id)}, {fixtureId: id}]});
    if (fixture) {
      const names = await this.teamNames([fixture.homeTeamId, fixture.awayTeamId]);
      const snapshot = await this.db.collection('match_input_snapshots').findOne({fixtureId: anyId(hex(fixture._id))});
      return redact({kind: 'lig', fixture: {...fixture, home: names.get(hex(fixture.homeTeamId)), away: names.get(hex(fixture.awayTeamId))}, inputSnapshot: snapshot});
    }
    const pvp = await this.db.collection('pvp_matches').findOne({_id: new ObjectId(id)});
    if (pvp) {
      const snapshot = await this.db.collection('match_input_snapshots').findOne({fixtureId: anyId(id)});
      return redact({kind: 'pvp', match: pvp, inputSnapshot: snapshot});
    }
    return null;
  }

  /** A league's table computed from its completed fixtures, plus fixture status counts. Accepts a league id or a team id. */
  async leagueTable(id: string): Promise<unknown> {
    if (!isHex(id)) throw new QueryRefused('lig ya da takım id 24 haneli bir id olmalı');
    const leagues = this.db.collection('leagues');
    const league = (await leagues.findOne({_id: new ObjectId(id)})) ?? (await leagues.find({teamIds: anyId(id)}).sort({startedAt: -1}).limit(1).next());
    if (!league) return null;
    const fixtures = await this.db.collection('league_fixtures').find({leagueId: anyId(hex(league._id))}, {projection: {stats: 0}}).sort({matchDate: 1}).toArray();
    const names = await this.teamNames([...(league.teamIds ?? []), ...fixtures.flatMap(f => [f.homeTeamId, f.awayTeamId])]);
    const rows = new Map<string, Standing>();
    const row = (tid: unknown) => {
      const k = hex(tid);
      if (!rows.has(k)) rows.set(k, {teamId: k, team: names.get(k) ?? k, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0});
      return rows.get(k)!;
    };
    for (const t of league.teamIds ?? []) row(t);
    const statusCounts: Record<string, number> = {};
    for (const f of fixtures) {
      statusCounts[f.status] = (statusCounts[f.status] ?? 0) + 1;
      if (f.status !== 'completed') continue;
      const h = row(f.homeTeamId);
      const a = row(f.awayTeamId);
      h.played++;
      a.played++;
      h.goalsFor += f.homeGoals;
      h.goalsAgainst += f.awayGoals;
      a.goalsFor += f.awayGoals;
      a.goalsAgainst += f.homeGoals;
      if (f.homeGoals > f.awayGoals) (h.won++, a.lost++, (h.points += 3));
      else if (f.homeGoals < f.awayGoals) (a.won++, h.lost++, (a.points += 3));
      else (h.drawn++, a.drawn++, h.points++, a.points++);
    }
    const table = [...rows.values()].sort((x, y) => y.points - x.points || y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst) || y.goalsFor - x.goalsFor);
    const open = fixtures.filter(f => f.status !== 'completed').slice(0, 20);
    return redact({
      league: {...league, teamIds: undefined, scoreTable: undefined},
      table,
      fixtureStatus: statusCounts,
      notCompleted: open.map(f => ({...f, home: names.get(hex(f.homeTeamId)), away: names.get(hex(f.awayTeamId))})),
      note: 'Tablo tamamlanmış (completed) fikstürlerden hesaplandı: galibiyet 3, beraberlik 1 puan; sıralama puan, averaj, atılan gol.',
    });
  }
}
