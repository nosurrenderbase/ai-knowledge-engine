# Modül dokümanı üretme prompt'u

Bu dosya, bir modülün (ya da tüm modüllerin) dokümanını üretmek için Claude'a verilecek prompt'tur. İlk örnek `pvp-match` modülüyle yapıldı; çıktının neye benzemesi gerektiğini görmek için `modules/pvp-match.md` ve `flows/pvp/` klasörüne bak.

Yollar: `<ENGINE>` bu repo (ai-knowledge-engine), `<KB>` ai-knowledge-base klonu, `<KOD>` nest-boilerplate'in temiz, detached bir worktree'si (üzerinde çalıştığın kopya değil).

Kullanım: Claude Code'u **nest-boilerplate** dizininde aç (proje hafızası o dizine bağlı; başka dizinde açarsan Jira ve canlı denetim notları yüklenmez) ve aşağıdaki bloğu yapıştır. `<MODÜL>` yerine modül klasör adını yaz (örn. `referral`). Tüm modüller için ise "Modül listesi" bölümündeki notu oku.

---

```text
Görev: nest-boilerplate'in <MODÜL> modülü için bilgi tabanı dokümanlarını üret.
Okuyucular patron, PM ve onların AI'ı. Kod bilmeyen biri okuyup "bu kural canlıda nasıl
çalışıyor, hangi barem geçerli" sorusunun cevabını bulabilmeli.

Repolar:
- Doküman reposu: <KB>/backend
- Kod kaynağı: <KOD> (main'in temiz, detached worktree'si).
- Araçlar ve şablon: <ENGINE> (kart üretici, prompts/backend/TEMPLATE-flow.md).
  Sadece OKU. Asla nest-boilerplate çalışma dizinine doküman yazma.

Adımlar:

1. Kodu güncelle:
   cd <KOD> && git fetch origin main -q && git checkout --detach origin/main -q
   Kısa SHA'yı not et; tüm frontmatter'larda code_commit bu olacak.

2. Use case kartlarını üret (AI değil, script):
   cd <ENGINE> && npm run gen:cards -- --kb <KB>/backend --source <KOD> <MODÜL>
   Kartlar usecases/<MODÜL>/ altına düşer. <!-- gen:start --> ... <!-- gen:end --> arasına
   ASLA elle dokunma; script her çalıştığında orayı yeniden yazar.

3. Modülü oku:
   - src/modules/<MODÜL>/ altındaki domain/constants, domain/types, domain/entities,
     usecases, presentation (resolver/controller), infra (repository sorguları), *.module.ts.
   - Modül dışındaki kullanımlar: grep -rl "<modül adıyla ilgili anahtar kelime>" src
     (örn. adwatch handler'ları, daily-mission metrikleri, cron'lar, push anahtarları).
   - Sabitin DB'de mi, env'de mi, kodda mı durduğunu belirle. DB'deki değerleri tahmin etme;
     "DB'de, koleksiyon X" diye yaz.
   - Hafızadaki bu modülle ilgili notları oku
     (nest-boilerplate projesinin Claude hafızası: MEMORY.md ve bağlı dosyalar): Jira kartları, canlı denetim
     bulguları, onay bekleyen sorunlar. "Bilinen sorunlar" bölümüne tarihiyle ekle.

4. Akışları belirle: modülü İŞ AKIŞLARINA böl (use case'lere değil). Bir akış =
   patronun soracağı bir konu (örn. "günlük hak", "ödül"). Tipik olarak 2-6 akış.
   Bir kural birden fazla akışta geçiyorsa TEK akışta tam anlat, diğerlerinden link ver.

5. Her akış için flows/<kısa-modül-adı>/<akış>.md yaz. Şablon: <ENGINE>/prompts/backend/TEMPLATE-flow.md.
   Zorunlu kurallar:
   - Türkçe, düz ve açık cümleler. Kısaltma ve kod adı kullanma; kullanırsan açıkla.
   - Her barem: somut değer + birim + kaynak sabit/dosya + nerede yaşadığı (kod/DB/env).
   - Kontrollerin SIRASINI ve dönen hata kodlarını yaz.
   - Kodda olmayan davranışı (dış maç motoru, istemci, cron sunucusu) açıkça "bu kodda değil"
     diye işaretle.
   - status alanı dürüst olsun: canlıda / kod main'de ama istemci bağlı değil / bayrakla kapalı.
   - Mermaid diyagramı: durum makinesi varsa stateDiagram, çok aktörlüyse sequenceDiagram,
     yoksa flowchart.
   - sources listesine akışı anlatan TÜM dosyaları yaz (CI ters indeksi bunu kullanacak).

6. Kartların "## Ne yapar" bölümündeki TODO'yu doldur: 2-3 cümle iş diliyle + ilgili akış
   linki. Sonra 2. adımdaki kart komutunu tekrar çalıştırıp paragrafın korunduğunu doğrula.

7. modules/<MODÜL>.md yaz: ne yapar, akış tablosu (durumuyla), kart listesi, diğer
   modüllerle ilişki (kullanır / kullanılır / dış), veri (koleksiyon, Redis anahtarı).
   Örnek: modules/pvp-match.md.

8. DOĞRULAMA (atlanamaz): akış MD'lerindeki her sayıyı koddaki sabitle grep'le karşılaştır.
   Kod yorumu ile sabitin değeri çelişiyorsa SABİT geçerlidir; çelişkiyi "Bilinen sorunlar"a
   yaz (örn. PvP'de yorum "30 dk" diyordu, sabit 5 dk'ydı). Kartlardaki sabit tablosu da
   değerleri koddan okur; akış ile kart çelişiyorsa akışı düzelt.

9. Commit ATMA. Oluşturulan/değişen dosyaların listesini ve varsa bulduğun kod-yorum
   çelişkilerini raporla.
```

---

## Modül listesi (tümü için)

Tüm modülleri tek seferde yapmak yerine gruplar halinde ilerle; her grup ayrı bir oturum ya da ayrı bir alt ajan olabilir. Önerilen sıra: patronun en çok sorduğu alanlar önce.

1. league, team-league, league-finalization, fixture, match-result-ingestion
2. referral, pro-package, kyc, iap, store
3. daily-mission, mission, user-mission, daily-checkin, adwatch
4. scout-market, player, team-player, player-marketplace, inventory, item
5. building, stadium-inbox, club-economy, resource, sponsorship, president
6. Kalanlar (`ls src/modules`)

Tüm modüllerin kartları tek komutla üretilebilir (AI gerektirmez):

```bash
npm run gen:cards -- --kb <KB>/backend --source <KOD> $(ls <KOD>/src/modules)
```

## Artımlı güncelleme

Kod değiştikçe dokümanları otomatik güncelleyen işçi `apps/sync`'tir; kuralları [UPDATE-PROMPT.md](UPDATE-PROMPT.md)'de.
