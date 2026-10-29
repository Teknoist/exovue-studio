/* ==========================================================================
   ExoMesh Studio — app logic
   exocad DentalCAD webview HTML -> extract OpenCTM meshes -> STL download.
   Names are recovered from exocad's color-definition table (type -> color).
   Everything runs client-side. No file ever leaves the browser.
   ========================================================================== */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  // ----- State -------------------------------------------------------------
  var meshes = [];        // [{ name, type, color, vertices, indices, verts, tris }]
  var activeFile = null;
  var blobUrl = null;
  var baseName = "model";

  // ----- Helpers -----------------------------------------------------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function humanSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }
  function sanitizeBase(name) {
    return (name || "model").replace(/\.(html?|htm)$/i, "").replace(/[^\w\-]+/g, "-").replace(/^-+|-+$/g, "") || "model";
  }
  function prettifyType(type) {
    return type.replace(/([A-Z])/g, " $1").replace(/^ /, "").replace(/ +/g, " ");
  }
  var DISPLAY_NAMES = {
    "OrthoModel": "Model",
    "ModelPlatelessBase": "Model",
    "ModelPlateTypeMixed": "Model",
    "ModelPlateTypeHealthy": "Model",
    "ModelPlatelessDie": "Die",
    "ModelPlateTypeStump": "Stump",
    "Antagonist": "Antagonist",
    "UnsegmentedJaw": "Jaw",
    "UnsegmentedTooth": "Tooth",
    "MergedTooth": "Merged Tooth",
    "MergedBridge": "Merged Bridge",
    "MergedPontic": "Merged Pontic",
    "MergedBar": "Merged Bar",
    "AnatomicCrown": "Crown",
    "AnatomicPontic": "Pontic"
  };
  function displayName(type) {
    return DISPLAY_NAMES[type] || prettifyType(type);
  }
  function toast(msg) {
    var t = $("toast");
    t.innerHTML = '<span class="toast__dot"></span>' + escapeHtml(msg);
    t.classList.add("is-show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("is-show"); }, 2600);
  }
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function base64ToBytes(b64) {
    b64 = b64.replace(/\s+/g, "");
    var lut = new Int16Array(256).fill(-1);
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (var k = 0; k < 64; k++) lut[chars.charCodeAt(k)] = k;
    var len = b64.length, out = new Uint8Array(Math.floor(len * 3 / 4)), p = 0;
    var buf = 0, bits = 0;
    for (var j = 0; j < len; j++) {
      var c = b64.charCodeAt(j);
      if (c === 0x3d) break; // '='
      var v = lut[c];
      if (v < 0) continue;
      buf = (buf << 6) | v;
      bits += 6;
      if (bits >= 8) { bits -= 8; out[p++] = (buf >> bits) & 0xff; }
    }
    return out.subarray(0, p);
  }

  function indexOfBytes(haystack, needle, from) {
    outer: for (var i = from; i <= haystack.length - needle.length; i++) {
      for (var j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }

  // ----- Theme injection into the exocad viewer ----------------------------
  var THEME_CSS = [
    ":root{",
    "--exo-purple:#17132a!important;",
    "--exo-purple-dark:#0b0a12!important;",
    "--exo-purple-light:#9da1ba!important;",
    "--exo-purple-light2:#c4c7d6!important;",
    "--exo-purple-light3:#878ba1!important;",
    "--exo-orange:#7c6cf0!important;",
    "--exo-grey-light:#efefee!important;",
    "--o2:#b06ef7!important;",
    "--o3:#8b7bf0!important;",
    "--p1:#7c6cf0!important;",
    "--p2:#8c82ab!important;",
    "--p3:#6b5cd6!important;",
    "--p4:#8c82ab!important;",
    "--p5:#fbfaff!important;",
    "--p6:#17132a!important;",
    "--p7:#0b0a12!important;",
    "--p8:#7c6cf0!important;",
    "--p9:#e5e3e9!important;",
    "--b1:#515b65!important;",
    "--b2:#798896!important;",
    "}",
    "body{background:#0b0a12!important;}",
    ".cad-trademark, .cad-multi-trademark-right, .cad-footer, .cad-header, .gui-sidebar{background:#17132a!important;}",
    ".cad-button, .gui-sidebar-bar, .cad-sidebar, .cad-multi-message-background{background:#12101d!important;}"
  ].join("");

  function buildThemedHtml(html) {
    // 3D background + border color (version-agnostic)
    html = html.replace(/(DentalWebGL\.BackgroundColor\s*=\s*)0x[0-9A-Fa-f]+/g, "$10x0b0a14");
    html = html.replace(/(DentalWebGL\.DesktopShowHideLeftBorderColor\s*=\s*)"[^"]*"/g, '$1"#7c6cf0"');
    // inject theme CSS
    var inject = '<style id="exomesh-theme">' + THEME_CSS + "</style>";
    if (html.indexOf("</head>") !== -1) {
      html = html.replace("</head>", inject + "</head>");
    } else {
      html = inject + html;
    }
    return html;
  }

  // ----- Name recovery: exocad color-definition table ----------------------
  function extractColorList(html) {
    var marker = "createColorDefinitionList=function(){return[";
    var s = html.indexOf(marker);
    if (s === -1) return [];
    var arrStart = s + marker.length;
    var e = html.indexOf("]}", arrStart);
    var text = html.slice(arrStart, e + 1);
    var re = /Type:"([^"]+)",Color:"(#[0-9A-Fa-f]{6})"/g;
    var list = [], m;
    while ((m = re.exec(text)) !== null) list.push({ type: m[1], color: m[2].toLowerCase() });
    return list;
  }

  function buildColorMap(list) {
    var map = {};
    list.forEach(function (entry) { if (!map[entry.color]) map[entry.color] = entry.type; });
    return map;
  }

  // type color lives right before the OCTM magic (descriptor). Scan backward.
  function meshType(bytes, octmOffset, colorMap) {
    // primary: known fixed offset in this format (100 bytes before OCTM)
    var lo = octmOffset - 100;
    if (lo >= 0 && lo + 2 < bytes.length) {
      var hex = rgbHex(bytes[lo], bytes[lo + 1], bytes[lo + 2]);
      if (colorMap[hex]) return colorMap[hex];
    }
    // fallback: scan the descriptor region
    for (var i = octmOffset - 256; i < octmOffset - 2; i++) {
      if (i < 0) continue;
      var h2 = rgbHex(bytes[i], bytes[i + 1], bytes[i + 2]);
      if (colorMap[h2]) return colorMap[h2];
    }
    return null;
  }

  function rgbHex(r, g, b) {
    return "#" + ("0" + (r & 0xff).toString(16)).slice(-2) + ("0" + (g & 0xff).toString(16)).slice(-2) + ("0" + (b & 0xff).toString(16)).slice(-2);
  }

  // ----- CTM extraction & decode ------------------------------------------
  function extractMeshes(bytes, colorMap) {
    var magic = [0x4f, 0x43, 0x54, 0x4d]; // "OCTM"
    var offs = [], from = 0, pos;
    while ((pos = indexOfBytes(bytes, magic, from)) !== -1) { offs.push(pos); from = pos + 4; }

    var result = [];
    for (var i = 0; i < offs.length; i++) {
      var start = offs[i];
      var end = i + 1 < offs.length ? offs[i + 1] : bytes.length;
      var chunk = bytes.subarray(start, end);
      try {
        var stream = new CTM.Stream(chunk);
        var file = new CTM.File(stream);
        var vertices = file.body.vertices;
        var indices = file.body.indices;
        if (!vertices || !indices || indices.length === 0) continue;
        var type = meshType(bytes, start, colorMap);
        result.push({
          type: type || "mesh_" + (i + 1),
          color: colorMap ? colorForType(bytes, start) : null,
          vertices: vertices,
          indices: indices,
          verts: vertices.length / 3,
          tris: indices.length / 3
        });
      } catch (e) { /* skip malformed */ }
    }
    // sort biggest first
    result.sort(function (a, b) { return b.tris - a.tris; });
    // friendly names + dedupe
    var seen = {};
    result.forEach(function (m) {
      var label = displayName(m.type);
      seen[label] = (seen[label] || 0) + 1;
      m.name = seen[label] > 1 ? label + "-" + seen[label] : label;
    });
    return result;
  }

  function colorForType(bytes, octmOffset) {
    var lo = octmOffset - 100;
    if (lo >= 0 && lo + 2 < bytes.length) return rgbHex(bytes[lo], bytes[lo + 1], bytes[lo + 2]);
    return "#7c6cf0";
  }

  // ----- STL (binary) ------------------------------------------------------
  function buildBinaryStl(mesh) {
    var triCount = mesh.indices.length / 3;
    var buffer = new ArrayBuffer(84 + triCount * 50);
    var dv = new DataView(buffer);
    var hdr = "ExoMesh Studio — " + mesh.name;
    for (var h = 0; h < 80; h++) dv.setUint8(h, h < hdr.length ? hdr.charCodeAt(h) : 0x20);
    dv.setUint32(80, triCount, true);
    var off = 84, v = mesh.vertices, idx = mesh.indices;
    for (var i = 0; i < idx.length; i += 3) {
      var a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      var ax = v[a], ay = v[a + 1], az = v[a + 2];
      var bx = v[b], by = v[b + 1], bz = v[b + 2];
      var cx = v[c], cy = v[c + 1], cz = v[c + 2];
      var ux = bx - ax, uy = by - ay, uz = bz - az;
      var vx = cx - ax, vy = cy - ay, vz = cz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
      dv.setFloat32(off, nx, true); off += 4;
      dv.setFloat32(off, ny, true); off += 4;
      dv.setFloat32(off, nz, true); off += 4;
      dv.setFloat32(off, ax, true); off += 4; dv.setFloat32(off, ay, true); off += 4; dv.setFloat32(off, az, true); off += 4;
      dv.setFloat32(off, bx, true); off += 4; dv.setFloat32(off, by, true); off += 4; dv.setFloat32(off, bz, true); off += 4;
      dv.setFloat32(off, cx, true); off += 4; dv.setFloat32(off, cy, true); off += 4; dv.setFloat32(off, cz, true); off += 4;
      dv.setUint16(off, 0, true); off += 2;
    }
    return new Blob([buffer], { type: "model/stl" });
  }

  // ----- Rendering ---------------------------------------------------------
  function renderMeshes() {
    var wrap = $("meshes");
    $("emptyMeshes").hidden = meshes.length > 0;
    $("panelSummary").textContent = meshes.length + " parça";
    wrap.innerHTML = meshes.map(function (m, i) {
      var label = m.name;
      return (
        '<div class="mesh" data-i="' + i + '">' +
          '<div class="mesh__check">✓</div>' +
          '<div class="mesh__dot" style="background:' + m.color + '"></div>' +
          '<div class="mesh__info">' +
            '<div class="mesh__name">' + escapeHtml(label) + '</div>' +
            '<div class="mesh__stats">' + m.tris.toLocaleString("tr-TR") + ' üçgen · ' + m.verts.toLocaleString("tr-TR") + ' nokta</div>' +
          '</div>' +
          '<button class="btn btn--ghost btn--sm mesh__dl" data-i="' + i + '" title="STL indir">⬇ .stl</button>' +
        '</div>'
      );
    }).join("");
  }

  function selectedIndices() {
    return Array.from(document.querySelectorAll(".mesh.is-selected")).map(function (el) { return +el.dataset.i; });
  }

  // ----- Viewer (exocad's own HTML viewer in an iframe) --------------------
  function loadViewer(blob) {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(blob);
    $("viewerEmpty").style.display = "flex";
    $("viewerFrame").onload = function () { $("viewerEmpty").style.display = "none"; };
    $("viewerFrame").src = blobUrl;
  }

  // ----- Actions -----------------------------------------------------------
  function handleFile(file) {
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) { toast("Lütfen .html veya .htm dosyası seç"); return; }
    activeFile = file;
    baseName = sanitizeBase(file.name);
    $("fileNameChip").textContent = file.name;
    $("fileSize").textContent = humanSize(file.size);

    var reader = new FileReader();
    reader.onload = function () {
      try {
        var html = reader.result;
        var re = /DentalWebGL\.m_Data\s*=\s*\{["']data["']:\s*["']([A-Za-z0-9+/=]+)["']\s*\}/g;
        var m, b64 = null;
        while ((m = re.exec(html)) !== null) b64 = m[1];
        if (!b64) throw new Error("m_Data bulunamadı");

        var colorMap = buildColorMap(extractColorList(html));
        var bytes = base64ToBytes(b64);
        meshes = extractMeshes(bytes, colorMap);
        if (!meshes.length) throw new Error("Mesh bulunamadı");

        renderMeshes();
        var themedHtml = buildThemedHtml(html);
        loadViewer(new Blob([themedHtml], { type: "text/html" }));

        $("hero").hidden = true;
        $("workspace").hidden = false;
        $("resetbar").hidden = false;
        $("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
        toast(meshes.length + " parça çıkarıldı");
      } catch (e) {
        toast("Hata: " + e.message);
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    $("viewerFrame").src = "about:blank";
    meshes = [];
    activeFile = null;
    $("meshes").innerHTML = "";
    $("hero").hidden = false;
    $("workspace").hidden = true;
    $("resetbar").hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function downloadSingle(i) {
    var m = meshes[i];
    downloadBlob(buildBinaryStl(m), baseName + "-" + m.name + ".stl");
    toast(m.name + " indirildi");
  }

  function downloadZip(indices) {
    if (!window.JSZip) { toast("JSZip yüklenemedi"); return; }
    var zip = new JSZip();
    indices.forEach(function (i) {
      var m = meshes[i];
      zip.file(baseName + "-" + m.name + ".stl", buildBinaryStl(m));
    });
    zip.generateAsync({ type: "blob" }).then(function (blob) {
      downloadBlob(blob, baseName + "-meshes.zip");
      toast(indices.length + " parça ZIP olarak indirildi");
    });
  }

  // ----- Events ------------------------------------------------------------
  var dropzone = $("dropzone"), fileInput = $("fileInput");
  dropzone.addEventListener("click", function () { fileInput.click(); });
  dropzone.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener("change", function () { handleFile(fileInput.files[0]); });

  ["dragenter", "dragover"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add("is-drag"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove("is-drag"); });
  });
  dropzone.addEventListener("drop", function (e) { handleFile(e.dataTransfer.files && e.dataTransfer.files[0]); });

  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) {
    e.preventDefault();
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /\.html?$/i.test(f.name)) handleFile(f);
  });

  $("meshes").addEventListener("click", function (e) {
    var dl = e.target.closest(".mesh__dl");
    if (dl) { e.stopPropagation(); downloadSingle(+dl.dataset.i); return; }
    var row = e.target.closest(".mesh");
    if (row) row.classList.toggle("is-selected");
  });

  $("btnSelectAll").addEventListener("click", function () {
    var rows = document.querySelectorAll(".mesh");
    var all = rows.length && Array.from(rows).every(function (r) { return r.classList.contains("is-selected"); });
    rows.forEach(function (r) { r.classList.toggle("is-selected", !all); });
  });
  $("btnDownloadSelected").addEventListener("click", function () {
    var sel = selectedIndices();
    if (!sel.length) return toast("Önce parça seçin");
    downloadZip(sel);
  });
  $("btnDownloadAll").addEventListener("click", function () {
    if (!meshes.length) return;
    downloadZip(meshes.map(function (_, i) { return i; }));
  });
  $("btnOpenTab").addEventListener("click", function () {
    if (blobUrl) window.open(blobUrl, "_blank");
  });
  $("btnFullscreen").addEventListener("click", function () {
    var s = $("viewerStage");
    if (s.requestFullscreen) s.requestFullscreen();
    else if (s.webkitRequestFullscreen) s.webkitRequestFullscreen();
  });
  $("btnReset").addEventListener("click", resetAll);
})();
