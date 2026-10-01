# ai-knowledge-engine

Efsane Başkan bilgi tabanını ([`ai-knowledge-base`](https://github.com/nosurrenderbase/ai-knowledge-base)) üreten, kodla senkron tutan ve sunan araçlar. Bilgi tabanı reposunda yalnız içerik durur; süreç (prompt'lar, script'ler, işçiler) buradadır.

| Yol | Ne |
|---|---|
| [`apps/sync`](apps/sync/README.md) | **kbsync**: kod reposunun main'ini yoklar, her merge'ü sırayla işleyip bilgi tabanını Claude Code ile günceller, doğrular, push eder |
| [`apps/mcp`](apps/mcp/README.md) | MCP sunucusu: `search`, `read_doc`, `grep`, `list_docs`; compose ile Redis'in yanında çalışır |
| `apps/panel` | Yönetim paneli (Next.js + Ant Design): kullanıcılar ve token'lar, kullanım, sorular, arama denemesi; `npm run dev -w @ai-knowledge-engine/panel` (port 3100), giriş `.env`'deki `PANEL_PASSWORD` |
| [`packages/kb`](packages/kb/src/index.ts) | Ortak parçalar: doküman okuma, backend use case kartları, frontend modeli ve kartları (API ve ekran kartları, API haritası, kullanılmayan kod), chunk'lama |
| [`packages/accounts`](packages/accounts/src/cli.ts) | Kullanıcılar, kişiye özel token'lar, kullanım kaydı (Postgres); `npm run users` |
| [`packages/search`](packages/search/src/index.ts) | Arama: Voyage embedding (voyage-4-large), Redis indeksi (vektör + Türkçe tam metin), hibrit sorgu, indeks senkronu, arama ölçümü |
| [`prompts/backend`](prompts/backend), [`prompts/frontend`](prompts/frontend) | Alan başına `PROMPT.md` (yazım kuralları), `UPDATE-PROMPT.md` (otomatik güncelleme kuralları ve sistem prompt'u), `TEMPLATE-flow.md` |
| [`docs/EMBEDDING.md`](docs/EMBEDDING.md) | Parça biçimi ve arama önerileri |
| [`deploy`](deploy) | Çalıştırma betiği, launchd şablonu, örnek ayar dosyası, Redis ayarları |
| [`compose.yaml`](compose.yaml) | Uzun süre çalışan servisler: Redis, Postgres, MCP sunucusu, panel, Cloudflare Tunnel |
| `work/` | (git dışı) işçinin klonları ve logları |

## Komutlar

```bash
npm ci
npm test                  # tüm paketlerin testleri
npm run typecheck

npm run gen:cards -- --kb <KB>/backend --source <kod reposu> <modül> [<modül> ...]
npm run build:chunks -- --kb <KB>/backend --out chunks.jsonl
node packages/kb/src/cli.ts gen-frontend --kb <KB>/frontend --source <uygulama reposu> --backend <backend reposu> --backend-kb <KB>/backend

deploy/run.sh once        # işçiyi bir tur çalıştır (deploy/kbsync.env ile)

docker compose up -d      # Redis + Postgres + MCP + tünel; parolalar .env'de (.env.example'dan kopyala)

npm run users -- add "Ad Soyad" --email ad@nosurrender.studio   # kişiye özel MCP token'ı
npm run users -- list | usage | queries [--empty]              # kullanıcılar, kullanım, sorular

npm run index -w @ai-knowledge-engine/search -- search "günde kaç pvp maçı"   # indekste ara
npm run index -w @ai-knowledge-engine/search -- status [--area frontend]     # indeks hangi KB commit'inde
npm run eval -w @ai-knowledge-engine/search                                  # arama kalitesi ölçümü
```

Bilgi tabanının iki alanı var: `backend/` (NestJS sunucusu, `nestjs-boilerplate`) ve `frontend/` (React Native uygulaması, `efsane-baskan-rn`). Her alanın kendi `.source-commit`'i, kendi işçi sırası ve kendi arama indeksi (`kb:backend`, `kb:frontend`) vardır; MCP ikisini birlikte arar.

Arama indeksini işçi günceller: her turdan sonra KB'nin main'i indekslenen commit'ten ilerideyse yalnız değişen parçaları embed edip Redis'e yazar. Embedding'ler `work/embeddings`'te de tutulur; Redis kaybolursa indeks ücretsiz yeniden kurulur.

Redis verisi `work/redis`'te (AOF + RDB) durur; makine ya da Docker yeniden başlayınca konteyner kendiliğinden kalkar. Başka makineye taşımak için repo, `work/` ve `.env` kopyalanır.

Node.js 22.18+ gerekir; TypeScript derlenmeden, doğrudan çalıştırılır.
