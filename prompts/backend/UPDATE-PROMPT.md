# Otomatik güncelleme: Node işçisi + Claude Code

Node işçisi (`apps/sync`, kurulum ve ayarlar için [apps/sync/README.md](../../apps/sync/README.md)) kod reposunu belirli aralıkla yoklar; `.source-commit`'ten bu yana merge varsa merge'leri **sırayla, teker teker** işler: ilgili dokümanları Claude Code'a (abonelikle, `claude -p`) güncelletir, doğrular ve bilgi tabanı reposuna yazar. **Deterministik her iş Node'da, yorum gerektiren iş Claude Code'da.** Commit ve push'u Claude değil, işçi yapar.

## 1. İşçi (Node)

### Sıra ve tek yazar

- **Kuyruk git'in kendisidir.** Ayrı kuyruk (Redis vb.) yok. Sıra: `git log --first-parent --reverse <.source-commit>..origin/main` (merge sırası). Durum yalnız `backend/.source-commit`'te (watermark) tutulur; işçi çökse de kaybolmaz.
- **Tek işçi, tek kopya.** Aynı anda en fazla bir iş çalışır. İş sürerken yoklama çalışmaz; iş bitince işçi sırayı kendisi yeniden kontrol eder.
- **Yoklama:** her `POLL_INTERVAL`'de (varsayılan 2 dk) `git ls-remote` ile main'in SHA'sına bakılır. Değişmemişse hiçbir şey yapılmaz. Açılışta da bir kez bakılır.
- **FIFO:** sıradaki ilk merge alınır, `watermark..o merge` aralığı işlenir. Sonraki merge, öncekinin işi bitmeden başlamaz; küçük bir fix büyük bir feature'ı geçemez.
- **Birikme freni:** sırada `BATCH_THRESHOLD`'dan (varsayılan 3) fazla merge varsa hepsi tek işte birleştirilir (`watermark..son merge`).
- **Watermark yalnız tam başarıda ilerler.** Hata olursa aynı merge tekrar denenir; `MAX_ATTEMPTS` (3) kez olmazsa alarm üretilir ve sıra durur. Merge atlanmaz.
- **Abonelik limiti:** `claude` limit mesajıyla ("You've hit your … limit", sıfırlanma saati) dönerse deneme sayılmaz; işçi o saate kadar uyur, sonra aynı merge'den devam eder.

### Bir işin adımları

`backend/` (ve ileride `frontend/`) için ayrı ayrı:

1. **Çek:** Kod reposu `git fetch`; kod worktree'si `git checkout --detach <HEAD_SHA>` (`gen:cards` commit'i buradan okur). KB reposu `git fetch` + `git reset --hard origin/main` (işçinin klonu yalnız onundur; yarım kalan iş böylece temizlenir).
2. **Taban:** `BASE_SHA = backend/.source-commit`, `HEAD_SHA` = işlenecek merge. `git merge-base --is-ancestor BASE HEAD` değilse (main'de force-push) dur, alarm üret.
3. **Diff:** `git diff --name-status -M BASE..HEAD`.
   - Etkisiz dosyaları ele: `*.spec.ts`, `test/`, `*.md` (kod reposundaki), `.github/` hariç CI dosyaları, lock dosyaları. Kalan yoksa sadece `.source-commit`'i güncelle, Claude'u çağırma.
4. **Etki listesi (ters indeks):** KB'deki tüm `.md` frontmatter'larını tara, `sources:` listesinde değişen dosya geçen dokümanları topla. Rename'de (`R eski -> yeni`) eski yolu ara; `sources:`'u yeni yola çevirmek Claude'un işidir. Ayrıca kategori kuralları (tablo aşağıda). Değişen `*/usecases/**/*.ts` → kart. Yeni/silinen modül klasörü → işaretle.
5. **Kartlar:** `packages/kb` kart üreticisi (`generateCards`, ts-morph; Claude değil) etkilenen modüller için çalışır. Script modülün bütün kartlarına `code_commit` basar; içeriği değişmeyip yalnız bu damgası değişen kartlar geri alınır. Silinen use case kartını silme, Claude'a "kaldırıldı" işaretlet.
6. **Claude'u çağır:** bölüm 3'teki komut; sistem prompt'u bölüm 2, çalıştırma mesajı bölüm 5.
7. **Doğrula** (bölüm 4). Düzeltilebilir hataları aynı oturuma (`--resume <session_id>`) geri ver (en fazla `VALIDATION_ROUNDS`, varsayılan 2 tur). Olmazsa commit etme, `.source-commit`'i ilerletme, deneme sayısını artır (yarım kalan dosyaları bir sonraki denemenin 1. adımı siler). Durdurucu hatada sıra hemen durur ve alarm üretilir.
8. **Yaz:** `.source-commit = HEAD_SHA`, README "Durum" sayıları, tek commit (`backend: #<PR> senkronu (kod <base7>..<head7>)`; birleştirilmiş işte PR listesi), `git push` (fast-forward değilse reddedilir → iş başarısız sayılır, tekrar denenir). Commit'e araç/AI imzası ekleme.
9. **İndeks:** vektör DB indeksleyicisi ayrı süreçtir: KB'nin main'ini çeker, `packages/kb` `buildChunks` çıktısındaki (`id`, `hash`) çiftlerini indeksle karşılaştırır, yalnız değişenleri embed eder, artık olmayanları siler. İşçiye bağlı değildir; her zaman git'e yetişir.

**Kategori kuralları** (sources'ta olmasa da etki listesine ekle):

| Değişen kod dosyası | Etkilenen doküman |
|---|---|
| `*.schema.ts`, `@Schema`, koleksiyon/index | `genel/veri-haritasi.md` |
| `src/bootstrap/config/env.schema.ts`, `.env.example` | `genel/altyapi.md` |
| `k8s/*.yaml`, `.github/workflows/*` | `genel/altyapi.md`, `genel/operasyon/cron-isleri.md` |
| `package.json` scripts, `scripts/*` | `genel/operasyon/elle-calistirilan-scriptler.md` |
| `/internal/*` controller, webhook, dış servis adapter'ı | `genel/dis-sistemler.md` |
| `*.resolver.ts`, `*.controller.ts` | modül dokümanı + ilgili akış |
| `domain/constants/*`, `*.constant.ts` | sabit ADINI tüm KB'de grep'le, geçen tüm dokümanlar |
| `src/common/*`, `src/bootstrap/*` | `genel/altyapi.md` |
| yeni modül klasörü | tam üretim (PROMPT.md) + `genel/genel-bakis.md` tabloları |

Etki listesi `GROUP_MAX_DOCS`'tan (varsayılan 40) büyükse Claude çağrısı aynı iş içinde gruplara bölünür: bir modülün (ya da bir `flows/<alan>`ın) dokümanları hep aynı grupta, `genel/` en sonda tek çağrıda. Doğrulama hepsi bitince çalışır, düzeltme turları son oturumu sürdürür; watermark hepsi bitince ilerler.

## 2. Claude sistem prompt'u

İşçi bu bölümdeki ilk ```text bloğunu okuyup `--append-system-prompt` ile verir; prompt'u değiştirmek için burayı düzenlemek yeterli.

```text
Sen Efsane Başkan backend'inin kodsuz bilgi tabanını kod değişikliklerine göre güncelleyen
dokümantasyon ajanısın. Okuyucular patron, PM ve onların AI'ı (vektör DB üzerinden RAG).
Doğrunun kaynağı HER ZAMAN koddur: doküman koda uyar. Kodu asla değiştirmezsin; yalnız sana
kod reposunu (ek dizin, salt okunur) OKUR, bilgi tabanı dokümanlarını YAZARSIN.

GÖREV
Çalıştırma mesajında sana: BASE ve HEAD commit, değişen kod dosyaları (durum A/M/D/R ile),
işçinin çıkardığı etki listesi (doküman → neden), yeni üretilen kartlar ve gerekirse diff
parçaları verilir. Yalnız etkilenen dokümanları güncelle.

ÇALIŞMA SIRASI
1. Her etkilenen doküman için: dokümanı baştan sona oku, ilgili kod dosyalarını ve diff'i oku,
   dokümanda değişmesi gereken yerleri belirle. Etki listesinde olup gerçekte değişmesi
   gerekmeyen dokümanı DEĞİŞTİRME, raporda "etkisiz" de.
2. Etki listesinde olmayan ama değişiklikten etkilendiğini gördüğün doküman varsa (sabit adıyla
   KB'de ara) onu da güncelle ve raporda belirt.
3. Yeni kartların "## Ne yapar" TODO'sunu doldur; davranışı değişen kartın paragrafını düzelt.
4. Silinen use case/akış/modül: dosyayı SİLME; frontmatter'a `status: kaldırıldı` ve
   `status_note: "<tarih>'de koddan kaldırıldı (<commit>)"` ekle, kartta "Ne yapar" başına
   **KALDIRILDI** yaz, diğer dokümanlardaki linklerini kaldır.
5. Yeni modül: PROMPT.md'deki kuralla akış(lar), modül dokümanı ve kart paragraflarını yaz;
   genel/genel-bakis.md'deki "Hangi soru için hangi doküman" ve "Modül haritası" tablolarına ekle.

YAZIM KURALLARI
- Yalnız etkilenen BÖLÜMLERİ değiştir. Dokunmadığın bölümün tek karakterini bile değiştirme
  (parça hash'leri değişir, gereksiz yeniden embed olur).
- Türkçe, düz ve tam cümleler. Kod adı kullanırsan açıkla.
- Her barem: değer + birim + kaynak sabit/dosya + nerede yaşadığı
  (kod / DB koleksiyon X / env DEĞİŞKEN / dış sistem). DB'deki değeri tahmin etme.
- Kontrollerin sırasını ve dönen hata kodlarını yaz.
- Bu repoda olmayan davranış (maç motoru, istemci, admin paneli, k8s zamanlaması, Sumsub,
  RevenueCat, APNs…): "bu kodda değil".
- Kod ile yorum çelişirse KOD geçerlidir; çelişkiyi "Bilinen sorunlar"a tarihiyle yaz.
- Kod şüpheli görünse de doküman BUGÜNKÜ davranışı anlatır; bulgu rapora ve
  "Bilinen sorunlar"a gider. Olması gerekeni anlatma.
- Kaldırılan kural/tablo satırını sil; gerekiyorsa "Değişiklik geçmişi" bölümüne tek satır
  tarihli not düş.
- status yalnız şunlardan biri: canlıda | kısmen canlıda | kod main'de, istemci bağlı değil |
  istemci kullanımı belirsiz | bayrakla kapalı | kaldırıldı. Açıklama `status_note`'a.
  Env/bayrakla açılan davranışta canlı değeri bilmiyorsan "env ile açılır, canlı değeri kodda
  görünmez" yaz.
- Yeni doküman ya da yeni kavram: `aliases:` (5-15 kısa ifade: Türkçe eş anlamlı ve günlük ağız,
  İngilizce kod adı, 1-3 tipik soru). Lig numarası ters: "1. Lig" = Rising Stars, "2. Lig" = Amateur.
- `sources:` listesini güncel tut; `code_commit:` yalnız DEĞİŞTİRDİĞİN dokümanlarda HEAD olur.
- Bölümler ~150-400 kelime; 40 satırı aşan tabloyu alt başlıkla böl.
- Mermaid'i yalnız akış değiştiyse güncelle; Türkçe durum adı için ASCII takma ad
  (state "Kabul edildi" as ACCEPTED), etiketlerde `;` yok.
- Yeni dosya adları ASCII, küçük harf, tireli.
- <!-- gen:start --> ... <!-- gen:end --> arasına ASLA yazma (script üretir).

YASAKLAR
- .env dosyası, veritabanı, parola/anahtar/token/bağlantı adresi, IP, e-posta, TC numarası,
  oyuncu adı: okuma, yazma, alıntılama YOK. Env için yalnız değişken ADI.
- Kod reposuna yazma yok.
- Tahmin yok: okuyamadığını "bilinmiyor / DB'de / dış sistemde" diye yaz.
- Etkilenmeyen dokümanı "iyileştirme" yok.

BİTİŞ
Son mesajın YALNIZ şu JSON olsun:
{
  "updated":   [{"path": "...", "sections": ["..."], "reason": "..."}],
  "created":   [{"path": "...", "reason": "..."}],
  "retired":   [{"path": "...", "reason": "..."}],
  "no_change": [{"path": "...", "reason": "..."}],
  "value_changes": [{"doc": "...", "rule": "...", "old": "...", "new": "...", "source": "SABİT (dosya)"}],
  "findings":  [{"severity": "high|medium|low", "path": "kod dosyası", "summary": "..."}],
  "open_questions": ["..."]
}
```

## 3. Claude Code çağrısı ve yetkiler

Abonelikle çalışır: botun **ayrı** koltuğunda `claude setup-token` ile üretilen token işçiye `CLAUDE_CODE_OAUTH_TOKEN` olarak verilir (kişisel hesap kullanılmaz; kotalar karışır). Agent SDK abonelikle çalışmadığı için CLI kullanılır.

```bash
claude -p \                                  # çalıştırma mesajı (bölüm 5) stdin'den
  --output-format json --json-schema '<BİTİŞ raporunun şeması>' \
  --permission-mode dontAsk \
  --model opus --max-turns 80 \
  --add-dir <kod worktree> \
  --setting-sources '' --settings '<izin kuralları JSON>' \
  --append-system-prompt '<bölüm 2>'
# doğrulama turlarında ayrıca: --resume <session_id>
```

Çalışma dizini KB reposudur. Makinedeki ya da repodaki ayar dosyaları yüklenmez (`--setting-sources ''`); yetkiler işçinin her çağrıda ürettiği kurallarla (`--settings`, mutlak yollarla) verilir ve `dontAsk` izin listesinde olmayan her şeyi sormadan reddeder:

| Yetki | Kapsam |
|---|---|
| İzinli | `Read`, `Grep`, `Glob`; Bash'te yalnız `git diff`, `git show`, `git log` (BASE'teki eski hal ve diff için) |
| Düzenleme | `Edit` / `Write` yalnız `backend/**/*.md` |
| Yasak | `**/.env*` okuma; `.source-commit` ve `backend/README.md` yazma; `git commit` / `git push`; ağ erişimi |

Kurallar dışında kalan her şey doğrulamada yakalanır (bölüm 4): gen bloğu, izin dışı dosya, kod worktree'sinde değişiklik.

## 4. Doğrulama (işçi, Claude'dan sonra)

İki tür sonuç var: **düzeltilebilir** hatalar Claude'a aynı oturumda geri verilir (en fazla `VALIDATION_ROUNDS` tur); **durdurucu** hatalar işi hemen bitirir ve sırayı insan bakana kadar durdurur.

Düzeltilebilir:

1. Değişen `.md`'lerde frontmatter geçerli YAML; `status` izinli değerlerden biri; `aliases` liste.
2. Tüm göreli markdown linkleri ve `sources` (kodda, HEAD'de) / `related` (KB'de) yolları var. `status: kaldırıldı` dokümanın `sources`'u denetlenmez.
3. `_TODO:` kalmadı. Değişen her kartta `<!-- gen:start -->…<!-- gen:end -->` arası script çıktısıyla birebir aynı; kartı yalnız script oluşturur.
4. Kapsam: kartları yeniden üretilen modüllerde her `*.usecase.ts` için kart var; değişen resolver/controller'lardaki her Query/Mutation/Subscription ve REST ucu en az bir dokümanda geçiyor.
5. Değişen dokümanlara eklenen satırlarda backtick içindeki sabit (`BÜYÜK_HARF_ALT_ÇİZGİ`) ve sınıf adları (`…UseCase`, `…Error`, `…Guard` vb.) kodda bulunuyor. Geçmişi anlatan satırlar ("kaldırıldı", "eski", "önceki") hariç.
6. Parçalama (`buildChunks`) hatasız; `embed_text`'te Mermaid yok; tekrar eden `id` yok.

Durdurucu:

7. Gizli bilgi taraması (eklenen satırlar): bağlantı adresi (`mongodb://`, `redis://`…), özel anahtar, AWS/GitHub/Anthropic/Slack anahtarları, JWT, parola ataması, e-posta, IP, geçerli TC kimlik numarası (kontrol haneleriyle).
8. İzin dışı değişiklik: `backend/**/*.md` dışında bir dosya, işçinin yönettiği `backend/README.md`, silinmiş dosya ya da kod worktree'sinde herhangi bir değişiklik.
9. Boyut freni: Claude'un değiştirdiği doküman sayısı `max(10, 3 × etki listesi)`'ni aşarsa commit edilmez, insana sorulur.

## 5. Çalıştırma mesajı şablonu (her iş)

```text
BASE: <base_sha>  HEAD: <head_sha>  Tarih: <YYYY-MM-DD>
Merge edilen PR'lar: <#no başlık> ...

Değişen kod dosyaları:
M src/modules/kyc/usecases/process-completed-kyc.usecase.ts
A src/modules/foo/usecases/bar.usecase.ts
D src/modules/pvp-match/usecases/grant-pvp-bonus-attempts.usecase.ts
R src/modules/a/x.ts -> src/modules/b/x.ts

Etki listesi (işçi):
flows/pro-kayit/pro-onayi-ve-tc-kontrolu.md  ← sources: process-completed-kyc.usecase.ts
usecases/kyc/process-completed-kyc.usecase.md ← kart yeniden üretildi, "Ne yapar"ı kontrol et
genel/veri-haritasi.md                        ← kategori: *.schema.ts değişti
usecases/foo/bar.usecase.md                   ← YENİ kart, "Ne yapar" TODO

Kod repo yolu: <kod worktree>. Diff'leri gerektikçe `git -C <kod worktree> diff BASE..HEAD -- <yol>` ile al. Sistem prompt'undaki kurallarla güncelle ve JSON raporla bitir.
```
