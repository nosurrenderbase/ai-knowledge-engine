# ai-knowledge-engine

Efsane Başkan bilgi tabanını ([`ai-knowledge-base`](https://github.com/nosurrenderbase/ai-knowledge-base)) üreten, kodla senkron tutan ve sunan araçlar. Bilgi tabanı reposunda yalnız içerik durur; süreç (prompt'lar, script'ler, işçiler) buradadır.

| Yol | Ne |
|---|---|
| [`apps/sync`](apps/sync/README.md) | **kbsync**: kod reposunun main'ini yoklar, her merge'ü sırayla işleyip bilgi tabanını Claude Code ile günceller, doğrular, push eder |
| `apps/mcp` | MCP sunucusu (sonra) |
| [`packages/kb`](packages/kb/src/index.ts) | Ortak parçalar: doküman okuma, use case kartı üreticisi, chunk'lama |
| [`packages/search`](packages/search/src/index.ts) | Arama: Voyage embedding (voyage-4-large), Redis indeksi (vektör + Türkçe tam metin), hibrit sorgu, indeks senkronu, arama ölçümü |
| [`prompts/backend`](prompts/backend) | `PROMPT.md` (elle modül dokümanı üretimi), `UPDATE-PROMPT.md` (otomatik güncelleme kuralları ve sistem prompt'u), `TEMPLATE-flow.md` |
| [`docs/EMBEDDING.md`](docs/EMBEDDING.md) | Parça biçimi ve arama önerileri |
| [`deploy`](deploy) | Çalıştırma betiği, launchd şablonu, örnek ayar dosyası, Redis ayarları |
| [`compose.yaml`](compose.yaml) | Uzun süre çalışan servisler (şimdilik Redis; sonra MCP) |
| `work/` | (git dışı) işçinin klonları ve logları |

## Komutlar

```bash
npm ci
npm test                  # tüm paketlerin testleri
npm run typecheck

npm run gen:cards -- --kb <KB>/backend --source <kod reposu> <modül> [<modül> ...]
npm run build:chunks -- --kb <KB>/backend --out chunks.jsonl

deploy/run.sh once        # işçiyi bir tur çalıştır (deploy/kbsync.env ile)

docker compose up -d      # Redis (vektör + tam metin indeksi); parola .env'de (.env.example'dan kopyala)

npm run index -w @ai-knowledge-engine/search -- search "günde kaç pvp maçı"   # indekste ara
npm run index -w @ai-knowledge-engine/search -- status                       # indeks hangi KB commit'inde
npm run eval -w @ai-knowledge-engine/search                                  # arama kalitesi ölçümü
```

Arama indeksini işçi günceller: her turdan sonra KB'nin main'i indekslenen commit'ten ilerideyse yalnız değişen parçaları embed edip Redis'e yazar. Embedding'ler `work/embeddings`'te de tutulur; Redis kaybolursa indeks ücretsiz yeniden kurulur.

Redis verisi `work/redis`'te (AOF + RDB) durur; makine ya da Docker yeniden başlayınca konteyner kendiliğinden kalkar. Başka makineye taşımak için repo, `work/` ve `.env` kopyalanır.

Node.js 22.18+ gerekir; TypeScript derlenmeden, doğrudan çalıştırılır.
