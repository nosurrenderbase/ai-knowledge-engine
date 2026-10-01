# kbsync

Bilgi tabanını kod reposuyla senkron tutan işçi. Kod reposunun `main`'ini yoklar; `backend/.source-commit`'ten sonraki merge'leri **sırayla, tek tek** işler: etkilenen dokümanları bulur, kartları script'le üretir, Claude Code'a (`claude -p`, abonelikle) dokümanları güncelletir, doğrular, commit edip push eder. Kurallar ve gerekçeler: [`prompts/backend/UPDATE-PROMPT.md`](../../prompts/backend/UPDATE-PROMPT.md); sistem prompt'u da oradan okunur.

`FRONTEND_REPO` verilirse aynı işçi uygulama reposunu (`efsane-baskan-rn`) da `frontend/.source-commit`'ten itibaren aynı kurallarla izler ([`prompts/frontend/UPDATE-PROMPT.md`](../../prompts/frontend/UPDATE-PROMPT.md)). Alanlar sırayla işlenir, aynı anda hep tek iş vardır. Frontend işinde API ve ekran kartları, API haritası ve kullanılmayan kod raporu script'le yeniden üretilir; etki listesi değişen dosyaları `sources`'unda tutan akışlardan, değişen kartlardan ve kategori kurallarından (uzak ayarlar, analitik, mimari) çıkar.

## Nasıl çalışır (kısaca)

- **Kuyruk git'in kendisi:** `git log --first-parent <.source-commit>..origin/main`. Ayrı kuyruk ya da veritabanı yok; durum yalnız `.source-commit`'te.
- **Tek işçi:** aynı anda tek iş. İş sürerken yoklama yapılmaz; iş bitince sıra yeniden okunur. Sonraki merge, öncekinin işi bitmeden başlamaz.
- **Yoklama:** `POLL_INTERVAL_MS`'de bir `git ls-remote`. Main değişmemişse hiçbir şey yapılmaz.
- **Birikme:** `BATCH_THRESHOLD`'dan fazla merge beklerse hepsi tek işte birleştirilir.
- **Hata:** watermark yalnız tam başarıda ilerler. Başarısız iş sonraki turda tekrar denenir; `MAX_ATTEMPTS` kez olmazsa ya da durdurucu bir hata çıkarsa (gizli bilgi, izin dışı dosya) sıra durur ve alarm gider. Merge atlanmaz.
- **Abonelik limiti:** Claude limit mesajı verirse deneme sayılmaz; işçi sıfırlanma saatine kadar bekler.
- **Commit'ler imzasızdır:** yalnız `GIT_AUTHOR_*` ile, trailer yok.
- **Arama indeksi:** her turdan sonra KB'nin main'i indekslenen commit'ten ilerideyse `packages/search` ile yalnız değişen parçalar embed edilip Redis'e yazılır. Hata senkronu durdurmaz; üst üste 3 turda bir alarm üretir. `VOYAGE_API_KEY`, `VOYAGE_API_URL`, `REDIS_PASSWORD` yoksa ya da `DRY_RUN` açıksa kapalıdır.

## Gereksinimler

- Node.js 22.18+ (TypeScript'i derlemeden çalıştırır), git.
- Claude Code CLI (`claude`), bot için **ayrı** bir abonelik koltuğunda `claude setup-token` ile üretilmiş token → `CLAUDE_CODE_OAUTH_TOKEN`.
- İki klon, ikisi de yalnız işçinin (işçi onları `reset --hard` ve `checkout --force` ile yönetir; üzerinde çalışılan bir kopyayı vermeyin). Varsayılan yerleri `work/` (git dışı):
  - `work/kb`: bilgi tabanı (push yetkisiyle),
  - `work/code`: kod reposu (okuma yetkisi yeter),
  - `work/frontend`: (isteğe bağlı) uygulama reposu.

İşçinin kodu bu repodadır; yönettiği klonlardan ayrı olduğu için onları sıfırlarken kendini etkilemez. Kart üreticisi ve chunk'lama `packages/kb`'den doğrudan çağrılır; bilgi tabanı klonunda ayrıca bağımlılık kurmak gerekmez.

## Kurulum

```bash
git clone git@github.com:nosurrenderbase/ai-knowledge-engine.git && cd ai-knowledge-engine
npm ci
git clone git@github.com:nosurrenderbase/ai-knowledge-base.git work/kb
git clone git@github.com:nosurrenderbase/nestjs-boilerplate.git work/code
git clone git@github.com:nosurrenderbase/efsane-baskan-rn.git work/frontend   # frontend alanı için
cp deploy/kbsync.env.example deploy/kbsync.env   # yolları ve PATH_PREFIX'i düzenle
deploy/run.sh once                               # bir tur: sıra boşsa "idle"
```

İşçiyi güncellemek için bu repoyu çekip (`git pull && npm ci`) servisi yeniden başlatın.

## Ayarlar (ortam değişkenleri)

| Değişken | Varsayılan | Anlamı |
|---|---|---|
| `KB_REPO` | (zorunlu) | Bilgi tabanı klonu |
| `CODE_REPO` | (zorunlu) | Kod reposu klonu |
| `KB_AREA` | `backend` | Backend alanının klasörü |
| `FRONTEND_REPO` | | Uygulama reposu klonu; verilirse `frontend/` alanı da senkronlanır |
| `FRONTEND_REMOTE` / `FRONTEND_BRANCH` | `origin` / `main` | |
| `KB_REMOTE` / `KB_BRANCH` | `origin` / `main` | |
| `CODE_REMOTE` / `CODE_BRANCH` | `origin` / `main` | |
| `POLL_INTERVAL_MS` | `120000` | Yoklama aralığı |
| `BATCH_THRESHOLD` | `3` | Bundan fazla merge birikirse tek işte birleştir |
| `MAX_ATTEMPTS` | `3` | Bir iş kaç kez başarısız olunca sıra dursun |
| `VALIDATION_ROUNDS` | `2` | Doğrulama hataları için Claude'a kaç düzeltme turu verilsin |
| `GROUP_MAX_DOCS` | `40` | Etki listesi bundan büyükse Claude çağrısı gruplara bölünür |
| `LIMIT_BACKOFF_MS` | `1800000` | Limit mesajında saat okunamazsa bekleme |
| `CLAUDE_BIN` | `claude` | |
| `CLAUDE_MODEL` | `opus` | |
| `CLAUDE_MAX_TURNS` | `80` | |
| `CLAUDE_TIMEOUT_MS` | `3600000` | Tek `claude` çağrısının üst süresi |
| `CLAUDE_CODE_OAUTH_TOKEN` | | Botun abonelik token'ı (CLI okur) |
| `PROMPTS_DIR` | bu reponun `prompts/` klasörü | `<alan>/UPDATE-PROMPT.md`'nin arandığı yer |
| `PATH_PREFIX` | | Yalnız `deploy/run.sh`: node ve claude'un klasörleri |
| `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` | `kbsync` / `kbsync@users.noreply.github.com` | Commit'lerin yazarı (canlıda `NoSurrender AI` / `ai@nosurrender.studio`) |
| `ALERT_WEBHOOK_URL` | | Alarmların `{text}` olarak POST edileceği adres (ör. Slack incoming webhook) |
| `DRY_RUN` | | `1`: yerelde commit et, push etme, tek işten sonra dur |
| `REDIS_*`, `VOYAGE_*` | | Arama indeksi için; `deploy/run.sh` bunları repodaki `.env`'den okur (bkz. `.env.example`) |

## Çalıştırma

```bash
deploy/run.sh             # sürekli: yokla, sırayı işle
deploy/run.sh once        # sırayı bir kez işle ve çık
DRY_RUN=1 deploy/run.sh once   # sıradaki tek işi yerelde commit et, push etme
```

Loglar stderr'e satır başına bir JSON nesnesi olarak yazılır. Süren iş bitmeden kapanırsa watermark ilerlemez; açılışta aynı merge'den devam edilir.

### macOS (launchd)

```bash
deploy/install-launchd.sh                                              # ~/Library/LaunchAgents'a yazar
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.nosurrender.kbsync.plist   # başlat
launchctl kickstart -k gui/$(id -u)/dev.nosurrender.kbsync                              # yeniden başlat
launchctl bootout gui/$(id -u)/dev.nosurrender.kbsync                                   # durdur
tail -f work/logs/kbsync.log
```

LaunchAgent kullanıcı oturumu açıkken çalışır: sunucuda otomatik giriş açık, uyku kapalı olmalı.

### Linux (systemd)

```ini
[Service]
User=kbsync
ExecStart=/srv/ai-knowledge-engine/deploy/run.sh
Restart=always
RestartSec=30
```

## Sıra durduğunda

Alarm hangi merge'de ve neden durduğunu söyler. Sorunu giderdikten sonra (ör. dokümanı elle düzeltip `.source-commit`'i o merge'e ilerletip push ederek) işçi bir sonraki yoklamada kendiliğinden devam eder; aynı merge'ü baştan denetmek için işçiyi yeniden başlatmak yeterli.

## Testler

```bash
npm test -w @ai-knowledge-engine/sync   # birim + uçtan uca (geçici git repoları, gerçek kart üreticisi, sahte claude)
```

Uçtan uca testler `test/fixtures/fake-claude.mjs` ile `claude`'u taklit eder; gerçek Claude çağrılmaz.
