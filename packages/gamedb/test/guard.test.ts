import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {ObjectId} from 'mongodb';
import {checkQuery, prepareFilter, preparePipeline, QueryRefused, redact, toText} from '../src/guard.ts';
import {DENIED_FIELD} from '../src/policy.ts';

const refused = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof QueryRefused && re.test(e.message));

describe('denied field names', () => {
  it('cover contact, login, device, payment and identity data but not game fields', () => {
    for (const f of ['email', 'phone', 'passwordHash', 'fcmTokens', 'cometChatAuthToken', 'connectedProviders', 'providerId', 'iban', 'tcNo', 'sumsubApplicantId', 'deviceId', 'tickDataUrl', 'firstName']) {
      assert.ok(DENIED_FIELD.test(f), f);
    }
    for (const f of ['name', 'boss', 'overall', 'homeGoals', 'teamId', 'challengerTicketId', 'birthDate', 'morale', 'block', 'isPro']) assert.ok(!DENIED_FIELD.test(f), f);
  });
});

describe('checkQuery', () => {
  it('refuses denied fields as keys, dotted paths, $references and plain field-name values', () => {
    refused(() => checkQuery({email: 'x@y'}), /"email"/);
    refused(() => checkQuery({'connectedProviders.providerId': 'g1'}), /connectedProviders/);
    refused(() => checkQuery([{$group: {_id: '$phone'}}]), /\$phone/);
    refused(() => checkQuery([{$project: {x: '$fcmTokens.token'}}]), /fcmTokens/);
    refused(() => checkQuery([{$lookup: {from: 'teams', localField: 'email', foreignField: 'name', as: 't'}}]), /email/);
  });

  it('refuses code, writes and joins outside the allowed collections', () => {
    refused(() => checkQuery({$where: 'true'}), /\$where/);
    refused(() => checkQuery([{$match: {}}, {$out: 'x'}]), /\$out/);
    refused(() => checkQuery([{$group: {_id: null, x: {$accumulator: {}}}}]), /\$accumulator/);
    refused(() => checkQuery([{$lookup: {from: 'iap_receipts', localField: 'a', foreignField: 'b', as: 'c'}}]), /iap_receipts/);
    refused(() => checkQuery([{$lookup: {from: 'users', localField: 'ownerId', foreignField: '_id', as: 'u'}}]), /users/);
    refused(() => checkQuery([{$unionWith: 'cometchat_tokens'}]), /cometchat_tokens/);
  });

  it('lets ordinary game queries through', () => {
    checkQuery({status: 'failed', matchDate: {$gte: new Date()}, $or: [{homeTeamId: 'a'}, {awayTeamId: 'a'}]});
    checkQuery([{$match: {status: 'completed'}}, {$group: {_id: '$leagueId', n: {$sum: 1}, goals: {$avg: {$add: ['$homeGoals', '$awayGoals']}}}}, {$lookup: {from: 'leagues', localField: '_id', foreignField: '_id', as: 'l'}}]);
    checkQuery([{$replaceRoot: {newRoot: '$$ROOT'}}]);
  });
});

describe('prepareFilter and preparePipeline', () => {
  it('reads Extended JSON and lets a hex id match both ObjectId and string forms', () => {
    const id = '6a8ed3fefd613b89d87727ba';
    const f = prepareFilter({homeTeamId: id, name: 'x', matchDate: {$gte: {$date: '2026-10-01T00:00:00Z'}}, $or: [{_id: id}], leagueId: {$oid: id}});
    assert.deepEqual(f.homeTeamId, {$in: [id, new ObjectId(id)]});
    assert.equal(f.name, 'x');
    assert.ok((f.matchDate as {$gte: Date}).$gte instanceof Date);
    assert.deepEqual((f.$or as Record<string, unknown>[])[0]._id, {$in: [id, new ObjectId(id)]});
    assert.ok(f.leagueId instanceof ObjectId);
    const [match] = preparePipeline([{$match: {teamId: id}}]);
    assert.deepEqual((match.$match as Record<string, unknown>).teamId, {$in: [id, new ObjectId(id)]});
  });
});

describe('redact', () => {
  it('drops denied fields at any depth, applies the users allowlist and cuts long arrays', () => {
    const user = {_id: new ObjectId(), email: 'a@b', boss: {name: 'Başkan', id: 'x'}, fcmTokens: [{token: 't'}], timezone: 'Europe/Istanbul', secretSauce: 1, notListed: 2};
    assert.deepEqual(Object.keys(redact(user, 'users') as object).sort(), ['_id', 'boss', 'timezone']);
    const nested = redact({a: {b: [{phone: '1', ok: 1}]}, list: Array.from({length: 70}, (_, i) => i)}) as {a: {b: object[]}; list: unknown[]};
    assert.deepEqual(nested.a.b, [{ok: 1}]);
    assert.equal(nested.list.length, 61);
    assert.match(String(nested.list[60]), /10 öğe daha/);
  });

  it('renders ids and dates plainly', () => {
    const id = new ObjectId('6a8ed3fefd613b89d87727ba');
    assert.equal(toText({id, at: new Date('2026-10-01T10:00:00Z')}), '{\n "id": "6a8ed3fefd613b89d87727ba",\n "at": "2026-10-01T10:00:00Z"\n}');
  });
});
