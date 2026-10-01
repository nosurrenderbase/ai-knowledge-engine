/**
 * Game database tools: registered only for people with database access
 * (users db-on) and only when MONGO_RO_URI is configured. Read-only, guarded
 * queries over the allowed collections (see packages/gamedb).
 */
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {QueryRefused, toText, type GameDb} from '@ai-knowledge-engine/gamedb';
import {z} from 'zod';

export const DB_INSTRUCTIONS = `

Oyun veritabanı (db_* ve hazır araçlar; yalnız okuma):
- Bilgi tabanı sistemin NASIL çalıştığını, veritabanı ŞU AN ne olduğunu söyler. "X takımı neden kaybetti?" gibi sorularda ikisini birleştir: önce veriyi çek (match_detail, team_overview), sonra kuralı bilgi tabanından oku (ör. mac-motoru/flows/takim-gucu/sonuc-katmani.md) ve somut sayılarla açıkla.
- Başlangıç: find_team (takım adı ya da başkan adıyla), team_overview, match_detail (lig ya da PvP maçı), league_table (lig ya da takım id). Bunlar yetmezse db_collections → db_fields → db_find / db_count / db_aggregate.
- Id'ler 24 haneli hex; string ya da {"$oid": "…"} ver (ikisi de çalışır). Tarihler UTC; {"$date": "2026-10-01T00:00:00Z"}. Fikstür durumları: scheduled, processing, simulated, uploading, completed, failed, dead.
- Kişisel veri (e-posta, telefon, giriş sağlayıcıları, cihaz/oturum token'ları, ödeme ve kimlik bilgisi) bu araçlarla okunamaz; sorulursa "erişimim yok" de. Başkan adı ve takım adı oyun içi görünen adlardır, gösterilebilir.
- Sorguları dar tut: filtre + projection + limit. Sonuçlar en fazla 100 (find) / 200 (aggregate) belge ve 10 sn ile sınırlı. Veri ikincil sunucudan okunur, birkaç saniye geride olabilir.
- Veriyi olduğu gibi aktar, yorumunu ayrı söyle; bulamadığını "veritabanında bulamadım" diye belirt.`;

type Tracked = (tool: string, input: Record<string, unknown>, fn: () => Promise<{text: string; isError?: boolean; summary: Record<string, unknown>}>) => Promise<unknown>;

const readOnly = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
const json = z.record(z.string(), z.unknown());

export function registerDbTools(server: McpServer, gdb: GameDb, tracked: Tracked): void {
  /** Shapes a result; refused queries come back as a readable error the model can fix. */
  const run = async (fn: () => Promise<unknown>, count: (v: unknown) => number = v => (Array.isArray(v) ? v.length : v ? 1 : 0)) => {
    try {
      const value = await fn();
      if (value === null || (Array.isArray(value) && value.length === 0)) return {text: 'Sonuç yok.', summary: {count: 0}};
      return {text: toText(value), summary: {count: count(value)}};
    } catch (e) {
      if (e instanceof QueryRefused) return {text: `Sorgu reddedildi: ${e.message}`, isError: true, summary: {count: 0, refused: true}};
      throw e;
    }
  };
  const reg = (name: string, title: string, description: string, inputSchema: Record<string, z.ZodType>, fn: (args: Record<string, unknown>) => Promise<unknown>) =>
    server.registerTool(name, {title, description, inputSchema, annotations: readOnly}, async (args: Record<string, unknown>) =>
      tracked(name, args, () => run(() => fn(args))) as never,
    );

  reg('find_team', 'Takım bul', 'Takımı adıyla, başkanının (oyuncunun) adıyla ya da id ile bulur: takım id, ad, başkan, kademe, şu anki lig, ömür boyu sayaçlar.', {query: z.string().min(1).describe('Takım adı, başkan adı (parça olabilir) ya da 24 haneli id')}, a =>
    gdb.findTeam(String(a.query)),
  );
  reg(
    'team_overview',
    'Takım özeti',
    'Takımın ayarları (diziliş, taktikler), başkanı, lig satırı, maç günü kadrosu (slot 1-18: overall, kondisyon, moral, stamina, sakatlık) ve son 8 lig maçı.',
    {team_id: z.string().describe('Takım id (find_team ile)')},
    a => gdb.teamOverview(String(a.team_id)),
  );
  reg(
    'match_detail',
    'Maç detayı',
    'Bir lig maçının (ya da PvP maçının) skoru, durumu, istatistikleri, hata/deneme bilgisi ve maç motorunun girdi fotoğrafı (iki kadro, taktikler, tohum, motor sürümü).',
    {match_id: z.string().describe('league_fixtures ya da pvp_matches id')},
    a => gdb.matchDetail(String(a.match_id)),
  );
  reg(
    'league_table',
    'Lig tablosu',
    'Ligin tamamlanmış maçlardan hesaplanan puan tablosu, fikstür durum sayıları ve tamamlanmamış maçlar. Lig id ya da takım id (takımın en son ligi) alır.',
    {id: z.string().describe('Lig id ya da takım id')},
    a => gdb.leagueTable(String(a.id)),
  );
  reg('db_collections', 'Okunabilir koleksiyonlar', 'Okunabilen koleksiyonlar, ne tuttukları ve onları anlatan bilgi tabanı dokümanı.', {}, async () => gdb.collections());
  reg(
    'db_fields',
    'Koleksiyonun alanları',
    'Bir koleksiyonun alan yolları ve tipleri (rastgele örnek belgelerden); doğru sorgu yazmak için.',
    {collection: z.string()},
    a => gdb.fields(String(a.collection)),
  );
  reg(
    'db_find',
    'Belge ara',
    'İzinli bir koleksiyonda find. filter/projection/sort MongoDB sözdizimi (Extended JSON: {"$oid"}, {"$date"}). En fazla 100 belge.',
    {
      collection: z.string(),
      filter: json.optional(),
      projection: json.optional().describe('Ör. {"name": 1, "status": 1}'),
      sort: json.optional().describe('Ör. {"matchDate": -1}'),
      limit: z.number().int().min(1).max(100).optional(),
      skip: z.number().int().min(0).optional(),
    },
    a => gdb.find({collection: String(a.collection), filter: a.filter, projection: a.projection as Record<string, unknown>, sort: a.sort as Record<string, unknown>, limit: a.limit as number, skip: a.skip as number}),
  );
  reg('db_count', 'Belge say', 'İzinli bir koleksiyonda filtreye uyan belge sayısı.', {collection: z.string(), filter: json.optional()}, async a => ({
    count: await gdb.count(String(a.collection), a.filter),
  }));
  reg(
    'db_aggregate',
    'Toplu sorgu',
    'İzinli bir koleksiyonda aggregation pipeline ($match, $group, $sort, $project, $lookup izinli koleksiyonlara…). Yazma aşamaları ve kod çalıştıran operatörler yasak; sonuç en fazla 200 belge.',
    {collection: z.string(), pipeline: z.array(json)},
    a => gdb.aggregate(String(a.collection), a.pipeline),
  );
}
