/**
 * The MCP server: four read-only tools over the Efsane Başkan knowledge base.
 * One McpServer is built per HTTP request (stateless); the heavy parts
 * (Redis client, embedder, caches) are shared through `Services`.
 */
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {search, type SearchContext} from '@ai-knowledge-engine/search';
import {z} from 'zod';
import type {KbStore} from './kb-store.ts';

export const INSTRUCTIONS = `Efsane Başkan oyununun backend bilgi tabanı: kurallar, baremler (sayısal değerler), akışlar, hata kodları, operasyon. Okuyucular patron ve PM; cevapları Türkçe, kod bilmeyen birine anlatır gibi ver.

Nasıl kullanılır:
1. Soruyu \`search\` ile ara. Sonuçlar dokümanın ilgili bölümünü gösterir, cevabın tamamı değildir.
2. Cevabı vermeden önce en ilgili dokümanı \`read_doc\` ile baştan sona oku; baremler, istisnalar ve bilinen sorunlar farklı bölümlerde olabilir.
3. Sabit adı, hata kodu, uç adı ya da bir sayı gibi birebir ifadeleri \`grep\` ile ara (ör. PVP_DAILY_LIMIT, GAME_LOCKED, 500.000).
4. Nereden başlayacağını bilmiyorsan genel/genel-bakis.md'yi oku: oyunun büyük resmi ve "hangi soru için hangi doküman" tablosu orada.

Cevap verirken:
- Kaynağı belirt: doküman yolu ve bölüm.
- Dokümanın status alanına dikkat et: "canlıda", "kısmen canlıda", "kod main'de, istemci bağlı değil", "istemci kullanımı belirsiz", "bayrakla kapalı", "kaldırıldı". "kaldırıldı" dokümanlar tarihsel kayıttır, güncel kural değildir.
- "Bu kodda değil" yazan davranış başka bir sistemdedir (maç motoru, istemci, admin paneli…); backend'den kesin bilgi verilemez.
- "DB'de" yazan değerler veritabanında durur, dokümanda sayı yoktur; tahmin etme.
- Lig numaraları ters: "1. Lig" = Rising Stars (en üst), "2. Lig" = Amateur.
- Bilgi dokümanların yazıldığı kod commit'ine göredir (frontmatter'daki code_commit); bilgi tabanında olmayan bir şeyi uydurma, "bilgi tabanında yok" de.`;

export interface Services {
  store: KbStore;
  search: SearchContext;
}

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const text = (t: string) => ({content: [{type: 'text' as const, text: t}]});
const readOnly = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};

export function buildServer(services: Services): McpServer {
  const server = new McpServer({name: 'efsane-baskan-kb', version: '1.0.0'}, {instructions: INSTRUCTIONS});

  server.registerTool(
    'search',
    {
      title: 'Bilgi tabanında ara',
      description:
        'Efsane Başkan bilgi tabanında anlamsal + kelime (hibrit) arama. Soruyu doğal dille yaz ("günde kaç PvP maçı oynanır"). ' +
        'En ilgili bölümleri döner; cevap için sonra read_doc ile dokümanın tamamını oku. "kaldırıldı" dokümanlar varsayılan olarak gizlidir.',
      inputSchema: {
        query: z.string().min(2).describe('Soru ya da aranan konu, Türkçe'),
        module: z.string().optional().describe('Yalnız bu backend modülü (ör. pvp-match, referral, kyc)'),
        kind: z.string().optional().describe('Yalnız bu doküman türü: flow, module, usecase, overview, infra, ops'),
        include_removed: z.boolean().optional().describe('"kaldırıldı" (tarihsel) dokümanları da getir'),
        limit: z.number().int().min(1).max(20).optional().describe('Sonuç sayısı (varsayılan 8)'),
      },
      annotations: readOnly,
    },
    async ({query, module, kind, include_removed, limit}) => {
      const hits = await search(services.search, query, {
        limit: limit ?? 8,
        filters: {module, kind, includeRemoved: include_removed},
      });
      if (hits.length === 0) return text(`"${query}" için sonuç yok. Farklı kelimelerle ara ya da grep dene.`);
      const commit = (await services.store.commit()).slice(0, 8);
      const lines = hits.map(
        (h, i) =>
          `${i + 1}. **${h.title}** — \`${h.path}\`${h.section ? ` › ${h.section}` : ''}${h.status ? ` [${h.status}]` : ''}\n   ${oneLine(h.text, 400)}`,
      );
      return text(`${hits.length} sonuç (bilgi tabanı commit ${commit}):\n\n${lines.join('\n\n')}\n\nCevap için ilgili dokümanı read_doc ile oku.`);
    },
  );

  server.registerTool(
    'read_doc',
    {
      title: 'Dokümanı oku',
      description:
        'Bir bilgi tabanı dokümanının tamamını (frontmatter dahil) getirir. Yol search/list_docs/grep sonuçlarındaki gibi: "flows/pvp/gunluk-hak.md". ' +
        'Frontmatter\'da status (canlı mı), code_commit (hangi koda göre yazıldı) ve sources (anlattığı kod dosyaları) bulunur.',
      inputSchema: {path: z.string().min(1).describe('Doküman yolu, ör. flows/pvp/gunluk-hak.md ya da genel/genel-bakis.md')},
      annotations: readOnly,
    },
    async ({path}) => {
      const doc = await services.store.getDoc(path);
      if (!doc) return {...text(`"${path}" bulunamadı. Yolu search ya da list_docs ile bul.`), isError: true};
      return text(doc.text);
    },
  );

  server.registerTool(
    'grep',
    {
      title: 'Birebir metin ara',
      description:
        'Tüm dokümanlarda birebir metin arar (büyük/küçük harf duyarsız): sabit adları (PVP_DAILY_LIMIT), hata kodları (GAME_LOCKED), ' +
        'GraphQL/REST uç adları, sayılar (500.000). Satır numarasıyla eşleşen satırları döner.',
      inputSchema: {
        pattern: z.string().min(2).describe('Aranan metin (düz metin, regex değil)'),
        prefix: z.string().optional().describe('Yalnız bu klasör, ör. flows/pvp/ ya da usecases/'),
        limit: z.number().int().min(1).max(200).optional().describe('En fazla eşleşme (varsayılan 50)'),
      },
      annotations: readOnly,
    },
    async ({pattern: needle, prefix, limit}) => {
      const {matches, truncated} = await services.store.grep(needle, {prefix, limit});
      if (matches.length === 0) return text(`"${needle}" hiçbir dokümanda geçmiyor.`);
      const lines = matches.map(m => `${m.path}:${m.line}: ${m.text}`);
      return text(`${matches.length}${truncated ? '+' : ''} eşleşme:\n${lines.join('\n')}${truncated ? '\n\n(Liste kısaltıldı; prefix ile daralt.)' : ''}`);
    },
  );

  server.registerTool(
    'list_docs',
    {
      title: 'Dokümanları listele',
      description:
        'Bilgi tabanındaki dokümanları başlık ve durumlarıyla listeler. Klasörler: genel/ (genel bakış, sözlük, veri haritası, operasyon), ' +
        'flows/<alan>/ (iş akışları), modules/ (modül özetleri), usecases/<modül>/ (kod kartları). Klasörle daraltmak için prefix ver.',
      inputSchema: {prefix: z.string().optional().describe('Ör. genel/, flows/lig/, modules/')},
      annotations: readOnly,
    },
    async ({prefix}) => {
      const docs = await services.store.list(prefix ?? '');
      if (docs.length === 0) return text(`"${prefix ?? ''}" altında doküman yok.`);
      const lines = docs.map(d => `${d.path} — ${d.title}${d.status ? ` [${d.status}]` : ''}`);
      return text(`${docs.length} doküman:\n${lines.join('\n')}`);
    },
  );

  return server;
}
