/* HELIX/OPS — ARCADE APP core: helpers, data store + polling, sprites, router, shell, boot.
   Real telemetry only — every value comes from the existing /api/* endpoints. */
(function (G) {
  "use strict";

  /* ═════════ helpers ═════════ */
  const OPS = (location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "";
  const api = (p) => OPS + p;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v) => (typeof v === "number" && isFinite(v)) ? v : null;
  const trunc = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const NT = "NO TELEMETRY";
  function ago(sec) {
    if (sec == null || !isFinite(sec)) return "—";
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + "s";
    if (sec < 3600) return Math.round(sec / 60) + "m";
    if (sec < 86400) return Math.round(sec / 3600) + "h";
    return Math.round(sec / 86400) + "d";
  }
  function fmtBytes(b) {
    const n = num(b); if (n == null) return "—";
    if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB"; return (n / 1073741824).toFixed(2) + " GB";
  }
  function jst(opts) {
    try { return new Date().toLocaleTimeString("en-GB", Object.assign({ timeZone: "Asia/Tokyo", hour12: false, hour: "2-digit", minute: "2-digit" }, opts || {})); } catch (e) { return "--:--"; }
  }
  function clockOf(t) {
    if (typeof t === "number" && t > 1e9) { try { return new Date(t * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour12: false }); } catch (e) {} }
    return String(t || "");
  }

  /* ═════════ settings ═════════ */
  const SET = { anim: "full", sound: "off", boot: "full" };
  try { Object.assign(SET, JSON.parse(localStorage.getItem("helix.app") || "{}")); } catch (e) {}
  if (matchMedia("(prefers-reduced-motion: reduce)").matches && !localStorage.getItem("helix.app")) SET.anim = "lite";
  function saveSet() { try { localStorage.setItem("helix.app", JSON.stringify(SET)); } catch (e) {} applySet(); }
  function applySet() {
    document.body.classList.toggle("anim-off", SET.anim === "off");
    document.body.classList.toggle("anim-lite", SET.anim === "lite");
  }

  /* ═════════ sound (arcade bleeps, off by default) ═════════ */
  let actx = null;
  function bleep(freq, dur, type) {
    if (SET.sound !== "on") return;
    try {
      actx = actx || new (G.AudioContext || G.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || "square"; o.frequency.value = freq || 660;
      g.gain.setValueAtTime(0.025, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + (dur || 0.07));
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + (dur || 0.07));
    } catch (e) {}
  }

  /* ═════════ agents: colours, mascots, roles ═════════ */
  const META = {
    helix:    { acc: "#ff4fa3", shape: "ghost", name: "HELIX", role: "lead · grok · runs the floor" },
    prefect:  { acc: "#3b82f6", shape: "round", name: "PREFECT", role: "align · keeps the plan honest" },
    foreman:  { acc: "#f59e0b", shape: "hex", name: "FOREMAN", role: "kanban · moves the work" },
    canon:    { acc: "#39e58c", shape: "square", name: "CANON", role: "docs · writes it down" },
    scribe:   { acc: "#22d3ee", shape: "round2", name: "SCRIBE", role: "research · reads first" },
    adze:     { acc: "#ff4d6d", shape: "tri", name: "ADZE", role: "critic · openai · no tools" },
    worker:   { acc: "#14b8a6", shape: "ghost", name: "WORKER", role: "unraid hermes · peer agent" },
    unraid:   { acc: "#facc15", shape: "box", name: "UNRAID", role: "peer · docker host" },
    umbrel:   { acc: "#fb923c", shape: "box", name: "UMBREL", role: "peer node" },
    honcho:   { acc: "#a3e635", shape: "hex", name: "HONCHO", role: "memory · peers & facts" },
    telegram: { acc: "#38bdf8", shape: "plane", name: "TELEGRAM", role: "channel · only Helix speaks" },
    user:     { acc: "#ffffff", shape: "user", name: "YOU", role: "operator · desktop" },
    web:      { acc: "#a78bfa", shape: "globe", name: "WEB", role: "search · browse" },
    tools:    { acc: "#c9c3d6", shape: "wrench", name: "TOOLS", role: "terminal · code" },
  };
  const ORDER = ["helix", "prefect", "foreman", "canon", "scribe", "adze", "worker", "honcho", "unraid", "umbrel", "telegram", "user", "web", "tools"];
  const meta = (id) => META[id] || { acc: "#a7a1b6", shape: "round", name: String(id || "?").toUpperCase(), role: "" };

  const SHAPES = {
    round:  ["...XXXX...", ".XXXXXXXX.", ".XXXXXXXX.", "XXWKXXWKXX", "XXWWXXWWXX", "XXXXXXXXXX", "XXXXXXXXXX", ".XXXXXXXX.", "..XXXXXX..", "..X....X.."],
    round2: ["..X....X..", "...XXXX...", ".XXXXXXXX.", "XXWWXXWWXX", "XXWKXXWKXX", "XXXXXXXXXX", "XXXXKKXXXX", ".XXXXXXXX.", "..XXXXXX..", ".XX....XX."],
    tri:    ["....XX....", "....XX....", "...XXXX...", "...XXXX...", "..XWKXWKX.", "..XWWXWWX.", ".XXXXXXXX.", "XXXXXXXXXX", "XXXXXXXXXX", ".X......X."],
    square: [".XXXXXXXX.", "XXXXXXXXXX", "XXWKXXWKXX", "XXWWXXWWXX", "XXXXXXXXXX", "XXXXXXXXXX", "XXXXKKXXXX", "XXXXXXXXXX", ".XXXXXXXX.", ".X......X."],
    hex:    ["...XXXX...", "..XXXXXX..", ".XXXXXXXX.", "XXWKXXWKXX", "XXWWXXWWXX", "XXXXXXXXXX", ".XXXXXXXX.", "..XXXXXX..", "...XXXX...", "..X....X.."],
    ghost:  ["..HXXXXH..", ".HXXXXXXH.", "HXXXXXXXXH", "HXKKXXKKXH", "XXKKXXKKXX", "XXXXXXXXXX", "XXXXXXXXXX", "XXXXXXXXXX", "XXXXXXXXXX", "X.XX.XX.X."],
    box:    ["XXXXXXXXXX", "XWWWWWWWWX", "XWKKWWKKWX", "XWWWWWWWWX", "XXXXXXXXXX", "XKXKXXXXHX", "XXXXXXXXXX", "XKXKXXXXHX", "XXXXXXXXXX", ".X......X."],
    plane:  ["........XX", "......XXWX", "....XXWWX.", "..XXWWWX..", "XXWWWWX...", "..XXWWX...", "....XWX...", "....XX....", "....X.....", ".........."],
    user:   ["...XXXX...", "..XXXXXX..", "..XKXXKX..", "..XXXXXX..", "...XXXX...", ".XXXXXXXX.", "XXXXXXXXXX", "XXXXXXXXXX", "XXXXXXXXXX", "XX......XX"],
    globe:  ["...XXXX...", ".XXWXXWXX.", ".XWXXXXWX.", "XWXXXXXXWX", "XXXXXXXXXX", "XWWWWWWWWX", "XXXXXXXXXX", ".XWXXXXWX.", ".XXWXXWXX.", "...XXXX..."],
    wrench: [".XX.......", "XWX.......", "XWWX......", ".XWWX.....", "..XWWX....", "...XWWX...", "....XWWXX.", ".....XWWWX", "......XWWX", ".......XX."],
  };
  const spriteCache = new Map();
  function spriteURL(id, on, scale) {
    const key = id + "|" + (on ? 1 : 0) + "|" + (scale || 4);
    if (spriteCache.has(key)) return spriteCache.get(key);
    const m = meta(id), s = scale || 4, cv = document.createElement("canvas");
    cv.width = cv.height = 10 * s;
    const ctx = cv.getContext("2d");
    drawSprite(ctx, id, on, 0, 0, s);
    const url = cv.toDataURL();
    spriteCache.set(key, url);
    void m;
    return url;
  }
  function drawSprite(ctx, id, on, ox, oy, s, tint) {
    const m = meta(id);
    const rows = SHAPES[m.shape] || SHAPES.round;
    const body = tint || (m.shape === "ghost" ? (on ? "#f4f1fa" : "#4a4458") : (on ? m.acc : "#4a4458"));
    const col = { X: body, W: on ? "#ffffff" : "#8b8698", K: "#0b0910", H: on ? m.acc : "#5a5468" };
    for (let y = 0; y < 10; y++) {
      const r = rows[y];
      for (let x = 0; x < 10; x++) { const c = col[r[x]]; if (c) { ctx.fillStyle = c; ctx.fillRect(Math.round(ox + x * s), Math.round(oy + y * s), Math.ceil(s), Math.ceil(s)); } }
    }
  }
  const sprite = (id, on, px) => `<img class="sprite" src="${spriteURL(id, on, 4)}" width="${px || 32}" height="${px || 32}" alt="">`;

  /* pixel double-helix logo */
  function logoCells() {
    const N = 13, pos = [], cells = {};
    for (let r = 0; r < N; r++) pos.push(Math.round(6.5 + 5.5 * Math.sin(r * Math.PI / 6.5)));
    for (let r = 0; r < N; r++) { const a = pos[r], b = 12 - a; if (Math.abs(a - b) >= 4 && r % 3 === 0) for (let c = Math.min(a, b) + 1; c < Math.max(a, b); c++) cells[c + "," + r] = "#5b2a47"; }
    for (let r = 0; r < N; r++) {
      const a = pos[r], b = 12 - a, pa = r ? pos[r - 1] : a, pb = 12 - pa;
      for (let c = Math.min(a, pa); c <= Math.max(a, pa); c++) cells[c + "," + r] = "#ffffff";
      for (let c = Math.min(b, pb); c <= Math.max(b, pb); c++) { const k = c + "," + r; cells[k] = (cells[k] === "#ffffff" && Math.cos(r * Math.PI / 6.5) > 0) ? "#ffffff" : "#ff4fa3"; }
    }
    return Object.keys(cells).map((k) => { const [c, r] = k.split(",").map(Number); return { c, r, f: cells[k] }; });
  }
  function drawLogo(cv, progress) {
    const ctx = cv.getContext("2d"), W = cv.width, s = W / 16;
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = "#ff4fa3"; ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = "#15121c"; ctx.fillRect(s * 0.6, s * 0.6, W - s * 1.2, W - s * 1.2);
    const cells = logoCells();
    const n = Math.floor(cells.length * (progress == null ? 1 : progress));
    cells.slice().sort((a, b) => a.r - b.r || a.c - b.c).slice(0, n).forEach((p) => { ctx.fillStyle = p.f; ctx.fillRect(Math.round(s * 1.5 + p.c * s), Math.round(s * 1.5 + p.r * s), Math.ceil(s), Math.ceil(s)); });
  }

  /* pixel icons (24×24 grid, crisp) */
  const IC = {
    home: "M3 11h2v9h5v-6h4v6h5v-9h2L12 3z",
    mesh: "M5 4h4v4H5zM15 4h4v4h-4zM10 15h4v4h-4zM8 7l3 8M16 7l-3 8M9 6h6",
    agents: "M7 5h4v4H7zM13 5h4v4h-4zM5 11h14v2H5zM6 14h12v5H6z",
    trace: "M3 6h12v2H3zM3 11h18v2H3zM3 16h8v2H3zM17 4h4v6h-4z",
    systems: "M4 4h16v6H4zM4 14h16v6H4zM6 6h2v2H6zM6 16h2v2H6z",
    memory: "M6 3h12v18H6zM9 6h6v2H9zM9 10h6v2H9zM9 14h4v2H9z",
    settings: "M11 2h2v4h-2zM11 18h2v4h-2zM2 11h4v2H2zM18 11h4v2h-4zM8 8h8v8H8z",
    more: "M4 11h4v2H4zM10 11h4v2h-4zM16 11h4v2h-4z",
    chat: "M3 4h18v12H9l-4 4v-4H3zM7 8h10v2H7zM7 11h7v2H7z",
    menu: "M3 5h18v2H3zM3 11h18v2H3zM3 17h18v2H3z",
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" shape-rendering="crispEdges" aria-hidden="true"><path d="${IC[k] || IC.more}" fill="currentColor" stroke="${k === "mesh" ? "currentColor" : "none"}" stroke-width="${k === "mesh" ? 1.6 : 0}"/></svg>`;

  /* ═════════ data store + polling ═════════ */
  const store = { data: {}, at: {}, err: {}, subs: new Set(), hist: [], net: { last: null, rates: [] }, talkSeen: new Set(), peak: null };
  const POLL = {
    stats: { path: "/api/stats", every: 10000, always: true },
    compute: { path: "/api/compute", every: 2000, always: true },
    agents: { path: "/api/agents", every: 6000, always: true },
    talk: { path: "/api/talk", every: 4000, always: true },
    trace: { path: "/api/trace?agent=helix&retain=24", every: 3000, always: true },
    adze: { path: "/api/adze", every: 15000, always: true },
    remote: { path: "/api/remote", every: 20000, pages: ["home", "systems"] },
    docker: { path: "/api/docker", every: 45000, pages: ["home", "systems"] },
    clients: { path: "/api/clients", every: 90000, pages: ["systems"] },
    git: { path: "/api/git", every: 60000, pages: ["settings", "home"] },
    matrix: { path: "/api/matrix", every: 30000, pages: ["memory", "home"] },
    memory: { path: "/api/memory", every: 60000, pages: ["memory"] },
    skills: { path: "/api/skills", every: 120000, pages: ["memory"] },
    thoughts: { path: "/api/thoughts", every: 3000, pages: ["agents"] },
    herdr: { path: "/api/herdr", every: 20000, pages: ["agents"] },
  };
  /* ── live mesh feed: /api/mesh snapshot + /api/stream (SSE), polling fallback ── */
  store.mesh = { seq: -1, events: [], sources: {}, mode: "connecting", unsupported: false, lastMsg: 0 };
  function meshAdd(evs) {
    if (!evs || !evs.length) return;
    const M = store.mesh, have = new Set(M.events.slice(-400).map((e) => e.seq));
    evs.forEach((e) => { if (!have.has(e.seq)) M.events.push(e); M.seq = Math.max(M.seq, e.seq || 0); });
    if (M.events.length > 700) M.events.splice(0, M.events.length - 700);
    M.lastMsg = Date.now();
    emit("mesh");
  }
  let es = null, meshPoll = null;
  async function meshSnapshot() {
    try {
      const d = await fetchJSON(store.mesh.seq >= 0 ? "/api/mesh?since=" + store.mesh.seq : "/api/mesh", 20000);
      store.mesh.sources = d.sources || {};
      if (store.mesh.seq < 0) store.mesh.seq = 0;
      meshAdd(d.events || []);
      if (!(d.events || []).length) emit("mesh");
      return true;
    } catch (e) {
      if (/404/.test(e.message)) { store.mesh.unsupported = true; store.mesh.mode = "legacy"; emit("mesh"); }
      return false;
    }
  }
  function meshFallback() {
    if (meshPoll) return;
    store.mesh.mode = "poll"; emit("mesh");
    meshPoll = setInterval(() => { if (!document.hidden) meshSnapshot(); }, 3000);
  }
  async function startMesh() {
    const ok = await meshSnapshot();
    if (!ok || store.mesh.unsupported) { if (!store.mesh.unsupported) meshFallback(); return; }
    if (!("EventSource" in G)) { meshFallback(); return; }
    let opened = false;
    const open = () => {
      try { es && es.close(); } catch (e) {}
      es = new EventSource(api("/api/stream?since=" + Math.max(0, store.mesh.seq)), { withCredentials: true });
      es.addEventListener("open", () => { opened = true; store.mesh.mode = "live"; if (meshPoll) { clearInterval(meshPoll); meshPoll = null; } emit("mesh"); });
      es.addEventListener("mesh", (m) => { try { const d = JSON.parse(m.data); meshAdd(d.events || []); } catch (e) {} });
      es.addEventListener("error", () => { if (store.mesh.mode === "live") { store.mesh.mode = "reconnecting"; emit("mesh"); } if (!opened) { es.close(); meshFallback(); } });
    };
    open();
    setTimeout(() => { if (!opened) { try { es.close(); } catch (e) {} meshFallback(); } }, 12000);
    setInterval(() => { if (store.mesh.mode === "live" && !document.hidden) meshSnapshot(); }, 60000);   // belt and braces
    document.addEventListener("visibilitychange", () => { if (!document.hidden && es && es.readyState === 2) open(); });
  }

  let curPage = "home";
  const timers = {};
  async function fetchJSON(path, ms) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 30000);
    try {
      const r = await fetch(api(path), { cache: "no-store", signal: ctl.signal, credentials: "same-origin" });
      if (r.status === 401 || (r.redirected && /\/login/.test(r.url))) { location.href = api("/login"); throw new Error("auth"); }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  async function load(key, force) {
    const p = POLL[key];
    if (!p) return;
    if (!force && document.hidden) return;
    if (!force && !p.always && !(p.pages || []).includes(curPage)) return;
    try {
      const d = await fetchJSON(p.path, key === "stats" ? 60000 : 25000);
      ingest(key, d);
      store.err[key] = null;
    } catch (e) { store.err[key] = e.message; }
    emit(key);
  }
  function ingest(key, d) {
    store.data[key] = d; store.at[key] = Date.now();
    if (key === "compute") {
      if (num(d.used_pct) != null) store.peak = store.peak == null ? d.used_pct : Math.max(store.peak, d.used_pct);
      const last = store.hist[store.hist.length - 1];
      if (!last || Date.now() - last.t > 2500) {
        const tc = d.total_cpus || 0, share = {};
        (d.hosts || []).forEach((h) => { if (h.online && tc) share[h.id] = 100 * (Number(h.load1) || 0) / tc; });
        store.hist.push({ t: Date.now(), used: num(d.used_pct), mem: d.mem_total_gb ? 100 * (d.mem_used_gb || 0) / d.mem_total_gb : null, share, names: Object.fromEntries((d.hosts || []).map((h) => [h.id, h.name || h.id])) });
        if (store.hist.length > 360) store.hist.shift();
      }
    }
    if (key === "stats") {
      const ifs = ((d.network || {}).ifaces) || [], eg = (d.network || {}).egress_iface;
      const nic = ifs.find((x) => x.name === eg) || ifs[0];
      if (nic && num(nic.rx_bytes) != null) {
        const now = Date.now(), L = store.net.last;
        if (L && L.name === nic.name && now > L.t && nic.rx_bytes >= L.rx) {
          const dt = (now - L.t) / 1000;
          store.net.rates.push({ t: now, rx: (nic.rx_bytes - L.rx) * 8 / 1e6 / dt, tx: (nic.tx_bytes - L.tx) * 8 / 1e6 / dt });
          if (store.net.rates.length > 90) store.net.rates.shift();
        }
        store.net.last = { name: nic.name, t: now, rx: nic.rx_bytes, tx: nic.tx_bytes };
      }
    }
  }
  let emitTimer = null; const dirty = new Set();
  function emit(key) {
    dirty.add(key);
    if (emitTimer) return;
    emitTimer = setTimeout(() => { emitTimer = null; const keys = new Set(dirty); dirty.clear(); store.subs.forEach((f) => { try { f(keys); } catch (e) { console.error(e); } }); }, 120);
  }
  function startPolling() {
    startMesh();
    Object.keys(POLL).forEach((k) => { load(k, POLL[k].always); timers[k] = setInterval(() => load(k), POLL[k].every); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) Object.keys(POLL).forEach((k) => load(k)); });
  }
  function needPage(page) {
    curPage = page;
    Object.keys(POLL).forEach((k) => { const p = POLL[k]; if (!p.always && (p.pages || []).includes(page) && (!store.at[k] || Date.now() - store.at[k] > p.every)) load(k, true); });
  }
  const D = (k) => store.data[k];

  /* ═════════ derived views ═════════ */
  function needsList() {
    const d = D("stats") || {}, items = [];
    (d.actions || []).forEach((a) => items.push({ sev: String(a.priority || "low").toLowerCase(), title: a.title || a.kind || "action", src: [a.source, a.detail].filter(Boolean).join(" · "), kind: a.kind || "" }));
    ((d.security || {}).findings || []).forEach((f) => { const lv = String(f.level || "").toLowerCase(); if (lv && lv !== "ok") items.push({ sev: lv, title: f.title || "finding", src: "hardening · " + (f.detail || ""), kind: "security" }); });
    const R = { high: 0, med: 1, warn: 2, low: 3 };
    items.forEach((x) => { if (!(x.sev in R)) x.sev = "low"; });
    return items.sort((a, b) => R[a.sev] - R[b.sev]);
  }
  /* one list of agents merging bot_mesh (online), /api/agents (status/thinking) and /api/adze */
  function agentList() {
    const st = D("stats") || {}, mesh = st.bot_mesh || {}, ag = (D("agents") || {}).agents || [], adze = D("adze");
    const byA = {}; ag.forEach((a) => { byA[a.id] = a; });
    const ids = new Set(), lastAct = {}, nowS = Date.now() / 1000;
    store.mesh.events.forEach((e) => { [e.agent, e.from].forEach((k) => { if (k && e.t) { const ag = nowS - e.t; if (lastAct[k] == null || ag < lastAct[k]) lastAct[k] = Math.max(0, ag); } }); });
    (mesh.nodes || []).forEach((n) => ids.add(n.id));
    ag.forEach((a) => ids.add(a.id));
    const out = [];
    ids.forEach((id) => {
      const n = (mesh.nodes || []).find((x) => x.id === id) || {}, a = byA[id] || {}, m = meta(id);
      let online = n.online != null ? !!n.online : !!a.online;
      if (id === "adze" && adze && typeof adze.online === "boolean") online = adze.online;
      if (id === "helix" && st.hermes) online = !!st.hermes.gateway_running;
      // silent profiles run one-shot (no gateway): real recent traffic on the mesh also means alive
      const act = lastAct[id];
      if (act != null && act < 900) online = true;
      const status = !online ? "dark" : (a.status === "busy" || (act != null && act < 120) ? "busy" : "idle");
      out.push({ id, name: m.name, label: n.label || a.label || m.name, acc: m.acc, role: m.role, kind: n.kind || a.kind || "", host: n.host || a.host || "", online, status, thinking: a.thinking || "", doing: a.doing || "", title: a.title || "", source: a.source || "", age_s: a.age_s != null ? a.age_s : act });
    });
    const ws = (store.mesh.sources || {}).worker, wEv = store.mesh.events.filter((e) => e.agent === "worker" || e.from === "worker" || e.to === "worker");
    if ((ws && ws !== "no database") || wEv.length) {
      const last = wEv[wEv.length - 1], m = meta("worker");
      const age = last && last.t ? Date.now() / 1000 - last.t : null;
      out.push({ id: "worker", name: m.name, label: "Unraid Hermes", acc: m.acc, role: m.role, kind: "peer-agent", host: "unraid", online: ws === "ok", status: ws !== "ok" ? "dark" : (age != null && age < 120 ? "busy" : "idle"), thinking: ws === "ok" ? "" : (ws || ""), doing: last && age != null && age < 120 ? last.text : "", title: last ? last.title : "", source: "", age_s: age });
    }
    out.sort((x, y) => (ORDER.indexOf(x.id) + 1 || 99) - (ORDER.indexOf(y.id) + 1 || 99));
    return out;
  }
  function talkItems() { return ((D("talk") || {}).items) || []; }

  /* ═════════ router ═════════ */
  const ROUTES = [
    { id: "home", label: "HOME", icon: "home", hash: "#/" },
    { id: "helix", label: "HELIX", icon: "chat", hash: "#/helix" },
    { id: "mesh", label: "MESH", icon: "mesh", hash: "#/mesh" },
    { id: "agents", label: "AGENTS", icon: "agents", hash: "#/agents" },
    { id: "trace", label: "TRACE", icon: "trace", hash: "#/trace" },
    { id: "systems", label: "SYSTEMS", icon: "systems", hash: "#/systems" },
    { id: "memory", label: "MEMORY", icon: "memory", hash: "#/memory" },
    { id: "settings", label: "SETTINGS", icon: "settings", hash: "#/settings" },
  ];
  const MOBILE = ["home", "helix", "mesh", "systems"];
  let current = null;
  function parseHash() {
    const h = (location.hash || "#/").replace(/^#\/?/, "");
    const [page, ...rest] = h.split("/");
    return { page: page || "home", arg: rest.join("/") || "" };
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function route() {
    const { page, arg } = parseHash();
    const P = G.HelixPages || {};
    const def = P[page] ? page : "home";
    const main = $("#main");
    if (current && current.destroy) { try { current.destroy(); } catch (e) {} }
    progress(30);
    main.innerHTML = "";
    const el = document.createElement("div"); el.className = "page"; main.appendChild(el);
    needPage(def);
    current = P[def](el, arg) || {};
    $$(".navbtn, .bottomnav button").forEach((b) => b.classList.toggle("on", b.dataset.page === def || (b.dataset.page === "more" && !MOBILE.includes(def))));
    document.title = "HELIX/OPS · " + def.toUpperCase();
    closeSheet(); window.scrollTo(0, 0);
    setTimeout(() => progress(100), 120); setTimeout(() => progress(0), 520);
    bleep(880, 0.04);
  }
  function progress(p) { const b = $("#pageload i"); if (b) b.style.width = p + "%"; if (b && p === 0) { b.style.transition = "none"; requestAnimationFrame(() => { b.style.transition = ""; }); } }

  /* ═════════ shell ═════════ */
  function shell() {
    const app = $("#app");
    app.innerHTML = `
<div class="cabinet" aria-hidden="true"></div><div class="scan" aria-hidden="true"></div>
<div class="pageload" id="pageload"><i></i></div>
<div class="shell">
  <header class="topbar">
    <a class="brand" href="#/" aria-label="HELIX/OPS home"><canvas id="brandlogo" width="64" height="64"></canvas><span><span class="wm">HELIX<span>/</span>OPS</span><span class="sub">HERMES COMMAND FLOOR · TOKYO-06</span></span></a>
    <div class="chips" id="chips"></div>
    <div class="clock" id="clock" aria-label="Japan time">--:--<small>JST</small></div>
  </header>
  <nav class="sidenav" aria-label="Main">
    ${ROUTES.map((r) => `<button class="navbtn" data-page="${r.id}" data-hash="${r.hash}">${icon(r.icon)}<span>${r.label}</span><span class="badge" id="nb-${r.id}" hidden></span></button>`).join("")}
    <div class="navsep"></div>
    <a class="navbtn" href="${api("/legacy")}">${icon("more")}<span>CLASSIC</span></a>
    <div class="navfoot" id="navfoot"></div>
  </nav>
  <main class="main" id="main" tabindex="-1"></main>
</div>
<nav class="bottomnav" aria-label="Main">
  ${MOBILE.map((id) => { const r = ROUTES.find((x) => x.id === id); return `<button data-page="${r.id}" data-hash="${r.hash}">${icon(r.icon)}<span>${r.label}</span></button>`; }).join("")}
  <button data-page="more" id="morebtn" aria-haspopup="true">${icon("menu")}<span>MORE</span></button>
</nav>
<div class="scrim" id="scrim"></div>
<div class="sheet moresheet" id="moresheet" role="dialog" aria-label="More pages"><div class="grab"></div>
  <div class="stack">${ROUTES.filter((r) => !MOBILE.includes(r.id)).map((r) => `<button class="navbtn" data-page="${r.id}" data-hash="${r.hash}">${icon(r.icon)}<span>${r.label}</span></button>`).join("")}
  <a class="navbtn" href="${api("/legacy")}">${icon("more")}<span>CLASSIC DASHBOARD</span></a></div>
</div>
<div class="sheet" id="insp" role="dialog" aria-label="Details"><div class="grab"></div><div id="inspbody"></div></div>`;
    drawLogo($("#brandlogo"));
    app.addEventListener("click", (e) => {
      const b = e.target.closest("[data-hash]");
      if (b) { e.preventDefault(); go(b.dataset.hash); return; }
      if (e.target.closest("#morebtn")) { openSheet("moresheet"); return; }
      if (e.target.closest("#scrim")) closeSheet();
    });
    document.addEventListener("keydown", (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const i = "12345678".indexOf(e.key); if (i >= 0 && ROUTES[i]) go(ROUTES[i].hash);
      if (e.key === "Escape") closeSheet();
    });
    setInterval(tickClock, 1000); tickClock();
    store.subs.add(updateShell);
  }
  function openSheet(id, html) {
    if (html != null) $("#inspbody").innerHTML = html;
    $("#" + id).classList.add("open"); $("#scrim").classList.add("open");
  }
  function closeSheet() { $$(".sheet").forEach((s) => s.classList.remove("open")); const sc = $("#scrim"); if (sc) sc.classList.remove("open"); }
  function tickClock() { const c = $("#clock"); if (c) c.innerHTML = `${esc(jst())}<small>JST</small>`; }
  function updateShell() {
    const st = D("stats"), adze = D("adze"), h = (st || {}).hermes || {};
    const chips = [];
    const ts = (st || {}).tailscale || {};
    chips.push(["UPLINK", st ? "ok" : (store.err.stats ? "bad" : ""), st ? "ONLINE" : "…"]);
    chips.push(["GATEWAY", st ? (h.gateway_running ? "ok" : "bad") : "", st ? (h.gateway_running ? "UP" : "DOWN") : "…"]);
    chips.push(["ADZE", adze ? (adze.online ? "ok" : "bad") : "", adze ? (adze.online ? "ON" : "OFF") : "…"]);
    chips.push(["TAILNET", ts.state ? (/running/i.test(ts.state) ? "ok" : "warn") : "", ts.state ? String(ts.state).toUpperCase() : "—"]);
    const lm = store.mesh.mode;
    chips.push(["LINK", lm === "live" ? "ok" : lm === "poll" || lm === "reconnecting" ? "warn" : lm === "legacy" ? "warn" : "", lm === "live" ? "LIVE" : lm === "poll" ? "POLL" : lm === "legacy" ? "OLD API" : lm === "reconnecting" ? "RETRY" : "…"]);
    if (st && st.auth_open) chips.push(["AUTH", "warn", "OPEN"]);
    const c = $("#chips"); if (c) c.innerHTML = chips.map(([k, cls, v]) => `<span class="chip ${cls}"><i></i>${k} <b class="v">${esc(v)}</b></span>`).join("");
    const needs = needsList(), nb = $("#nb-home");
    if (nb && st) { nb.hidden = !needs.length; nb.textContent = needs.length; nb.classList.toggle("alert", needs.some((x) => x.sev === "high")); }
    const al = agentList(), nm = $("#nb-agents"); if (nm && al.length) { nm.hidden = false; nm.textContent = al.filter((a) => a.online && !["user", "telegram"].includes(a.id)).length + "/" + al.filter((a) => !["user", "telegram"].includes(a.id)).length; }
    const tr = D("trace"), nt = $("#nb-trace"); if (nt && tr) { nt.hidden = false; nt.textContent = tr.live ? "LIVE" : "IDLE"; nt.classList.toggle("alert", !!tr.live); }
    const ms = $("#nb-mesh"); if (ms) { const n = (store.mesh.unsupported ? talkItems() : store.mesh.events).filter((m) => m.t && Date.now() / 1000 - m.t < 3600).length; ms.hidden = !n; ms.textContent = n; }
    const f = $("#navfoot"); if (f) f.innerHTML = `<b>HOS://TKY-06</b><br>${st ? `scan ${esc(st.collect_ms)}ms · age ${esc(st.cache_age_s ?? 0)}s` : "connecting…"}<br>keys 1–8 switch pages`;
  }
  function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }

  /* ═════════ boot screen ═════════ */
  function boot(done) {
    const fast = SET.boot === "fast" || (SET.boot !== "off" && sessionStorage.getItem("helix.booted") === "1");
    if (SET.boot === "off") { done(); return; }
    const el = document.createElement("div");
    el.className = "boot"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Starting HELIX/OPS");
    el.innerHTML = `<button class="btn sm skip" id="bootskip">SKIP ▸</button>
      <div class="inner">
        <canvas id="bootlogo" width="160" height="160"></canvas>
        <div><div class="title">HELIX<span>/</span>OPS</div><div class="tag2" style="margin-top:10px">HERMES COMMAND FLOOR · TOKYO-06</div></div>
        <div class="post" id="post" aria-live="polite"></div>
        <div class="prog" id="prog">${"<i></i>".repeat(24)}</div>
        <button class="start" id="bootstart" hidden>▶ PRESS START</button>
        <div class="credit">© HΞL-01 · CREDIT 01 · ${esc(new Date().getFullYear())}</div>
      </div>`;
    document.body.appendChild(el);
    const logo = $("#bootlogo", el), post = $("#post", el), prog = $$("#prog i", el);
    let finished = false;
    const finish = () => {
      if (finished) return; finished = true;
      sessionStorage.setItem("helix.booted", "1");
      bleep(1320, 0.12); el.classList.add("out"); setTimeout(() => el.remove(), 520); done();
    };
    $("#bootskip", el).addEventListener("click", finish);
    $("#bootstart", el).addEventListener("click", finish);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") finish(); });
    let lp = 0; const lt = setInterval(() => { lp = Math.min(1, lp + (fast ? 0.2 : 0.05)); drawLogo(logo, lp); if (lp >= 1) clearInterval(lt); }, 50);
    const setProg = (f) => prog.forEach((p, i) => p.classList.toggle("on", i < Math.round(f * prog.length)));
    const line = (txt, cls) => { const d = document.createElement("div"); d.innerHTML = txt + (cls ? ` <span class="${cls}">${cls === "ok" ? "OK" : cls === "warn" ? "SLOW" : "FAIL"}</span>` : ""); post.appendChild(d); post.scrollTop = 1e6; bleep(cls === "bad" ? 220 : 520, 0.03); return d; };
    const checks = [
      ["UPLINK", "/health"], ["FLEET SCAN", "/api/compute"], ["AGENT ROSTER", "/api/agents"], ["COMMS BUS", "/api/talk"],
      ["COGNITIVE TRACE", "/api/trace?agent=helix"], ["ANALYSIS CORE", "/api/adze"], ["SYSTEM SNAPSHOT", "/api/stats"],
    ];
    (async () => {
      line("HELIX/OPS BIOS v5 · ARCADE BOARD");
      line("MEM CHECK " + (navigator.deviceMemory ? navigator.deviceMemory + "GB" : "OK") + " · " + (matchMedia("(max-width: 900px)").matches ? "FIELD UNIT" : "COMMAND DECK"));
      let i = 0;
      for (const [name, path] of checks) {
        const d = line(`${name.padEnd(16, ".")}`);
        const t0 = performance.now();
        let cls = "ok";
        try {
          const data = await Promise.race([fetchJSON(path, 25000), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), fast ? 1500 : 6000))]);
          const key = Object.keys(POLL).find((k) => POLL[k].path.split("?")[0] === path.split("?")[0]);
          if (key) ingest(key, data);
          if (performance.now() - t0 > 3000) cls = "warn";
        } catch (e) { cls = e.message === "slow" ? "warn" : "bad"; }
        d.innerHTML = `${esc(name.padEnd(16, "."))} <span class="${cls}">${cls === "ok" ? "OK" : cls === "warn" ? "WAIT" : "FAIL"}</span>`;
        i++; setProg(i / checks.length);
        if (finished) return;
      }
      const ag = agentList().filter((a) => !["user", "telegram"].includes(a.id));
      if (ag.length) line(`AGENTS ON FLOOR ... <span class="ok">${ag.filter((a) => a.online).length}/${ag.length}</span>`);
      const tk = talkItems().length; line(`MESSAGES ON BUS ... <span class="ok">${tk}</span>`);
      if (fast) { setTimeout(finish, 350); return; }
      $("#bootstart", el).hidden = false; $("#bootstart", el).focus();
      setTimeout(finish, 2600);
    })();
  }

  /* ═════════ start ═════════ */
  function start() {
    applySet();
    shell();
    window.addEventListener("hashchange", route);
    boot(() => {});
    startPolling();
    route();
  }

  G.Helix = { api, esc, $, $$, clamp, num, trunc, ago, fmtBytes, jst, clockOf, NT, SET, saveSet, bleep, META, meta, ORDER, sprite, spriteURL, drawSprite, drawLogo, icon, store, D, load, needsList, agentList, talkItems, go, openSheet, closeSheet, toast, fetchJSON, start };
})(window);
