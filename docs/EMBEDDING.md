# Embedding ve arama sözleşmesi

Bilgi tabanı vektör veritabanına `npm run build:chunks -- --kb <KB>/backend` çıktısıyla (`chunks.jsonl`) yüklenir. Parçalama kuralları `packages/kb/src/chunks.ts` içindedir (`buildChunks`); bu dosya neyin neden öyle yapıldığını anlatır.

## Parça (chunk) biçimi

Her satır bir JSON nesnesidir:

| Alan | Anlamı |
|---|---|
| `id` | `<dosya yolu>#<başlık yolu>[#parça no]`. Dosya yolu ve başlıklar değişmedikçe sabittir; artımlı indeksin anahtarıdır. |
| `hash` | `embed_text`'in sha256 özeti. Değişmediyse yeniden embed edilmez. |
| `embed_text` | Embed modeline giden metin: bağlam satırı + eş anlamlılar + bölüm metni. |
| `text` | Bölümün tam hali (Mermaid dahil); gösterim ve tam metin arama için. |
| `meta` | Frontmatter alanları (`type`, `module`, `status`, `status_note`, `jira`, `aliases`, `code_commit`, `sources`, `related`) + `headings`, `title`. Filtre için. |

## Parçalama kuralları

- Dokümanlar `##` ve `###` başlıklarından bölünür.
- 2.400 karakteri aşan bölüm paragraflardan; büyük tablolar satır gruplarından bölünür ve **her parçada tablo başlık satırı tekrarlanır**.
- Mermaid diyagramları `embed_text`'ten çıkarılır (anlamsal gürültü), `text` içinde kalır.
- Her `embed_text` şu bağlam satırıyla başlar: `<alan> (<modül>) › <doküman başlığı> › <başlık yolu>`, ardından `Eş anlamlılar: ...`.
- Use case kartlarında yalnız **"Ne yapar"** paragrafı embed edilir. Script'in ürettiği tablolar (girdi, bağımlılık, çağrı, sabit, hata) tam metin aramaya ve MCP'nin dosyayı doğrudan okumasına bırakılır.

## Arama önerileri

- **Karma arama:** vektör + tam metin (BM25) birlikte. Sabit adları, hata kodları ve sayılar tam metinle daha iyi bulunur. Redis 8 ikisini de destekler.
- **Çok dilli embed modeli:** metin Türkçe, kod adları İngilizce, sorular Türkçe gelir.
- **Varsayılan filtre:** `meta.status != "kaldırıldı"`. Tarihsel soru sorulursa filtre kaldırılır.
- **Güncelleme:** `.source-commit` → `git diff --name-only <commit>..origin/main` → değişen kaynak dosyayı `meta.sources` listesinde içeren dokümanlar güncellenir, kartlar `packages/kb` kart üreticisiyle yeniden üretilir, sonra parçalar (`buildChunks`) yeniden üretilir ve yalnız `hash`'i değişen parçalar yeniden embed edilir; artık üretilmeyen `id`'ler indeksten silinir.
