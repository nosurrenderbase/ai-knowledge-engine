# Maç motoru bilgi tabanı: yazım kuralları

Efsane Başkan'ın maçlarını oynatan motorun (Go; repo `nosurrenderbase/match-engine`) kodsuz bilgi tabanı. Okuyucular:

- **PM ve patron:** "Maç sonucunu hangi statlar belirliyor, hangisi ne kadar etkili?", "Overall'ı yüksek takım neden kaybetti?", "Şu oyun stili ne işe yarıyor?"
- **Backend geliştirici:** "Motor oyuncu verisinden hangi alanları okuyor?", "Maç sonucu nereye yazılıyor, ödülü kim tetikliyor?", "Lig maçları ne zaman ve nasıl oynatılıyor?"
- **Onların AI'ı:** yukarıdaki soruların hepsi, sayılarla.

Doğrunun kaynağı her zaman koddur. Bilgi tabanı koda giden haritadır.

## Motorun temel fikri (her yazar bilmeli)

- Maç canlı oynanmaz: 90 dakika sunucuda baştan sona simüle edilir (~1 sn), tick akışı kaydedilir, istemci kaydı oynatır.
- Deterministik: aynı girdiler (kadrolar, taktikler, tohum, motor sürümü, CPU mimarisi) bit-bit aynı maçı üretir.
- Davranış veriden gelir: oyuncu kararları SkillCorner takip verisinden (~760 Premier League maçı) türetilmiş tablolardan (`analysis/out/*.json`) okunur. "No self-tuning" kuralı: ölçümden gelmeyen katsayı motora giremez.
- Statlar davranışı değiştirmez, büker: `attrFactor(stat, gain) = 1 + gain·(stat−70)/30`, 70'te 1, uçlarda 1±gain. Hangi statın hangi gain'le nereye girdiği `genel/metrik-haritasi.md`'de (script).
- Takım gücü (tier), takım stili ve oyuncu statları ayrı eksenlerdir.

## Klasörler (`<KB>/mac-motoru/`)

| Klasör | İçerik | Kim yazar |
|---|---|---|
| `genel/` | Genel bakış ("hangi soru için hangi doküman"), mimari, metriklerin etkisi, veri modelleri, altyapı, sözlük; metrik haritası ve oyun stilleri tabloları (script) | AI + script |
| `flows/<alan>/` | Mekanizmalar: maç akışı, takım gücü, top üstü kararlar, topsuz oyun, kaleci, duran toplar, fiziksel durum, çıktılar, altyapı. **Ana içerik.** | AI |
| `metrikler/` | Backend'in sakladığı her oyuncu statı için kart: motorda hangi alan, hangi fonksiyonlar, hangi gain, nerede tüketiliyor | Script; yalnız "Ne işe yarar" paragrafı AI |

Kartlar `ai-knowledge-engine`'de `node packages/kb/src/cli.ts gen-engine ...` ile üretilir. `<!-- gen:start -->` … `<!-- gen:end -->` arasına ASLA dokunma.

## Akış dokümanı yazarken

Şablon: `TEMPLATE-flow.md`. Kurallar:

1. **Akış = bir mekanizma ya da süreç**, dosya değil: "Pas seçimi ve isabeti", "Takım gücü (tier)", "Lig maçlarının toplu oynatılması". Bir konu birden fazla akışta geçiyorsa TEK akışta tam anlat, diğerlerinden link ver.
2. **Etki büyüklüğü zorunlu ve sayısal.** Her stat, taktik ya da bayrak için: hangi niceliği (olasılık, hız, sıklık, isabet sapması, mesafe) ne kadar değiştirir; örnek iki değer için hesapla (60 vs 90). Kodda olduğu gibi, tahminsiz.
3. **Kaynak zinciri:** sayı nereden geliyor: SkillCorner ölçümü (miner + model dosyası), literatür varsayımı ya da elle seçim. Kod yorumundaki gerekçeyi aktar; "kalibre edildi" diyorsa neye göre kalibre edildiğini yaz.
4. **Girdiler ve sınırlar:** mekanizmayı hangi oyuncu statları (`metrics:`), takım verileri (taktik, tier, stil), modeller (`models:`) besliyor. Motorun okumadığı statları "etkisi yok" diye açıkça söyle (bkz. `genel/metrik-haritasi.md`).
5. **Durum (`status`) dürüst olsun:** `canlıda` | `kısmen canlıda` (ör. faz-2: en yakın kancaya kısmen bağlı) | `bayrakla kapalı` (sabit/bayrakla kapatılmış, ör. `tierPressPayoffCalibrated`) | `kodda var, kullanılmıyor` | `kaldırıldı`. Açıklama `status_note`'a.
6. **Backend'e bağla:** maçı tetikleyen, girdileri hazırlayan, sonucu ve ödülü işleyen backend dokümanlarını `backend:` listesine ve metin içinde linkle (`../../../backend/flows/...`). Motor ile backend'in uyuşmadığını görürsen "Bilinen sorunlar"a yaz.
7. **Bu kodda olmayan davranış** (backend kuralı, ödül, ekonomi, istemci gösterimi): "motorda değil" diye belirt ve varsa ilgili dokümana linkle.
8. **Türkçe, düz ve tam cümleler; futbol terimi Türkçe** (pres, orta, ara pas, savunma bloğu); ilk geçişte İngilizce/kod karşılığını parantezde ver. Kod adı kullanırsan ne olduğunu açıkla. Dosya yollarını backtick içinde ver.
9. **`aliases`:** 5-15 kısa ifade: futbol dili, İngilizce terim, kod adı, 1-3 tipik soru ("dribbling ne işe yarar").
10. **`sources`:** konuyu anlatan TÜM motor dosyaları (ileride değişiklikte hangi dokümanın güncelleneceğini bu liste belirler). **`models`:** okunan `analysis/out/*.json` dosyaları. **`metrics`:** kullanılan statların kart yolları (`metrikler/<stat>.md`).
11. Mermaid: süreçte `flowchart` ya da `sequenceDiagram`, durum makinesinde `stateDiagram`. Türkçe durum adı için ASCII takma ad; etiketlerde `;` yok.
12. Bölümler ~150-400 kelime; 40 satırı aşan tabloyu alt başlıkla böl. Aynı dokümanda aynı başlığı iki kez kullanma.
13. Gizli bilgi yok: AWS hesap numarası, anahtar, token, bağlantı adresi, kişi adı, e-posta. `.env`, terraform state, kubeconfig okunmaz; altyapıyı kaynak adı ve davranış düzeyinde anlat.
14. Dosya adları ASCII, küçük harf, tireli.

## Linkler

Akış dokümanı `flows/<alan>/x.md` içinden:

- metrik kartı: `../../metrikler/<stat>.md`
- genel: `../../genel/<belge>.md`
- başka akış: `../<alan>/<akış>.md`
- backend: `../../../backend/flows/<alan>/<akış>.md`, `../../../backend/modules/<modül>.md`
- frontend: `../../../frontend/flows/<alan>/<akış>.md`

Frontmatter'daki `related`, `metrics` yolları alan köküne göredir (`flows/...`, `metrikler/...`); `models` ve `sources` motor reposunun köküne göre; `backend:` listesi `../backend/...` biçimindedir.

## Kart paragrafı

`metrikler/<stat>.md` "## Ne işe yarar": 2-4 cümle; bu stat maçta neyi değiştirir (futbol diliyle), etkisi ne kadar (60 ile 90 arası örnek), hangi pozisyonda önemli; motor okumuyorsa "maç sonucuna etkisi yok; yalnız kart yüzü/overall hesabında ve backend'de" gibi açıkça. İlgili akışa link.
