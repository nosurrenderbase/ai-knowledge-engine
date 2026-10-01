/**
 * User and token management until the admin panel exists.
 *
 *   npm run users -- add "Ahmet Yılmaz" --email ahmet@nosurrender.studio [--note PM]
 *   npm run users -- list
 *   npm run users -- token <id|e-posta> [--label laptop]     # extra token for an existing user
 *   npm run users -- tokens <id|e-posta>
 *   npm run users -- revoke <önek>                            # e.g. 3f9a1c2b
 *   npm run users -- disable|enable <id|e-posta>
 *   npm run users -- db-on|db-off <id|e-posta>   # oyun veritabanı araçları (MCP db_*)
 *   npm run users -- usage [--days 30]
 *   npm run users -- queries [--days 7] [--user <id|e-posta>] [--tool search] [--empty] [--limit 50]
 *   npm run users -- purge [--days 90]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {parseArgs} from 'node:util';
import {createDb, databaseUrl, migrate} from './db.ts';
import {purgeUsage, recentQueries, usageSummary} from './usage.ts';
import {addUser, findUser, issueToken, listTokens, listUsers, revokeToken, setDbAccess, setUserDisabled} from './users.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const envFile = path.join(REPO_ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    email: {type: 'string'},
    note: {type: 'string'},
    label: {type: 'string'},
    days: {type: 'string'},
    user: {type: 'string'},
    tool: {type: 'string'},
    empty: {type: 'boolean', default: false},
    limit: {type: 'string'},
  },
});

const fmt = (d: Date | null) => (d ? d.toLocaleString('tr-TR', {timeZone: 'Europe/Istanbul'}) : '-');
const db = createDb({url: databaseUrl(process.env)});

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function user(ref: string | undefined) {
  if (!ref) fail('kullanıcı gerekli: id ya da e-posta');
  const u = await findUser(db, ref);
  if (!u) fail(`kullanıcı bulunamadı: ${ref}`);
  return u;
}

try {
  await migrate(db);
  const [command, ...args] = positionals;
  switch (command) {
    case 'add': {
      if (!args[0]) fail('ad gerekli: users add "Ad Soyad" --email ...');
      const u = await addUser(db, {name: args[0], email: values.email, note: values.note});
      const t = await issueToken(db, u.id, values.label);
      console.log(`Kullanıcı #${u.id} ${u.name} eklendi.\nToken (yalnız şimdi gösteriliyor, saklanmıyor):\n\n  ${t.token}\n`);
      break;
    }
    case 'token': {
      const u = await user(args[0]);
      const t = await issueToken(db, u.id, values.label);
      console.log(`${u.name} için yeni token (yalnız şimdi gösteriliyor):\n\n  ${t.token}\n`);
      break;
    }
    case 'tokens': {
      const u = await user(args[0]);
      for (const t of await listTokens(db, u.id)) {
        console.log(`${t.prefix}\t${t.label ?? ''}\toluşturma ${fmt(t.createdAt)}\tson kullanım ${fmt(t.lastUsedAt)}\t${t.revokedAt ? `İPTAL ${fmt(t.revokedAt)}` : 'aktif'}`);
      }
      break;
    }
    case 'revoke': {
      if (!args[0]) fail('token öneki gerekli (users tokens <kullanıcı> ile görülür)');
      console.log((await revokeToken(db, args[0])) ? 'iptal edildi' : 'aktif token bulunamadı');
      break;
    }
    case 'disable':
    case 'enable': {
      const u = await user(args[0]);
      await setUserDisabled(db, u.id, command === 'disable');
      console.log(`${u.name} ${command === 'disable' ? 'devre dışı' : 'etkin'}`);
      break;
    }
    case 'db-on':
    case 'db-off': {
      const u = await user(args[0]);
      await setDbAccess(db, u.id, command === 'db-on');
      console.log(`${u.name}: oyun veritabanı erişimi ${command === 'db-on' ? 'açık' : 'kapalı'}`);
      break;
    }
    case 'list': {
      console.log('id\tad\te-posta\taktif token\tson kullanım\t30 günde çağrı\tdurum');
      for (const u of await listUsers(db)) {
        console.log(`${u.id}\t${u.name}\t${u.email ?? '-'}\t${u.activeTokens}\t${fmt(u.lastUsedAt)}\t${u.calls30d}\t${u.disabledAt ? 'devre dışı' : 'etkin'}\t${u.dbAccess ? 'db' : '-'}`);
      }
      break;
    }
    case 'usage': {
      const days = Number(values.days ?? 30);
      console.log(`Son ${days} gün:\nkullanıcı\taraç\tçağrı\thata`);
      for (const r of await usageSummary(db, days)) console.log(`${r.name}\t${r.tool}\t${r.calls}\t${r.errors}`);
      break;
    }
    case 'queries': {
      const u = values.user ? await user(values.user) : null;
      const rows = await recentQueries(db, {
        days: Number(values.days ?? 7),
        userId: u?.id,
        tool: values.tool,
        emptyOnly: values.empty,
        limit: Number(values.limit ?? 50),
      });
      for (const r of rows) {
        const asked = r.input.query ?? r.input.path ?? r.input.pattern ?? r.input.prefix ?? '';
        const found = Array.isArray(r.result.paths) ? (r.result.paths as string[]).slice(0, 3).join(', ') : '';
        console.log(`${fmt(r.at)}\t${r.name ?? '?'}\t${r.tool}\t${asked}\t→ ${r.result.count ?? '-'} ${found}${r.error ? `\tHATA: ${r.error}` : ''}`);
      }
      break;
    }
    case 'purge': {
      const days = Number(values.days ?? process.env.USAGE_RETENTION_DAYS ?? 90);
      console.log(`${await purgeUsage(db, days)} kayıt silindi (${days} günden eski)`);
      break;
    }
    default:
      fail('Kullanım: users add|list|token|tokens|revoke|disable|enable|db-on|db-off|usage|queries|purge (ayrıntı: packages/accounts/src/cli.ts)');
  }
} finally {
  await db.end();
}
