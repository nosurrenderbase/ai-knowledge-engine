/**
 * Generated documents of the match engine knowledge base (no AI):
 *   metrikler/<stat>.md        one per player stat the backend stores: what the engine does with it
 *   genel/metrik-haritasi.md   every stat → engine field → factor functions → gains → call sites
 *   genel/oyun-stilleri.md     every play style → hooks → multipliers
 * Each keeps a written part above its generated block (see writeCard).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {writeCard} from './cards.ts';
import {buildEngineModel, factorAt, inPool, isPoolFunc, statSlug, usersOf, type EngineFunc, type EngineModel, type Gain, type Site} from './engine-model.ts';

export interface EngineDocsOptions {
  /** Knowledge base area for the engine (e.g. <kb>/mac-motoru). */
  areaDir: string;
  /** Match engine repo, checked out at the commit to document. */
  sourceDir: string;
}

export interface EngineDocsResult {
  commit: string;
  metrics: number;
  written: string[];
  /** Metric cards whose stat no longer exists. */
  orphanCards: string[];
}

const GENERATOR = 'ai-knowledge-engine/packages/kb (mac-motoru)';
const ATTR_FILE = 'internal/ai/attr.go';

const code = (s: string) => `\`${s.replace(/`/g, "'")}\``;
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const loc = (s: Site | {file: string; line: number}) => code(`${s.file}:${s.line}`);
const mul = (x: number) => `×${x.toFixed(2)}`;

/** Player fields outside detailedStats that the engine reads (card path → Attr field). */
const IDENTITY: {path: string; field: string; title: string}[] = [
  {path: 'height', field: 'Height', title: 'Boy (cm)'},
  {path: 'preferredFoot', field: 'Foot', title: 'Tercih edilen ayak'},
  {path: 'overall', field: 'Overall', title: 'Overall'},
  {path: 'playStyles', field: 'Styles', title: 'Oyun stilleri (PlayStyles)'},
];

/** Turkish names of the stats, for titles and search aliases (unknown stats fall back to their field name). */
const STAT_NAMES: Record<string, string> = {
  crossing: 'Orta', finishing: 'Bitiricilik', headingAccuracy: 'Kafa isabeti', shortPassing: 'Kısa pas', volleys: 'Vole',
  dribbling: 'Dribbling (top sürme)', curve: 'Falso', freeKickAccuracy: 'Frikik isabeti', longPassing: 'Uzun pas', ballControl: 'Top kontrolü',
  acceleration: 'Hızlanma (ivme)', sprintSpeed: 'Sprint hızı', agility: 'Çeviklik', reactions: 'Reaksiyon', balance: 'Denge',
  shotPower: 'Şut gücü', jumping: 'Sıçrama', stamina: 'Dayanıklılık (stamina)', strength: 'Güç (fizik)', longShots: 'Uzaktan şut',
  aggression: 'Agresiflik (sertlik)', interceptions: 'Pas arası', attackingPosition: 'Hücumda pozisyon alma', vision: 'Vizyon (oyun görüşü)',
  penalties: 'Penaltı', composure: 'Soğukkanlılık', defensiveAwareness: 'Savunma farkındalığı', standingTackle: 'Top kapma (ayakta müdahale)',
  slidingTackle: 'Kayarak müdahale', diving: 'Uzanma (kaleci)', handling: 'Topu tutma (kaleci)', kicking: 'Vuruş ve degaj (kaleci)',
  positioning: 'Pozisyon alma (kaleci)', reflexes: 'Refleks (kaleci)', height: 'Boy', preferredFoot: 'Tercih edilen ayak',
  overall: 'Overall (OVR)', playStyles: 'Oyun stilleri (PlayStyles)',
};

function metricMeta(m: Metric): {title: string; aliases: string[]} {
  const key = m.path.split('.').pop()!;
  const tr = STAT_NAMES[key] ?? key;
  const short = tr.replace(/\s*\(.*\)$/, '');
  const aliases = [...new Set([key, tr, short, `${short} ne işe yarar`, `${short} maçı ne kadar etkiliyor`, `${key} etkisi`])];
  return {title: `${tr}: maç motorunda etkisi`, aliases};
}

interface Metric {
  path: string;
  slug: string;
  field: string | null;
  face: string | null;
  share: number | null;
  identity: boolean;
}

function metrics(model: EngineModel): Metric[] {
  const fieldNames = new Set(model.fields.map(f => f.name));
  return [
    ...model.dbStats.map(s => ({path: `detailedStats.${s.path}`, slug: statSlug(s.path), field: s.field, face: s.face, share: s.share, identity: false})),
    ...IDENTITY.filter(i => fieldNames.has(i.field)).map(i => ({path: i.path, slug: statSlug(i.path), field: i.field, face: null, share: null, identity: true})),
  ];
}

/** Users of a field, plus the users of the fields the bridge copies it into. */
function allUsers(model: EngineModel, field: string) {
  const own = usersOf(model, field);
  const alias = model.aliases.get(field);
  const copied = alias ? alias.targets.flatMap(t => usersOf(model, t)) : [];
  return {own, copied, alias};
}

const isUsed = (model: EngineModel, field: string | null) => {
  if (!field) return false;
  const u = allUsers(model, field);
  return u.own.length + u.copied.length > 0;
};

function gainRange(g: Gain): string {
  if (g.value === null) return '—';
  return `${mul(factorAt(g.value, 50))} … ${mul(factorAt(g.value, 90))}`;
}

function gainCell(gains: Gain[]): string {
  if (!gains.length) return '—';
  return gains.map(g => `${code(`attrFactor(${g.arg}, ${g.expr})`)}${g.value !== null && g.expr !== String(g.value) ? ` = ${g.value}` : ''}`).join('<br>');
}

function rangeCell(gains: Gain[]): string {
  return gains.length ? gains.map(gainRange).join('<br>') : '—';
}

function sitesOf(model: EngineModel, f: EngineFunc): Site[] {
  return f.receiver === 'Attr' ? (model.callSites.get(f.method) ?? []) : [];
}

function renderMetric(model: EngineModel, m: Metric): string {
  const out: string[] = [];
  const fieldInfo = m.field ? model.fields.find(f => f.name === m.field) : undefined;
  out.push('## Kimlik', '', '| | |', '|---|---|');
  out.push(`| Oyuncu verisindeki alan | ${code(m.path)} |`);
  out.push(`| Motordaki alan | ${m.field ? `${code(`ai.Attr.${m.field}`)} (${code(ATTR_FILE)})` : '— (motor bu alanı okumuyor)'} |`);
  if (fieldInfo?.comment) out.push(`| Koddaki not | ${cell(fieldInfo.comment)} |`);
  if (!m.identity) out.push(`| Koçluk takviyesi | ${m.face ? `${code(m.face)} kart yüzünün takviyesinin ${m.share} katı bu stata eklenir` : '—'} |`);
  if (m.field && !m.identity) out.push(`| Takım ortalamasına (maç öncesi yeniden ortalama) girer | ${inPool(model, m.field) ? 'evet' : 'hayır'} |`);
  out.push('');

  const {own: users, copied, alias} = m.field ? allUsers(model, m.field) : {own: [], copied: [], alias: undefined};
  out.push('## Motorda nerede kullanılıyor', '');
  if (alias) {
    out.push(`Köprü (${code('internal/lineup/attr_bridge.go')}) ${alias.when ? `${code(alias.when)} olduğunda ` : ''}bu değeri ${alias.targets.map(t => code(t)).join(', ')} alanlarına kopyalar; o alanları okuyan hesaplar bu statı kullanır: ${[...new Set(copied.map(u => code(u.func.name)))].join(', ') || '—'}. Ayrıntı ilgili statların kartlarında.`, '');
  }
  if (!m.field || !users.length) {
    if (alias && copied.length) return out.join('\n');
    out.push(m.field ? '_Motor bu alanı hiçbir hesapta kullanmıyor._' : '_Motor bu statı okumuyor: maç sonucuna etkisi yok._', '');
    return out.join('\n');
  }
  out.push(`Çarpanlar ${model.neutral} değerinde 1'dir; "50 … 90" sütunu statı 50 ve 90 olan iki oyuncunun çarpanını gösterir (stil etkisi hariç).`, '');
  out.push('| Fonksiyon | Yer | Nasıl | Çarpan | 50 … 90 | Stil kancaları |', '|---|---|---|---|---|---|');
  for (const {func, via} of users) {
    const how = via.length ? `${via.map(v => code(`Attr.${v}`)).join(', ')} üzerinden` : 'doğrudan okur';
    out.push(`| ${code(func.name)} | ${loc(func)} | ${how} | ${gainCell(func.gains)} | ${rangeCell(func.gains)} | ${func.hooks.map(code).join(', ') || '—'} |`);
  }
  out.push('');
  const attrUsers = users.filter(u => u.func.receiver === 'Attr' && !u.via.length);
  const called = attrUsers.filter(u => sitesOf(model, u.func).length);
  if (called.length) {
    out.push('## Çarpanın tüketildiği yerler', '');
    for (const {func} of called) {
      out.push(`- ${code(func.name)}: ${sitesOf(model, func).map(s => `${code(s.func)} (${loc(s)})`).join(', ')}`);
    }
    out.push('');
  }
  return out.join('\n');
}

function renderMap(model: EngineModel, list: Metric[]): string {
  const out: string[] = [];
  const used = list.filter(m => isUsed(model, m.field));
  const unused = list.filter(m => !used.includes(m));
  out.push('## Statlar', '');
  out.push('| Stat | Motordaki alan | Kullanan fonksiyonlar | Koçluk payı |', '|---|---|---|---|');
  for (const m of used) {
    const users = usersOf(model, m.field!).filter(u => !u.via.length || u.func.receiver !== 'Attr');
    const names = [...new Set(users.flatMap(u => (u.via.length ? u.via.map(v => `Attr.${v}`) : [u.func.name])))];
    const alias = model.aliases.get(m.field!);
    if (alias) names.push(`(${alias.targets.join(', ')} yerine${alias.when ? `, ${alias.when}` : ''})`);
    out.push(`| [${code(m.path)}](../metrikler/${m.slug}.md) | ${code(m.field!)} | ${names.map(n => (n.startsWith('(') ? n : code(n))).join(', ')} | ${m.face ? `${m.face} × ${m.share}` : '—'} |`);
  }
  out.push('');
  out.push('## Motorun okumadığı statlar', '');
  out.push(
    unused.length ? unused.map(m => `- [${code(m.path)}](../metrikler/${m.slug}.md)${m.field ? ` (${code(m.field)} alanına aktarılıyor ama hiçbir hesap okumuyor)` : ''}`).join('\n') : '_Yok._',
    '',
  );

  out.push('## Çarpan fonksiyonları', '');
  out.push(`${code('attrFactor(stat, gain) = 1 + gain·(stat − ' + model.neutral + ')/30')}, ${model.neutral}'te 1, uçlarda ${code('1 ± gain')} ile sınırlı.`, '');
  out.push('| Fonksiyon | Okuduğu statlar | Çarpan | 50 … 90 | Stil kancaları | Tüketildiği yerler |', '|---|---|---|---|---|---|');
  const factorFuncs = model.funcs.filter(f => !isPoolFunc(f) && (f.gains.length || (f.receiver === 'Attr' && f.fields.length && model.callSites.has(f.method))));
  for (const f of factorFuncs) {
    const reads = [...new Set([...f.fields, ...f.calls.flatMap(c => model.funcs.find(x => x.name === `Attr.${c}`)?.fields ?? [])])];
    out.push(`| ${code(f.name)} (${loc(f)}) | ${reads.map(code).join(', ') || '—'} | ${gainCell(f.gains)} | ${rangeCell(f.gains)} | ${f.hooks.map(code).join(', ') || '—'} | ${sitesOf(model, f).map(s => code(s.func)).join(', ') || '—'} |`);
  }
  out.push('');
  return out.join('\n');
}

function renderStyles(model: EngineModel): string {
  const out: string[] = [];
  const c = model.styleConsts;
  out.push('## Çarpan sözleşmesi', '');
  out.push('| Sabit | Değer |', '|---|---|');
  for (const [k, v] of Object.entries(c)) out.push(`| ${code(k)} | ${v} |`);
  out.push('');
  out.push('## Kancalar', '');
  out.push('| Kanca | Tür | Ne değişir |', '|---|---|---|');
  for (const h of model.hooks) out.push(`| ${code(h.name)} | ${h.kind === 'tend' ? 'eğilim' : 'yetenek'} | ${cell(h.comment) || '—'} |`);
  out.push('');
  out.push('## Stiller', '');
  out.push('"+" (plus) sürümü aynı kancalara daha büyük sabitle (yetenek ' + (c.styleExecPlus ?? '?') + ', eğilim ' + (c.styleTendPlus ?? '?') + ') girer. "ters" etkiler çarpanı böler.', '');
  out.push('| Stil | Etkiler | Not |', '|---|---|---|');
  for (const s of model.styles) {
    const eff = s.effects.map(e => {
      const k = e.tend ? c.styleTend : c.styleExec;
      const v = k ? (e.inv ? 1 / k : k) : null;
      return `${code(e.hook)} ${v ? mul(v) : ''}${e.inv ? ' (ters)' : ''}`.trim();
    });
    out.push(`| ${code(s.name)} | ${eff.join(', ')} | ${cell(s.note) || '—'} |`);
  }
  out.push('');
  return out.join('\n');
}

export function generateEngineDocs(opts: EngineDocsOptions): EngineDocsResult {
  const model = buildEngineModel(opts.sourceDir);
  const base = {code_commit: model.commit, generated_by: GENERATOR};
  const written: string[] = [];
  const list = metrics(model);

  for (const m of list) {
    const rel = `metrikler/${m.slug}.md`;
    const usage = isUsed(model, m.field) ? 'kullanılıyor' : 'kullanılmıyor';
    writeCard(
      path.join(opts.areaDir, rel),
      {
        type: 'metric',
        title: JSON.stringify(metricMeta(m).title),
        name: JSON.stringify(m.path),
        field: m.field ?? '—',
        usage,
        aliases: JSON.stringify(metricMeta(m).aliases),
        ...base,
      },
      renderMetric(model, m),
      '## Ne işe yarar\n\n_TODO: 2-4 cümle, iş diliyle: bu stat maçta neyi değiştirir, ne kadar etkili, hangi pozisyonda önemli (AI doldurur)._\n',
    );
    written.push(rel);
  }

  writeCard(
    path.join(opts.areaDir, 'genel/metrik-haritasi.md'),
    {type: 'overview', title: JSON.stringify('Metrik haritası: oyuncu statı → motor alanı → çarpan → kullanıldığı yer'), ...base},
    renderMap(model, list),
    '## Bu belge ne için\n\n"Maç motoru hangi statları kullanıyor?", "Şu stat neyi etkiliyor, ne kadar?", "Hangi statın maça hiç etkisi yok?" sorularının kod tarafı. Tablolar koddan otomatik üretilir; statların birbirine göre ne kadar etkili olduğunun yorumu [metriklerin etkisi](metriklerin-etkisi.md) belgesindedir.\n',
  );
  written.push('genel/metrik-haritasi.md');

  if (model.styles.length) {
    writeCard(
      path.join(opts.areaDir, 'genel/oyun-stilleri.md'),
      {type: 'overview', title: JSON.stringify('Oyun stilleri (PlayStyles): stil → kanca → çarpan'), ...base},
      renderStyles(model),
      '## Bu belge ne için\n\n"Şu oyun stili maçta ne işe yarıyor?" sorusunun kod tarafı. Her stil bir ya da birkaç kancaya sabit bir çarpan ekler; yetenek kancaları isabeti ve hızı, eğilim kancaları bir hareketi ne sık denediğini değiştirir. Tablolar koddan otomatik üretilir.\n',
    );
    written.push('genel/oyun-stilleri.md');
  }

  const live = new Set(list.map(m => `${m.slug}.md`));
  const dir = path.join(opts.areaDir, 'metrikler');
  const orphanCards = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md') && !live.has(f)).map(f => `metrikler/${f}`) : [];
  return {commit: model.commit, metrics: list.length, written, orphanCards};
}
