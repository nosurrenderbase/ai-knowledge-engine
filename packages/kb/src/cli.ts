/**
 * Manual use of the knowledge base tools (the sync worker calls them directly).
 *
 *   npm run gen:cards -- --kb <kb>/backend --source <kod reposu> <modül> [<modül> ...]
 *   npm run build:chunks -- --kb <kb>/backend [--out chunks.jsonl]
 */
import * as path from 'node:path';
import {parseArgs} from 'node:util';
import {generateCards} from './cards.ts';
import {buildChunks, writeChunks} from './chunks.ts';

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    kb: {type: 'string'},
    source: {type: 'string'},
    out: {type: 'string'},
  },
});
const [command, ...rest] = positionals;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!values.kb) fail('--kb <bilgi tabanı alan klasörü> gerekli (ör. ../ai-knowledge-base/backend)');
const areaDir = path.resolve(values.kb);

if (command === 'gen-cards') {
  if (!values.source) fail('--source <kod reposu> gerekli');
  if (rest.length === 0) fail('en az bir modül adı gerekli');
  const counts = generateCards({areaDir, sourceDir: path.resolve(values.source), modules: rest});
  for (const [module, count] of Object.entries(counts)) console.log(`${module}: ${count} kart → usecases/${module}/`);
} else if (command === 'build-chunks') {
  const out = path.resolve(values.out ?? 'chunks.jsonl');
  const chunks = buildChunks(areaDir);
  writeChunks(chunks, out);
  console.log(`${chunks.length} parça → ${out}`);
} else {
  fail('Kullanım: cli.ts gen-cards|build-chunks --kb <alan> [--source <kod>] [--out <dosya>] [modüller]');
}
