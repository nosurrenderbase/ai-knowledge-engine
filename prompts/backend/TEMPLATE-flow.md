---
type: flow
module: <modül-klasör-adı>
title: <iş dilinde kısa başlık>
status: canlıda | kısmen canlıda | kod main'de, istemci bağlı değil | istemci kullanımı belirsiz | bayrakla kapalı | kaldırıldı
status_note: "<isteğe bağlı: durumu açıklayan tek cümle>"
aliases: [<sorularda geçebilecek eş anlamlılar, Türkçe/İngilizce>]
code_commit: <kod reposu kısa SHA>
jira: [LCO-xxxx]
sources:
  - src/modules/<modül>/...   # bu akışı anlatan TÜM kaynak dosyalar (ters indeks bunu kullanır)
related:
  - flows/<modül>/<diğer-akış>.md
---

# <Başlık>

## Ne yapar

2-4 cümle, iş diliyle. Kod adı kullanma; kullanılırsa açıkla.

## Kurallar ve baremler

| Kural | Değer | Kaynak | Nerede yaşıyor |
|---|---|---|---|
| ... | somut sayı + birim | sabit adı / dosya | kod / DB (koleksiyon adı) / env (değişken adı) / dış sistem |

## Akış

```mermaid
flowchart TD
    A[...] --> B{...}
```

Numaralı adımlar. Hata dönen her kontrolde hata kodunu yaz (örn. `PVP_DAILY_LIMIT_REACHED`).

## İstemciye açılan uçlar

| Uç | Tür |
|---|---|

## Kenar durumlar

## Bilinen sorunlar

Kod-yorum çelişkileri, onay bekleyen bulgular, canlıda görülen anomaliler (tarihiyle).

## İlgili

Diğer akışlar ve use case kartları (link).
