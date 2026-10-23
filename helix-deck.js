/* HELIX/OPS — COMMAND DECK.
   Desktop instrument grid for [01] OPERATIONS + Field Terminal focus card.
   Real telemetry only: every value comes from an existing /api/* field; missing → NO TELEMETRY / "—".
   History (sparklines, fleet chart) is collected client-side from the live polls since page load. No secrets. */
(function (global) {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = (p) => {
    const OPS = (typeof global.OPS === "string") ? global.OPS : ((location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "");
    return OPS + p;
  };
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v) => (typeof v === "number" && isFinite(v)) ? v : null;
  const NT = '<span class="dk-dimt">NO TELEMETRY</span>';

  // Two palettes: CRT (default, docs/DESIGN-SYSTEM.md) and ARCADE (opt-in theme, helix-arcade.*).
  const CRT = { ok: "#7CFF7A", soft: "#B8FFB0", bright: "#E8FFE2", gold: "#d4a017", bad: "#e86a5a", dim: "#9aa391", idle: "#4d6b4c", deep: "#3f9a46", cream: "#d6d4c8", cyan: "#6aa8a8", track: "#1a241a", wire: "#2a3a2a", void: "#060705" };
  const ARC = { ok: "#39e58c", soft: "#8ff5c0", bright: "#ffffff", gold: "#f59e0b", bad: "#ff4d6d", dim: "#a19bb0", idle: "#3a3446", deep: "#3b82f6", cream: "#e9e4f2", cyan: "#22d3ee", track: "#241f2e", wire: "#2e2839", void: "#0d0b12" };
  const C = Object.assign({}, CRT);
  const HOST_CRT = [CRT.ok, CRT.deep, CRT.cream, CRT.cyan, CRT.soft, "#7d8574"];
  const HOST_ARC = ["#39e58c", "#3b82f6", "#ff4fa3", "#f59e0b", "#22d3ee", "#ef4444"];
  const isArcade = () => document.body.classList.contains("theme-arcade");
  const hostColors = () => (isArcade() ? HOST_ARC : HOST_CRT);
  function applyPalette() { Object.assign(C, isArcade() ? ARC : CRT); }
  const listeners = [];
  function emit() { listeners.forEach((f) => { try { f(S); } catch (e) {} }); }
  const SEV_RANK = { high: 0, med: 1, warn: 2, low: 3 };

  const S = {
    stats: null, compute: null,
    hist: [], histMax: 300, lastHistT: 0, peak: null,
    net: { last: null, rates: [] },
    nodesHist: [],
    trace: null, docker: null, clients: null, remote: null, git: null, matrix: null, adze: null,
    sel: "helix", picked: false, on: true, focus: "cpu", mounted: false,
  };

  /* ───────────── SVG builders ───────────── */
  function ring(pct, color, label) {
    const r = 30, circ = 2 * Math.PI * r;
    const p = num(pct);
    const dash = p == null ? 0 : clamp(p, 0, 100) / 100 * circ;
    const txt = p == null ? "—" : Math.round(p) + "%";
    return `<svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label="${esc(label)} ${esc(txt)}">
      <circle cx="38" cy="38" r="${r}" fill="none" stroke="${C.track}" stroke-width="6"/>
      <circle cx="38" cy="38" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 38 38)"/>
      <text x="38" y="43" text-anchor="middle" fill="${C.bright}" font-size="15" font-family="ui-monospace, Menlo, monospace">${txt}</text>
    </svg>`;
  }
  function path(vals, w, h, max) {
    if (!vals.length) return "";
    const m = max || Math.max(1, ...vals);
    const step = vals.length > 1 ? w / (vals.length - 1) : w;
    return vals.map((v, i) => (i ? "L" : "M") + (i * step).toFixed(1) + " " + (h - clamp(v / m, 0, 1) * (h - 2) - 1).toFixed(1)).join(" ");
  }
  function spark(vals, w, h, label, max) {
    if (vals.length < 2) return `<div class="dk-sub" style="height:${h}px;display:flex;align-items:center">sampling_</div>`;
    const d = path(vals, w, h, max);
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px" role="img" aria-label="${esc(label)}">
      <path d="${d} L${w} ${h} L0 ${h} Z" fill="rgba(124,255,122,.12)"/><path d="${d}" fill="none" stroke="${C.ok}" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>`;
  }

  /* ───────────── helpers ───────────── */
  function parseKanban(txt) {
    const out = {};
    String(txt || "").split(/\n/).forEach((ln) => {
      const m = ln.match(/^\s*([a-z_ -]+?)\s*[:\s]\s*(\d+)\s*$/i);
      if (m) out[m[1].trim().toLowerCase()] = parseInt(m[2], 10);
    });
    return out;
  }
  function clockSec(t) {
    const m = String(t || "").match(/(\d{1,2}):(\d{2}):(\d{2})/);
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : null;
  }
  function fmtBytes(b) {
    const n = num(b);
    if (n == null) return "—";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  }
  function needsList() {
    const d = S.stats || {};
    const items = [];
    (d.actions || []).forEach((a) => items.push({
      sev: String(a.priority || "low").toLowerCase(), title: a.title || a.kind || "action", src: [a.source, a.detail].filter(Boolean).join(" · "),
    }));
    ((d.security || {}).findings || []).forEach((f) => {
      const lv = String(f.level || "").toLowerCase();
      if (lv && lv !== "ok") items.push({ sev: lv, title: f.title || "finding", src: "HARDENING · " + (f.detail || "") });
    });
    items.forEach((x) => { if (!(x.sev in SEV_RANK)) x.sev = "low"; });
    items.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);
    return items;
  }
  function active() {
    if (!S.on || document.hidden) return false;
    if (document.body.classList.contains("field-term")) return false;
    const pane = $("pane-ops");
    return !!pane && !pane.hidden;
  }
  async function getJSON(p) {
    const r = await fetch(api(p), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  function jumpTab(tab) { document.querySelector(`#tabs [data-tab="${tab}"]`)?.click(); }

  /* ───────────── skeleton ───────────── */
  function skeleton() {
    return `
<div class="dk-grid" aria-label="Instruments">
  <div class="dk-pn dk-s2 dk-tile ring" id="dk-cpu"></div>
  <div class="dk-pn dk-s2 dk-tile ring" id="dk-mem"></div>
  <div class="dk-pn dk-s2 dk-tile" id="dk-net"></div>
  <div class="dk-pn dk-s2 dk-tile" id="dk-mesh"></div>
  <div class="dk-pn dk-s2 dk-tile" id="dk-hard"></div>
  <div class="dk-pn dk-s2 dk-tile alert" id="dk-alerts"></div>
</div>

<div class="dk-grid">
  <section class="dk-pn dk-s12 dk-chart" aria-label="Fleet compute">
    <div class="dk-hd"><span>FLEET // COMPUTE</span><small id="dk-fleet-sub">since page load</small></div>
    <div class="dk-bd" id="dk-fleet"><div class="dk-empty">sampling_</div></div>
  </section>
</div>

<div class="dk-grid">
  <section class="dk-pn dk-s8" aria-label="Botmesh topology">
    <div class="dk-hd"><span>BOTMESH // NETWORK CONTROL</span><small>live topology · 接続網</small></div>
    <div class="dk-topo">
      <div class="dk-topo-map" id="dk-topo-map"><div class="dk-empty">scanning mesh_</div></div>
      <div class="dk-topo-side">
        <div class="dk-nodes" id="dk-nodes" role="list"></div>
        <div class="dk-inspect" id="dk-inspect"></div>
      </div>
    </div>
  </section>
  <div class="dk-col dk-s4">
    <section class="dk-pn" aria-label="Hermes cognitive core">
      <div class="dk-hd"><span>HERMES // COGNITIVE CORE</span><small>人工知能演算核</small></div>
      <div class="dk-bd" id="dk-hermes"><div class="dk-empty">scanning_</div></div>
    </section>
    <section class="dk-pn" aria-label="ADZE analysis core">
      <div class="dk-hd"><span>ADZE // ANALYSIS CORE</span><small>silent critic</small></div>
      <div class="dk-bd" id="dk-adze"><div class="dk-empty">scanning_</div></div>
    </section>
  </div>
</div>

<div class="dk-grid">
  <section class="dk-pn dk-s4 alert" aria-label="Needs you">
    <div class="dk-hd"><span>NEEDS YOU</span><small>要対応</small></div>
    <div class="dk-needs" id="dk-needs"><div class="dk-bd dk-empty">scanning_</div></div>
  </section>
  <section class="dk-pn dk-s4" aria-label="Agent cognitive trace">
    <div class="dk-hd"><span>AGENT COGNITIVE TRACE</span><small>observable events only</small></div>
    <div class="dk-bd" id="dk-trace"><div class="dk-empty">scanning trace_</div></div>
  </section>
  <section class="dk-pn dk-s4" aria-label="Hardening findings">
    <div class="dk-hd"><span>hardening.py</span><small>security.findings</small></div>
    <div class="dk-bd" id="dk-hardpy"><div class="dk-empty">scanning_</div></div>
  </section>
</div>

<div class="dk-grid">
  <section class="dk-pn dk-s7" aria-label="Service matrix">
    <div class="dk-hd"><span>SERVICE MATRIX // DOCKER</span><small id="dk-dock-sub">unraid</small></div>
    <div id="dk-dock"><div class="dk-bd dk-empty">scanning docker_</div></div>
  </section>
  <section class="dk-pn dk-s5" aria-label="Remote matrix">
    <div class="dk-hd"><span>REMOTE MATRIX // RUSTDESK</span><small>遠隔端末 · OSS</small></div>
    <div class="dk-bd" id="dk-remote"><div class="dk-empty">scanning remote_</div></div>
  </section>
</div>

<div class="dk-grid">
  <section class="dk-pn dk-s6" aria-label="LAN clients">
    <div class="dk-hd"><span>NETWORK PULSE // LAN</span><small id="dk-lan-sub">clients by owner</small></div>
    <div class="dk-bd" id="dk-lan"><div class="dk-empty">scanning LAN_</div></div>
  </section>
  <div class="dk-col dk-s3">
    <section class="dk-pn" aria-label="Source control">
      <div class="dk-hd"><span>SOURCE CONTROL</span><small>git</small></div>
      <div class="dk-bd" id="dk-git"><div class="dk-empty">scanning git_</div></div>
    </section>
  </div>
  <div class="dk-col dk-s3">
    <section class="dk-pn" aria-label="Memory matrix">
      <div class="dk-hd"><span>MEMORY MATRIX</span><small>記憶演算</small></div>
      <div class="dk-bd" id="dk-mem-banks"><div class="dk-empty">scanning memory_</div></div>
    </section>
  </div>
</div>`;
  }

  /* ───────────── instruments ───────────── */
  function renderTiles() {
    const c = S.compute || {};
    const d = S.stats || {};
    const hosts = (c.hosts || []).filter((h) => h.online);
    const cpu = num(c.used_pct);
    if ($("dk-cpu")) $("dk-cpu").innerHTML = ring(cpu, C.ok, "Fleet CPU") +
      `<div><div class="dk-k">FLEET CPU</div><div class="dk-v">${hosts.length || "—"} host${hosts.length === 1 ? "" : "s"} · ${esc(c.total_cpus ?? "—")} cpu</div>
       <div class="dk-sub">load ${esc(c.total_load ?? "—")}${S.peak != null ? ` · peak ${Math.round(S.peak)}%` : ""}</div></div>`;

    const mu = num(c.mem_used_gb), mt = num(c.mem_total_gb);
    const mp = mu != null && mt ? mu / mt * 100 : null;
    if ($("dk-mem")) $("dk-mem").innerHTML = ring(mp, C.soft, "Memory") +
      `<div><div class="dk-k">MEMORY</div><div class="dk-v">${mu != null && mt ? `${mu} / ${mt} GB` : "—"}</div>
       <div class="dk-sub">hermes procs ${esc(c.hermes_procs ?? "—")}</div></div>`;

    const rates = S.net.rates;
    const last = rates.length ? rates[rates.length - 1] : null;
    const ifn = (d.network || {}).egress_iface || "en0";
    if ($("dk-net")) $("dk-net").innerHTML =
      `<div style="display:flex;justify-content:space-between"><span class="dk-k">NETWORK · ${esc(ifn)}</span><span class="dk-ok" style="font-size:11px">${d.network ? "● UP" : ""}</span></div>
       <div class="dk-big">${last ? (last.rx + last.tx).toFixed(1) : "—"}<small> Mb/s</small></div>
       ${spark(rates.map((r) => r.rx + r.tx), 200, 34, "Network throughput history")}
       <div class="dk-sub">${last ? `↓ ${last.rx.toFixed(1)} · ↑ ${last.tx.toFixed(1)}` : "sampling between scans_"}</div>`;

    const nodes = ((d.bot_mesh || {}).nodes) || [];
    const on = nodes.filter((n) => n.online).length;
    if ($("dk-mesh")) $("dk-mesh").innerHTML = nodes.length
      ? `<span class="dk-k">BOTMESH NODES</span><div class="dk-big">${on}<small> / ${nodes.length} online</small></div>
         <div class="dk-segs" aria-hidden="true">${nodes.map((n) => `<i class="${n.online ? "on" : "off"}" title="${esc(n.label)}"></i>`).join("")}</div>
         <div class="dk-legend"><span><span class="dk-ok">■</span> ${on} ONLINE</span><span><span class="dk-bad">□</span> ${nodes.length - on} OFF</span></div>`
      : `<span class="dk-k">BOTMESH NODES</span><div class="dk-big">—</div>${NT}`;

    const sec = d.security || {};
    const bad = (sec.findings || []).filter((f) => f.level && f.level !== "ok");
    const score = num(sec.score);
    if ($("dk-hard")) $("dk-hard").innerHTML =
      `<span class="dk-k">HARDENING</span><div class="dk-big">${score ?? "—"}<small> / 100</small></div>
       <div class="dk-meter" role="img" aria-label="Hardening score ${score ?? "unknown"}"><i style="width:${score ?? 0}%"></i></div>
       <div class="dk-sub ${bad.length ? "dk-gold" : ""}">${bad.length ? `${bad.length} finding${bad.length > 1 ? "s" : ""} · ${esc(bad[0].title)}` : (d.security ? "no open findings" : "")}</div>`;

    const items = needsList();
    const cnt = (k) => items.filter((x) => x.sev === k).length;
    const parts = [["high", C.bad], ["med", C.gold], ["warn", C.gold], ["low", C.idle]].map(([k, col]) => ({ k, col, n: cnt(k) })).filter((p) => p.n);
    if ($("dk-alerts")) $("dk-alerts").innerHTML =
      `<span class="dk-k dk-bad">NEEDS YOU</span><div class="dk-big">${S.stats ? items.length : "—"}<small> open</small></div>
       <div class="dk-split" aria-hidden="true">${parts.map((p) => `<i style="flex:${p.n};background:${p.col}"></i>`).join("") || `<i style="flex:1;background:${C.track}"></i>`}</div>
       <div class="dk-sub">${parts.map((p) => `${p.n} ${p.k}`).join(" · ") || (S.stats ? "all clear" : "")}</div>`;
  }

  /* ───────────── topology ───────────── */
  function layout(nodes) {
    const pos = {};
    const bots = [], right = [], misc = [];
    nodes.forEach((n) => {
      if (n.kind === "orchestra") pos[n.id] = [320, 150];
      else if (n.kind === "human") pos[n.id] = [50, 150];
      else if (n.kind === "channel") pos[n.id] = [175, 55];
      else if (n.kind === "bot") bots.push(n);
      else if (n.kind === "peer" || n.kind === "memory") right.push(n);
      else misc.push(n);
    });
    bots.forEach((n, i) => {
      const t = bots.length > 1 ? i / (bots.length - 1) : 0.5;
      pos[n.id] = [110 + t * 300, 262 - Math.sin(t * Math.PI) * 18];
    });
    const rslots = [[490, 55], [600, 110], [600, 200], [490, 255], [600, 30], [600, 280]];
    right.concat(misc).forEach((n, i) => { pos[n.id] = rslots[i % rslots.length]; });
    return pos;
  }
  function renderTopo() {
    const mesh = (S.stats || {}).bot_mesh || {};
    const nodes = mesh.nodes || [];
    const edges = mesh.edges || [];
    const map = $("dk-topo-map"), list = $("dk-nodes"), insp = $("dk-inspect");
    if (!map || !list || !insp) return;
    if (!nodes.length) { map.innerHTML = `<div class="dk-empty">${NT}</div>`; list.innerHTML = ""; insp.innerHTML = ""; return; }
    if (!nodes.some((n) => n.id === S.sel)) S.sel = nodes[0].id;
    const pos = layout(nodes);
    const byId = {}; nodes.forEach((n) => byId[n.id] = n);
    const lines = edges.filter((e) => pos[e.from] && pos[e.to]).map((e) => {
      const [x1, y1] = pos[e.from], [x2, y2] = pos[e.to];
      const hot = S.picked && (e.from === S.sel || e.to === S.sel);
      const col = hot ? C.gold : (e.live ? C.deep : C.wire);
      const dash = e.live ? "" : ` stroke-dasharray="4 4"`;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${hot ? 1.6 : 1}"${dash}/>`;
    }).join("");
    const marks = nodes.map((n) => {
      const [x, y] = pos[n.id];
      const big = n.kind === "orchestra" ? 16 : 11;
      const col = n.online ? C.ok : C.bad;
      const sel = S.picked && n.id === S.sel;
      return `<g>${sel ? `<rect x="${x - big / 2 - 5}" y="${y - big / 2 - 5}" width="${big + 10}" height="${big + 10}" fill="none" stroke="${C.gold}"/>` : ""}
        <rect x="${x - big / 2}" y="${y - big / 2}" width="${big}" height="${big}" fill="${n.online ? col : C.void}" stroke="${col}" stroke-width="1.2"/>
        <text x="${x}" y="${y + big / 2 + 14}" text-anchor="middle" fill="${sel ? C.bright : (n.online ? C.soft : C.dim)}" font-size="10" letter-spacing="1" font-family="ui-monospace, Menlo, monospace">${esc(String(n.label || n.id).toUpperCase())}</text></g>`;
    }).join("");
    const on = nodes.filter((n) => n.online).length;
    map.innerHTML = `<svg viewBox="0 0 650 300" role="img" aria-label="Botmesh topology, ${on} of ${nodes.length} nodes online">${lines}${marks}</svg>`;
    list.innerHTML = nodes.map((n) => `<button type="button" role="listitem" class="dk-node${n.id === S.sel ? " sel" : ""}" data-node="${esc(n.id)}">
        <span class="g" style="color:${n.online ? C.ok : C.bad}">${n.online ? "■" : "□"}</span><span class="nm">${esc(n.label || n.id)}</span><span class="st">${n.online ? "ONLINE" : "OFFLINE"}</span></button>`).join("");
    const s = byId[S.sel];
    const links = edges.filter((e) => e.from === s.id || e.to === s.id);
    insp.innerHTML = `<div class="dk-k">INSPECT</div><div class="ttl">${esc(s.label || s.id)}</div>
      <div class="dk-kv"><div><div class="dk-k">KIND</div><div class="dk-v">${esc(s.kind || "—")}</div></div><div><div class="dk-k">HOST</div><div class="dk-v">${esc(s.host || "—")}</div></div></div>
      ${links.slice(0, 5).map((e) => {
        const other = byId[e.from === s.id ? e.to : e.from];
        return `<div class="dk-sub"><span class="${e.live ? "dk-ok" : "dk-dimt"}">${e.live ? "━" : "┄"}</span> ${esc(e.label || "")} → ${esc(other ? other.label : "")}${e.weight ? ` · ${esc(e.weight)}` : ""}</div>`;
      }).join("")}`;
  }

  /* ───────────── hermes + adze ───────────── */
  function pipeChips() {
    const stages = ((S.trace || {}).stages) || {};
    const order = ["REQUEST", "INTERPRET", "PLAN", "TOOL", "OBSERVATION", "DECISION", "RESPONSE"];
    const keys = Object.keys(stages);
    const lastLit = [...order].reverse().find((k) => stages[k] || stages[k.toLowerCase()]);
    return `<div class="dk-pipe" role="img" aria-label="pipeline">${order.map((k) => {
      const on = !!(stages[k] || stages[k.toLowerCase()]);
      const cur = k === lastLit;
      return `<span class="${on ? "lit" : ""}${cur ? " cur" : ""}">${k}</span>`;
    }).join("")}${keys.length ? "" : ""}</div>`;
  }
  function renderHardPy() {
    const box = $("dk-hardpy");
    if (!box) return;
    const sec = (S.stats || {}).security;
    if (!sec) { box.innerHTML = `<div class="dk-empty">${NT}</div>`; return; }
    const snake = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "check";
    const rows = (sec.findings || []).map((f) => {
      const lv = String(f.level || "").toLowerCase();
      let val = "LOW", cls = "low";
      if (lv === "ok") { val = "PASS"; cls = "ok"; }
      else if (lv === "med" || lv === "warn") { val = "MED ✗"; cls = "med"; }
      else if (lv === "high") { val = "HIGH ✗"; cls = "high"; }
      return `<div class="row ${cls}"><span>${esc(snake(f.title))}</span><span>${val}</span></div>`;
    }).join("");
    const sc = num(sec.score);
    box.innerHTML = `<div class="dk-py"><div>score = ${sc != null ? sc : "—"} / 100</div><div>checks = {</div>${rows || `<div class="dk-empty">${NT}</div>`}<div>}</div></div>`;
  }
  function renderHermes() {
    const box = $("dk-hermes");
    if (!box) return;
    const h = (S.stats || {}).hermes;
    if (!h) { box.innerHTML = `<div class="dk-empty">${NT}</div>`; return; }
    const kb = parseKanban(h.kanban);
    const order = ["triage", "todo", "ready", "blocked", "running", "scheduled", "done"];
    const kcol = { triage: C.idle, todo: "#2f4a2f", ready: C.deep, blocked: C.bad, running: C.gold, scheduled: C.cyan, done: C.ok };
    const keys = order.filter((k) => kb[k] > 0);
    const kbar = keys.length
      ? `<div class="dk-kanban" role="img" aria-label="Kanban ${keys.map((k) => k + " " + kb[k]).join(", ")}">${keys.map((k) => `<i style="flex:${kb[k]};background:${kcol[k]};${k === "todo" || k === "triage" ? "color:" + C.bright : ""}">${kb[k]}</i>`).join("")}</div>
         <div class="dk-legend" style="margin-top:3px">${keys.map((k) => `<span><span style="color:${kcol[k]}">■</span> ${k.toUpperCase()}</span>`).join("")}</div>`
      : `<div class="dk-sub">no kanban telemetry</div>`;
    const kc = { REQUEST: C.soft, PLAN: C.cream, TOOL: C.gold, RESULT: C.ok, RESPONSE: C.bright, DELEGATE: C.cyan };
    const tl = ((S.trace || {}).timeline || []).slice(-5).reverse();
    const feed = tl.length
      ? tl.map((e) => `<div><span class="t">${esc(e.t || "")}</span><span class="kd" style="color:${kc[e.kind] || C.dim}">${esc(e.kind)}</span><span class="s">${esc(e.summary || e.label || "")}</span></div>`).join("")
      : `<div class="dk-dimt">no observable events yet_</div>`;
    const behind = num(h.commits_behind);
    box.innerHTML = `
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
        <div><div style="font-size:20px;letter-spacing:.06em" class="${h.gateway_running ? "dk-ok" : "dk-bad"}">${h.gateway_running ? "RUNNING" : "GATEWAY DOWN"}</div>
        <div class="dk-sub">${h.gateway_pid ? "pid " + esc(h.gateway_pid) + " · " : ""}${esc(h.version || "version —")}${behind ? ` · <span class="dk-gold">${behind} behind</span>` : ""}</div></div>
        <span style="border:1px solid #2f4a2f;padding:2px 8px;font-size:11px" class="dk-v">LEAD</span>
      </div>
      <div class="dk-kv" style="margin:10px 0">
        <div><div class="dk-k">MODEL</div><div class="dk-v">${esc(h.model || "—")}</div></div>
        <div><div class="dk-k">PROVIDER</div><div class="dk-v">${esc(h.provider || "—")}</div></div>
        <div><div class="dk-k">MEMORY</div><div class="dk-v">${esc(h.memory || "—")}</div></div>
        <div><div class="dk-k">CRON</div><div class="dk-v">${esc(h.cron_jobs ?? "—")} jobs</div></div>
      </div>
      ${pipeChips()}
      <div class="dk-k" style="margin-bottom:4px">KANBAN</div>${kbar}
      <div class="dk-feed" style="margin-top:10px">${feed}</div>`;
  }
  function renderAdze() {
    const box = $("dk-adze");
    if (!box) return;
    const a = S.adze;
    if (!a) { box.innerHTML = `<div class="dk-empty">${NT}</div>`; return; }
    const mode = String(a.mode || "").toLowerCase();
    const last = a.last || {};
    const st = a.online ? (last.state || "STANDBY") : "OPENAI PROVIDER UNAVAILABLE";
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="width:10px;height:10px;display:inline-block;${a.online ? "background:" + C.ok : "border:1px solid " + C.bad}"></span>
        <span class="${a.online ? "dk-ok" : "dk-bad"}" style="letter-spacing:.08em">${esc(st)}</span>
      </div>
      <div class="dk-modes" role="img" aria-label="ADZE mode ${esc(mode || "unknown")}">${["off", "auto", "always", "manual"].map((m) => `<span class="${m === mode ? "on" : ""}">${m.toUpperCase()}</span>`).join("")}</div>
      <div class="dk-sub" style="margin-top:8px">${a.online ? esc((a.model || "openai") + " · max 3 rounds · Hermes executes") : "Set OPENAI_API_KEY locally to bring ADZE online."}</div>`;
  }

  /* ───────────── fleet compute ───────────── */
  function pushCompute(c) {
    const now = Date.now();
    if (num(c.used_pct) != null) S.peak = S.peak == null ? c.used_pct : Math.max(S.peak, c.used_pct);
    if (now - S.lastHistT < 2000) return;
    S.lastHistT = now;
    const tc = c.total_cpus || 0;
    const share = {};
    (c.hosts || []).forEach((h) => { if (h.online && tc) share[h.id] = 100 * (Number(h.load1) || 0) / tc; });
    const mp = c.mem_total_gb ? 100 * (c.mem_used_gb || 0) / c.mem_total_gb : null;
    S.hist.push({ t: now, used: num(c.used_pct), share, names: Object.fromEntries((c.hosts || []).map((h) => [h.id, h.name || h.id])), mem: mp, ai: num(c.hermes_procs) });
    if (S.hist.length > S.histMax) S.hist.shift();
  }
  function renderFleet() {
    const box = $("dk-fleet");
    if (!box) return;
    const H = S.hist;
    if (H.length < 2) { box.innerHTML = `<div class="dk-empty">sampling_ (one point every 2s)</div>`; return; }
    const ids = [];
    H.forEach((p) => Object.keys(p.share).forEach((id) => { if (!ids.includes(id)) ids.push(id); }));
    const names = H[H.length - 1].names || {};
    const W = 760, Ht = 210, n = H.length;
    const top = Math.max(25, Math.ceil(Math.max(...H.map((p) => p.used || 0)) / 25) * 25);
    const x = (i) => (i * W / (n - 1)).toFixed(1);
    const y = (v) => (Ht - clamp(v / top, 0, 1) * Ht).toFixed(1);
    let lower = new Array(n).fill(0);
    const bands = ids.map((id, k) => {
      const upper = H.map((p, i) => lower[i] + (p.share[id] || 0));
      const topPts = upper.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join(" ");
      const botPts = lower.map((v, i) => [i, v]).reverse().map(([i, v]) => `L${x(i)} ${y(v)}`).join(" ");
      lower = upper;
      const col = hostColors()[k % hostColors().length];
      return `<path d="${topPts} ${botPts} Z" fill="${col}" fill-opacity=".45" stroke="${col}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    }).join("");
    const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${(Ht * f).toFixed(0)}" y2="${(Ht * f).toFixed(0)}" stroke="${C.track}" vector-effect="non-scaling-stroke"/>`).join("");
    const lastP = H[n - 1];
    if (isArcade()) {
      const W = 640, Ht = 160;
      const top = Math.max(25, Math.ceil(Math.max(...H.map((p) => p.used || 0), 1) / 25) * 25);
      const x = (i) => (i * W / Math.max(1, n - 1)).toFixed(1);
      const y = (v) => (Ht - clamp((v || 0) / top, 0, 1) * Ht).toFixed(1);
      const line = H.map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p.used)}`).join(" ");
      const area = `${line} L${x(n - 1)} ${Ht} L0 ${Ht} Z`;
      const c = S.compute || {};
      const hosts = (c.hosts || []).filter((h) => h.online);
      const peakT = S.peak != null ? H.reduce((a, p) => (p.used === S.peak ? p : a), H[0]) : null;
      let peakAt = "—";
      try { if (peakT) peakAt = new Date(peakT.t).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) {}
      const hostBars = hosts.map((h, k) => {
        const pct = num(h.used_pct) != null ? h.used_pct : (num(h.load1) != null && c.total_cpus ? 100 * h.load1 / c.total_cpus : null);
        const col = hostColors()[k % hostColors().length];
        return `<div class="dk-sub"><span style="color:${col}">■</span> ${esc((h.name || h.id || "").toUpperCase())} <b class="dk-v">${pct != null ? pct.toFixed(1) + "%" : "—"}</b>
          <div class="dk-meter"><i style="width:${pct != null ? Math.min(100, pct) : 0}%;background:${col}"></i></div></div>`;
      }).join("");
      if ($("dk-fleet-sub")) $("dk-fleet-sub").textContent = `last ${Math.max(1, Math.round((lastP.t - H[0].t) / 60000))} min · real samples`;
      box.innerHTML = `<div class="dk-fleet-split">
        <svg viewBox="0 0 ${W} ${Ht}" preserveAspectRatio="none" role="img" aria-label="Fleet CPU line with up and down bars">${volBars(H, W, Ht)}<path d="${area}" fill="${C.ok}" fill-opacity=".18"/><path d="${line}" fill="none" stroke="${C.ok}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
        <div><div class="dk-fleet-read">${lastP.used != null ? Math.round(lastP.used) + "%" : "—"}</div>
          <div class="dk-sub">peak ${S.peak != null ? Math.round(S.peak) + "%" : "—"} at ${esc(peakAt)} · ${hosts.length} hosts · ${esc(c.total_cpus ?? "—")} cpu</div>
          ${hostBars || `<div class="dk-empty">${NT}</div>`}</div></div>`;
      return;
    }
    const legend = ids.map((id, k) => `<span><span style="color:${hostColors()[k % hostColors().length]}">■</span> ${esc(String(names[id] || id).toUpperCase())} <b class="dk-v">${(lastP.share[id] || 0).toFixed(1)}%</b></span>`).join("");
    const mins = Math.max(1, Math.round((lastP.t - H[0].t) / 60000));
    if ($("dk-fleet-sub")) $("dk-fleet-sub").textContent = `last ${mins} min · share of fleet CPU · scale 0–${top}%`;
    box.innerHTML = `<div class="dk-legend" style="font-size:11px;color:${C.cream};margin-bottom:8px">${legend}<span style="margin-left:auto">FLEET <b class="dk-v">${(lastP.used ?? 0).toFixed(1)}%</b></span></div>
      <svg viewBox="0 0 ${W} ${Ht}" preserveAspectRatio="none" role="img" aria-label="Stacked CPU share per host, last ${mins} minutes">${grid}${bands}${isArcade() ? volBars(H, W, Ht) : ""}</svg>
      <div class="dk-axis"><span>−${mins}m</span><span>NOW</span></div>`;
  }

  // ARCADE: per-sample fleet CPU as bars along the floor (green = rising, pink = falling vs the previous sample)
  function volBars(H, W, Ht) {
    const n = H.length, bw = Math.min(8, Math.max(1, W / n - 2)), maxU = Math.max(1, ...H.map((p) => p.used || 0));
    return H.map((p, i) => {
      const prev = i ? (H[i - 1].used || 0) : (p.used || 0);
      const h = 4 + (p.used || 0) / maxU * Ht * 0.22;
      const col = (p.used || 0) >= prev ? C.ok : "#ff4fa3";
      return `<rect x="${(i * W / Math.max(1, n - 1) - bw / 2).toFixed(1)}" y="${(Ht - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${col}" fill-opacity=".55"/>`;
    }).join("");
  }

  /* ───────────── needs you ───────────── */
  function renderNeeds() {
    const box = $("dk-needs");
    if (!box) return;
    const items = needsList();
    box.innerHTML = items.length
      ? items.map((x) => `<div class="dk-need"><span class="sev ${x.sev}">${esc(x.sev.toUpperCase())}</span><div class="tx"><div class="tt">${esc(x.title)}</div><div class="sr" title="${esc(x.src)}">${esc(x.src)}</div></div></div>`).join("")
      : `<div class="dk-bd dk-ok">● nothing needs you</div>`;
  }

  /* ───────────── trace ───────────── */
  function renderTrace() {
    const box = $("dk-trace");
    if (!box) return;
    const t = S.trace;
    if (!t) { box.innerHTML = `<div class="dk-empty">${NT}</div>`; return; }
    const tl = t.timeline || [];
    let start = -1;
    for (let i = tl.length - 1; i >= 0; i--) if (tl[i].kind === "REQUEST") { start = i; break; }
    const run = start >= 0 ? tl.slice(start) : tl.slice(-12);
    const head = `<div style="display:flex;justify-content:space-between;gap:10px;font-size:11px;margin-bottom:8px">
        <span class="dk-v" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.objective || "—")}${t.source ? ` · ${esc(t.source)}` : ""}</span>
        <span class="${t.live ? "dk-gold" : "dk-ok"}" style="flex:none">${esc(t.live ? "LIVE · " + (t.stage || "") : (t.stage || "IDLE"))}${num(t.elapsed_s) != null ? ` · ${Math.round(t.elapsed_s)}s` : ""}</span></div>`;
    if (!run.length) { box.innerHTML = head + `<div class="dk-empty">${esc(t.hel_line || "no observable events")}</div>`; return; }
    let t0 = clockSec(run[0].t);
    const secs = run.map((e) => { let s = clockSec(e.t); if (s != null && t0 != null && s < t0) s += 86400; return s; });
    const valid = secs.filter((s) => s != null);
    if (t0 == null && valid.length) t0 = valid[0];
    const span0 = valid.length ? Math.max(...valid) - t0 : 0;
    const span = Math.max(5, Math.ceil((span0 + 1) / 5) * 5);
    const pc = (s) => clamp((s - t0) / span * 100, 0, 100);
    const lanes = { REQUEST: [], PLAN: [], TOOL: [], RESULT: [], RESPONSE: [] };
    const col = { REQUEST: C.soft, PLAN: C.cream, TOOL: C.gold, RESULT: C.ok, RESPONSE: C.bright };
    run.forEach((e, i) => {
      const s = secs[i];
      if (s == null) return;
      const k = e.kind === "DELEGATE" ? "TOOL" : e.kind;
      if (!lanes[k]) return;
      if (k === "RESULT") {
        const dur = num(((e.detail || {}).duration_s));
        const name = (e.detail || {}).tool || "";
        if (dur != null && dur > 0) lanes.TOOL.push({ l: pc(s - dur), w: Math.max(0.8, dur / span * 100), label: name });
        lanes.RESULT.push({ l: pc(s), w: 0.8, label: "" });
      } else if (k === "RESPONSE") {
        lanes.RESPONSE.push({ l: pc(s), w: Math.max(0.8, 100 - pc(s)) * (e.label === "COMPLETE" ? 0.06 : 1), label: e.label === "COMPLETE" ? "" : "streaming" });
      } else {
        lanes[k].push({ l: pc(s), w: 0.8, label: "" });
      }
    });
    const rows = Object.keys(lanes).map((k) => `<div class="dk-lane"><span class="dk-k nm">${k}</span><div class="tr">${lanes[k].map((b) =>
      `<i style="left:${b.l.toFixed(2)}%;width:${b.w.toFixed(2)}%;background:${col[k]}" title="${esc(b.label)}">${esc(b.label)}</i>`).join("")}</div></div>`).join("");
    const ticks = [0, 1, 2, 3, 4].map((i) => `<span>${Math.round(span * i / 4)}s</span>`).join("");
    const kc = { REQUEST: C.soft, PLAN: C.cream, TOOL: C.gold, RESULT: C.ok, RESPONSE: C.bright, DELEGATE: C.cyan };
    const log = run.slice(-4).map((e) => `<div><span class="dk-dimt">${esc(e.t || "")}</span> <span style="color:${kc[e.kind] || C.dim}">${esc(e.kind)}</span> ${esc(e.summary || e.label || "")}</div>`).join("");
    box.innerHTML = head + rows + `<div class="dk-taxis">${ticks}</div><div class="dk-tlog">${log}</div>
      <div style="margin-top:8px"><button type="button" class="dk-btn" data-jump="trace">OPEN [05] TRACE</button></div>`;
  }

  /* ───────────── docker ───────────── */
  function renderDocker() {
    const box = $("dk-dock");
    if (!box) return;
    const d = S.docker;
    if (!d) return;
    if (!d.ok) { box.innerHTML = `<div class="dk-bd dk-bad">${esc(d.error || "docker unavailable")}</div>`; if ($("dk-dock-sub")) $("dk-dock-sub").textContent = "unraid · NO TELEMETRY"; return; }
    const cs = d.containers || [];
    const up = cs.filter((c) => c.running).length;
    if ($("dk-dock-sub")) $("dk-dock-sub").textContent = `${d.host || "unraid"} · ${up} / ${cs.length} up`;
    box.innerHTML = `<div class="dk-dock">${cs.map((c) => `
      <div class="dk-ctr${c.running ? "" : " down"}">
        <div class="row"><span class="nm" title="${esc(c.name)}">${esc(c.name)}</span><span style="color:${c.running ? C.ok : C.bad};font-size:10px">${c.running ? "■" : "□"} ${esc(String(c.state || "").toUpperCase())}</span></div>
        <div class="meta" title="${esc(c.status)}">${esc(c.status || "—")}</div>
        <div class="meta" title="${esc(c.image)}">${esc(c.image || "")}</div>
        <div class="row"><span class="acts">${c.webui ? `<a class="dk-btn" href="${esc(c.webui)}" target="_blank" rel="noopener">OPEN</a>` : ""}</span>
          <button type="button" class="dk-btn" data-dk-act="${c.running ? "stop" : "start"}" data-dk-name="${esc(c.name)}">${c.running ? "STOP" : "START"}</button></div>
      </div>`).join("") || `<div class="dk-empty">no containers</div>`}</div>`;
  }

  /* ───────────── LAN ───────────── */
  function renderLan() {
    const box = $("dk-lan");
    if (!box) return;
    const d = S.clients;
    if (!d) return;
    const cs = d.clients || [];
    if ($("dk-lan-sub")) $("dk-lan-sub").textContent = `${cs.length} clients · ${d.unifi ? "UniFi + DHCP" : (d.need_key ? "DHCP only · no UniFi key" : "DHCP")}`;
    if (!cs.length) { box.innerHTML = `<div class="dk-empty">no leases with names</div>`; return; }
    const traffic = (c) => (Number(c.rx_mb) || 0) + (Number(c.tx_mb) || 0);
    const maxT = Math.max(1, ...cs.map(traffic));
    const hasT = cs.some((c) => c.rx_mb != null || c.tx_mb != null);
    const groups = {};
    cs.forEach((c) => { const o = c.owner || "unknown"; (groups[o] = groups[o] || []).push(c); });
    const keys = Object.keys(groups).sort((a, b) => (a === "unknown") - (b === "unknown") || groups[b].length - groups[a].length);
    box.innerHTML = `<div class="dk-lan-wrap">` + keys.map((o) => `<div class="dk-lan-group"><div class="gh"><span>${esc(o)}</span><span>${groups[o].length}</span></div>
      <div class="dk-lan-cells">${groups[o].map((c) => {
        const a = hasT ? 0.15 + 0.85 * Math.log1p(traffic(c)) / Math.log1p(maxT) : 0.6;
        const wifi = c.wired === false;
        const tip = `${c.name || c.hostname || "client"} · ${c.ip || ""}${hasT ? ` · ${(traffic(c)).toFixed(0)} MB` : ""}${wifi ? " · wifi" : (c.wired ? " · wired" : "")}`;
        return `<i class="${wifi ? "wifi" : ""}" title="${esc(tip)}" style="background:rgba(124,255,122,${a.toFixed(2)});${wifi ? `border-color:rgba(124,255,122,${a.toFixed(2)})` : ""}"></i>`;
      }).join("")}</div></div>`).join("") + `</div>` +
      `<div class="dk-legend" style="margin-top:6px"><span>■ wired</span><span>□ wifi</span><span>${hasT ? "brighter = more traffic" : "no traffic counters"}</span>
       <button type="button" class="dk-btn" style="margin-left:auto" data-jump="net">OPEN [02] NETWORK</button></div>`;
  }

  /* ───────────── remote ───────────── */
  function renderRemote() {
    const box = $("dk-remote");
    if (!box) return;
    const r = S.remote;
    if (!r) return;
    if (!r.ok) { box.innerHTML = `<div class="dk-bad">${esc(r.error || "remote unavailable")}</div>`; return; }
    const port = (lbl, p, dash) => `<div class="${dash ? "dash" : ""}"><div class="dk-k" style="font-size:9px">${lbl}</div><div style="color:${p && p.online ? C.ok : (dash ? C.dim : C.bad)}">${p && p.online ? "●" : "○"} ${esc(p ? p.port : "—")}</div></div>`;
    const devs = (r.devices || []).slice(0, 6);
    const cnt = r.counts || {};
    box.innerHTML = `<div class="dk-ports">${port("HBBS", r.hbbs)}${port("HBBR", r.hbbr)}${port("NAT", r.nat, true)}</div>
      <div class="dk-sub" style="margin-bottom:4px">${esc(cnt.online ?? 0)} online · ${esc(cnt.devices ?? 0)} known · sessions: no telemetry (OSS)</div>
      ${devs.map((d) => {
        const on = d.rustdesk_online === true || d.helix_online === true;
        const unk = d.rustdesk_online == null && d.helix_online == null;
        return `<div class="dk-peer"><span style="color:${on ? C.ok : C.dim}">${on ? "■" : (unk ? "◧" : "□")}</span>
          <div class="tx"><div class="dk-v">${esc(d.name || d.id)}</div><div class="meta">${esc(d.id)}${d.ip ? " · " + esc(d.ip) : ""}${d.platform ? " · " + esc(d.platform) : ""}</div></div>
          <a class="dk-btn" href="${esc(d.launch || "")}">CONNECT</a><button type="button" class="dk-btn" data-dk-copy="${esc(d.id)}">COPY ID</button></div>`;
      }).join("") || `<div class="dk-empty">no known peers</div>`}`;
  }

  /* ───────────── git + memory ───────────── */
  function renderGit() {
    const box = $("dk-git");
    if (!box) return;
    const g = S.git;
    if (!g) return;
    if (!g.ok) { box.innerHTML = `<div class="dk-dimt">${esc(g.error || "NO REPO")}</div>`; return; }
    const days = Array.isArray(g.days) ? g.days : [];
    const mx = Math.max(1, ...days);
    box.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px"><span class="dk-v">⎇ ${esc(g.branch || "—")}</span><span class="${g.clean ? "dk-ok" : "dk-gold"}">${g.clean ? "● clean" : esc(g.dirty) + " modified"}</span></div>
      <div class="dk-sub" style="margin:4px 0">${esc((g.head || "").toLowerCase())} · ${esc(g.subject || "")}</div>
      <div class="dk-sub" style="margin-bottom:6px">sync <span class="${g.sync === "UP TO DATE" ? "dk-ok" : "dk-gold"}">${esc(g.sync || "—")}</span></div>
      ${days.length ? `<div class="dk-strip" role="img" aria-label="Commits per day, last ${days.length} days">${days.map((n) => `<i style="${n ? `background:rgba(124,255,122,${(0.25 + 0.75 * n / mx).toFixed(2)})` : ""}" title="${n} commit${n === 1 ? "" : "s"}"></i>`).join("")}</div>
        <div class="dk-sub" style="font-size:10px;margin-top:3px">commits · last ${days.length} days</div>` : ""}`;
  }
  function renderBanks() {
    const box = $("dk-mem-banks");
    if (!box) return;
    const m = S.matrix;
    if (!m) return;
    const banks = m.banks || [];
    if (!banks.length) { box.innerHTML = `<div class="dk-empty">${NT}</div>`; return; }
    const maxB = Math.max(1, ...banks.map((b) => Number(b.bytes) || 0));
    box.innerHTML = banks.slice(0, 6).map((b) => {
      const u = num(b.utilization);
      const p = u != null ? clamp(u <= 1 ? u * 100 : u, 0, 100) : 100 * (Number(b.bytes) || 0) / maxB;
      const hot = (u != null && p > 70) || /WARNING|FULL|ADVISED|ELEVATED/.test(String(b.pressure || ""));
      const off = String(b.status || "").toUpperCase() !== "ONLINE";
      return `<div class="dk-bank"><div class="row"><span style="color:${off ? C.dim : C.cream}">${esc(b.name || b.id)}</span><span class="dk-dimt">${u != null ? Math.round(p) + "%" : fmtBytes(b.bytes)}</span></div>
        <div class="bar"><i class="${hot ? "hot" : ""}" style="width:${p.toFixed(1)}%"></i></div></div>`;
    }).join("") + `<button type="button" class="dk-btn" data-jump="matrix">OPEN [07] MEMORY</button>`;
  }

  /* ───────────── tab badges ───────────── */
  function badge(tab, text, alert) {
    const b = document.querySelector(`#tabs [data-tab="${tab}"]`);
    if (!b) return;
    let s = b.querySelector(".dk-badge");
    if (text == null || text === "") { if (s) s.remove(); return; }
    if (!s) { s = document.createElement("span"); s.className = "dk-badge"; b.appendChild(s); }
    s.textContent = text;
    s.classList.toggle("alert", !!alert);
  }
  function renderBadges() {
    const items = S.stats ? needsList() : null;
    if (items) badge("ops", String(items.length), items.some((x) => x.sev === "high"));
    if (S.clients) badge("net", String(S.clients.count ?? (S.clients.clients || []).length));
    const sec = (S.stats || {}).security;
    if (sec && sec.score != null) badge("sec", String(sec.score), sec.score < 70);
    if (S.docker && S.docker.ok) { const cs = S.docker.containers || []; const up = cs.filter((c) => c.running).length; badge("dock", `${up}/${cs.length}`, up < cs.length); }
    if (S.trace) badge("trace", S.trace.live ? "LIVE" : "IDLE");
    if (S.remote && S.remote.ok) badge("remote", String((S.remote.counts || {}).online ?? 0), !(S.remote.hbbs || {}).online || !(S.remote.hbbr || {}).online);
    if (S.matrix && S.matrix.banks) badge("matrix", String(S.matrix.bankCount ?? S.matrix.banks.length));
  }

  /* ───────────── Field Terminal focus card ───────────── */
  const FOCUS = ["cpu", "mem", "net", "ai", "nodes"];
  function renderFocus() {
    const box = $("ft-focus");
    if (!box || !document.body.classList.contains("field-term")) return;
    const f = S.focus;
    let k = "", big = "—", sub = "", vals = [], max;
    const c = S.compute || {};
    if (f === "cpu") { k = "FLEET CPU"; big = num(c.used_pct) != null ? Math.round(c.used_pct) + "%" : "—"; sub = `${(c.hosts || []).filter((h) => h.online).length} hosts${S.peak != null ? " · peak " + Math.round(S.peak) + "%" : ""}`; vals = S.hist.map((p) => p.used || 0); max = 100; }
    if (f === "mem") { k = "MEMORY"; big = c.mem_total_gb ? `${c.mem_used_gb} GB` : "—"; sub = c.mem_total_gb ? `of ${c.mem_total_gb} GB` : ""; vals = S.hist.map((p) => p.mem || 0); max = 100; }
    if (f === "net") { const r = S.net.rates; const l = r[r.length - 1]; k = "NETWORK"; big = l ? (l.rx + l.tx).toFixed(1) : "—"; sub = l ? `Mb/s · ↓${l.rx.toFixed(1)} ↑${l.tx.toFixed(1)}` : "sampling between scans_"; vals = r.map((x) => x.rx + x.tx); }
    if (f === "ai") { const h = (S.stats || {}).hermes || {}; k = "HERMES"; big = h.gateway_running ? "RUNNING" : (S.stats ? "DOWN" : "—"); sub = `${esc(h.model || "")} · procs ${esc(c.hermes_procs ?? "—")}`; vals = S.hist.map((p) => p.ai || 0); }
    if (f === "nodes") { const ns = ((S.stats || {}).bot_mesh || {}).nodes || []; k = "BOTMESH"; big = ns.length ? `${ns.filter((n) => n.online).length}` : "—"; sub = ns.length ? `of ${ns.length} online` : ""; vals = S.nodesHist.slice(); }
    const needs = S.stats ? needsList().slice(0, 2) : [];
    box.innerHTML = `<div class="k">${esc(k)} · since page load</div>
      <div class="big">${esc(big)}<small>${esc(sub)}</small></div>
      ${spark(vals, 340, 56, k + " history", max)}
      <div class="ax"><span>−${Math.max(1, Math.round(((S.hist[S.hist.length - 1] || {}).t - (S.hist[0] || {}).t) / 60000) || 1)}m</span><span>NOW</span></div>
      ${needs.length ? `<div class="needs"><div class="k" style="color:#e86a5a">NEEDS YOU · ${needsList().length}</div>${needs.map((x) => `<div><span class="sev ${x.sev}">${esc(x.sev.toUpperCase())}</span><span style="color:#E8FFE2">${esc(x.title)}</span></div>`).join("")}</div>` : ""}`;
    document.querySelectorAll("#ft-strip button").forEach((b, i) => b.classList.toggle("dk-on", FOCUS[i] === f));
  }

  /* ───────────── ingest from existing loops ───────────── */
  function ingestStats(d) {
    if (!d || d.error) return;
    S.stats = d;
    const ifs = ((d.network || {}).ifaces) || [];
    const eg = (d.network || {}).egress_iface;
    const nic = ifs.find((x) => x.name === eg) || ifs.find((x) => x.name === "en0") || ifs[0];
    if (nic && num(nic.rx_bytes) != null) {
      const now = Date.now();
      const L = S.net.last;
      if (L && L.name === nic.name && now > L.t && nic.rx_bytes >= L.rx) {
        const dt = (now - L.t) / 1000;
        S.net.rates.push({ rx: (nic.rx_bytes - L.rx) * 8 / 1e6 / dt, tx: (nic.tx_bytes - L.tx) * 8 / 1e6 / dt });
        if (S.net.rates.length > 60) S.net.rates.shift();
      }
      S.net.last = { name: nic.name, t: now, rx: nic.rx_bytes, tx: nic.tx_bytes };
    }
    const ns = ((d.bot_mesh || {}).nodes) || [];
    if (ns.length) { S.nodesHist.push(ns.filter((n) => n.online).length); if (S.nodesHist.length > 60) S.nodesHist.shift(); }
    renderTiles(); renderTopo(); renderHermes(); renderNeeds(); renderBadges(); renderFocus();
    renderHardPy();
    emit();
  }
  function ingestCompute(d) {
    if (!d) return;
    S.compute = d;
    pushCompute(d);
    if (active()) { renderTiles(); renderFleet(); }
    renderFocus();
    emit();
  }

  /* ───────────── own pollers (only while the deck is visible) ───────────── */
  function poll(path, key, every, after, always) {
    const go = async () => {
      if (!always && !active()) return;
      try { S[key] = await getJSON(path); } catch (e) { if (!S[key]) S[key] = { ok: false, error: "SCAN FAIL: " + e.message }; }
      try { after(); renderBadges(); } catch (e) {}
      emit();
    };
    go();
    setInterval(go, every);
    return go;
  }

  function setOn(on) {
    S.on = !!on;
    try { localStorage.setItem("helix.deck", S.on ? "on" : "off"); } catch (e) {}
    document.body.classList.toggle("deck-on", S.on);
    const deck = $("deck");
    if (deck) deck.hidden = !S.on;
    const b = $("deck-tog");
    if (b) { b.textContent = "DECK: " + (S.on ? "ON" : "OFF"); b.setAttribute("aria-pressed", S.on ? "true" : "false"); }
    if (S.on) { renderTiles(); renderTopo(); renderHermes(); renderNeeds(); renderFleet(); }
  }

  function mount() {
    if (S.mounted) return;
    S.mounted = true;
    applyPalette();
    const pane = $("pane-ops");
    if (pane) {
      const deck = document.createElement("section");
      deck.id = "deck";
      deck.setAttribute("aria-label", "HELIX/OPS command deck");
      deck.innerHTML = skeleton();
      pane.insertBefore(deck, pane.firstChild);
      deck.addEventListener("click", async (e) => {
        const node = e.target.closest("[data-node]");
        if (node) { S.sel = node.dataset.node; S.picked = true; renderTopo(); return; }
        const jump = e.target.closest("[data-jump]");
        if (jump) { jumpTab(jump.dataset.jump); return; }
        const copy = e.target.closest("[data-dk-copy]");
        if (copy) {
          try { await navigator.clipboard.writeText(copy.dataset.dkCopy); copy.textContent = "COPIED"; } catch (err) { copy.textContent = "COPY FAILED"; }
          setTimeout(() => { copy.textContent = "COPY ID"; }, 1400);
          return;
        }
        const act = e.target.closest("[data-dk-act]");
        if (act) {
          act.disabled = true;
          act.textContent = act.dataset.dkAct === "stop" ? "STOPPING_" : "STARTING_";
          try {
            await fetch(api("/api/docker"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: act.dataset.dkName, action: act.dataset.dkAct }) });
          } catch (err) {}
          dockerNow();
        }
      });
    }
    // sysbar toggle (restores the legacy NOC / need-you modules when OFF)
    const bar = $("sysbar");
    if (bar && !$("deck-tog")) {
      const b = document.createElement("button");
      b.type = "button"; b.id = "deck-tog";
      b.addEventListener("click", () => setOn(!S.on));
      const anchor = $("anim-tog");
      if (anchor && anchor.parentNode === bar) bar.insertBefore(b, anchor); else bar.appendChild(b);
    }
    let saved = "on";
    try { saved = localStorage.getItem("helix.deck") || "on"; } catch (e) {}
    setOn(saved !== "off");

    // Field Terminal focus card
    const strip = $("ft-strip");
    if (strip && !$("ft-focus")) {
      const f = document.createElement("div");
      f.id = "ft-focus"; f.setAttribute("aria-live", "polite");
      strip.parentNode.insertBefore(f, strip.nextSibling);
      strip.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        const i = Array.prototype.indexOf.call(strip.querySelectorAll("button"), btn);
        if (FOCUS[i]) { S.focus = FOCUS[i]; renderFocus(); }
      });
    }

    // first stats scan may have finished before this module loaded
    getJSON("/api/stats").then(ingestStats).catch(() => {});
    poll("/api/trace?agent=helix", "trace", 5000, () => { renderTrace(); renderHermes(); });
    poll("/api/adze", "adze", 10000, renderAdze);
    poll("/api/git", "git", 30000, renderGit);
    poll("/api/matrix", "matrix", 30000, renderBanks);
    poll("/api/remote", "remote", 15000, renderRemote);
    poll("/api/clients", "clients", 90000, renderLan);
    dockerNow = poll("/api/docker", "docker", 60000, renderDocker);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { renderFleet(); renderTiles(); } });
    document.getElementById("tabs")?.addEventListener("click", (e) => {
      if (e.target.closest('[data-tab="ops"]')) setTimeout(() => { renderFleet(); renderTiles(); renderTopo(); }, 0);
    });
  }
  let dockerNow = () => {};

  function rerender() {
    applyPalette();
    renderTiles(); renderTopo(); renderHermes(); renderAdze(); renderNeeds(); renderFleet();
    renderTrace(); renderDocker(); renderLan(); renderRemote(); renderGit(); renderBanks(); renderFocus();
    renderHardPy();
    emit();
  }
  function select(id) { S.sel = id; S.picked = true; renderTopo(); emit(); }

  global.HelixDeck = { mount, ingestStats, ingestCompute, state: S, needsList, onUpdate: (f) => listeners.push(f), rerender, select, active, palette: C };
})(window);
