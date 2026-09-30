# ai-knowledge-engine

Efsane Başkan bilgi tabanını ([`ai-knowledge-base`](https://github.com/nosurrenderbase/ai-knowledge-base)) üreten, kodla senkron tutan ve sunan araçlar. Bilgi tabanı reposunda yalnız içerik durur; süreç (prompt'lar, script'ler, işçiler) buradadır.

| Yol | Ne |
|---|---|
| [`apps/sync`](apps/sync/README.md) | **kbsync**: kod reposunun main'ini yoklar, her merge'ü sırayla işleyip bilgi tabanını Claude Code ile günceller, doğrular, push eder |
| `apps/mcp` | MCP sunucusu (sonra) |
| `apps/indexer` | Parçaları vektör DB'ye yükleyen seeder (sonra) |
| [`packages/kb`](packages/kb/src/index.ts) | Ortak parçalar: doküman okuma, use case kartı üreticisi, chunk'lama |
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
```

Redis verisi `work/redis`'te (AOF + RDB) durur; makine ya da Docker yeniden başlayınca konteyner kendiliğinden kalkar. Başka makineye taşımak için repo, `work/` ve `.env` kopyalanır.

Node.js 22.18+ gerekir; TypeScript derlenmeden, doğrudan çalıştırılır.
