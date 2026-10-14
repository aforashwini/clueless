/* Clueless Closet: a digital wardrobe that lives entirely in the browser. */
(() => {
  "use strict";

  const CATS = [
    { id: "top", label: "Tops", one: "Top" },
    { id: "bottom", label: "Bottoms", one: "Bottom" },
    { id: "dress", label: "Dresses", one: "Dress" },
    { id: "outerwear", label: "Outerwear", one: "Outerwear" },
    { id: "shoes", label: "Shoes", one: "Shoes" },
    { id: "accessory", label: "Accessories", one: "Accessory" },
    { id: "bag", label: "Bags", one: "Bag" },
  ];
  const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
  const OPTIONAL = new Set(["outerwear", "accessory", "bag"]);
  const SIDE_SLOTS = ["outerwear", "accessory", "bag"];
  const mainSlots = (mode) => (mode === "dress" ? ["dress", "shoes"] : ["top", "bottom", "shoes"]);

  const SCENES = [
    { id: "studio", label: "Studio" },
    { id: "beach", label: "Beach" },
    { id: "city", label: "City" },
    { id: "picnic", label: "Picnic" },
    { id: "night", label: "Night out" },
    { id: "museum", label: "Museum" },
    { id: "plane", label: "Plane" },
  ];
  const sceneUrl = (id) => `assets/scenes/${SCENES.some((s) => s.id === id) ? id : "studio"}.svg`;

  // The doll photo is 244 x 726. Each category gets a box on her body, in
  // fractions of the doll's width (cx, w) and height (y, h). A garment is
  // scaled to fit inside its box, then nudged by the item's saved fit.
  const DOLL = { src: "assets/doll.png", ratio: 244 / 726 };
  const FIT = {
    top: { cx: 0.5, y: 0.19, w: 0.82, h: 0.3 },
    bottom: { cx: 0.5, y: 0.385, w: 0.62, h: 0.57 },
    dress: { cx: 0.5, y: 0.19, w: 0.7, h: 0.72 },
    outerwear: { cx: 0.5, y: 0.18, w: 1.0, h: 0.52 },
    shoes: { cx: 0.51, y: 0.925, w: 0.46, h: 0.08, anchor: "bottom" },
    bag: { cx: 0.88, y: 0.4, w: 0.42, h: 0.24, anchor: "center" },
    accessory: { cx: 0.5, y: 0.17, w: 0.34, h: 0.12 },
  };
  const layerOrder = (tucked) =>
    tucked
      ? ["shoes", "top", "bottom", "dress", "outerwear", "bag", "accessory"]
      : ["shoes", "bottom", "top", "dress", "outerwear", "bag", "accessory"];

  // Background removal model, loaded on first use from a CDN.
  const AI_LIB = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/+esm";
  const MAX_SIDE = 1024;

  const SAVE_LINES = [
    "Totally a match!",
    "Way harsh... on everyone else.",
    "Saved. You look like a Monet. In a good way.",
    "Whatever! (It's saved.)",
    "Rollin' with the homies, in style.",
  ];

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /* ---------- Storage (IndexedDB) ---------- */

  const db = {
    _p: null,
    open() {
      this._p ||= new Promise((resolve, reject) => {
        const req = indexedDB.open("clueless-closet", 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore("items", { keyPath: "id" });
          req.result.createObjectStore("outfits", { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return this._p;
    },
    async tx(store, mode, fn) {
      const d = await this.open();
      return new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => resolve(r && r.result);
        t.onerror = () => reject(t.error);
      });
    },
    all: (store) => db.tx(store, "readonly", (s) => s.getAll()),
    put: (store, obj) => db.tx(store, "readwrite", (s) => s.put(obj)),
    del: (store, id) => db.tx(store, "readwrite", (s) => s.delete(id)),
  };

  /* ---------- State ---------- */

  const state = {
    items: [],
    outfits: [],
    pending: [],
    view: "closet",
    filter: "all",
    lookTab: "loved",
    match: { mode: "separates", sel: {}, locked: {}, scene: "studio", tucked: false, picked: null },
  };

  const urlCache = new Map();
  function urlFor(item) {
    if (!item) return "";
    const hit = urlCache.get(item.id);
    if (hit && hit.blob === item.image) return hit.url;
    if (hit) URL.revokeObjectURL(hit.url);
    const url = URL.createObjectURL(item.image);
    urlCache.set(item.id, { blob: item.image, url });
    return url;
  }
  const itemById = (id) => state.items.find((i) => i.id === id);
  const itemsOf = (cat) => state.items.filter((i) => i.category === cat);

  /* ---------- Image processing ---------- */

  function canvasFrom(source, maxSide) {
    const w = source.width, h = source.height;
    const k = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  const toBlob = (canvas, type = "image/png", q) =>
    new Promise((res) => canvas.toBlob(res, type, q));

  async function blobToCanvas(blob, maxSide = MAX_SIDE) {
    const bmp = await createImageBitmap(blob);
    const c = canvasFrom(bmp, maxSide);
    bmp.close?.();
    return c;
  }

  const colorDist = (p, i, r, g, b) => {
    const dr = p[i] - r, dg = p[i + 1] - g, db_ = p[i + 2] - b;
    return Math.sqrt(dr * dr + dg * dg + db_ * db_);
  };

  // Flood-fill the background in from the photo edges. Works well for clothes
  // laid on a fairly plain floor, bed or wall.
  function cutoutPlain(canvas, tol = 45) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const { width: w, height: h } = canvas;
    const img = ctx.getImageData(0, 0, w, h);
    const p = img.data;

    const rs = [], gs = [], bs = [];
    const sample = (x, y) => { const i = (y * w + x) * 4; rs.push(p[i]); gs.push(p[i + 1]); bs.push(p[i + 2]); };
    for (let x = 0; x < w; x += 2) { sample(x, 0); sample(x, h - 1); }
    for (let y = 0; y < h; y += 2) { sample(0, y); sample(w - 1, y); }
    const med = (a) => a.sort((m, n) => m - n)[a.length >> 1];
    const R = med(rs), G = med(gs), B = med(bs);

    const bg = new Uint8Array(w * h);
    const stack = [];
    const seed = (x, y) => {
      const k = y * w + x;
      if (!bg[k] && colorDist(p, k * 4, R, G, B) < tol) { bg[k] = 1; stack.push(k); }
    };
    for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
    for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }

    while (stack.length) {
      const k = stack.pop();
      const x = k % w, y = (k / w) | 0, i = k * 4;
      const cr = p[i], cg = p[i + 1], cb = p[i + 2];
      const visit = (n) => {
        if (bg[n]) return;
        const j = n * 4;
        const dBg = colorDist(p, j, R, G, B);
        // Accept pixels close to the background color, or ones that drift only
        // slightly from their neighbor (handles shadows and uneven lighting).
        if (dBg < tol || (dBg < tol * 2 && colorDist(p, j, cr, cg, cb) < tol * 0.22)) {
          bg[n] = 1;
          stack.push(n);
        }
      };
      if (x > 0) visit(k - 1);
      if (x < w - 1) visit(k + 1);
      if (y > 0) visit(k - w);
      if (y < h - 1) visit(k + w);
    }

    // Background showing through closed gaps (bag handles, between the legs of
    // jeans) isn't reachable from the edges, so clear any sizable pocket of it.
    const minPocket = w * h * 0.0015;
    const seen = new Uint8Array(w * h);
    const pocket = [];
    for (let k0 = 0; k0 < w * h; k0++) {
      if (bg[k0] || seen[k0] || colorDist(p, k0 * 4, R, G, B) >= tol * 0.8) continue;
      pocket.length = 0;
      seen[k0] = 1;
      stack.push(k0);
      while (stack.length) {
        const k = stack.pop();
        pocket.push(k);
        const x = k % w;
        for (const n of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, k - w, k + w]) {
          if (n < 0 || n >= w * h || bg[n] || seen[n] || colorDist(p, n * 4, R, G, B) >= tol * 0.8) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (pocket.length > minPocket) for (const k of pocket) bg[k] = 1;
    }

    // If almost everything matched the background (white tee on a white bed),
    // there's nothing sensible to keep.
    let cleared = 0;
    for (let k = 0; k < w * h; k++) cleared += bg[k];
    if (cleared > w * h * 0.997) return null;

    for (let k = 0; k < w * h; k++) {
      if (bg[k]) { p[k * 4 + 3] = 0; continue; }
      // Soften the edge a little so cutouts don't look jagged.
      const x = k % w, y = (k / w) | 0;
      const edge = (x > 0 && bg[k - 1]) || (x < w - 1 && bg[k + 1]) || (y > 0 && bg[k - w]) || (y < h - 1 && bg[k + w]);
      if (edge) p[k * 4 + 3] = 140;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // Trim transparent space so every piece fills its frame.
  function cropToContent(canvas) {
    const { width: w, height: h } = canvas;
    const p = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (p[(y * w + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return canvas; // nothing left; keep as is
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const out = document.createElement("canvas");
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  let aiLibPromise = null;
  function setAiStatus(text) {
    const el = $("#ai-status");
    el.hidden = !text;
    el.textContent = text || "";
  }
  async function aiCutout(blob) {
    aiLibPromise ||= import(AI_LIB).catch((e) => { aiLibPromise = null; throw e; });
    const lib = await aiLibPromise;
    const removeBackground = lib.removeBackground || lib.default;
    const seen = {};
    const out = await removeBackground(blob, {
      output: { format: "image/png" },
      progress: (key, cur, total) => {
        if (!key.startsWith("fetch") || !total) return;
        seen[key] = cur / total;
        const vals = Object.values(seen);
        const pct = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100);
        setAiStatus(pct < 100 ? `Downloading the smart cutout model (first time only)... ${pct}%` : "");
      },
    });
    setAiStatus("");
    return blobToCanvas(out);
  }

  // Returns { image, original, method } where image is a trimmed PNG cutout.
  async function processImage(source, method, tol) {
    const base = await blobToCanvas(source);
    const original = await toBlob(base, "image/jpeg", 0.9);
    let cut = null;
    if (method === "ai") {
      try {
        cut = await aiCutout(original);
      } catch (err) {
        console.warn("Smart cutout failed, falling back to simple cutout", err);
        setAiStatus("");
        toast("Smart cutout couldn't load, used the simple one instead");
        method = "plain";
      }
    }
    if (method === "plain") {
      cut = cutoutPlain(canvasFrom(base, MAX_SIDE), tol);
      if (!cut) {
        toast("Couldn't spot the piece. Try a contrasting background or the Smart cutout.");
        method = "none";
      }
    }
    if (method === "none") cut = base;
    const final = method === "none" ? cut : cropToContent(cut);
    return { image: await toBlob(final, "image/png"), original, method, aspect: final.width / final.height };
  }

  /* ---------- UI helpers ---------- */

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2600);
  }

  function setView(v) {
    state.view = v;
    try { localStorage.setItem("cc-view", v); } catch {}
    $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    $$(".view").forEach((s) => (s.hidden = s.id !== "view-" + v));
    render();
  }

  function render() {
    if (state.view === "closet") renderCloset();
    if (state.view === "match") renderMatch();
    if (state.view === "look") renderLook();
  }

  /* ---------- Closet ---------- */

  function renderCloset() {
    const counts = Object.fromEntries(CATS.map((c) => [c.id, 0]));
    state.items.forEach((i) => counts[i.category]++);
    $("#filters").innerHTML =
      `<button class="chip ${state.filter === "all" ? "active" : ""}" data-filter="all">All <b>${state.items.length}</b></button>` +
      CATS.map((c) => `<button class="chip ${state.filter === c.id ? "active" : ""}" data-filter="${c.id}">${c.label} <b>${counts[c.id]}</b></button>`).join("");

    const shown = state.items
      .filter((i) => state.filter === "all" || i.category === state.filter)
      .sort((a, b) => b.createdAt - a.createdAt);

    const pending = state.pending.map(
      (p) => `<div class="card pending"><div class="pic">Snipping...</div><div class="name">${esc(p.name)}</div><div class="cat">${esc(CAT[p.category].one)}</div></div>`
    );
    const cards = shown.map(
      (i) => `<button class="card" data-item="${i.id}">
        <div class="pic"><img src="${urlFor(i)}" alt="${esc(i.name || CAT[i.category].one)}" loading="lazy"></div>
        <div class="name">${esc(i.name || "Untitled")}</div>
        <div class="cat">${esc(CAT[i.category].one)}</div>
      </button>`
    );
    $("#closet-grid").innerHTML = pending.concat(cards).join("");
    $("#closet-empty").hidden = state.items.length + state.pending.length > 0;
  }

  async function addFiles(files) {
    const category = $("#add-cat").value;
    const method = $("#add-method").value;
    if (state.filter !== "all" && state.filter !== category) state.filter = category;
    const jobs = files.map((f) => ({ id: uid(), file: f, category, name: prettyName(f.name) }));
    state.pending.push(...jobs);
    renderCloset();
    for (const job of jobs) {
      try {
        const { image, original, method: used, aspect } = await processImage(job.file, method, 45);
        const item = { id: job.id, name: job.name, category, notes: "", image, original, method: used, aspect, fit: null, createdAt: Date.now() };
        await db.put("items", item);
        state.items.push(item);
      } catch (err) {
        console.error(err);
        toast(`Couldn't read ${job.file.name}`);
      }
      state.pending = state.pending.filter((p) => p !== job);
      if (state.view === "closet") renderCloset();
    }
  }

  function prettyName(filename) {
    const base = filename.replace(/\.[^.]+$/, "");
    return /^(img|dsc|pxl|photo|image)[-_ ]?\d/i.test(base) || /^\d/.test(base) ? "" : base.replace(/[-_]+/g, " ").slice(0, 60);
  }

  /* ---------- Item editor ---------- */

  let editing = null; // { item, image, method }
  function openEditor(id) {
    const item = itemById(id);
    if (!item) return;
    editing = { item, image: item.image, prev: item.image, method: item.method, aspect: item.aspect };
    $("#ed-img").src = urlFor(item);
    $("#ed-name").value = item.name || "";
    $("#ed-cat").value = item.category;
    $("#ed-notes").value = item.notes || "";
    $("#item-dialog").showModal();
  }

  async function redo(method) {
    if (!editing) return;
    const box = $(".editor-img");
    box.classList.add("busy");
    $$("[data-redo]").forEach((b) => (b.disabled = true));
    try {
      const res = await processImage(editing.item.original, method, Number($("#ed-tol").value));
      editing.image = res.image;
      editing.method = res.method;
      editing.aspect = res.aspect;
      $("#ed-img").src = URL.createObjectURL(res.image);
    } finally {
      box.classList.remove("busy");
      $$("[data-redo]").forEach((b) => (b.disabled = false));
    }
  }

  async function saveEditor() {
    const { item } = editing;
    Object.assign(item, {
      name: $("#ed-name").value.trim(),
      category: $("#ed-cat").value,
      notes: $("#ed-notes").value.trim(),
      image: editing.image,
      method: editing.method,
      aspect: editing.aspect,
    });
    // A new cutout has a different shape, so start its doll fit over.
    if (editing.image !== editing.prev) item.fit = null;
    await db.put("items", item);
    render();
  }

  async function deleteItem(id) {
    const used = state.outfits.filter((o) => Object.values(o.slots).includes(id)).length;
    const msg = used ? `Delete this piece? It's in ${used} saved outfit${used > 1 ? "s" : ""}.` : "Delete this piece from your closet?";
    if (!confirm(msg)) return false;
    await db.del("items", id);
    state.items = state.items.filter((i) => i.id !== id);
    const c = urlCache.get(id);
    if (c) { URL.revokeObjectURL(c.url); urlCache.delete(id); }
    for (const k in state.match.sel) if (state.match.sel[k] === id) delete state.match.sel[k];
    render();
    return true;
  }

  /* ---------- Matcher ---------- */

  function currentId(cat) {
    const list = itemsOf(cat);
    const sel = state.match.sel[cat];
    if (sel === null) return null; // explicitly "none"
    if (sel && list.some((i) => i.id === sel)) return sel;
    return OPTIONAL.has(cat) || !list.length ? null : list[0].id;
  }

  function step(cat, dir) {
    const ids = itemsOf(cat).map((i) => i.id);
    if (OPTIONAL.has(cat)) ids.unshift(null);
    if (ids.length < 2) return;
    const at = Math.max(0, ids.indexOf(currentId(cat)));
    state.match.sel[cat] = ids[(at + dir + ids.length) % ids.length];
    renderMatch({ [cat]: dir });
  }

  function shuffle() {
    const anim = {};
    for (const cat of [...mainSlots(state.match.mode), ...SIDE_SLOTS]) {
      if (state.match.locked[cat]) continue;
      const ids = itemsOf(cat).map((i) => i.id);
      if (!ids.length) continue;
      // Optional pieces show up about half the time.
      state.match.sel[cat] = OPTIONAL.has(cat) && Math.random() < 0.5 ? null : pick(ids);
      anim[cat] = Math.random() < 0.5 ? 1 : -1;
    }
    renderMatch(anim);
  }

  // Where a garment sits on the doll, as percentages of the doll box.
  function placement(item, cat) {
    const b = FIT[cat];
    const aspect = item.aspect || 1;
    const f = item.fit || { x: 0, y: 0, s: 1 };
    const bw = b.w * DOLL.ratio;
    let gw, gh;
    if (aspect > bw / b.h) { gw = bw; gh = bw / aspect; } else { gh = b.h; gw = b.h * aspect; }
    gw *= f.s;
    gh *= f.s;
    const w = gw / DOLL.ratio;
    const top = b.anchor === "bottom" ? b.y + b.h - gh : b.anchor === "center" ? b.y + (b.h - gh) / 2 : b.y;
    return { left: (b.cx + f.x - w / 2) * 100, top: (top + f.y) * 100, width: w * 100 };
  }

  const placeStyle = (p) => `left:${p.left.toFixed(2)}%;top:${p.top.toFixed(2)}%;width:${p.width.toFixed(2)}%`;

  function dollHtml(slots, { scene, tucked, picked, anim = {} } = {}) {
    const layers = layerOrder(tucked)
      .map((cat) => {
        const item = slots[cat] && itemById(slots[cat]);
        if (!item) return "";
        const cls = ["garment", picked === item.id && "picked", anim[cat] && "pop"].filter(Boolean).join(" ");
        return `<img class="${cls}" data-garment="${item.id}" data-cat="${cat}" src="${urlFor(item)}" style="${placeStyle(placement(item, cat))}" alt="${esc(item.name || CAT[cat].one)}" draggable="false">`;
      })
      .join("");
    return `<div class="scene" style="background-image:url('${sceneUrl(scene)}')">
      <div class="dollbox"><img class="doll" src="${DOLL.src}" alt="" draggable="false">${layers}</div>
    </div>`;
  }

  function currentSlots() {
    const slots = {};
    for (const cat of [...mainSlots(state.match.mode), ...SIDE_SLOTS]) {
      const id = currentId(cat);
      if (id) slots[cat] = id;
    }
    return slots;
  }

  function slotHtml(cat, anim) {
    const list = itemsOf(cat);
    const id = currentId(cat);
    const item = id && itemById(id);
    const canStep = list.length + (OPTIONAL.has(cat) ? 1 : 0) > 1;
    const locked = !!state.match.locked[cat];
    let thumb;
    if (item) {
      const from = anim ? `style="--from:${anim * 30}px"` : "";
      thumb = `<img src="${urlFor(item)}" alt="" class="${anim ? "pop" : ""}" ${from}>`;
    } else {
      thumb = `<span class="none">${list.length ? "none" : "none yet"}</span>`;
    }
    return `<div class="slot ${locked ? "locked" : ""}">
      <div class="label">${esc(CAT[cat].one.toUpperCase())}</div>
      <button class="arrow" data-step="${cat}" data-dir="-1" ${canStep ? "" : "disabled"} aria-label="Previous ${esc(CAT[cat].one)}">&lsaquo;</button>
      <div class="thumb" title="${item ? esc(item.name) : ""}">${thumb}</div>
      <button class="arrow" data-step="${cat}" data-dir="1" ${canStep ? "" : "disabled"} aria-label="Next ${esc(CAT[cat].one)}">&rsaquo;</button>
      <button class="lock" data-lock="${cat}" title="${locked ? "Unlock" : "Keep this piece when shuffling"}">${locked ? "locked" : "lock"}</button>
    </div>`;
  }

  function renderMatch(anim = {}) {
    const m = state.match;
    $$(".seg").forEach((b) => b.classList.toggle("active", b.dataset.mode === m.mode));
    $("#rig").innerHTML = [...mainSlots(m.mode), ...SIDE_SLOTS].map((c) => slotHtml(c, anim[c])).join("");
    $("#tuck").checked = m.tucked;
    $("#tuck-row").hidden = m.mode === "dress";
    const slots = currentSlots();
    if (m.picked && !Object.values(slots).includes(m.picked)) m.picked = null;
    $("#doll-stage").innerHTML = dollHtml(slots, { scene: m.scene, tucked: m.tucked, picked: m.picked, anim });
    $("#scene-picker").innerHTML = SCENES.map(
      (sc) => `<button class="scene-chip ${sc.id === m.scene ? "active" : ""}" data-scene="${sc.id}" style="background-image:url('${sceneUrl(sc.id)}')"><span>${esc(sc.label)}</span></button>`
    ).join("");
    const picked = m.picked && itemById(m.picked);
    $("#fit-bar").hidden = !picked;
    $("#fit-hint").hidden = !!picked || !Object.keys(slots).length;
    if (picked) $("#fit-name").textContent = picked.name || CAT[picked.category].one;
  }

  /* Dragging and resizing pieces on the doll. Fits are saved per item, so a
     piece you adjust once sits the same way in every outfit. */

  let drag = null;
  function startDrag(e) {
    const el = e.target.closest(".garment");
    if (!el) {
      if (state.match.picked) { state.match.picked = null; renderMatch(); }
      return;
    }
    e.preventDefault();
    const item = itemById(el.dataset.garment);
    state.match.picked = item.id;
    const box = el.parentElement.getBoundingClientRect();
    drag = { el, item, cat: el.dataset.cat, box, x0: e.clientX, y0: e.clientY, fit0: { x: 0, y: 0, s: 1, ...item.fit }, moved: false };
    el.setPointerCapture(e.pointerId);
    $$(".garment.picked").forEach((g) => g.classList.remove("picked"));
    el.classList.add("picked");
    renderFitBar();
  }
  function moveDrag(e) {
    if (!drag) return;
    const dx = (e.clientX - drag.x0) / drag.box.width;
    const dy = (e.clientY - drag.y0) / drag.box.height;
    if (Math.abs(dx) + Math.abs(dy) > 0.004) drag.moved = true;
    drag.item.fit = { ...drag.fit0, x: drag.fit0.x + dx, y: drag.fit0.y + dy };
    drag.el.setAttribute("style", placeStyle(placement(drag.item, drag.cat)));
  }
  async function endDrag() {
    if (!drag) return;
    const { item, moved } = drag;
    drag = null;
    if (moved) await db.put("items", item);
  }
  function renderFitBar() {
    const picked = state.match.picked && itemById(state.match.picked);
    $("#fit-bar").hidden = !picked;
    $("#fit-hint").hidden = !!picked;
    if (picked) $("#fit-name").textContent = picked.name || CAT[picked.category].one;
  }
  async function adjustFit(action) {
    const item = state.match.picked && itemById(state.match.picked);
    if (!item) return;
    const f = { x: 0, y: 0, s: 1, ...item.fit };
    if (action === "bigger") f.s = Math.min(4, f.s * 1.08);
    if (action === "smaller") f.s = Math.max(0.2, f.s / 1.08);
    if (action === "done") { state.match.picked = null; renderMatch(); return; }
    item.fit = action === "reset" ? null : f;
    await db.put("items", item);
    renderMatch();
  }

  async function saveOutfit(status) {
    const slots = currentSlots();
    if (!Object.keys(slots).length) {
      toast("Ugh, as if! Add some clothes to your closet first.");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const outfit = {
      id: uid(),
      name: $("#outfit-name").value.trim(),
      status,
      slots,
      scene: state.match.scene,
      tucked: state.match.mode !== "dress" && state.match.tucked,
      notes: "",
      worn: status === "loved" ? [today] : [],
      createdAt: Date.now(),
    };
    await db.put("outfits", outfit);
    state.outfits.push(outfit);
    $("#outfit-name").value = "";
    const stamp = $("#stamp");
    stamp.textContent = status === "loved" ? "MATCH!" : "TRY IT!";
    stamp.hidden = true;
    void stamp.offsetWidth;
    stamp.hidden = false;
    setTimeout(() => (stamp.hidden = true), 1150);
    toast(status === "loved" ? pick(SAVE_LINES) : "Saved to your want-to-try list");
  }

  /* ---------- Lookbook ---------- */

  const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  function renderLook() {
    const loved = state.outfits.filter((o) => o.status === "loved");
    const tries = state.outfits.filter((o) => o.status === "try");
    $("#count-loved").textContent = loved.length;
    $("#count-try").textContent = tries.length;
    $$("[data-look]").forEach((b) => b.classList.toggle("active", b.dataset.look === state.lookTab));

    const list = (state.lookTab === "loved" ? loved : tries).sort((a, b) => b.createdAt - a.createdAt);
    $("#look-grid").innerHTML = list
      .map((o) => {
        const worn = o.worn || [];
        const last = worn.length ? [...worn].sort().at(-1) : null;
        const meta =
          o.status === "loved"
            ? `Worn ${worn.length}&times;${last ? ` &middot; last on ${fmtDate(last)}` : ""}`
            : `Added ${new Date(o.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
        const main =
          o.status === "loved"
            ? `<button class="btn" data-act="wore" data-id="${o.id}">Wore it again today</button>`
            : `<button class="btn primary" data-act="wore" data-id="${o.id}">Wore it &amp; loved it</button>`;
        return `<article class="look">
          <div class="look-stage">${dollHtml(o.slots, { scene: o.scene, tucked: o.tucked })}</div>
          <label class="scene-select">Scene
            <select data-scene-for="${o.id}">${SCENES.map((sc) => `<option value="${sc.id}" ${sc.id === (o.scene || "studio") ? "selected" : ""}>${esc(sc.label)}</option>`).join("")}</select>
          </label>
          <h3>${esc(o.name || (o.status === "loved" ? "A favorite look" : "An idea to try"))}</h3>
          <div class="meta">${meta}</div>
          <textarea data-notes="${o.id}" placeholder="Notes: where you wore it, what to change...">${esc(o.notes)}</textarea>
          <div class="row">
            ${main}
            <button class="btn" data-act="remix" data-id="${o.id}">Remix</button>
            <button class="btn danger" data-act="delete" data-id="${o.id}">Delete</button>
          </div>
        </article>`;
      })
      .join("");

    const empty = $("#look-empty");
    empty.hidden = list.length > 0;
    empty.innerHTML =
      state.lookTab === "loved"
        ? `<p class="big">No favorites yet</p><p>Build a look in Match and hit "Wore it &amp; loved it".</p>`
        : `<p class="big">Nothing to try yet</p><p>Spot a combo in Match you want to test? Save it as "Want to try".</p>`;
  }

  async function lookAction(act, id) {
    const o = state.outfits.find((x) => x.id === id);
    if (!o) return;
    if (act === "wore") {
      const today = new Date().toISOString().slice(0, 10);
      o.worn = o.worn || [];
      if (!o.worn.includes(today)) o.worn.push(today);
      const moved = o.status === "try";
      o.status = "loved";
      await db.put("outfits", o);
      toast(moved ? "Moved to Worn & loved. Look at you!" : "Logged it for today");
      renderLook();
    } else if (act === "remix") {
      state.match.mode = o.slots.dress ? "dress" : "separates";
      state.match.sel = {};
      for (const cat of [...mainSlots(state.match.mode), ...SIDE_SLOTS]) state.match.sel[cat] = o.slots[cat] || null;
      state.match.scene = o.scene || "studio";
      state.match.tucked = !!o.tucked;
      state.match.picked = null;
      $("#outfit-name").value = o.name ? o.name + " (remix)" : "";
      setView("match");
    } else if (act === "delete") {
      if (!confirm("Delete this outfit? The clothes stay in your closet.")) return;
      await db.del("outfits", id);
      state.outfits = state.outfits.filter((x) => x.id !== id);
      renderLook();
    }
  }

  /* ---------- Backup ---------- */

  const blobToDataUrl = (b) =>
    new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

  async function exportBackup() {
    const items = await Promise.all(
      state.items.map(async (i) => ({ ...i, image: await blobToDataUrl(i.image), original: await blobToDataUrl(i.original) }))
    );
    const data = JSON.stringify({ app: "clueless-closet", version: 1, items, outfits: state.outfits });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = `clueless-closet-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== "clueless-closet") throw new Error("not a backup");
      for (const raw of data.items || []) {
        const item = { ...raw, image: await (await fetch(raw.image)).blob(), original: await (await fetch(raw.original)).blob() };
        await db.put("items", item);
      }
      for (const o of data.outfits || []) await db.put("outfits", o);
      await loadAll();
      toast(`Imported ${data.items.length} pieces and ${data.outfits.length} outfits`);
      render();
    } catch (err) {
      console.error(err);
      toast("That file doesn't look like a Clueless Closet backup");
    }
  }

  async function loadAll() {
    [state.items, state.outfits] = await Promise.all([db.all("items"), db.all("outfits")]);
    // Older items were saved before the doll existed and don't know their shape yet.
    for (const item of state.items) {
      if (item.aspect) continue;
      try {
        const bmp = await createImageBitmap(item.image);
        item.aspect = bmp.width / bmp.height;
        bmp.close?.();
        await db.put("items", item);
      } catch {
        item.aspect = 1;
      }
    }
  }

  /* ---------- Wiring ---------- */

  function bind() {
    const catOptions = CATS.map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
    $("#add-cat").innerHTML = catOptions;
    $("#ed-cat").innerHTML = catOptions;
    try {
      $("#add-method").value = localStorage.getItem("cc-method") || "ai";
      $("#add-cat").value = localStorage.getItem("cc-cat") || "top";
    } catch {}
    $("#add-method").onchange = (e) => { try { localStorage.setItem("cc-method", e.target.value); } catch {} };
    $("#add-cat").onchange = (e) => { try { localStorage.setItem("cc-cat", e.target.value); } catch {} };

    $$(".tab").forEach((b) => (b.onclick = () => setView(b.dataset.view)));

    $("#file-input").onchange = (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      if (files.length) addFiles(files);
    };
    $("#filters").onclick = (e) => {
      const b = e.target.closest("[data-filter]");
      if (b) { state.filter = b.dataset.filter; renderCloset(); }
    };
    $("#closet-grid").onclick = (e) => {
      const c = e.target.closest("[data-item]");
      if (c) openEditor(c.dataset.item);
    };

    $$("[data-redo]").forEach((b) => (b.onclick = () => redo(b.dataset.redo)));
    $("#ed-delete").onclick = async () => {
      if (await deleteItem(editing.item.id)) $("#item-dialog").close("deleted");
    };
    $("#item-dialog").addEventListener("close", async () => {
      if ($("#item-dialog").returnValue === "save" && editing) await saveEditor();
      editing = null;
    });

    $(".mode").onclick = (e) => {
      const b = e.target.closest("[data-mode]");
      if (b) { state.match.mode = b.dataset.mode; renderMatch(); }
    };
    $("#rig").onclick = (e) => {
      const s = e.target.closest("[data-step]");
      if (s) return step(s.dataset.step, Number(s.dataset.dir));
      const l = e.target.closest("[data-lock]");
      if (l) { state.match.locked[l.dataset.lock] = !state.match.locked[l.dataset.lock]; renderMatch(); }
    };
    $("#scene-picker").onclick = (e) => {
      const b = e.target.closest("[data-scene]");
      if (b) { state.match.scene = b.dataset.scene; try { localStorage.setItem("cc-scene", b.dataset.scene); } catch {} renderMatch(); }
    };
    $("#tuck").onchange = (e) => { state.match.tucked = e.target.checked; renderMatch(); };
    const stage = $("#doll-stage");
    stage.addEventListener("pointerdown", startDrag);
    stage.addEventListener("pointermove", moveDrag);
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
    stage.addEventListener("wheel", (e) => {
      if (!e.target.closest(".garment.picked")) return;
      e.preventDefault();
      adjustFit(e.deltaY < 0 ? "bigger" : "smaller");
    }, { passive: false });
    $("#fit-bar").onclick = (e) => {
      const b = e.target.closest("[data-fit]");
      if (b) adjustFit(b.dataset.fit);
    };
    $("#shuffle").onclick = shuffle;
    $("#save-loved").onclick = () => saveOutfit("loved");
    $("#save-try").onclick = () => saveOutfit("try");

    $("#view-look").addEventListener("click", (e) => {
      const t = e.target.closest("[data-look]");
      if (t) { state.lookTab = t.dataset.look; renderLook(); return; }
      const a = e.target.closest("[data-act]");
      if (a) lookAction(a.dataset.act, a.dataset.id);
    });
    $("#look-grid").addEventListener("change", async (e) => {
      const sceneFor = e.target.dataset.sceneFor;
      if (sceneFor) {
        const o = state.outfits.find((x) => x.id === sceneFor);
        o.scene = e.target.value;
        await db.put("outfits", o);
        e.target.closest(".look").querySelector(".scene").style.backgroundImage = `url('${sceneUrl(o.scene)}')`;
        return;
      }
      const id = e.target.dataset.notes;
      const o = id && state.outfits.find((x) => x.id === id);
      if (o) { o.notes = e.target.value; await db.put("outfits", o); }
    });

    $("#export").onclick = exportBackup;
    $("#import").onchange = (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (f) importBackup(f);
    };

    document.addEventListener("keydown", (e) => {
      if (state.view !== "match" || e.target.matches("input, textarea, select")) return;
      if (e.key === " ") { e.preventDefault(); shuffle(); }
    });
  }

  async function init() {
    bind();
    try {
      await loadAll();
    } catch (err) {
      console.error(err);
      toast("This browser is blocking storage, so nothing will be saved");
    }
    try { state.match.scene = localStorage.getItem("cc-scene") || "studio"; } catch {}
    let view = "closet";
    try { view = localStorage.getItem("cc-view") || view; } catch {}
    if (!state.items.length) view = "closet";
    setView(view);
  }

  init();
})();
