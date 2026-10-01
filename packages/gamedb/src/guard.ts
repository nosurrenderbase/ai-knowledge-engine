/**
 * Checks a query before it reaches the database and cleans what comes back.
 *
 * checkQuery refuses (throws QueryRefused) anything that names a denied field
 * (as a key, a "$field" reference or a dotted path), uses a forbidden operator,
 * or joins into a collection that is not allowed. redact then drops denied
 * fields at any depth, applies the users allowlist and cuts long arrays — a
 * second line in case a value reaches the output another way.
 */
import {BSON, ObjectId} from 'mongodb';
import {COLLECTIONS, DENIED_FIELD, FORBIDDEN_OPERATORS, LIMITS} from './policy.ts';

const {EJSON} = BSON;

export class QueryRefused extends Error {}

const JOIN_STAGES: Record<string, string> = {$lookup: 'from', $graphLookup: 'from', $unionWith: 'coll'};
/** Keys whose plain string value is a field name (no "$" prefix). */
const FIELD_NAME_KEYS = new Set(['localField', 'foreignField', 'connectFromField', 'connectToField', 'depthField', 'as', 'field', '$getField', 'path', 'includeArrayIndex']);

export function allowedCollection(name: string): boolean {
  return Object.hasOwn(COLLECTIONS, name);
}

function checkPath(path: string, where: string): void {
  for (const seg of path.replace(/^\$+/, '').split('.')) {
    if (seg && DENIED_FIELD.test(seg)) throw new QueryRefused(`"${path}" kişisel/gizli bir alan; sorgulanamaz (${where})`);
  }
}

/** Walks a filter, projection, sort or pipeline and refuses what policy forbids. */
export function checkQuery(value: unknown, where = 'sorgu'): void {
  if (Array.isArray(value)) {
    for (const v of value) checkQuery(v, where);
    return;
  }
  if (typeof value === 'string') {
    if (value.startsWith('$') && !value.startsWith('$$')) checkPath(value, where);
    return;
  }
  if (!value || typeof value !== 'object' || value instanceof ObjectId || value instanceof Date) return;
  for (const [key, v] of Object.entries(value)) {
    if (FORBIDDEN_OPERATORS.has(key)) throw new QueryRefused(`${key} kullanılamaz (${where})`);
    if (key in JOIN_STAGES) {
      const spec = v as Record<string, unknown> | string;
      const target = typeof spec === 'string' ? spec : (spec?.[JOIN_STAGES[key]] as string | undefined);
      if (!target || !allowedCollection(target) || COLLECTIONS[target].joinable === false) {
        throw new QueryRefused(`${key} yalnız izinli koleksiyonlara bağlanabilir; "${target ?? '?'}" olmaz (${where})`);
      }
    }
    if (!key.startsWith('$')) checkPath(key, where);
    if (FIELD_NAME_KEYS.has(key) && typeof v === 'string') checkPath(v, where);
    checkQuery(v, where);
  }
}

/**
 * Turns Extended JSON ({"$oid": …}, {"$date": …}) into driver values, and lets
 * a bare 24-hex string match both forms where an id is expected (the game
 * stores some ids as ObjectId, some as strings).
 */
export function prepareFilter(value: unknown): Record<string, unknown> {
  const parsed = EJSON.deserialize((value ?? {}) as object, {relaxed: false}) as Record<string, unknown>;
  const isIdKey = (k: string) => k === '_id' || /Id$/.test(k) || /\._id$/.test(k);
  const fix = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      if ((k === '$and' || k === '$or' || k === '$nor') && Array.isArray(v)) {
        for (const x of v) if (x && typeof x === 'object') fix(x as Record<string, unknown>);
      } else if (typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v) && isIdKey(k)) {
        obj[k] = {$in: [v, new ObjectId(v)]};
      }
    }
    return obj;
  };
  return fix(parsed);
}

export function preparePipeline(stages: unknown): Record<string, unknown>[] {
  if (!Array.isArray(stages)) throw new QueryRefused('pipeline bir dizi olmalı');
  return stages.map(s => {
    const stage = EJSON.deserialize(s as object, {relaxed: false}) as Record<string, unknown>;
    if (stage.$match && typeof stage.$match === 'object') stage.$match = prepareFilter(EJSON.serialize(stage.$match));
    return stage;
  });
}

/** Removes denied fields at any depth, applies the collection's field allowlist, cuts long arrays. */
export function redact(doc: unknown, collection?: string, depth = 0): unknown {
  if (Array.isArray(doc)) {
    const items = doc.slice(0, LIMITS.maxArray).map(d => redact(d, undefined, depth + 1));
    if (doc.length > LIMITS.maxArray) items.push(`… ${doc.length - LIMITS.maxArray} öğe daha (kısaltıldı)`);
    return items;
  }
  if (!doc || typeof doc !== 'object' || doc instanceof ObjectId || doc instanceof Date) return doc;
  if ((doc as {_bsontype?: string})._bsontype) return doc;
  const allow = depth === 0 && collection ? COLLECTIONS[collection]?.fields : undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (DENIED_FIELD.test(k)) continue;
    if (allow && !allow.includes(k)) continue;
    out[k] = redact(v, undefined, depth + 1);
  }
  return out;
}

/** JSON for the model: ObjectIds as hex, dates as ISO strings, capped in size. */
export function toText(value: unknown): string {
  const text = JSON.stringify(EJSON.serialize(value, {relaxed: true}), (_k, v) => {
    if (v && typeof v === 'object' && '$oid' in v) return v.$oid;
    if (v && typeof v === 'object' && '$date' in v) return v.$date;
    return v;
  }, 1);
  return text.length > LIMITS.maxChars ? `${text.slice(0, LIMITS.maxChars)}\n… (çıktı ${text.length} karakter, kısaltıldı; projection ya da limit ile daralt)` : text;
}
