# Ajans OS

**Tek kişilik şirket için yapay zekâ ekibi.** Sen müdüre iş verirsin, müdür isteği doğru uzmanlara böler, uzmanlar sırayla çalışır, çıktılar tek yerde toplanır.

Kendi bilgisayarında (`http://localhost:7777`) çalışır. Sunucuya taşınabilir, 7/24 açık kalabilir.

---

## Neden

Tek başına çalışan biri için asıl sorun fikir değil, **sırayla doğru işi yapmak**. Reklam metni yazarken fiyat hesabı, rapor hazırlarken kreatif brief gerekiyor. Her seferinde sıfırdan prompt yazmak vakit kaybı.

Ajans OS bunu bir ekibe devrediyor:

- **Müdür** — en güçlü model, isteği okur ve 1-4 göreve böler
- **Uzmanlar** — 40+ hazır ajan, kendi uzmanlık alanlarında çalışır
- **Yönlendirici** — her işi en uygun modele verir (görsel işi görsel modele, uzun HTML işi geniş çıktılı modele, hızlı iş hızlı modele)

---

## Özellikler

| | |
|---|---|
| 🧠 **Müdür + uzman mimarisi** | İstek otomatik görevlere bölünür, her görev doğru ajana gider |
| 🔀 **Otomatik model yönlendirme** | En güçlü model müdür, işe göre hızlı/görsel/uzun-çıktı modeli uzman |
| 📎 **Dosya ve görsel ekleme** | Sürükle-bırak, pano (Ctrl+V), metin dosyası içeriği okunur |
| 👁️ **Canlı önizleme** | Üretilen HTML sayfa/sunum panelin içinde açılır, mobil görünüm desteği |
| 🏢 **Çoklu şirket** | Her şirketin kendi notları ve kendi ekibi var |
| 💾 **İş geçmişi** | Her çalıştırma `runs/` altına kaydedilir, tekrar açılabilir |
| 🔐 **Şifre koruması** | Sunucu modunda opsiyonel oturum koruması |
| 📦 **Sıfır bağımlılık** | npm paketi yok, veritabanı yok. Sadece Node.js |
| 🖥️ **Sunucu modu** | systemd / Windows servisi ile 7/24 çalışır |

---

## Hızlı başlangıç

### Gereken
- [Node.js](https://nodejs.org) 18 veya üzeri (LTS önerilir)

### Çalıştır

```bash
git clone <bu-repo>
cd ajans-os
```

**Windows:** `baslat.bat` dosyasına çift tıkla
**Linux / macOS:**

```bash
node server.js
```

Tarayıcıda aç: **http://localhost:7777**

### API anahtarlarını gir

Panel modelleri çağırmak için bir sağlayıcıya ihtiyaç duyar. İki yol var:

**A) opencode.json'dan okur** (varsa otomatik)

```
~/.config/opencode/opencode.json
```

`providers.<id>.settings.baseURL` ve `apiKey` alanları okunur.

**B) Kendi dosyan**

```bash
cp deploy/providers.ornek.json data/providers.json
```

Sonra `data/providers.json` içindeki `BURAYA_..._ANAHTARI` yazılarını kendi anahtarlarınla değiştir.

> OpenAI uyumlu **her** sağlayıcı çalışır: OpenRouter, Groq, Together, DeepSeek, yerel Ollama/LM Studio…

---

## Nasıl çalışır

```
İstek  →  Müdür (en güçlü model)
            ↓  plan: 1-4 görev
          Uzman 1 (işe uygun model)  →  çıktı
            ↓  önceki çıktıyı görür
          Uzman 2 (işe uygun model)  →  çıktı
            ↓
          Birleşik sonuç + kayıt
```

**Örnek:** *"Butik kahve markası için 10.000 TL Instagram reklam planı ve 3 reklam metni hazırla"*

1. Müdür planı böler: `meta-reklam` (plan) → `kreatif-metin` (metinler)
2. `meta-reklam` kampanya yapısını, kitleleri, 4 haftalık test takvimini yazar
3. `kreatif-metin` **önceki çıktıyı görerek** o plana uygun 3 ayrı metin üretir

---

## Model havuzu

Açılır listenin varsayılanı **🧠 Otomatik — müdür seçer**.

| Rol | Seçim kuralı |
|---|---|
| **Müdür** | Havuzun en güçlü modeli (güç puanı en yüksek) |
| **Görsel işleri** | Görsel görebilen en güçlü model |
| **Hızlı işler** | En hızlı model |
| **Uzun çıktı (HTML)** | Çıktı limiti yüksek model |
| **Ağır analiz** | Güç/hız dengeli en iyi model |

Her görev kartında hangi modelin kullanıldığı yazar. Sağ üstteki **Modelleri test et** butonu her modeli dener, cevap vermeyeni listeden düşürür.

### Ajan bazlı model sabitleme

Ajan dosyasının başına bir satır ekle:

```yaml
---
name: Meta Ads Denetmeni
description: Ekran görüntüsünden reklam denetimi
model: vision
---
```

| Değer | Anlamı |
|---|---|
| `vision` | Görsel görebilen en güçlü model |
| `leader` | Havuzun en güçlü modeli |
| `fast` | En hızlı model |
| `long` | Geniş çıktı limitli model |
| `balanced` | Güç/hız dengeli |
| tam id | Belirli model, örn. `evren::glm-5.3` |

---

## Ajanlar

`agents/` klasöründe 40+ hazır uzman var. Kendi `.md` dosyanı ekleyerek yenilerini yazabilirsin.

**Pazarlama** — strateji, meta-reklam, google-reklam, tiktok-reklam, seo-geo, sosyal-yonetim, kreatif-metin, analytics-rapor

**Reklam denetimi** (hesaba bağlanmaz, ekran görüntüsüyle çalışır) — meta-denetim, meta-rapor, google-denetim, google-rapor

**Web** — web-tasarim, web-gelistirme, web-denetim, marka-kimlik

**Müşteri** — musteri-kazanma, musteri-yonetimi, pricing-analyst, research-synthesist

**Operasyon** — operasyon, finans, icerik-seo, sosyal-medya, yorum-cevap

### Yeni ajan yazmak

`agents/yeni-ajan.md`:

```markdown
---
name: Benim Uzmanım
description: Ne yaptığını tek cümleyle yaz — müdür bu açıklamayı okuyup seçer
model: fast
---

Sen ... uzmanısın.

## İstek türleri
- **Şu iş:** şöyle yap

## Çıktı formatı
...

## Kurallar
- ...
```

Panelde sayfayı yenile, ajan listede çıkar.

---

## Dosya ve görsel ekleme

İstek kutusunun altındaki **📎 Dosya / görsel** butonu, sürükle-bırak veya `Ctrl+V`.

| Tür | Nasıl işlenir |
|---|---|
| Görsel (png, jpg, webp, gif, svg) | Model doğrudan görür; model göremiyorsa otomatik görsel modele geçilir |
| Metin (txt, md, csv, json, html, css, js, xml, yml) | İçeriği okunup isteğe eklenir |
| Diğer (pdf, docx, xlsx) | Okunmaz — ekran görüntüsü al veya metni kopyala |

Dosya başına 12 MB. Dosya tipi uzantıya değil **içeriğe** göre belirlenir (bozuk görsel hatası olmaz).

---

## Önizleme

Uzman HTML ürettiyse görev kartında **▶ Önizle** butonu çıkar:

- Sayfa panelin içinde açılır (gerçek tarayıcı davranışı)
- **📱 Mobil** → telefon boyutu
- **Yeni sekmede aç** → tam ekran
- Yarıda kesilmiş HTML otomatik onarılır, kesildiği görünür uyarıyla belirtilir

Yerel modda `127.0.0.1` ve `::1` birlikte dinlenir (Windows'ta `localhost` IPv6 çözümleme sorunu için).

---

## Çoklu şirket

Sol üstteki listeden şirket seç. **+ Yeni şirket** ile yeni iş kolu kur:

- **Şirket notları** — uzmanlar her işte bunu görür. Fiyat listesi, marka tonu, yasaklı ifadeler, hedefler. **Ne kadar doluysa çıktı o kadar isabetli.**
- **Ekip** — hangi ajanlar bu şirkette çalışsın. O şirkete gerçekten hizmet eden 8-15 ajan ideal.

Şirket dosyaları `data/companies/<id>.json` (`.gitignore` içinde, repoya girmez).

---

## Sunucuya taşıma

Bilgisayarını kapatsan da çalışsın istiyorsan: **`deploy/TASIMA.md`**

İçinde:
- Linux tek komut kurulum (`deploy/kur.sh`) — systemd servisi, otomatik yeniden başlatma
- Windows Server kurulumu (`deploy/kur-windows.ps1`)
- Nginx + HTTPS (Let's Encrypt)
- Yedekleme, güncelleme, sorun giderme

### Sunucu modu

```bash
SUNUCU_MODU=1 ADMIN_PASSWORD=guclu-sifre node server.js
```

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `7777` | Dinlenen port |
| `SUNUCU_MODU` | kapalı | `1` ise `0.0.0.0` dinler (dışarıdan erişim) |
| `ADMIN_PASSWORD` | boş | Doluysa giriş şifresi istenir |
| `SESSION_SECRET` | otomatik | Oturum imzalama anahtarı |

> ⚠️ `SUNUCU_MODU=1` ile `ADMIN_PASSWORD` boş bırakırsan panel internete **şifresiz** açılır. API anahtarların risk altında olur.

---

## Klasör düzeni

```
ajans-os/
├── server.js            HTTP sunucu + rotalar
├── lib/
│   ├── agents.js        ajan dosyalarını okur
│   ├── auth.js          şifre / oturum koruması
│   ├── llm.js           model çağrısı (SSE akış)
│   ├── manager.js       müdür: plan üretir
│   ├── preview.js       HTML önizleme + onarım
│   ├── providers.js     model havuzu
│   ├── router.js        model seçimi
│   └── store.js         şirketler + iş kayıtları
├── public/              arayüz (vanilla JS, derleme yok)
├── agents/              uzman tanımları (.md)
├── deploy/              sunucu kurulum dosyaları
├── data/                şirketler, sağlayıcılar  [gitignore]
├── runs/                iş geçmişi                [gitignore]
└── uploads/             eklenen dosyalar          [gitignore]
```

---

## Sorun giderme

**"localhost bağlanılamıyor"**
```bash
netstat -ano | findstr :7777    # Windows
lsof -i :7777                   # Linux
```
Port dinlenmiyorsa sunucu çalışmıyor. `baslat.bat` penceresi açık mı?

**"API anahtarı bulunamadı"** → `data/providers.json` içindeki `apiKey` alanı boş.

**Port kullanımda** → `PORT=7788 node server.js` (Windows: `set PORT=7788`)

**Panel boş açıldı** → `Ctrl + F5`

**Önizleme beyaz** → model HTML'i yarıda kesmiş. İsteğe *"kısa tut, tek ekran"* ekle veya geniş çıktılı model seç.

**Uzman yanlış seçildi** → isteğe ajan adını yaz: *"bunu meta-reklam yapsın"*, ya da şirket ekibini daralt.

---

## Lisans

MIT — bkz. [LICENSE](LICENSE)

---

## Katkı

Ajan eklemek istiyorsan: `agents/` içine bir `.md` dosyası ekle, `name` + `description` + `model` frontmatter'ı yaz. Müdür ajanı `description` alanından tanıyıp seçer.
