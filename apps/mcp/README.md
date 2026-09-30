# MCP sunucusu

Efsane Başkan bilgi tabanını Claude'a açan MCP sunucusu (Streamable HTTP, stateless). Veriyi yalnız Redis'ten okur: arama indeksi ve dokümanların tam metni işçinin (`apps/sync`) indeks senkronuyla aynı KB commit'indedir.

## Araçlar

| Araç | Ne yapar |
|---|---|
| `search` | Hibrit arama (voyage-4-large vektör + Türkçe BM25). Filtreler: `module`, `kind`, `include_removed`; "kaldırıldı" dokümanlar varsayılan gizli |
| `read_doc` | Dokümanın tamamı (frontmatter dahil) |
| `grep` | Tüm dokümanlarda birebir metin (sabit adı, hata kodu, sayı), satır numarasıyla |
| `list_docs` | Dokümanlar, başlık ve durumlarıyla; klasörle daraltılabilir |

Sunucu, nasıl kullanılacağını anlatan talimatları (`instructions`) da gönderir: önce ara, sonra dokümanı oku, kaynağı belirt, `status` ve "bu kodda değil" ne demek.

## Çalıştırma

`compose.yaml` ile Redis'in yanında çalışır; yalnız `127.0.0.1:8787`'den erişilir ve `MCP_TOKEN` ister.

```bash
docker compose up -d --build mcp
curl http://127.0.0.1:8787/health
```

Geliştirirken doğrudan: `npm start -w @ai-knowledge-engine/mcp` (repodaki `.env`'i okur).

## Claude Code'a eklemek

```bash
claude mcp add --transport http efsane-kb http://127.0.0.1:8787/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

claude.ai (web/Desktop) için sunucunun internetten erişilebilir olması ve OAuth gerekir; henüz yapılmadı.

## Testler

```bash
npm test -w @ai-knowledge-engine/mcp   # resmi MCP istemcisiyle, geçici bir Redis indeksine karşı
```
