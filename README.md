# 🦷 ExoMesh Studio

**exocad DentalCAD webview HTML → STL dönüştürücü.**

exocad'in ürettiği `.html` dosyalarının içine gömülü 3D mesh'leri (OpenCTM formatında) tarayıcıda çözer, **3D** önizleme sunar ve **STL** olarak indirir. Tüm işlem istemci tarafında çalışır — dosyanız hiçbir sunucuya yüklenmez.

## ✨ Özellikler

- 🧩 **Mesh ayrıştırma** — `DentalWebGL.m_Data` içindeki base64 veriyi çözer, `OCTM` ile ayrılmış tüm OpenCTM mesh'leri çıkarır (MG1/MG2/RAW sıkıştırma destekli).
- 🧊 **3D önizleme** — Çözülen mesh'leri Three.js ile döndürülebilir, yakınlaştırılabilir sahne olarak gösterir; her mesh ayrı renk ve görünürlük anahtarıyla.
- 📐 **Binary STL** — Doğru yüz normalleriyle binary STL üretir (3D baskı / CAD uyumlu).
- 📦 **Toplu indir** — Seçilen mesh'leri veya tümünü tek `.zip` olarak indirir (JSZip).

## 🔧 Teknik

- OpenCTM çözücü: [js-openctm](https://github.com/juanmellado/js-openctm) (`assets/vendor/ctm.js` + `lzma.js`, MIT/LGPL).
- Üç boyutlu görüntüleme: Three.js + OrbitControls (CDN).
- STL üretimi: tarayıcı içi binary writer.

## 🚀 GitHub Pages'e yükleme

1. Bu klasörü bir GitHub deposuna it:
   ```bash
   git init && git add . && git commit -m "ExoMesh Studio"
   git branch -M main
   git remote add origin https://github.com/KULLANICI/REPO.git
   git push -u origin main
   ```
2. **Settings → Pages → Deploy from a branch → `main` / `/ (root)` → Save**.

## ⚠️ Not

Bu araç, exocad DentalCAD webview dosyalarındaki 3D veriyi görüntülemek ve STL'e dönüştürmek için tasarlanmıştır. Telif hakkı ve lisans koşulları dosyaların sahibi olan exocad GmbH'ye aittir. Bu araç resmi bir exocad ürünü değildir.
