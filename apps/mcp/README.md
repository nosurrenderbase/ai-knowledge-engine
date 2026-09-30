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

`compose.yaml` ile Redis ve Postgres'in yanında çalışır. Makinede `127.0.0.1:8787`'den, dışarıdan Cloudflare Tunnel (`cloudflared` servisi) üzerinden **https://mcp.efsanebaskan.com/mcp** adresinden erişilir.

```bash
docker compose up -d --build mcp
curl http://127.0.0.1:8787/health
```

Geliştirirken doğrudan: `npm start -w @ai-knowledge-engine/mcp` (repodaki `.env`'i okur).

## Erişim ve kullanım kaydı

Herkes kendi token'ıyla bağlanır; token'lar `packages/accounts` ile yönetilir, veritabanında yalnız özetleri durur:

```bash
npm run users -- add "Ahmet Yılmaz" --email ahmet@nosurrender.studio   # token'ı bir kez gösterir
npm run users -- token <id|e-posta>      # aynı kişiye ek token (ör. ikinci bilgisayar)
npm run users -- revoke <önek>           # tek token'ı iptal et
npm run users -- disable <id|e-posta>    # kişinin tüm erişimini kapat
```

Her araç çağrısı kaydedilir: kim, hangi araç, ne sordu, kaç sonuç ve hangi dokümanlar, süre, hata, istemci. Ayrıntılı kayıtlar `USAGE_RETENTION_DAYS` (varsayılan 90) günden sonra MCP'nin saatlik temizliğiyle silinir; kişi/gün/araç toplamları kalıcıdır.

```bash
npm run users -- usage --days 30         # kim ne kadar kullandı
npm run users -- queries --days 7        # son sorular
npm run users -- queries --empty         # sonuç bulunamayan aramalar (bilgi tabanının eksikleri)
```

`MCP_TOKEN` tanımlıysa eski ortak token da geçiş süresince çalışır ve "Ortak token (geçici)" adına kaydedilir; herkes kendi token'ına geçince `.env`'den silip `docker compose up -d mcp`.

## Claude Code'a eklemek

```bash
claude mcp add --transport http efsane-kb https://mcp.efsanebaskan.com/mcp --header "Authorization: Bearer <kişisel token>"
```

claude.ai (web/Desktop) bağlantısı OAuth ister; henüz yapılmadı.

## Testler

```bash
npm test -w @ai-knowledge-engine/mcp   # resmi MCP istemcisiyle, geçici bir Redis indeksine karşı
```
