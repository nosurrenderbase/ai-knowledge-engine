# ai-knowledge-engine

Efsane Başkan bilgi tabanını ([`ai-knowledge-base`](https://github.com/nosurrenderbase/ai-knowledge-base)) üreten, kodla senkron tutan ve sunan araçlar. Bilgi tabanı reposunda yalnız içerik durur; süreç (prompt'lar, script'ler, işçiler) buradadır.

| Yol | Ne |
|---|---|
| [`apps/sync`](apps/sync/README.md) | **kbsync**: kod reposunun main'ini yoklar, her merge'ü sırayla işleyip bilgi tabanını Claude Code ile günceller, doğrular, push eder |
| [`apps/mcp`](apps/mcp/README.md) | MCP sunucusu: `search`, `read_doc`, `grep`, `list_docs`; compose ile Redis'in yanında çalışır |
| [`apps/deploy`](apps/deploy/src/deploy.ts) | Bu makinenin kendini güncellemesi: main'i 2 dakikada bir yoklar, yeni commit'i aday klonda test eder, değişen servisi yeniden başlatır, sağlık kontrolü yapar, olmazsa geri alır |
| `apps/panel` | Yönetim paneli (Next.js + Ant Design): kullanıcılar ve token'lar, kullanım, sorular, arama denemesi; `npm run dev -w @ai-knowledge-engine/panel` (port 3100), giriş `.env`'deki `PANEL_PASSWORD` |
| [`packages/kb`](packages/kb/src/index.ts) | Ortak parçalar: doküman okuma, backend use case kartları, frontend modeli ve kartları (API ve ekran kartları, API haritası, kullanılmayan kod), maç motoru modeli ve kartları (stat → çarpan → kullanıldığı yer, oyun stilleri), chunk'lama |
| [`packages/gamedb`](packages/gamedb/src/policy.ts) | Oyun veritabanına (MongoDB) salt okunur erişim: izinli koleksiyonlar, kişisel veriyi reddeden sorgu denetimi ve maskeleme, hazır görünümler (takım, maç, lig tablosu) |
| [`packages/settings`](packages/settings/src/catalog.ts) | Panelden değiştirilebilen ayarların kataloğu, `.env` düzenleme (yorum ve sıra korunur), değerlerin şifrelenmesi |
| [`packages/accounts`](packages/accounts/src/cli.ts) | Kullanıcılar, kişiye özel token'lar, kullanım kaydı (Postgres); `npm run users` |
| [`packages/search`](packages/search/src/index.ts) | Arama: Voyage embedding (voyage-4-large), Redis indeksi (vektör + Türkçe tam metin), hibrit sorgu, indeks senkronu, arama ölçümü |
| [`prompts/backend`](prompts/backend), [`prompts/frontend`](prompts/frontend), [`prompts/mac-motoru`](prompts/mac-motoru) | Alan başına `PROMPT.md` (yazım kuralları), `UPDATE-PROMPT.md` (otomatik güncelleme kuralları ve sistem prompt'u), `TEMPLATE-flow.md` |
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
node packages/kb/src/cli.ts gen-engine --kb <KB>/mac-motoru --source <match-engine reposu>

deploy/run.sh once        # işçiyi bir tur çalıştır (deploy/kbsync.env ile)

docker compose up -d      # Redis + Postgres + MCP + tünel; parolalar .env'de (.env.example'dan kopyala)

npm run users -- add "Ad Soyad" --email ad@nosurrender.studio   # kişiye özel MCP token'ı
npm run users -- list | usage | queries [--empty]              # kullanıcılar, kullanım, sorular

npm run index -w @ai-knowledge-engine/search -- search "günde kaç pvp maçı"   # indekste ara
npm run index -w @ai-knowledge-engine/search -- status [--area frontend]     # indeks hangi KB commit'inde
npm run eval -w @ai-knowledge-engine/search                                  # arama kalitesi ölçümü
```

Bilgi tabanının üç alanı var: `backend/` (NestJS sunucusu, `nestjs-boilerplate`), `frontend/` (React Native uygulaması, `efsane-baskan-rn`) ve `mac-motoru/` (Go maç motoru, `match-engine`). Her alanın kendi `.source-commit`'i, kendi işçi sırası ve kendi arama indeksi (`kb:backend`, `kb:frontend`, `kb:mac-motoru`) vardır; MCP hepsini birlikte arar.

Arama indeksini işçi günceller: her turdan sonra KB'nin main'i indekslenen commit'ten ilerideyse yalnız değişen parçaları embed edip Redis'e yazar. Embedding'ler `work/embeddings`'te de tutulur; Redis kaybolursa indeks ücretsiz yeniden kurulur.

Redis verisi `work/redis`'te (AOF + RDB) durur; makine ya da Docker yeniden başlayınca konteyner kendiliğinden kalkar. Başka makineye taşımak için repo, `work/` ve `.env` kopyalanır.

## Otomatik deploy

Bu repo'nun main'ine push edilen her commit bu makinede kendiliğinden canlıya alınır (`dev.nosurrender.kbdeploy`, launchd, 2 dakikada bir):

1. Yeni commit önce `work/deploy/candidate` aday klonunda kurulur, `npm run typecheck` ve `npm test`'ten geçer. Geçmezse canlıya hiç dokunulmaz; o commit bir daha denenmez, sonraki commit denenir.
2. Canlı klon ileri sarılır (`--ff-only`); yalnız değişenin gerektirdiği yapılır: `apps/sync` → işçi yeniden başlar (süren Claude işi varsa iş bitince), `apps/mcp` → MCP, `apps/panel` → panel, `packages/*` → onu kullananlar, kilit dosyası → `npm ci`, `compose.yaml` → bütün servisler; dokümanlar ve `prompts/` hiçbir şeyi yeniden başlatmaz.
3. Sağlık kontrolü (container `healthy`, işçi "başladı" logu); olmazsa önceki commit'e dönülür.

Panelin genel bakış sayfasındaki **Sürümler** kartı canlı commit'i, her servisin (işçi, MCP, panel) gerçekte çalıştırdığı commit'i, işçinin şu an bir iş yürütüp yürütmediğini ve her bilgi tabanı alanının işlediği son kod commit'ini gösterir. Elle derleme yaparken commit'i imaja yazmak için: `GIT_SHA=$(git rev-parse HEAD) docker compose up -d --build`.

Her adım `work/logs/deploy.log`'a, deploy/atlama/hata/geri alma `ALERT_WEBHOOK_URL`'e gider; canlıdaki commit `work/deploy/state.json`'da. **Sunucudaki klonda elle düzenleme yapılmaz**: commit edilmemiş değişiklik varsa deploy durur ve alarm verir. Elle bir tur: `deploy/run-deploy.sh`.

## Panel: Sistem

**Durum** sekmesi Redis, Postgres, MCP, oyun veritabanı, Cloudflare tüneli (dışarıdan), işçi (alan başına sıra durumu), deploy ajanı ve diski yoklar; işçi ve deploy loglarındaki son uyarı/hataları gösterir.

**Ayarlar** sekmesi [`packages/settings/src/catalog.ts`](packages/settings/src/catalog.ts)'teki anahtarları gösterir (sırların yalnız son 4 karakteri). Değiştirme:

1. Panel yalnız Cloudflare Access ile doğrulanmış bir kişiye yazma izni verir (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`; ikisi yoksa salt okunur).
2. Yeni değer panelde sunucunun açık anahtarıyla şifrelenip Postgres'teki `settings_changes` sırasına yazılır. Özel anahtar yalnız `work/settings/`'te durur; panel ve veritabanı değeri açamaz.
3. Deploy ajanı (2 dakikada bir) değeri açar, katalogla tekrar doğrular, dosyanın yedeğini alır (`work/settings/backups/`), yazar, anahtarı okuyan servisi yeniden başlatır, sağlık kontrolü yapar; olmazsa eski dosyayı geri koyar. Uygulanınca şifreli değer silinir; satır, kimin neyi ne zaman değiştirdiğinin kaydı olarak kalır.

Panelin kendini kilitleyebileceği anahtarlar (Postgres ve Redis parolası, tünel token'ı, Access ayarları, repo yolları) panelde salt okunurdur; sunucuda elle değiştirilir.

### Cloudflare Access kurulumu

1. Cloudflare Zero Trust > Access > Applications > Add an application > Self-hosted: alan adı `panel.efsanebaskan.com`.
2. Policy: Allow, Include > Emails ending in `@nosurrender.studio` (giriş yöntemi: Google ya da tek kullanımlık kod).
3. Uygulamanın Overview sekmesindeki **Application Audience (AUD) Tag** ve takım alanını (Settings > Custom Pages'te görünen `<takım>.cloudflareaccess.com`) sunucudaki `.env`'ye yaz:
   ```
   CF_ACCESS_TEAM_DOMAIN=<takım>.cloudflareaccess.com
   CF_ACCESS_AUD=<AUD etiketi>
   ```
4. `docker compose up -d panel`.

Node.js 22.18+ gerekir; TypeScript derlenmeden, doğrudan çalıştırılır.
