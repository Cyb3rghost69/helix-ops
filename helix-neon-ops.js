(function () {
  const ACCENT = {
    helix: "#ff2bd6", prefect: "#00e5ff", foreman: "#ffb000", canon: "#39ff88",
    scribe: "#b44cff", adze: "#ff5533", honcho: "#66aaff", unraid: "#39ff88",
    ecc: "#ffe600", umbrel: "#ff8ad8"
  };
  function p() {
    return (typeof OPS === "string") ? OPS : ((location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  }
  function motion() {
    return (document.body.getAttribute("data-hx-motion") || "enhanced");
  }
  async function get(path) {
    const r = await fetch(p() + path, { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }
  const cache = { t: 0, agents: [], ecc: null, jobs: null, btop: null, ctx: null, matrix: null, events: [], medic: null, compute: null, adze: null, hermes: null };
  let timer = 0;
  let raf = 0;
  let pulses = [];
  let selected = null;
  let roomBots = [];

  function fmt(n) {
    if (n == null || n !== n) return "—";
    if (typeof n === "number") return (Math.abs(n) >= 1000) ? n.toLocaleString() : String(n);
    return String(n);
  }
  function botState(a) {
    if (!a) return "unknown";
    if (a.online === false && a.status === "dark") return "offline";
    if (a.status === "busy") return "working";
    if (a.status === "silent") return "idle";
    if (a.status === "idle" && a.online) return "idle";
    if (a.status === "error") return "error";
    if (a.online) return "idle";
    return "unknown";
  }
  function mergeBots() {
    const list = (cache.agents || []).map((a) => Object.assign({}, a));
    if (cache.ecc && cache.ecc.ok) {
      if (!list.some((x) => x.id === "ecc")) {
        list.push({
          id: "ecc", label: "ECC", host: "mac", kind: "profile", role: "silent harness",
          status: cache.ecc.cli ? "idle" : "dark", online: !!cache.ecc.cli,
          doing: cache.ecc.note, title: "ecc v" + (cache.ecc.version || "?")
        });
      }
    }
    if (cache.adze) {
      const ad = list.find((x) => x.id === "adze");
      if (ad) {
        ad.online = !!cache.adze.online;
        ad.status = cache.adze.online ? (cache.adze.last ? "busy" : "idle") : "dark";
        ad.model = cache.adze.model;
        ad.provider = cache.adze.provider;
      }
    }
    if (cache.compute) {
      const hx = list.find((x) => x.id === "helix");
      if (hx) {
        hx.model = cache.compute.active_model;
        hx.provider = cache.ctx && cache.ctx.provider;
        hx.doing = cache.compute.current_task || hx.doing;
      }
    }
    return list;
  }
  function drawCards() {
    const box = document.getElementById("hne-cards");
    if (!box) return;
    const bots = mergeBots();
    box.innerHTML = bots.map((a) => {
      const st = botState(a);
      const task = a.doing || a.title || a.role || "—";
      return `<button type="button" class="hne-card" data-bot="${esc(a.id)}" style="border-color:${ACCENT[a.id] || "#ff2bd6"}">
        <div class="id">${esc((a.label || a.id || "").toUpperCase())}</div>
        <div class="st">${esc(st.toUpperCase())} · ${esc(a.host || "—")}</div>
        <div class="task">${esc(task)}</div>
      </button>`;
    }).join("") || `<div class="dim">NO AGENT TELEMETRY</div>`;
  }
  function donut(canvas, parts, label) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width = canvas.clientWidth || 180;
    const h = canvas.height = 92;
    ctx.clearRect(0, 0, w, h);
    const total = parts.reduce((s, x) => s + (x.n || 0), 0);
    ctx.fillStyle = "#9aa";
    ctx.font = "11px ui-monospace,monospace";
    if (!total) {
      ctx.fillText(label + " · NO DATA", 8, 20);
      return;
    }
    let a0 = -Math.PI / 2;
    const cx = 46, cy = 46, r = 32;
    parts.forEach((p) => {
      const a1 = a0 + (p.n / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1);
      ctx.closePath();
      ctx.fillStyle = p.c;
      ctx.fill();
      a0 = a1;
    });
    ctx.fillStyle = "#fff6ff";
    ctx.fillText(label + " n=" + total, 90, 28);
    parts.forEach((p, i) => {
      ctx.fillStyle = p.c;
      ctx.fillText(p.k + " " + p.n, 90, 44 + i * 14);
    });
  }
  function drawActivity() {
    const c = document.getElementById("hne-activity");
    if (!c) return;
    const g = c.getContext("2d");
    const w = c.width = c.clientWidth || 600;
    const h = c.height = 88;
    g.fillStyle = "#08010c";
    g.fillRect(0, 0, w, h);
    const ev = cache.events || [];
    const now = Date.now();
    const span = 60 * 60 * 1000;
    const buckets = new Array(30).fill(0);
    ev.forEach((e) => {
      const t = Date.parse(e.t || e.time || "") || 0;
      if (!t || now - t > span) return;
      const i = Math.min(29, Math.floor(((t - (now - span)) / span) * 30));
      if (i >= 0) buckets[i] += 1;
    });
    const max = Math.max(1, ...buckets);
    g.strokeStyle = "#00e5ff";
    g.beginPath();
    buckets.forEach((n, i) => {
      const x = (i / 29) * (w - 8) + 4;
      const y = h - 16 - (n / max) * (h - 28);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.stroke();
    g.fillStyle = "#ff2bd6";
    g.font = "10px ui-monospace,monospace";
    g.fillText("EVENTS / 1H  ·  last update " + (cache.t ? new Date(cache.t).toLocaleTimeString() : "—") + "  ·  unit: events", 8, 12);
    g.fillStyle = "#888";
    g.fillText("AI activity (Hermes events). Not host CPU.", 8, h - 4);
  }
  function drawSupport() {
    const jobs = cache.jobs || {};
    const jlist = jobs.jobs || [];
    const counts = {
      running: (jobs.running || []).length,
      queued: (jobs.queued || []).length,
      waiting: (jobs.waiting_approval || []).length,
      done: (jobs.completed || []).length,
      fail: (jobs.failed || []).length
    };
    donut(document.getElementById("hne-donut-jobs"), [
      { k: "run", n: counts.running, c: "#00e5ff" },
      { k: "queue", n: counts.queued, c: "#ffb000" },
      { k: "wait", n: counts.waiting, c: "#ff2bd6" },
      { k: "ok", n: counts.done, c: "#39ff88" },
      { k: "fail", n: counts.fail, c: "#ff5533" }
    ], "JOBS");
    const banks = (cache.matrix && cache.matrix.banks) || [];
    donut(document.getElementById("hne-donut-mem"), banks.slice(0, 6).map((b, i) => ({
      k: b.id || ("M" + i), n: b.used || 0, c: ["#ff2bd6", "#00e5ff", "#39ff88", "#ffb000", "#b44cff", "#66aaff"][i]
    })), "MEM CHARS");
    const btop = cache.btop || {};
    const inf = document.getElementById("hne-infra");
    if (inf) {
      inf.innerHTML = `<div class="hne-row"><span>HOST CPU</span><b>${fmt(btop.used_pct)}%</b></div>
        <div class="hne-row"><span>HOST RAM</span><b>${fmt(btop.mem_used_gb)} / ${fmt(btop.mem_total_gb)} GB (${fmt(btop.mem_pct)}%)</b></div>
        <div class="hne-row"><span>CPUS (FLEET)</span><b>${fmt(btop.total_cpus)}</b></div>
        <div class="dim">Host resources. Not model tokens.</div>
        <div class="hne-row"><span>CONTAINERS</span><b>${cache.medic && cache.medic.counts ? esc(JSON.stringify(cache.medic.counts)) : (cache.medic && cache.medic.ok ? "medic ok" : "NO DATA")}</b></div>`;
    }
    const mem = document.getElementById("hne-memory");
    if (mem) {
      mem.innerHTML = banks.slice(0, 8).map((b) =>
        `<div class="hne-row"><span>${esc(b.id)} ${esc(b.name || "")}</span><b>${fmt(b.used)}/${fmt(b.limit)} ${esc(b.capacityType || "")}</b></div>`
      ).join("") || `<div class="dim">MEMORY STORE UNAVAILABLE</div>`;
    }
    const api = document.getElementById("hne-api");
    const ctx = cache.ctx || {};
    if (api) {
      api.innerHTML = ctx.ok
        ? `<div class="hne-row"><span>PROVIDER</span><b>${esc(ctx.provider)} / ${esc(ctx.model)}</b></div>
           <div class="hne-row"><span>API CALLS (lifetime)</span><b>${fmt(ctx.apiCalls)}</b></div>
           <div class="hne-row"><span>SESSION IN / OUT</span><b>${fmt(ctx.sessionInput)} / ${fmt(ctx.sessionOutput)}</b></div>
           <div class="dim">Token totals are session lifetime, not current window. Cost not metered here.</div>
           <div class="hne-row"><span>COMPUTE TARGET</span><b>${esc((cache.compute || {}).active_target)} · ${fmt((cache.compute || {}).avg_duration_ms)} ms avg</b></div>`
        : `<div class="dim">NO TOKEN TELEMETRY</div>`;
    }
    const log = document.getElementById("hne-log");
    if (log) {
      log.innerHTML = (cache.events || []).slice(-8).reverse().map((e) =>
        `<div class="hne-row"><span>${esc(e.t || "")}</span><b>${esc(e.kind || e.type || "")}</b></div>`
      ).join("") || `<div class="dim">NO EVENTS</div>`;
    }
    const mesh = document.getElementById("hne-mesh");
    if (mesh) {
      const bots = mergeBots();
      const w = 420, h = 220;
      const hx = { x: w / 2, y: h / 2 };
      const innerIds = ["user", "telegram", "honcho", "ecc"];
      const inner = bots.filter((a) => innerIds.indexOf(a.id) >= 0);
      const outer = bots.filter((a) => a.id !== "helix" && innerIds.indexOf(a.id) < 0);
      const place = (list, rx, ry, rot) => list.map((a, i) => {
        const ang = (i / Math.max(1, list.length)) * Math.PI * 2 + rot;
        return {
          id: a.id,
          x: hx.x + Math.cos(ang) * rx,
          y: hx.y + Math.sin(ang) * ry,
          c: ACCENT[a.id] || "#ff2bd6",
          on: a.online || a.status === "silent" || a.status === "idle" || a.status === "busy",
        };
      });
      const nodes = [{ id: "helix", x: hx.x, y: hx.y, c: ACCENT.helix || "#ff2bd6", on: true }]
        .concat(place(inner, 70, 48, -Math.PI / 2))
        .concat(place(outer, 160, 90, -Math.PI / 3));
      const lines = nodes.filter((n) => n.id !== "helix").map((n) =>
        `<line x1="${hx.x}" y1="${hx.y}" x2="${n.x}" y2="${n.y}" stroke="${n.on ? n.c : "#333"}" stroke-width="1" opacity="0.7"/>`
      ).join("");
      const extra = [];
      const by = {};
      nodes.forEach((n) => { by[n.id] = n; });
      [["prefect", "foreman"], ["canon", "scribe"], ["unraid", "honcho"], ["telegram", "user"]].forEach(([a, b]) => {
        if (by[a] && by[b]) extra.push(`<line x1="${by[a].x}" y1="${by[a].y}" x2="${by[b].x}" y2="${by[b].y}" stroke="#8866aa" stroke-width="1" opacity="0.45"/>`);
      });
      const dots = nodes.map((n) =>
        `<circle cx="${n.x}" cy="${n.y}" r="${n.id === "helix" ? 8 : 5}" fill="${n.on ? n.c : "#222"}" stroke="#ff2bd6"/><text x="${n.x + 8}" y="${n.y + 4}" fill="#fff6ff" font-size="9">${esc(n.id)}</text>`
      ).join("");
      mesh.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="bot mesh">${lines}${extra.join("")}${dots}</svg>`;
    }
    const q = document.getElementById("hne-jobs");
    if (q) {
      q.innerHTML = jlist.slice(0, 6).map((j) =>
        `<div class="hne-row"><span>${esc(j.status)}</span><b>${esc((j.task || "").slice(0, 48))}</b></div>`
      ).join("") || `<div class="dim">NO JOBS</div>`;
    }
    const lat = document.getElementById("hne-lat");
    if (lat) {
      const hs = cache.hermes || {};
      lat.innerHTML = `<div class="hne-row"><span>HERMES LATENCY</span><b>${hs.online ? fmt(hs.latency) + " ms" : "DISCONNECTED"}</b></div>
        <div class="hne-row"><span>QUEUE DEPTH</span><b>${fmt(counts.queued + counts.waiting)}</b></div>
        <div class="hne-row"><span>THROUGHPUT</span><b>${fmt((cache.compute && cache.compute.metrics && cache.compute.metrics.jobs_completed) || 0)} jobs done</b></div>
        <div class="dim">Latency is Hermes status ping. Throughput is COMPUTE jobs completed (not fabricated).</div>`;
    }
  }
  function openDrawer(id) {
    const a = mergeBots().find((x) => x.id === id);
    const d = document.getElementById("hne-drawer");
    if (!d) return;
    selected = id;
    if (!a) {
      d.hidden = false;
      d.innerHTML = `<h2>${esc(id)}</h2><p class="dim">UNKNOWN / DISCONNECTED</p><button type="button" id="hne-close">CLOSE</button>`;
      document.getElementById("hne-close").onclick = () => { d.hidden = true; };
      return;
    }
    const st = botState(a);
    const goto = { helix: "ops", ecc: "ecc", adze: "trace", unraid: "medic", honcho: "matrix" }[id] || "";
    d.hidden = false;
    d.innerHTML = `<h2>${esc((a.label || a.id).toUpperCase())}</h2>
      <div class="hne-row"><span>STATUS</span><b>${esc(st)}</b></div>
      <div class="hne-row"><span>HOST</span><b>${esc(a.host || "—")}</b></div>
      <div class="hne-row"><span>ROLE</span><b>${esc(a.role || "—")}</b></div>
      <div class="hne-row"><span>TASK</span><b>${esc(a.doing || a.title || "—")}</b></div>
      <div class="hne-row"><span>PROVIDER / MODEL</span><b>${esc(a.provider || "—")} / ${esc(a.model || "—")}</b></div>
      <p class="dim">${a.online ? "telemetry live" : "disconnected or silent"}</p>
      <div class="hx-bar">
        ${goto ? `<button type="button" data-go="${goto}">OPEN MODULE</button>` : ""}
        <button type="button" id="hne-close">CLOSE</button>
      </div>`;
    d.querySelector("#hne-close").onclick = () => { d.hidden = true; };
    const g = d.querySelector("[data-go]");
    if (g) g.onclick = () => { d.hidden = true; if (typeof selectTab === "function") selectTab(g.getAttribute("data-go")); };
  }
  function drawRoom(ts) {
    const c = document.getElementById("hne-room");
    if (!c) return;
    const ctx = c.getContext("2d");
    const w = c.width = c.clientWidth || 640;
    const h = c.height = c.clientHeight || 360;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#070010";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,43,214,0.12)";
    for (let x = 0; x < w; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.fillStyle = "#1a0820";
    ctx.fillRect(24, h - 70, w - 48, 50);
    ctx.fillStyle = "#221028";
    ctx.fillRect(18, 18, 70, h - 100);
    ctx.fillStyle = "#00e5ff";
    for (let i = 0; i < 6; i++) ctx.fillRect(28, 28 + i * 28, 50, 16);
    const bots = mergeBots();
    roomBots = [];
    const n = Math.max(1, bots.length);
    bots.forEach((a, i) => {
      const x = 120 + (i % 5) * Math.floor((w - 160) / 5);
      const y = 70 + Math.floor(i / 5) * 110;
      const col = ACCENT[a.id] || "#ff2bd6";
      const st = botState(a);
      ctx.fillStyle = "#14081c";
      ctx.fillRect(x - 18, y + 28, 56, 22);
      ctx.strokeStyle = col;
      ctx.strokeRect(x - 18, y + 28, 56, 22);
      ctx.fillStyle = col;
      ctx.font = "9px ui-monospace,monospace";
      ctx.fillText((a.id || "").toUpperCase(), x - 16, y + 42);
      let bob = 0;
      if (motion() !== "off" && st === "idle") bob = Math.sin((ts || 0) / 240 + i) * 2;
      if (st === "working" && motion() !== "off") bob = ((Math.floor((ts || 0) / 120) + i) % 2);
      ctx.fillStyle = st === "offline" || st === "unknown" ? "#333" : col;
      ctx.fillRect(x + 6, y - 2 + bob, 12, 12);
      ctx.fillRect(x + 4, y + 10 + bob, 16, 16);
      if (st === "error") {
        ctx.fillStyle = "#ff5533";
        ctx.fillRect(x + 8, y - 14, 8, 8);
      }
      if (st === "working") {
        ctx.fillStyle = "#00e5ff";
        ctx.fillRect(x + 28, y, 18, 12);
      }
      roomBots.push({ id: a.id, x, y, w: 56, h: 50 });
    });
    pulses = pulses.filter((p) => (ts - p.t) < 900);
    pulses.forEach((p) => {
      const a = roomBots.find((b) => b.id === p.from) || roomBots[0];
      const b = roomBots.find((x) => x.id === p.to) || roomBots[1];
      if (!a || !b) return;
      const k = (ts - p.t) / 900;
      ctx.fillStyle = "#00e5ff";
      ctx.fillRect(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 6, 6);
    });
    ctx.fillStyle = "#ff2bd6";
    ctx.font = "11px ui-monospace,monospace";
    ctx.fillText("HELIX OPS  ·  COMMAND FLOOR", 24, 16);
  }
  function tick(ts) {
    drawRoom(ts);
    if (motion() !== "off" && !document.hidden) raf = requestAnimationFrame(tick);
  }
  function startAnim() {
    cancelAnimationFrame(raf);
    if (motion() === "off") { drawRoom(0); return; }
    raf = requestAnimationFrame(tick);
  }
  async function load() {
    const results = await Promise.allSettled([
      get("/api/agents"), get("/api/ecc"), get("/api/compute/jobs"), get("/api/btop"),
      get("/api/ctx"), get("/api/matrix"), get("/api/events"), get("/api/medic"),
      get("/api/compute/status"), get("/api/adze"), get("/api/hermes/status")
    ]);
    const [ag, ecc, jobs, btop, ctx, mx, ev, medic, cs, adze, hs] = results.map((r) => r.status === "fulfilled" ? r.value : null);
    cache.t = Date.now();
    cache.agents = (ag && ag.agents) || [];
    cache.ecc = ecc;
    cache.jobs = jobs;
    cache.btop = btop;
    cache.ctx = ctx;
    cache.matrix = mx;
    cache.events = (ev && ev.events) || [];
    cache.medic = medic;
    cache.compute = cs;
    cache.adze = adze;
    cache.hermes = hs;
    const conn = document.getElementById("hne-conn");
    if (conn) conn.textContent = (hs && hs.online) ? "LINK UP" : "LINK DOWN";
    const clk = document.getElementById("hne-clock");
    if (clk) clk.textContent = new Date().toLocaleTimeString();
    const al = document.getElementById("hne-alerts");
    const wait = ((jobs && jobs.waiting_approval) || []).length;
    if (al) al.textContent = wait ? ("ATTN " + wait) : "ATTN 00";
    drawCards();
    drawSupport();
    drawActivity();
    if (cache.events.length) {
      const last = cache.events[cache.events.length - 1];
      if (last && last.kind) pulses.push({ t: performance.now(), from: "helix", to: last.capability && String(last.capability).includes("home") ? "helix" : "honcho" });
    }
  }
  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    const el = document.getElementById("hne-boot");
    if (!el) { load(); startAnim(); return; }
    const skip = localStorage.getItem("helix_ops_skip_boot") === "1" || motion() === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    load();
    if (skip) { el.hidden = true; startAnim(); return; }
    el.hidden = false;
    const lines = [
      "HELIX OPS",
      "MOUNTING FLOOR…",
      "LINK CHECK IN FLIGHT",
      "WORKSTATIONS"
    ];
    const pre = el.querySelector("pre");
    let i = 0;
    const id = setInterval(() => {
      if (pre && i < lines.length) pre.textContent += lines[i++] + "\n";
      if (i >= lines.length) {
        clearInterval(id);
        setTimeout(() => { el.hidden = true; startAnim(); }, motion() === "reduced" ? 200 : 700);
      }
    }, motion() === "reduced" ? 40 : 180);
  }
  function bind() {
    document.getElementById("hne-cards")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-bot]");
      if (b) openDrawer(b.getAttribute("data-bot"));
    });
    document.getElementById("hne-room")?.addEventListener("click", (e) => {
      const c = e.currentTarget;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const hit = roomBots.find((b) => x >= b.x - 18 && x <= b.x + 40 && y >= b.y - 8 && y <= b.y + 50);
      if (hit) openDrawer(hit.id);
    });
    document.getElementById("hne-skip")?.addEventListener("click", () => {
      localStorage.setItem("helix_ops_skip_boot", "1");
      const el = document.getElementById("hne-boot");
      if (el) el.hidden = true;
      startAnim();
    });
    document.getElementById("hne-theme")?.addEventListener("click", () => {
      if (globalThis.HelixTheme) HelixTheme.applyTheme("neon-ops");
    });
    document.addEventListener("helix-theme", (ev) => {
      if (ev.detail && ev.detail.theme === "neon-ops" && typeof selectTab === "function") selectTab("floor");
    });
    document.addEventListener("helix-motion", () => startAnim());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else startAnim();
    });
  }
  function poll() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (document.hidden) return;
      const pane = document.getElementById("pane-floor");
      if (pane && pane.hidden) return;
      load().catch(() => {});
    }, 8000);
  }
  function mount() {
    bind();
    poll();
  }
  globalThis.HelixNeonOps = { load: function () { load().then(() => startAnim()); }, mount, openDrawer, boot };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
