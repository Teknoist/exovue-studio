# 🦷 ExoVue Studio

**DentalCAD webview HTML dosyalarını yükleyin, gömülü stilleri çıkarın ve modeli 3D olarak görüntüleyin.**

ExoVue Studio, [exocad](https://exocad.com/) DentalCAD'in ürettiği `webview` HTML dosyalarını tarayıcıda açıp içindeki her şeyi **tamamen istemci tarafında** (hiçbir dosya sunucuya yüklenmez) ayrıştıran modern bir araçtır.

## ✨ Neler yapıyor?

- 🎨 **Renk paleti çıkarma** — `:root` içindeki tüm CSS değişkenlerini (`--exo-purple`, `--exo-orange`, `--grey-*` …) renk kartları olarak listeler, kopyalar ve `.css` olarak indirir.
- 📦 **CSS blokları** — HTML içindeki tüm `<style>` bloklarını tek tek önizler ve indirilebilir hâle getirir.
- 🧩 **Sınıf ayrıştırma** — `.cad-slider-widget` gibi tüm sınıfları bulur, seçtiklerinizi tek tıkla `.css` olarak indirir.
- 🧊 **3D görüntüleyici** — Dosyanın içindeki gömülü Three.js sahnesini iframe içinde canlı çalıştırır (döndür, yakınlaştır, tam ekran).
- 🔍 **Arama & filtre** — Renk, blok ve sınıf listelerinde anında arama.
- 🔒 **Gizlilik** — Dosyanız hiçbir sunucuya gönderilmez; tüm işlem tarayıcınızda gerçekleşir.

## 🚀 GitHub Pages'e yükleme

1. Bu klasörü bir GitHub deposuna koyun (veya doğrudan `git push` edin):

   ```bash
   git init
   git add .
   git commit -m "ExoVue Studio"
   git branch -M main
   git remote add origin https://github.com/KULLANICI/REPO.git
   git push -u origin main
   ```

2. Depo ayarlarında **Settings → Pages** bölümüne gidin.
3. **Source** olarak `Deploy from a branch` seçin, dal olarak `main` ve klasör olarak `/ (root)` işaretleyin.
4. **Save** deyin. Birkaç dakika içinde siteniz `https://KULLANICI.github.io/REPO/` adresinde yayında olur.

Alternatif olarak tüm `index.html`, `assets/style.css` ve `assets/app.js` dosyalarını GitHub'daki dosya düzenleyiciden tek tek ekleyebilirsiniz — klasör yapısını koruyun.

## 📁 Dosya yapısı

```
.
├── index.html          # Arayüz
├── assets/
│   ├── style.css       # Uygulama stilleri
│   └── app.js          # Ayrıştırma + 3D + indirme mantığı
└── README.md
```

## 🧪 Nasıl kullanılır?

1. `index.html`'i açın (veya GitHub Pages'te yayınlayın).
2. exocad webview `.html` dosyanızı bırakma alanına sürükleyin ya da seçin.
3. Sol tarafta model **3D** olarak yüklenir.
4. Sağ panelden renk paletini, CSS bloklarını veya sınıfları inceleyin ve dilediğinizi indirin.

## ⚠️ Not

Bu araç, exocad DentalCAD webview dosyalarının **içeriğini görüntülemek ve stil parçalarını indirmek** için tasarlanmıştır. Telif hakkı ve lisans koşulları, dosyaların sahibi olan exocad GmbH'ye aittir. Bu araç resmi bir exocad ürünü değildir ve exocad ile bağlantısı yoktur.
