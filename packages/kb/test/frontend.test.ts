import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {genBlock, manualPart} from '../src/cards.ts';
import {parseDoc} from '../src/docs.ts';
import {generateFrontendDocs, kebab, routeSlug} from '../src/frontend-cards.ts';
import {buildFrontendModel, opKey, parseOperation, routePath, routesReaching} from '../src/frontend-model.ts';
import {initRepo, read, tmpDir, write} from './helpers.ts';

describe('parseOperation', () => {
  it('reads kind, name, variables and top-level fields, aliases and nesting included', () => {
    const doc = `
      query HomeData($id: ID!, $limit: Int) {
        me { id team { name } }
        # a comment with { braces }
        top: leaderboard(limit: $limit, filter: { tier: "A" }) { rows { id } }
        __typename
      }`;
    assert.deepEqual(parseOperation(doc), {kind: 'query', name: 'HomeData', variables: '$id: ID!, $limit: Int', rootFields: ['me', 'leaderboard']});
  });

  it('handles mutations without variables and returns null for non-operations', () => {
    assert.deepEqual(parseOperation('mutation ClaimAll { claimAll }'), {kind: 'mutation', name: 'ClaimAll', variables: '', rootFields: ['claimAll']});
    assert.equal(parseOperation('fragment X on Y { a }'), null);
  });
});

describe('names', () => {
  it('turns routes and operations into paths', () => {
    assert.equal(routePath('app/(tabs)/index.tsx'), '/');
    assert.equal(routePath('app/(tabs)/stadium.tsx'), '/stadium');
    assert.equal(routePath('app/buildings/[id].tsx'), '/buildings/[id]');
    assert.equal(routePath('app/_layout.tsx'), 'kök düzen');
    assert.equal(routePath('app/(tabs)/_layout.tsx'), '(tabs) düzeni');
    assert.equal(routeSlug('app/(chat)/room/[groupId].tsx'), 'chat-room-group-id');
    assert.equal(routeSlug('app/_layout.tsx'), 'kok-duzen');
    assert.equal(kebab('CreatePvpMatch'), 'create-pvp-match');
    assert.equal(kebab('MyKYCStatus'), 'my-kyc-status');
  });
});

const APP: Record<string, string> = {
  'app/_layout.tsx': "import Root from '@/components/Root';\nexport default Root;\n",
  'app/(tabs)/index.tsx': "import Home from '@/components/pages/home/Home';\nexport default function Index() { return <Home />; }\n",
  'app/pvp.tsx': "import {PvpPanel} from '@/components/pvp/PvpPanel';\nexport default function Pvp() { return <PvpPanel />; }\n",
  'src/components/Root.tsx': 'export default function Root() { return null; }\n',
  'src/components/pages/home/index.ts': "export {TopBar} from './TopBar';\nexport {OldPanel as LegacyPanel} from './OldPanel';\nexport * from './widgets';\n",
  'src/components/pages/home/OldPanel.tsx': 'export const OldPanel = () => null;\n',
  'src/components/pages/home/widgets.tsx': 'export function Clock() { return null; }\nexport default function Unused() { return null; }\n',
  'src/components/pages/home/TopBar.tsx': 'export const TopBar = () => null;\n',
  'src/components/pages/home/Home.tsx': [
    "import {TopBar, Clock} from './';",
    "import {useQuery} from '@apollo/client';",
    "import {MeQuery} from '@/graphql/me';",
    "import {router} from 'expo-router';",
    "import {track} from '@/lib/analytics';",
    'export default function Home() {',
    '  useQuery(MeQuery);',
    "  track('home_opened');",
    "  return <Button onPress={() => router.push('/pvp')} />;",
    '}',
    '',
  ].join('\n'),
  'src/components/pvp/PvpPanel.tsx': [
    "import {useMutation} from '@apollo/client';",
    "import {CreatePvpMatchMutation} from '@/graphql';",
    'export function PvpPanel() {',
    '  useMutation(CreatePvpMatchMutation);',
    '  return null;',
    '}',
    '',
  ].join('\n'),
  'src/components/old/Unused.tsx': "import {OldThingQuery} from '@/graphql/old';\nexport const Unused = () => OldThingQuery;\n",
  'src/lib/analytics/index.ts': 'export function track(_e: string) {}\n',
  'src/graphql/index.ts': "export * from './pvp';\n",
  'src/graphql/me.ts': "import {graphql} from '@/gql';\nexport const MeQuery = graphql(`\n  query Me {\n    me { id isPro }\n  }\n`);\n",
  'src/graphql/pvp.ts': [
    "import {graphql} from '@/gql';",
    "import {gql} from '@apollo/client';",
    'export const CreatePvpMatchMutation = graphql(`',
    '  mutation CreatePvpMatch($input: CreatePvpMatchInput!) {',
    '    createPvpMatch(input: $input) { id }',
    '  }',
    '`);',
    'export const RemainingQuery = gql`',
    '  query PvpRemaining {',
    '    pvpMatchesRemainingToday',
    '  }',
    '`;',
    '',
  ].join('\n'),
  'src/graphql/old.ts': "import {graphql} from '@/gql';\nexport const OldThingQuery = graphql(`query OldThing { oldThing }`);\n",
  'src/gql/graphql.ts': '// generated, ignored\n',
  'src/components/__tests__/Home.test.tsx': 'test("x", () => {});\n',
};

const BACKEND: Record<string, string> = {
  'src/modules/user/presentation/user.resolver.ts': '@Resolver()\nexport class R {\n  @Query(() => User)\n  me() {}\n}\n',
  'src/modules/pvp-match/presentation/pvp.resolver.ts':
    "@Resolver()\nexport class P {\n  @Mutation(() => Boolean)\n  createPvpMatch() {}\n  @Query(() => Int, {name: 'pvpMatchHistory'})\n  history() {}\n}\n",
};

describe('frontend model and documents', () => {
  let root: string;
  let app: string;
  let backend: string;
  let backendKb: string;
  let area: string;

  before(() => {
    root = tmpDir();
    app = path.join(root, 'app');
    backend = path.join(root, 'backend');
    backendKb = path.join(root, 'kb/backend');
    area = path.join(root, 'kb/frontend');
    initRepo(app, APP);
    initRepo(backend, BACKEND);
    write(backendKb, 'flows/pvp/meydan-okuma.md', '---\ntitle: PvP meydan okuma\nstatus: canlıda\n---\n\n# PvP\n\n`createPvpMatch` maçı başlatır.\n');
    write(backendKb, 'flows/pvp/eski.md', '---\ntitle: Eski\nstatus: kaldırıldı\n---\n\n`createPvpMatch` eskiden…\n');
  });
  after(() => fs.rmSync(root, {recursive: true, force: true}));

  it('finds operations, users through barrels, and the routes that reach them', () => {
    const m = buildFrontendModel(app);
    assert.deepEqual(m.ops.map(o => o.name).sort(), ['CreatePvpMatch', 'Me', 'OldThing', 'PvpRemaining']);
    assert.ok(!m.files.has('src/gql/graphql.ts') && !m.files.has('src/components/__tests__/Home.test.tsx'), 'üretilmiş ve test dosyaları yok sayılır');
    const create = m.ops.find(o => o.name === 'CreatePvpMatch')!;
    assert.deepEqual(m.opUsers.get(opKey(create)), ['src/components/pvp/PvpPanel.tsx'], "barrel (export *) üzerinden");
    assert.deepEqual(routesReaching(m, 'src/components/pvp/PvpPanel.tsx'), ['app/pvp.tsx']);
    const raw = m.ops.find(o => o.name === 'PvpRemaining')!;
    assert.equal(raw.style, 'raw');
    assert.ok(!m.reachable.has('src/components/old/Unused.tsx'));
    assert.ok(m.reachable.has('src/components/pages/home/TopBar.tsx'), "klasörün kendisinden içe aktarma ('./') çözülür");
    assert.ok(m.reachable.has('src/components/pages/home/widgets.tsx'), 'export * üzerinden içe aktarılan ad izlenir');
    assert.ok(!m.reachable.has('src/components/pages/home/OldPanel.tsx'), 'barrel yeniden dışa aktarsa da kimse almıyorsa erişilmez');
    assert.deepEqual(m.files.get('src/components/pages/home/Home.tsx')?.navTargets, ['/pvp']);
    assert.deepEqual(m.files.get('src/components/pages/home/Home.tsx')?.events, ['home_opened']);
  });

  it('writes operation and screen cards, the API map and the unused-code report', () => {
    const res = generateFrontendDocs({areaDir: area, sourceDir: app, backendDir: backend, backendAreaDir: backendKb});
    assert.equal(res.operations, 4);
    assert.equal(res.routes, 3);

    const card = read(area, 'api/create-pvp-match.md');
    const {meta} = parseDoc(card);
    assert.equal(meta.type, 'api');
    assert.equal(meta.usage, 'aktif');
    assert.equal(meta.backend, 'var');
    assert.match(manualPart(card), /_TODO: 1-2 cümle/);
    assert.match(card, /\[PvP meydan okuma\]\(\.\.\/\.\.\/backend\/flows\/pvp\/meydan-okuma\.md\)/);
    assert.doesNotMatch(card, /eski\.md/, '"kaldırıldı" backend dokümanlarına link verilmez');
    assert.match(card, /\| `src\/components\/pvp\/PvpPanel\.tsx` \| \[\/pvp\]\(\.\.\/ekranlar\/pvp\.md\) \|/);

    assert.equal(parseDoc(read(area, 'api/pvp-remaining.md')).meta.backend, 'eksik');
    assert.match(read(area, 'api/pvp-remaining.md'), /`pvpMatchesRemainingToday` \*\*\(backend'de yok\)\*\*/);
    assert.equal(parseDoc(read(area, 'api/old-thing.md')).meta.usage, 'erişilmiyor');

    const home = read(area, 'ekranlar/tabs-index.md');
    assert.match(home, /\[Me\]\(\.\.\/api\/me\.md\)/);
    assert.match(home, /## Yönlendirdiği rotalar\n\n`\/pvp`/);
    assert.match(home, /`home_opened`/);

    const map = read(area, 'genel/api-haritasi.md');
    assert.match(map, /\| `createPvpMatch` \| mutation \| \[CreatePvpMatch\]\(\.\.\/api\/create-pvp-match\.md\) \| \[\/pvp\]\(\.\.\/ekranlar\/pvp\.md\) \|/);
    assert.match(map, /## Frontend'in hiç çağırmadığı backend alanları[\s\S]*`pvpMatchHistory`/);
    assert.match(map, /## Backend'de olmayan alanı çağıran[\s\S]*PvpRemaining[\s\S]*`pvpMatchesRemainingToday`/);
    assert.match(read(area, 'genel/kullanilmayan-kod.md'), /### `src\/components\/old`\n\n- `Unused\.tsx`/);
  });

  it('keeps the written paragraph and reports cards of operations that went away', () => {
    const file = path.join(area, 'api/create-pvp-match.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/_TODO:[^\n]*/, 'Arkadaşa PvP daveti gönderir.'));
    write(area, 'api/gone-op.md', '---\ntype: api\n---\n\n## Ne yapar\n\nEski.\n\n<!-- gen:start -->\nx\n<!-- gen:end -->\n');
    const res = generateFrontendDocs({areaDir: area, sourceDir: app, backendDir: backend, backendAreaDir: backendKb});
    assert.match(read(area, 'api/create-pvp-match.md'), /Arkadaşa PvP daveti gönderir\./);
    assert.ok(genBlock(read(area, 'api/create-pvp-match.md')));
    assert.deepEqual(res.orphanCards, ['api/gone-op.md']);
  });
});
