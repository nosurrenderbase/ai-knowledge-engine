# Frontend bilgi tabanı: yazım kuralları

Efsane Başkan mobil uygulamasının (React Native, Expo Router; repo `nosurrenderbase/efsane-baskan-rn`) kodsuz bilgi tabanı. Okuyucular:

- **Backend geliştirici:** "Bu mutation'ı uygulamada nereler, ne zaman çağırıyor?", "Bu alanı değiştirirsem hangi ekran etkilenir?", "Frontend hangi hata kodunu nasıl gösteriyor?"
- **PM:** "Bu özellik oyuncuya nasıl görünüyor, ne zaman çıkıyor, açık mı kapalı mı?"
- **Patron ve onların AI'ı:** "Oyuncu X'i yapınca ne oluyor?"

Doğrunun kaynağı her zaman koddur. Bilgi tabanı koda giden haritadır.

## Klasörler (`<KB>/frontend/`)

| Klasör | İçerik | Kim yazar |
|---|---|---|
| `genel/` | Genel bakış (uygulama haritası, "hangi soru için hangi doküman"), mimari, uzak ayarlar, analitik, API haritası (script), kullanılmayan kod (script) | AI + script |
| `flows/<alan>/` | Oyuncu yolculukları: ne görür, ne zaman görünür, hangi API ne zaman, hatalar, bayraklar. **Ana içerik.** | AI |
| `api/` | Her GraphQL işlemi için kart: backend alanları, kullanan dosyalar, erişildiği ekranlar | Script; yalnız "Ne yapar" paragrafı AI |
| `ekranlar/` | Her rota için kart: işlemler, yönlendirmeler, analitik | Script; yalnız "Ne gösterir" paragrafı AI |

Kartlar `ai-knowledge-engine`'de `node packages/kb/src/cli.ts gen-frontend ...` ile üretilir. `<!-- gen:start -->` … `<!-- gen:end -->` arasına ASLA dokunma.

## Akış dokümanı yazarken

Şablon: `TEMPLATE-flow.md`. Kurallar:

1. **Akış = oyuncunun bir yolculuğu ya da bir konu**, dosya değil. "PvP meydan okuma", "Lig kayıt", "Bina yükseltme". Bir alanda tipik olarak 2-6 akış. Bir konu birden fazla akışta geçiyorsa TEK akışta tam anlat, diğerlerinden link ver.
2. **Görünme koşulları zorunlu ve somut.** Bir bileşen ne zaman görünür, ne zaman gizlenir: hangi backend alanı (`me.isPro`), hangi jotai atom'u (`proUpsellOpenAtom`), hangi uzak ayar (`pvp_matchmaking_enabled`), hangi zaman penceresi, hangi tutorial adımı. Kodda olduğu gibi, tahminsiz.
3. **Her API çağrısı için: ne zaman** (ekran açılınca, butona basınca, belirli aralıkla poll, bildirim gelince), **hangi işlem** (api kartına link), **hangi backend alanı**, **backend tarafı** (backend akışına link). Sonrasında yenilenen sorgular (`refetchQueries`), iyimser güncelleme (optimistic), önbellek politikası (`fetchPolicy`, `pollInterval`) varsa yaz.
4. **Hatalar:** backend hata kodu (ör. `PVP_DAILY_LIMIT_REACHED`, `GAME_LOCKED`) ya da ağ hatası olduğunda oyuncu ne görür; çeviri anahtarı (`t('...')`) ve mümkünse Türkçe metni (`src/locales/tr/common.json`'dan).
5. **Sayılar ve süreler:** değer + birim + nerede yaşadığı (kod sabiti / Firebase Remote Config + koddaki varsayılan / backend'den gelir).
6. **Durum (`status`) dürüst olsun:** `canlıda` | `kısmen canlıda` | `bayrakla kapalı` (uzak ayar ya da kod bayrağıyla kapalı) | `kodda var, erişilmiyor` (hiçbir rotadan erişilmiyor; bkz. `genel/kullanilmayan-kod.md`) | `kaldırıldı`. Açıklama `status_note`'a.
7. **Backend'e bağla:** aynı konunun backend dokümanlarını `backend:` listesine ve metin içinde linkle (`../../../backend/flows/...`). Frontend ile backend'in uyuşmadığını görürsen (frontend'in beklediği alan yok, hata kodu farklı, limit farklı) "Bilinen sorunlar"a yaz.
8. **Bu kodda olmayan davranış** (backend kuralı, maç motoru, Firebase'deki değer, mağaza): "uygulamada değil" diye belirt ve varsa backend dokümanına linkle.
9. **Türkçe, düz ve tam cümleler.** Kod adı (bileşen, hook, atom) kullanırsan ne olduğunu açıkla. Okuyucu kod bilmiyor olabilir, ama backend geliştirici dosya yolunu da ister: dosya yollarını backtick içinde ver.
10. **`aliases`:** 5-15 kısa ifade: oyuncunun/PM'in günlük dili, ekran adı, bileşen adı, 1-3 tipik soru.
11. **`sources`:** akışı anlatan TÜM frontend dosyaları (ileride değişiklikte hangi dokümanın güncelleneceğini bu liste belirler). **`api`:** çağrılan işlemlerin kart yolları (`api/<işlem>.md`).
12. Mermaid: çok aktörlü akışta `sequenceDiagram`, durum makinesinde `stateDiagram`, yoksa `flowchart`. Türkçe durum adı için ASCII takma ad; etiketlerde `;` yok.
13. Bölümler ~150-400 kelime; 40 satırı aşan tabloyu alt başlıkla böl. Aynı dokümanda aynı başlığı iki kez kullanma.
14. Gizli bilgi yok: API anahtarı, token, kişi adı, e-posta. `.env` okunmaz.
15. Dosya adları ASCII, küçük harf, tireli.

## Linkler

Akış dokümanı `flows/<alan>/x.md` içinden:

- api kartı: `../../api/<işlem>.md`
- ekran kartı: `../../ekranlar/<rota>.md`
- genel: `../../genel/<belge>.md`
- başka frontend akışı: `../<alan>/<akış>.md`
- backend: `../../../backend/flows/<alan>/<akış>.md`, `../../../backend/modules/<modül>.md`

Frontmatter'daki `related`, `api`, `sources` dışı yollar alan köküne göredir (`flows/...`, `api/...`); `backend:` listesi `../backend/...` biçimindedir.

## Kart paragrafları

- `api/<işlem>.md` "## Ne yapar": 1-2 cümle; bu çağrı oyuncu için ne sağlar, uygulama onu ne zaman yapar. İlgili akışa link.
- `ekranlar/<rota>.md` "## Ne gösterir": 2-3 cümle; oyuncu bu ekranda ne görür, ne yapabilir, nereden gelinir. İlgili akışlara link.
