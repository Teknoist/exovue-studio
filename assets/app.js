/* ==========================================================================
   ExoMesh Studio — app logic
   exocad DentalCAD webview HTML  ->  extract OpenCTM meshes  ->  STL download
   Everything runs client-side. No file ever leaves the browser.
   ========================================================================== */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  // ----- State -------------------------------------------------------------
  var meshes = [];        // [{ name, vertices:Float32Array, indices:Uint32Array, tris, verts, color, threeMesh }]
  var activeFile = null;
  var baseName = "model";

  // three.js objects
  var scene, camera, renderer, controls, rafId;
  var meshGroup = null;

  // mesh palette
  var PALETTE = ["#ef895f", "#7c6cf0", "#41d9a4", "#f5c84c", "#ff6b9d", "#4cc3ff", "#b06ef7", "#8bd450", "#ff8a5c", "#5aa9ff"];

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

  // Find all positions of a byte sequence
  function indexOfBytes(haystack, needle, from) {
    outer: for (var i = from; i <= haystack.length - needle.length; i++) {
      for (var j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }

  // ----- CTM extraction & decode ------------------------------------------
  function extractMeshes(bytes) {
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
        result.push({
          name: "mesh_" + (i + 1),
          vertices: vertices,
          indices: indices,
          verts: vertices.length / 3,
          tris: indices.length / 3
        });
      } catch (e) {
        // ignore malformed trailing chunk
      }
    }
    // sort biggest first
    result.sort(function (a, b) { return b.tris - a.tris; });
    result.forEach(function (m, idx) { m.name = "mesh_" + (idx + 1); m.color = PALETTE[idx % PALETTE.length]; });
    return result;
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

  // ----- 3D viewer ---------------------------------------------------------
  function initViewer() {
    if (renderer) return;
    var stage = $("viewerStage");
    var canvas = $("viewerCanvas");
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0a14);

    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    camera.position.set(60, 40, 80);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // lights
    scene.add(new THREE.HemisphereLight(0xffffff, 0x302a4d, 0.75));
    var d1 = new THREE.DirectionalLight(0xffffff, 0.9); d1.position.set(80, 120, 60); scene.add(d1);
    var d2 = new THREE.DirectionalLight(0xffffff, 0.4); d2.position.set(-60, -40, -80); scene.add(d2);

    meshGroup = new THREE.Group();
    scene.add(meshGroup);

    function resize() {
      var w = stage.clientWidth, h = stage.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);
    new ResizeObserver(resize).observe(stage);
    resize();

    function loop() {
      rafId = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    }
    loop();
  }

  function addMeshToScene(m) {
    initViewer();
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    geo.computeVertexNormals();
    var mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(m.color), roughness: 0.6, metalness: 0.05, flatShading: true, side: THREE.DoubleSide
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.name = m.name;
    meshGroup.add(mesh);
    m.threeMesh = mesh;
  }

  function fitCamera() {
    if (!meshGroup || meshGroup.children.length === 0) return;
    var box = new THREE.Box3().setFromObject(meshGroup);
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z) || 1;
    var fov = camera.fov * Math.PI / 180;
    var dist = maxDim / (2 * Math.tan(fov / 2)) * 1.4;
    camera.position.copy(center).add(new THREE.Vector3(dist * 0.6, dist * 0.45, dist));
    camera.near = maxDim / 100;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }

  // ----- Rendering the mesh list -------------------------------------------
  function renderMeshes() {
    var wrap = $("meshes");
    $("emptyMeshes").hidden = meshes.length > 0;
    $("panelSummary").textContent = meshes.length + " mesh";
    wrap.innerHTML = meshes.map(function (m, i) {
      return (
        '<div class="mesh" data-i="' + i + '">' +
          '<div class="mesh__check">✓</div>' +
          '<div class="mesh__dot" style="background:' + m.color + '"></div>' +
          '<div class="mesh__info">' +
            '<div class="mesh__name">' + escapeHtml(m.name) + '</div>' +
            '<div class="mesh__stats">' + m.tris.toLocaleString("tr-TR") + ' üçgen · ' + m.verts.toLocaleString("tr-TR") + ' nokta</div>' +
          '</div>' +
          '<button class="btn btn--ghost btn--sm mesh__dl" data-i="' + i + '" title="STL indir">⬇ .stl</button>' +
        '</div>'
      );
    }).join("");
  }

  function renderLegend() {
    var lg = $("viewerLegend");
    lg.innerHTML = meshes.map(function (m, i) {
      return '<div class="lg-item" data-i="' + i + '"><span class="lg-dot" style="background:' + m.color + '"></span>' + escapeHtml(m.name) + '</div>';
    }).join("");
  }

  function selectedIndices() {
    return Array.from(document.querySelectorAll(".mesh.is-selected")).map(function (el) { return +el.dataset.i; });
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

        var bytes = base64ToBytes(b64);
        meshes = extractMeshes(bytes);
        if (!meshes.length) throw new Error("Mesh bulunamadı");

        // render list & legend
        renderMeshes();
        renderLegend();

        // clear previous scene meshes
        if (meshGroup) {
          meshGroup.traverse(function (o) { if (o.isMesh) { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); } });
          while (meshGroup.children.length) meshGroup.remove(meshGroup.children[0]);
        }
        meshes.forEach(addMeshToScene);
        fitCamera();
        $("viewerEmpty").style.display = "none";

        $("hero").hidden = true;
        $("workspace").hidden = false;
        $("resetbar").hidden = false;
        $("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
        toast(meshes.length + " mesh çıkarıldı");
      } catch (e) {
        toast("Hata: " + e.message);
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (meshGroup) { while (meshGroup.children.length) meshGroup.remove(meshGroup.children[0]); }
    meshes = [];
    activeFile = null;
    $("meshes").innerHTML = "";
    $("viewerLegend").innerHTML = "";
    $("viewerEmpty").style.display = "flex";
    $("hero").hidden = false;
    $("workspace").hidden = true;
    $("resetbar").hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function downloadSingle(i) {
    var m = meshes[i];
    var blob = buildBinaryStl(m);
    downloadBlob(blob, baseName + "-" + m.name + ".stl");
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
      toast(indices.length + " mesh ZIP olarak indirildi");
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

  // mesh list interaction
  $("meshes").addEventListener("click", function (e) {
    var dl = e.target.closest(".mesh__dl");
    if (dl) { e.stopPropagation(); downloadSingle(+dl.dataset.i); return; }
    var row = e.target.closest(".mesh");
    if (row) row.classList.toggle("is-selected");
  });

  // legend toggles visibility
  $("viewerLegend").addEventListener("click", function (e) {
    var it = e.target.closest(".lg-item");
    if (!it) return;
    var m = meshes[+it.dataset.i];
    if (m.threeMesh) { m.threeMesh.visible = !m.threeMesh.visible; it.classList.toggle("is-off", !m.threeMesh.visible); }
  });

  $("btnSelectAll").addEventListener("click", function () {
    var rows = document.querySelectorAll(".mesh");
    var all = rows.length && Array.from(rows).every(function (r) { return r.classList.contains("is-selected"); });
    rows.forEach(function (r) { r.classList.toggle("is-selected", !all); });
  });
  $("btnDownloadSelected").addEventListener("click", function () {
    var sel = selectedIndices();
    if (!sel.length) return toast("Önce mesh seçin");
    downloadZip(sel);
  });
  $("btnDownloadAll").addEventListener("click", function () {
    if (!meshes.length) return;
    downloadZip(meshes.map(function (_, i) { return i; }));
  });
  $("btnFullscreen").addEventListener("click", function () {
    var s = $("viewerStage");
    if (s.requestFullscreen) s.requestFullscreen();
    else if (s.webkitRequestFullscreen) s.webkitRequestFullscreen();
  });
  $("btnReset").addEventListener("click", resetAll);
})();
