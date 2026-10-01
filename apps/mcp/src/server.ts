/**
 * The MCP server: four read-only tools over the Efsane Başkan knowledge base,
 * which has three areas: backend (rules, numbers, server flows), frontend
 * (the mobile app: screens, what the player sees, which API is called where)
 * and mac-motoru (the match engine: which stats decide a match, and how much).
 * One McpServer is built per HTTP request (stateless); the heavy parts
 * (Redis client, embedder, caches) are shared through `Services`.
 */
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {Principal, UsageEvent} from '@ai-knowledge-engine/accounts';
import {search, type SearchContext, type SearchHit} from '@ai-knowledge-engine/search';
import {z} from 'zod';
import {splitArea, type KbStore} from './kb-store.ts';

export const INSTRUCTIONS = `Efsane Başkan oyununun bilgi tabanı, üç alan:
- backend/: sunucu kuralları, baremler (sayısal değerler), akışlar, hata kodları, operasyon.
- frontend/: mobil uygulama: ekranlar, oyuncunun ne gördüğü ve bir bileşenin ne zaman göründüğü, hangi ekranın hangi API'yi (GraphQL query/mutation) ne zaman çağırdığı, uygulamadaki hata mesajları, uzak ayarlar (Firebase Remote Config), kullanılmayan kod.
- mac-motoru/: maçları oynatan motor (Go): maçı hangi oyuncu statlarının, takım gücünün, taktiklerin ve oyun stillerinin nasıl ve ne kadar etkilediği, pas/şut/pres/kaleci gibi mekanizmalar, istatistik ve reytingin nasıl üretildiği, lig ve PvP maçlarının nasıl oynatıldığı.
Okuyucular backend geliştirici, PM ve patron; cevapları Türkçe ver, soran kişinin teknik seviyesine göre.

Nasıl kullanılır:
1. Soruyu \`search\` ile ara (varsayılan: bütün alanlarda birden; "area" ile daraltılabilir). Sonuçlar ilgili bölümü gösterir, cevabın tamamı değildir.
2. Cevabı vermeden önce en ilgili dokümanı \`read_doc\` ile baştan sona oku (yol alan önekiyle: "backend/flows/pvp/gunluk-hak.md", "frontend/flows/pvp/…").
3. Sabit adı, hata kodu, GraphQL işlem/alan adı ya da bir sayı gibi birebir ifadeleri \`grep\` ile ara (ör. PVP_DAILY_LIMIT, createPvpMatch, 500.000).
4. "Bu mutation/query'yi uygulamada nereler çağırıyor?" → frontend/genel/api-haritasi.md (backend alanı → frontend işlemi → ekran) ya da frontend/api/<işlem>.md kartı. "Bu ekran hangi API'leri çağırıyor?" → frontend/ekranlar/<rota>.md.
5. "Şu stat/metrik maçta ne işe yarıyor, ne kadar etkili?" → mac-motoru/metrikler/<stat>.md kartı, mac-motoru/genel/metriklerin-etkisi.md (karşılaştırma ve ölçüm) ve mac-motoru/genel/metrik-haritasi.md (stat → motor fonksiyonu → çarpan). Oyun stilleri → mac-motoru/genel/oyun-stilleri.md.
6. Nereden başlayacağını bilmiyorsan backend/genel/genel-bakis.md (oyunun büyük resmi), frontend/genel/genel-bakis.md (uygulamanın haritası) ya da mac-motoru/genel/genel-bakis.md (maç motoru) oku; hepsinde "hangi soru için hangi doküman" tablosu var.

Cevap verirken:
- Kaynağı belirt: doküman yolu ve bölüm.
- Bir konunun kuralı backend'de, oyuncunun gördüğü frontend'de, maçın içinde olan mac-motoru'ndadır; gerekiyorsa hepsini oku (dokümanlar birbirine link verir).
- Maç motoru davranışı veriden (SkillCorner takip verisinden türetilmiş tablolardan) alır; oyuncu statları bu davranışı çarpanlarla büker. Etkiyi sorarken dokümandaki sayıları (çarpan, ölçüm) aktar, yorum katma.
- status alanına dikkat et. Backend: "canlıda", "kısmen canlıda", "kod main'de, istemci bağlı değil", "istemci kullanımı belirsiz", "bayrakla kapalı", "kaldırıldı". Frontend: "canlıda", "kısmen canlıda", "bayrakla kapalı", "kodda var, erişilmiyor", "kaldırıldı". Maç motoru: "canlıda", "kısmen canlıda", "bayrakla kapalı", "kodda var, kullanılmıyor", "kaldırıldı". "kaldırıldı" dokümanlar tarihsel kayıttır.
- "Bu kodda değil" / "uygulamada değil" yazan davranış başka bir sistemdedir; o alandan kesin bilgi verilemez.
- "DB'de" ya da "Firebase'de" yazan değerler orada durur; tahmin etme.
- Lig numaraları ters: "1. Lig" = Rising Stars (en üst), "2. Lig" = Amateur.
- Bilgi dokümanların yazıldığı kod commit'ine göredir (frontmatter'daki code_commit); bilgi tabanında olmayan bir şeyi uydurma, "bilgi tabanında yok" de.`;

export interface Area {
  store: KbStore;
  search: SearchContext;
}

export interface Services {
  /** Knowledge base areas by name, in search order (backend first). */
  areas: Map<string, Area>;
  /** Records a tool call (fire-and-forget; failures are only logged). */
  usage?: (event: UsageEvent) => Promise<void>;
  log?: (level: 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) => void;
}

/** Who is calling, from the token, and with what client (User-Agent). */
export interface Caller {
  principal: Principal;
  client: string | null;
}

interface ToolOutcome {
  text: string;
  isError?: boolean;
  /** What to remember about the answer: counts, document paths. */
  summary: Record<string, unknown>;
}

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const readOnly = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};

export function buildServer(services: Services, caller: Caller): McpServer {
  const server = new McpServer({name: 'efsane-baskan-mcp', version: '1.0.0'}, {instructions: INSTRUCTIONS});
  const areaNames = [...services.areas.keys()];
  const areaParam = z.enum(areaNames as [string, ...string[]]).optional();
  const pick = (area?: string) => (area ? [[area, services.areas.get(area)!] as const] : [...services.areas.entries()]);

  /** Runs a tool, records the call, and shapes the MCP result. */
  const tracked = async (tool: string, input: Record<string, unknown>, fn: () => Promise<ToolOutcome>) => {
    const started = performance.now();
    let outcome: ToolOutcome;
    let error: string | null = null;
    try {
      outcome = await fn();
      if (outcome.isError) error = outcome.text;
    } catch (e) {
      error = (e as Error).message;
      outcome = {text: `Araç hatası: ${error}`, isError: true, summary: {count: 0}};
    }
    services
      .usage?.({
        userId: caller.principal.userId,
        tokenId: caller.principal.tokenId,
        tool,
        input,
        result: outcome.summary,
        durationMs: performance.now() - started,
        error,
        client: caller.client,
      })
      .catch(e => services.log?.('warn', 'kullanım kaydı yazılamadı', {error: (e as Error).message}));
    return {content: [{type: 'text' as const, text: outcome.text}], ...(outcome.isError ? {isError: true} : {})};
  };

  server.registerTool(
    'search',
    {
      title: 'Bilgi tabanında ara',
      description:
        'Efsane Başkan bilgi tabanında anlamsal + kelime (hibrit) arama; varsayılan olarak bütün alanlarda (backend, frontend, mac-motoru) birlikte. ' +
        'Soruyu doğal dille yaz ("günde kaç PvP maçı oynanır", "PvP davet butonu ne zaman görünür"). En ilgili bölümleri döner; ' +
        'cevap için sonra read_doc ile dokümanın tamamını oku. "kaldırıldı" dokümanlar varsayılan olarak gizlidir.',
      inputSchema: {
        query: z.string().min(2).describe('Soru ya da aranan konu, Türkçe'),
        area: areaParam.describe('Yalnız bu alan: backend (sunucu kuralları), frontend (mobil uygulama) ya da mac-motoru (maç motoru). Boşsa hepsi.'),
        module: z.string().optional().describe('Yalnız bu modül/alan klasörü (ör. backend: pvp-match, referral; frontend: pvp, lig; mac-motoru: top-ustu, kaleci)'),
        kind: z.string().optional().describe('Yalnız bu doküman türü: flow, module, usecase, overview, infra, api, screen'),
        include_removed: z.boolean().optional().describe('"kaldırıldı" (tarihsel) dokümanları da getir'),
        limit: z.number().int().min(1).max(20).optional().describe('Sonuç sayısı (varsayılan 8)'),
      },
      annotations: readOnly,
    },
    async ({query, area, module, kind, include_removed, limit}) =>
      tracked('search', {query, area, module, kind, include_removed, limit}, async () => {
        const n = limit ?? 8;
        const hits: (SearchHit & {area: string})[] = [];
        const commits: string[] = [];
        for (const [name, a] of pick(area)) {
          try {
            const found = await search(a.search, query, {limit: n, filters: {module, kind, includeRemoved: include_removed}});
            hits.push(...found.map(h => ({...h, area: name})));
            commits.push(`${name} ${(await a.store.commit()).slice(0, 8)}`);
          } catch (e) {
            // An area without an index yet (e.g. right after it was added) is skipped, not fatal.
            services.log?.('warn', 'alan aranamadı', {area: name, error: (e as Error).message});
          }
        }
        hits.sort((a, b) => b.score - a.score);
        const top = hits.slice(0, n);
        const summary = {count: top.length, paths: [...new Set(top.map(h => `${h.area}/${h.path}`))].slice(0, 5)};
        if (top.length === 0) return {text: `"${query}" için sonuç yok. Farklı kelimelerle ara ya da grep dene.`, summary};
        const lines = top.map(
          (h, i) =>
            `${i + 1}. **${h.title}** — \`${h.area}/${h.path}\`${h.section ? ` › ${h.section}` : ''}${h.status ? ` [${h.status}]` : ''}\n   ${oneLine(h.text, 400)}`,
        );
        return {
          text: `${top.length} sonuç (bilgi tabanı: ${commits.join(', ')}):\n\n${lines.join('\n\n')}\n\nCevap için ilgili dokümanı read_doc ile oku.`,
          summary,
        };
      }),
  );

  server.registerTool(
    'read_doc',
    {
      title: 'Dokümanı oku',
      description:
        'Bir bilgi tabanı dokümanının tamamını (frontmatter dahil) getirir. Yol alan önekiyle: "backend/flows/pvp/gunluk-hak.md", ' +
        '"frontend/api/create-pvp-match.md"; önek yoksa backend sayılır. Frontmatter\'da status (canlı mı), code_commit (hangi koda göre yazıldı) ' +
        've sources (anlattığı kod dosyaları) bulunur.',
      inputSchema: {path: z.string().min(1).describe('Doküman yolu, ör. backend/genel/genel-bakis.md ya da frontend/genel/api-haritasi.md')},
      annotations: readOnly,
    },
    async ({path}) =>
      tracked('read_doc', {path}, async () => {
        const {area, path: rel} = splitArea(path, areaNames);
        const doc = await services.areas.get(area)?.store.getDoc(rel);
        if (!doc) return {text: `"${path}" bulunamadı. Yolu search ya da list_docs ile bul.`, isError: true, summary: {count: 0}};
        return {text: doc.text, summary: {count: 1, paths: [`${area}/${doc.path}`]}};
      }),
  );

  server.registerTool(
    'grep',
    {
      title: 'Birebir metin ara',
      description:
        'Dokümanlarda birebir metin arar (büyük/küçük harf duyarsız): sabit adları (PVP_DAILY_LIMIT), hata kodları (GAME_LOCKED), ' +
        'GraphQL işlem/alan adları (createPvpMatch), REST uçları, sayılar (500.000). Satır numarasıyla eşleşen satırları döner.',
      inputSchema: {
        pattern: z.string().min(2).describe('Aranan metin (düz metin, regex değil)'),
        prefix: z.string().optional().describe('Yalnız bu klasör, ör. backend/flows/pvp/ ya da frontend/api/'),
        area: areaParam.describe('Yalnız bu alan (prefix alan önekiyle başlıyorsa gerek yok)'),
        limit: z.number().int().min(1).max(200).optional().describe('En fazla eşleşme (varsayılan 50)'),
      },
      annotations: readOnly,
    },
    async ({pattern: needle, prefix, area, limit}) =>
      tracked('grep', {pattern: needle, prefix, area, limit}, async () => {
        const max = limit ?? 50;
        const scoped = prefix ? splitArea(prefix, areaNames) : null;
        const targets = scoped && prefix!.split('/')[0] === scoped.area ? pick(scoped.area) : pick(area);
        const matches: {path: string; line: number; text: string}[] = [];
        let truncated = false;
        for (const [name, a] of targets) {
          const res = await a.store.grep(needle, {prefix: scoped?.path ?? '', limit: max - matches.length});
          matches.push(...res.matches.map(m => ({...m, path: `${name}/${m.path}`})));
          if (res.truncated || matches.length >= max) {
            truncated = true;
            break;
          }
        }
        const summary = {count: matches.length, truncated, paths: [...new Set(matches.map(m => m.path))].slice(0, 5)};
        if (matches.length === 0) return {text: `"${needle}" hiçbir dokümanda geçmiyor.`, summary};
        const lines = matches.map(m => `${m.path}:${m.line}: ${m.text}`);
        return {
          text: `${matches.length}${truncated ? '+' : ''} eşleşme:\n${lines.join('\n')}${truncated ? '\n\n(Liste kısaltıldı; prefix ile daralt.)' : ''}`,
          summary,
        };
      }),
  );

  server.registerTool(
    'list_docs',
    {
      title: 'Dokümanları listele',
      description:
        'Bilgi tabanındaki dokümanları başlık ve durumlarıyla listeler. backend/: genel/, flows/<alan>/, modules/, usecases/<modül>/. ' +
        'frontend/: genel/, flows/<alan>/, api/ (GraphQL işlem kartları), ekranlar/ (rota kartları). ' +
        'mac-motoru/: genel/, flows/<alan>/, metrikler/ (oyuncu statı kartları). Daraltmak için prefix ver (ör. frontend/flows/).',
      inputSchema: {prefix: z.string().optional().describe('Ör. backend/genel/, frontend/flows/pvp/, mac-motoru/metrikler/')},
      annotations: readOnly,
    },
    async ({prefix}) =>
      tracked('list_docs', {prefix}, async () => {
        const scoped = prefix ? splitArea(prefix, areaNames) : null;
        const targets = scoped && prefix!.split('/')[0] === scoped.area ? pick(scoped.area) : pick();
        const docs: string[] = [];
        for (const [name, a] of targets) {
          for (const d of await a.store.list(scoped?.path ?? '')) docs.push(`${name}/${d.path} — ${d.title}${d.status ? ` [${d.status}]` : ''}`);
        }
        if (docs.length === 0) return {text: `"${prefix ?? ''}" altında doküman yok.`, summary: {count: 0}};
        return {text: `${docs.length} doküman:\n${docs.join('\n')}`, summary: {count: docs.length}};
      }),
  );

  return server;
}
