/* ==========================================================================
   ExoVue Studio — app logic
   Upload an exocad DentalCAD webview HTML, extract styles, view in 3D, download.
   Everything runs client-side. No file ever leaves the browser.
   ========================================================================== */

(function () {
  "use strict";

  // ----- DOM references ----------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const dropzone = $("dropzone");
  const fileInput = $("fileInput");
  const hero = $("hero");
  const workspace = $("workspace");
  const resetbar = $("resetbar");
  const viewerStage = $("viewerStage");
  const viewerEmpty = $("viewerEmpty");
  const viewerFrame = $("viewerFrame");
  const viewerHint = $("viewerHint");
  const fileNameChip = $("fileNameChip");
  const fileSize = $("fileSize");
  const panelSummary = $("panelSummary");

  // ----- State -------------------------------------------------------------
  let activeFile = null;
  let blobUrl = null;
  let styleBlocks = [];   // [{ css, label, size }]
  let variables = [];     // [{ name, value, isColor }]
  let classes = [];       // [{ name, rules: [{selector, body}] }]
  let baseName = "styles";

  // ----- Helpers -----------------------------------------------------------
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function humanSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function sanitizeBase(name) {
    return (name || "styles")
      .replace(/\.(html?|htm)$/i, "")
      .replace(/[^\w\-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "styles";
  }

  function toast(msg) {
    const t = $("toast");
    t.innerHTML = '<span class="toast__dot"></span>' + escapeHtml(msg);
    t.classList.add("is-show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("is-show"), 2400);
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Panoya kopyalandı");
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast("Panoya kopyalandı"); }
      catch (_) { toast("Kopyalanamadı"); }
      ta.remove();
    }
  }

  // ----- CSS parsing -------------------------------------------------------
  function parseCssRules(css) {
    const rules = [];
    let i = 0;
    const n = css.length;
    while (i < n) {
      while (i < n && /\s/.test(css[i])) i++;
      const open = css.indexOf("{", i);
      if (open === -1) break;
      let depth = 0, j = open;
      for (; j < n; j++) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") { depth--; if (depth === 0) break; }
      }
      if (j >= n) break;
      const selector = css.slice(i, open).trim();
      const body = css.slice(open + 1, j).trim();
      if (selector && selector.startsWith("@")) {
        if (/^@media/i.test(selector)) rules.push(...parseCssRules(body));
      } else if (selector && body) {
        rules.push({ selector, body });
      }
      i = j + 1;
    }
    return rules;
  }

  function isColorValue(val) {
    return (
      /^#([0-9a-f]{3,8})$/i.test(val) ||
      /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/i.test(val) ||
      /^(transparent|currentcolor)$/i.test(val)
    );
  }

  function extractVariables(css) {
    const map = new Map();
    const re = /(--[\w-]+)\s*:\s*([^;{}]+)(?:;|\})/g;
    let m;
    while ((m = re.exec(css)) !== null) {
      const name = m[1];
      const value = m[2].trim();
      if (!map.has(name)) map.set(name, value);
    }
    return Array.from(map, ([name, value]) => ({ name, value, isColor: isColorValue(value) }));
  }

  function extractClasses(css) {
    const rules = parseCssRules(css);
    const classMap = new Map(); // name -> { name, rules: [] }
    const nameRe = /\.[a-zA-Z][\w-]*/g;
    for (const rule of rules) {
      const parts = rule.selector.split(",");
      for (const part of parts) {
        const seg = part.trim();
        if (!seg) continue;
        let mm;
        nameRe.lastIndex = 0;
        while ((mm = nameRe.exec(seg)) !== null) {
          const name = mm[0].slice(1); // strip leading '.'
          if (!classMap.has(name)) classMap.set(name, { name, rules: [] });
          classMap.get(name).rules.push({ selector: seg, body: rule.body });
        }
      }
    }
    // Deduplicate identical rules per class
    const result = Array.from(classMap.values()).map((cls) => {
      const seen = new Set();
      cls.rules = cls.rules.filter((r) => {
        const key = r.selector + "\u0000" + r.body;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return cls;
    });
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  function blockLabel(css) {
    if (/--exo-/.test(css) || (/:root/.test(css) && /--\w/.test(css))) return "Tema · CSS değişkenleri";
    if (/\.cad-/.test(css)) return "GUI bileşenleri";
    return "Stil bloğu";
  }

  function processHtml(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, "text/html");

    // Style blocks
    styleBlocks = Array.from(doc.querySelectorAll("style")).map((el, idx) => {
      const css = el.textContent.trim();
      return { css, idx, label: blockLabel(css), size: css.length };
    }).filter((b) => b.css.length > 0);

    const allCss = styleBlocks.map((b) => b.css).join("\n\n");

    // Also surface <link rel="stylesheet"> (informational, non-inline)
    const linkCount = doc.querySelectorAll('link[rel="stylesheet"]').length;

    variables = extractVariables(allCss);
    classes = extractClasses(allCss);

    return { linkCount, docTitle: doc.title || "" };
  }

  // ----- Rendering ---------------------------------------------------------
  function renderSummary() {
    const colorCount = variables.filter((v) => v.isColor).length;
    const parts = [
      variables.length + " değişken",
      colorCount + " renk",
      styleBlocks.length + " blok",
      classes.length + " sınıf",
    ];
    panelSummary.textContent = parts.join(" · ");
    $("countColors").textContent = colorCount;
    $("countBlocks").textContent = styleBlocks.length;
    $("countClasses").textContent = classes.length;
  }

  function renderColors(filter) {
    const wrap = $("swatches");
    const list = variables.filter((v) => v.isColor).filter((v) =>
      !filter || v.name.toLowerCase().includes(filter) || v.value.toLowerCase().includes(filter)
    );
    $("emptyColors").hidden = list.length > 0;
    wrap.innerHTML = list.map((v) => {
      const chip = isOpaqueHex(v.value)
        ? `<div class="swatch__chip" style="background:${escapeHtml(v.value)}"></div>`
        : `<div class="swatch__chip swatch__chip--transparent" style="background:${escapeHtml(v.value)}"></div>`;
      return `
        <div class="swatch" title="${escapeHtml(v.name)}: ${escapeHtml(v.value)}">
          ${chip}
          <button class="swatch__copy" data-copy="${escapeHtml(v.value)}" title="Kopyala">⧉</button>
          <div class="swatch__body">
            <div class="swatch__name">${escapeHtml(v.name)}</div>
            <div class="swatch__value">${escapeHtml(v.value)}</div>
          </div>
        </div>`;
    }).join("");
  }

  function isOpaqueHex(val) {
    return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(val) || /^(rgb|hsl)\(/i.test(val);
  }

  function renderBlocks(filter) {
    const wrap = $("blocks");
    const list = styleBlocks.filter((b) => !filter || b.css.toLowerCase().includes(filter));
    $("emptyBlocks").hidden = list.length > 0;
    wrap.innerHTML = list.map((b) => `
      <div class="block" data-idx="${b.idx}">
        <div class="block__head">
          <span class="block__idx">#${b.idx + 1}</span>
          <span class="block__label">${escapeHtml(b.label)}</span>
          <span class="block__size">${humanSize(b.size)}</span>
          <button class="btn btn--ghost btn--sm" data-download-block="${b.idx}" title="İndir">⬇</button>
          <span class="block__chev">▶</span>
        </div>
        <pre class="block__pre"><code>${escapeHtml(b.css)}</code></pre>
      </div>`).join("");
  }

  function renderClasses(filter) {
    const wrap = $("classes");
    const list = classes.filter((c) => !filter || c.name.toLowerCase().includes(filter));
    $("emptyClasses").hidden = list.length > 0;
    wrap.innerHTML = list.map((c) => {
      const props = c.rules.length === 1
        ? c.rules[0].body.replace(/\s+/g, " ").slice(0, 90)
        : c.rules.length + " kural";
      return `
        <div class="cls" data-name="${escapeHtml(c.name)}">
          <div class="cls__check">✓</div>
          <span class="cls__name">.${escapeHtml(c.name)}</span>
          <span class="cls__props">${escapeHtml(props)}</span>
          <span class="cls__arrow">›</span>
        </div>`;
    }).join("");
  }

  // ----- 3D viewer --------------------------------------------------------
  function load3D(file) {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(file);
    viewerEmpty.style.display = "flex";
    viewerFrame.onload = () => { viewerEmpty.style.display = "none"; };
    viewerFrame.src = blobUrl;
  }

  // ----- Actions -----------------------------------------------------------
  function handleFile(file) {
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) {
      toast("Lütfen .html veya .htm dosyası seç");
      return;
    }
    activeFile = file;
    baseName = sanitizeBase(file.name);

    fileNameChip.textContent = file.name;
    fileSize.textContent = humanSize(file.size);

    const reader = new FileReader();
    reader.onload = () => {
      processHtml(reader.result);
      renderSummary();
      renderColors("");
      renderBlocks("");
      renderClasses("");
      $("searchColors").value = "";
      $("searchBlocks").value = "";
      $("searchClasses").value = "";
      // switch to colors tab
      activateTab("colors");

      hero.hidden = true;
      workspace.hidden = false;
      resetbar.hidden = false;
      workspace.scrollIntoView({ behavior: "smooth", block: "start" });
      load3D(file);
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    activeFile = null;
    viewerFrame.src = "about:blank";
    hero.hidden = false;
    workspace.hidden = true;
    resetbar.hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectedClasses() {
    return Array.from(document.querySelectorAll(".cls.is-selected")).map((el) => el.dataset.name);
  }

  function buildSelectedCss(names) {
    const set = new Set(names);
    const parts = [];
    for (const c of classes) {
      if (!set.has(c.name)) continue;
      for (const r of c.rules) parts.push(r.selector + " {\n  " + r.body + "\n}");
    }
    return "/* ExoVue Studio — seçili sınıflar */\n" + parts.join("\n\n") + "\n";
  }

  function buildThemeCss() {
    const decls = variables.map((v) => "  " + v.name + ": " + v.value + ";").join("\n");
    return "/* ExoVue Studio — çıkarılan tema */\n:root {\n" + decls + "\n}\n";
  }

  function buildAllCss() {
    return "/* ExoVue Studio — tüm stiller */\n" +
      styleBlocks.map((b) => "/* --- " + b.label + " --- */\n" + b.css).join("\n\n") + "\n";
  }

  // ----- Tabs --------------------------------------------------------------
  function activateTab(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
    document.querySelectorAll(".tabpane").forEach((p) => p.classList.toggle("is-active", p.id === "pane-" + name));
  }

  // ----- Events ------------------------------------------------------------
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("is-drag"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("is-drag"); })
  );
  dropzone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(f);
  });

  // Global drag & drop (anywhere on page)
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /\.html?$/i.test(f.name)) handleFile(f);
  });

  // Tabs
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => activateTab(t.dataset.tab))
  );

  // Search
  $("searchColors").addEventListener("input", (e) => renderColors(e.target.value.toLowerCase()));
  $("searchBlocks").addEventListener("input", (e) => renderBlocks(e.target.value.toLowerCase()));
  $("searchClasses").addEventListener("input", (e) => renderClasses(e.target.value.toLowerCase()));

  // Blocks: expand / download (event delegation)
  $("blocks").addEventListener("click", (e) => {
    const dl = e.target.closest("[data-download-block]");
    if (dl) {
      const idx = +dl.dataset.downloadBlock;
      const b = styleBlocks.find((x) => x.idx === idx);
      if (b) { downloadText(baseName + "-block-" + (idx + 1) + ".css", b.css, "text/css;charset=utf-8"); toast("Blok #" + (idx + 1) + " indirildi"); }
      return;
    }
    const head = e.target.closest(".block__head");
    if (head) head.parentElement.classList.toggle("is-open");
  });

  // Classes: selection (event delegation)
  $("classes").addEventListener("click", (e) => {
    const row = e.target.closest(".cls");
    if (row) row.classList.toggle("is-selected");
  });

  // Swatch copy (event delegation)
  $("swatches").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy]");
    if (btn) copyText(btn.dataset.copy);
  });

  // Toolbar buttons
  $("btnDownloadTheme").addEventListener("click", () => {
    if (!variables.length) return toast("Değişken bulunamadı");
    downloadText(baseName + "-theme.css", buildThemeCss(), "text/css;charset=utf-8");
    toast("Tema indirildi");
  });
  $("btnCopyVars").addEventListener("click", () => {
    if (!variables.length) return toast("Değişken bulunamadı");
    copyText(buildThemeCss());
  });
  $("btnDownloadAllCss").addEventListener("click", () => {
    if (!styleBlocks.length) return toast("Stil bloğu bulunamadı");
    downloadText(baseName + "-all.css", buildAllCss(), "text/css;charset=utf-8");
    toast("Tüm CSS indirildi");
  });
  $("btnSelectAll").addEventListener("click", () => {
    const rows = document.querySelectorAll(".cls");
    const all = rows.length && Array.from(rows).every((r) => r.classList.contains("is-selected"));
    rows.forEach((r) => r.classList.toggle("is-selected", !all));
  });
  $("btnDownloadSelected").addEventListener("click", () => {
    const names = selectedClasses();
    if (!names.length) return toast("Önce sınıf seçin");
    downloadText(baseName + "-classes.css", buildSelectedCss(names), "text/css;charset=utf-8");
    toast(names.length + " sınıf indirildi");
  });

  // Viewer controls
  $("btnOpenTab").addEventListener("click", () => {
    if (blobUrl) window.open(blobUrl, "_blank");
  });
  $("btnFullscreen").addEventListener("click", () => {
    if (viewerStage.requestFullscreen) viewerStage.requestFullscreen();
    else if (viewerStage.webkitRequestFullscreen) viewerStage.webkitRequestFullscreen();
  });

  $("btnReset").addEventListener("click", resetAll);
})();
