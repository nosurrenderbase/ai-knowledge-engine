/**
 * Manual index maintenance and search from the command line.
 *
 *   npm run index -w @ai-knowledge-engine/search -- sync [--area frontend] [--kb work/kb/frontend]
 *   npm run index -w @ai-knowledge-engine/search -- search "günde kaç pvp maçı" [--area backend] [--module pvp-match]
 *   npm run index -w @ai-knowledge-engine/search -- status [--area frontend]
 */
import {execFileSync} from 'node:child_process';
import * as path from 'node:path';
import {parseArgs} from 'node:util';
import {createClient} from 'redis';
import {areaLabel} from '@ai-knowledge-engine/kb';
import {loadDotEnv, loadSearchConfig, REPO_ROOT} from './config.ts';
import {readMeta, syncIndex} from './indexer.ts';
import {search} from './search.ts';
import {Voyage} from './voyage.ts';

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    area: {type: 'string', default: 'backend'},
    kb: {type: 'string'},
    module: {type: 'string'},
    kind: {type: 'string'},
    limit: {type: 'string', default: '8'},
  },
});

await loadDotEnv(process.env);
const area = values.area!;
const cfg = loadSearchConfig(process.env, area);
const label = areaLabel(area);
const client = createClient({url: cfg.redisUrl, password: cfg.redisPassword});
await client.connect();
const voyage = new Voyage(cfg.voyage);

try {
  const [command, ...rest] = positionals;
  if (command === 'sync') {
    const areaDir = path.resolve(values.kb ?? path.join(REPO_ROOT, 'work/kb', area));
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: areaDir, encoding: 'utf8'}).trim();
    const res = await syncIndex({client, voyage, target: cfg.target, areaDir, commit, cacheDir: cfg.cacheDir, label});
    console.log(JSON.stringify({commit, ...res}));
  } else if (command === 'search') {
    const hits = await search({client, voyage, spec: cfg.target, model: cfg.target.model}, rest.join(' '), {
      limit: Number(values.limit),
      filters: {module: values.module, kind: values.kind},
    });
    for (const h of hits) console.log(`${h.score}\t${h.path}\t${h.section}`);
  } else if (command === 'status') {
    console.log(JSON.stringify(await readMeta(client, cfg.target)));
  } else {
    console.error('Kullanım: cli.ts sync|search|status');
    process.exitCode = 1;
  }
} finally {
  await client.quit();
}
