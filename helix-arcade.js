/* HELIX/OPS — ARCADE theme: agent roster cards + office floor scene + theme switch.
   Opt-in (sysbar THEME button or ?theme=arcade); CRT stays default.
   Real telemetry only: cards and the floor are drawn from HelixDeck.state (existing /api/* polls).
   Mascots are original pixel sprites. Motion is idle decoration only and stops under prefers-reduced-motion. */
(function (global) {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);
  const trunc = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  /* ───────────── agents ───────────── */
  const ORDER = ["helix", "prefect", "foreman", "canon", "scribe", "adze", "unraid", "honcho", "telegram", "umbrel"];
  const META = {
    helix:    { acc: "#ff4fa3", shape: "ghost", role: "lead · grok · runs the floor" },
    prefect:  { acc: "#3b82f6", shape: "round", role: "align · keeps the plan honest" },
    foreman:  { acc: "#f59e0b", shape: "hex",   role: "kanban · moves the work" },
    canon:    { acc: "#39e58c", shape: "square", role: "docs · writes it down" },
    scribe:   { acc: "#22d3ee", shape: "round", role: "research · reads first" },
    adze:     { acc: "#ef4444", shape: "tri",   role: "critic · openai · no tools" },
    unraid:   { acc: "#facc15", shape: "square", role: "peer · docker host" },
    honcho:   { acc: "#a3e635", shape: "hex",   role: "memory · peers & facts" },
    telegram: { acc: "#38bdf8", shape: "round", role: "channel · only Helix speaks" },
    umbrel:   { acc: "#fb923c", shape: "tri",   role: "peer node" },
  };
  const FALLBACK = ["#ff4fa3", "#3b82f6", "#39e58c", "#f59e0b", "#22d3ee", "#ef4444"];

  const SHAPES = {
    round: ["...XXXX...", ".XXXXXXXX.", ".XXXXXXXX.", "XXWKXXWKXX", "XXWWXXWWXX", "XXXXXXXXXX", "XXXXXXXXXX", ".XXXXXXXX.", "..XXXXXX..", "..X....X.."],
    tri:   ["....XX....", "....XX....", "...XXXX...", "...XXXX...", "..XWKXWKX.", "..XWWXWWX.", ".XXXXXXXX.", "XXXXXXXXXX", "XXXXXXXXXX", ".X......X."],
    square:[".XXXXXXXX.", "XXXXXXXXXX", "XXWKXXWKXX", "XXWWXXWWXX", "XXXXXXXXXX", "XXXXXXXXXX", "XXXXKKXXXX", "XXXXXXXXXX", ".XXXXXXXX.", ".X......X."],
    hex:   ["...XXXX...", "..XXXXXX..", ".XXXXXXXX.", "XXWKXXWKXX", "XXWWXXWWXX", "XXXXXXXXXX", ".XXXXXXXX.", "..XXXXXX..", "...XXXX...", "..X....X.."],
    ghost: ["..HXXXXH..", ".HXXXXXXH.", "HXXXXXXXXH", "HXKKXXKKXH", "XXKKXXKKXX", "XXXXXXXXXX", "XXXXXXXXXX", "XXXXXXXXXX", "XXXXXXXXXX", "X.XX.XX.X."],
  };
  function sprite(shape, acc, on, px, ox, oy) {
    const rows = SHAPES[shape] || SHAPES.round;
    const body = shape === "ghost" ? (on ? "#f4f1fa" : "#4a4458") : (on ? acc : "#4a4458");
    const col = { X: body, W: on ? "#ffffff" : "#8b8698", K: "#0d0b12", H: on ? acc : "#5a5468" };
    let out = "";
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length; x++) {
        const c = col[r[x]];
        if (c) out += `<rect x="${(ox + x * px).toFixed(1)}" y="${(oy + y * px).toFixed(1)}" width="${px}" height="${px}" fill="${c}"/>`;
      }
    });
    return out;
  }

  function agents(S) {
    const mesh = (S.stats || {}).bot_mesh || {};
    const nodes = (mesh.nodes || []).filter((n) => n.kind !== "human");
    nodes.sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));
    return nodes.map((n, i) => {
      const m = META[n.id] || { acc: FALLBACK[i % FALLBACK.length], shape: ["round", "hex", "square", "tri"][i % 4], role: n.kind || "" };
      return Object.assign({ id: n.id, label: n.label || n.id, online: !!n.online, kind: n.kind, host: n.host }, m);
    });
  }

  /* per-agent real lines */
  function detail(a, S) {
    const st = S.stats || {};
    const h = st.hermes || {};
    const edges = ((st.bot_mesh || {}).edges) || [];
    const tl = ((S.trace || {}).timeline) || [];
    const last = tl[tl.length - 1];
    if (a.id === "helix") {
      const stages = (S.trace || {}).stages || {};
      const lit = Object.values(stages).filter(Boolean).length, tot = Object.keys(stages).length || 7;
      return { tag: h.gateway_running ? "LEAD" : "DOWN", k: h.model || "model —", v: (h.cron_jobs ?? "—") + " cron", bar: S.trace ? lit / tot : null, say: last ? `${last.kind} · ${last.summary || last.label || ""}` : (h.gateway_running ? "gateway up · waiting for work" : "gateway down") };
    }
    if (a.id === "adze") {
      const ad = S.adze || {};
      return { tag: ad.online ? "ONLINE" : "OFF", k: "mode " + String(ad.mode || "—").toUpperCase(), v: ad.online ? (ad.model || "openai") : "no key", bar: null, say: ad.online ? ((ad.last || {}).state || "standing by") : "OPENAI PROVIDER UNAVAILABLE" };
    }
    if (a.id === "unraid") {
      const d = S.docker || {};
      const cs = d.containers || [];
      const up = cs.filter((c) => c.running).length;
      const r = S.remote || {};
      return { tag: a.online ? "ONLINE" : "OFF", k: "containers", v: d.ok ? `${up}/${cs.length}` : "—", bar: d.ok && cs.length ? up / cs.length : null, say: r.ok ? `rustdesk hbbs ${(r.hbbs || {}).online ? "●" : "○"} hbbr ${(r.hbbr || {}).online ? "●" : "○"}` : "peer link" };
    }
    if (a.id === "honcho") {
      const banks = ((S.matrix || {}).banks) || [];
      return { tag: a.online ? "ONLINE" : "OFF", k: "memory banks", v: banks.length || "—", bar: null, say: a.online ? "api healthy" : "api unreachable" };
    }
    const e = edges.find((x) => (x.from === "helix" && x.to === a.id) || (x.to === a.id) || (x.from === a.id));
    return { tag: a.online ? "ONLINE" : "IDLE", k: e ? e.label : a.kind, v: a.online ? "gateway ●" : "gateway ○", bar: null, say: a.online ? `helix → ${e ? e.label : a.id}` : "on the bench · zz" };
  }

  /* ───────────── roster ───────────── */
  function renderRoster(S) {
    const box = $("ar-roster");
    if (!box || !document.body.classList.contains("theme-arcade")) return;
    const list = agents(S).slice(0, 8);
    if (!list.length) { box.innerHTML = ""; return; }
    box.innerHTML = list.map((a) => {
      const d = detail(a, S);
      return `<button type="button" class="ar-card${S.picked && S.sel === a.id ? " sel" : ""}" data-agent="${esc(a.id)}" style="--acc:${a.acc}" aria-label="${esc(a.label)} ${esc(d.tag)}">
        <span class="tag${a.online ? " on" : ""}">${esc(d.tag)}</span>
        <span class="top"><svg viewBox="0 0 30 30" aria-hidden="true">${sprite(a.shape, a.acc, a.online, 3, 0, 0)}</svg>
          <span><span class="nm">${esc(a.label.replace(/ peer$/i, ""))}</span><div class="rl">${esc(a.role)}</div></span></span>
        <span class="ln"><span>${esc(d.k)}</span><b>${esc(d.v)}</b></span>
        ${d.bar != null ? `<span class="bar"><i style="width:${Math.round(d.bar * 100)}%"></i></span>` : `<span class="bar" style="background:transparent"></span>`}
        <span class="say${a.online ? "" : " off"}" title="${esc(d.say)}">${esc(d.say)}</span>
      </button>`;
    }).join("");
  }

  /* ───────────── office floor ───────────── */
  function jst() {
    try { return new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) { return "--:--"; }
  }
  function plant(x, y) {
    return `<rect x="${x + 6}" y="${y + 22}" width="16" height="14" fill="#2a2533"/><rect x="${x + 4}" y="${y + 20}" width="20" height="4" fill="#3a3346"/>
      <rect x="${x + 12}" y="${y}" width="4" height="22" fill="#1f6b3a"/><rect x="${x + 4}" y="${y + 6}" width="8" height="4" fill="#2f8f4e"/><rect x="${x + 16}" y="${y + 4}" width="9" height="4" fill="#2f8f4e"/>
      <rect x="${x + 2}" y="${y + 12}" width="10" height="4" fill="#27a35a"/><rect x="${x + 16}" y="${y + 12}" width="10" height="4" fill="#27a35a"/><rect x="${x + 10}" y="${y - 4}" width="8" height="5" fill="#39c46e"/>`;
  }
  function desk(x, y, a, i, S) {
    const on = a && a.online;
    const acc = a ? a.acc : "#3a3346";
    let screen = `<rect x="${x + 25}" y="${y - 44}" width="70" height="40" fill="#0a0910" stroke="#3a3346"/>`;
    if (a) {
      screen += `<text x="${x + 29}" y="${y - 35}" fill="${on ? acc : "#5a5468"}" font-size="7" letter-spacing="1">${esc(trunc(a.label.toUpperCase(), 12))}</text>`;
      if (on) {
        const H = (S.hist || []).slice(-12);
        H.forEach((p, k) => {
          const share = Object.values(p.share || {}).reduce((s, v) => s + v, 0);
          const h = Math.max(2, Math.min(22, ((i * 7 + k * 5) % 9) + share * 0.6));
          screen += `<rect x="${x + 30 + k * 5}" y="${y - 8 - h}" width="3" height="${h.toFixed(0)}" fill="${acc}" opacity=".85"/>`;
        });
      } else {
        screen += `<text x="${x + 60}" y="${y - 18}" fill="#5a5468" font-size="8" text-anchor="middle">OFFLINE</text>`;
      }
    }
    let g = screen +
      `<rect x="${x + 55}" y="${y - 4}" width="10" height="4" fill="#2a2533"/>` +
      `<rect x="${x}" y="${y}" width="120" height="12" fill="#2a2533"/><rect x="${x}" y="${y + 12}" width="120" height="3" fill="#1c1824"/>` +
      `<rect x="${x + 4}" y="${y + 15}" width="4" height="30" fill="#1c1824"/><rect x="${x + 112}" y="${y + 15}" width="4" height="30" fill="#1c1824"/>` +
      `<rect x="${x + 38}" y="${y + 2}" width="34" height="6" fill="#16131d"/><rect x="${x + 80}" y="${y + 3}" width="6" height="5" fill="#16131d"/>` +
      `<rect x="${x + 48}" y="${y + 30}" width="24" height="18" fill="#1c1824"/><rect x="${x + 52}" y="${y + 48}" width="4" height="10" fill="#16131d"/><rect x="${x + 64}" y="${y + 48}" width="4" height="10" fill="#16131d"/>`;
    if (a) {
      const sel = S.picked && S.sel === a.id;
      const sx = x + 45, sy = y + 20;
      g += `<g data-agent="${esc(a.id)}"><g class="${on ? "bob b" + ((i % 4) + 1) : ""}">
        ${sel ? `<rect x="${sx - 4}" y="${sy - 4}" width="38" height="38" fill="none" stroke="#ff4fa3" stroke-width="2"/>` : ""}
        ${sprite(a.shape, a.acc, on, 3, sx, sy)}
        ${on ? "" : `<text x="${sx + 30}" y="${sy}" fill="#8b8698" font-size="9">z z</text>`}
        <text x="${sx + 15}" y="${sy + 40}" fill="${on ? a.acc : "#8b8698"}" font-size="8" text-anchor="middle" letter-spacing="1">${esc(trunc(a.label.toUpperCase(), 10))}</text></g></g>`;
    }
    return g;
  }
  function renderFloor(S) {
    const box = $("ar-floor");
    if (!box || !document.body.classList.contains("theme-arcade")) return;
    const deckState = S;
    const list = agents(S);
    const helix = list.find((a) => a.id === "helix");
    const deskAgents = list.filter((a) => a.id !== "helix" && a.kind !== "peer" && a.kind !== "channel").slice(0, 6);
    while (deskAgents.length < 6) deskAgents.push(null);
    const c = S.compute || {};
    const H = (S.hist || []).slice(-48);
    const needs = global.HelixDeck ? global.HelixDeck.needsList() : [];
    const st = S.stats || {};
    const hm = st.hermes || {};
    const on = list.filter((a) => a.online).length;

    // wall screen: fleet CPU line + vol bars
    const SX = 300, SY = 26, SW = 360, SH = 112;
    let scr = `<rect x="${SX}" y="${SY}" width="${SW}" height="${SH}" fill="#0a0910" stroke="#3a3346" stroke-width="2"/>`;
    for (let k = 1; k < 4; k++) scr += `<rect x="${SX + 2}" y="${SY + k * SH / 4}" width="${SW - 4}" height="1" fill="#1c1824"/>`;
    if (H.length > 1) {
      const mx = Math.max(10, ...H.map((p) => p.used || 0));
      const pts = H.map((p, i) => [SX + 8 + i * (SW - 16) / (H.length - 1), SY + SH - 22 - (p.used || 0) / mx * (SH - 40)]);
      H.forEach((p, i) => {
        const prev = i ? H[i - 1].used || 0 : p.used || 0;
        const h = 3 + (p.used || 0) / mx * 14;
        scr += `<rect x="${(pts[i][0] - 2).toFixed(0)}" y="${(SY + SH - 4 - h).toFixed(0)}" width="4" height="${h.toFixed(0)}" fill="${(p.used || 0) >= prev ? "#39e58c" : "#ff4fa3"}" opacity=".6"/>`;
      });
      scr += `<polyline points="${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}" fill="none" stroke="#39e58c" stroke-width="2" style="shape-rendering:auto"/>`;
      const lp = pts[pts.length - 1];
      scr += `<rect x="${(lp[0] - 3).toFixed(0)}" y="${(lp[1] - 3).toFixed(0)}" width="6" height="6" fill="#ffffff" class="blink"/>`;
    } else {
      scr += `<text x="${SX + SW / 2}" y="${SY + SH / 2}" fill="#5a5468" font-size="10" text-anchor="middle">SAMPLING FLEET_</text>`;
    }
    scr += `<text x="${SX + 8}" y="${SY + 13}" fill="#ffffff" font-size="9" letter-spacing="1">FLEET CPU ${c.used_pct != null ? Math.round(c.used_pct) + "%" : "—"}</text>`;
    scr += `<text x="${SX + SW - 8}" y="${SY + 13}" fill="#39e58c" font-size="9" text-anchor="end">LOAD ${c.total_load ?? "—"} / ${c.total_cpus ?? "—"} CPU</text>`;

    // left: logo tile + candle wall
    let left = `<rect x="22" y="20" width="96" height="96" rx="10" fill="#1a1622" stroke="#2a2533"/>
      <circle cx="70" cy="58" r="24" fill="none" stroke="#ff4fa3" stroke-width="3" stroke-dasharray="30 6 20 6 40 6"/>
      <path d="M62 40 Q78 49 62 58 Q46 67 62 76" fill="none" stroke="#ffffff" stroke-width="3" style="shape-rendering:auto"/>
      <path d="M78 40 Q62 49 78 58 Q94 67 78 76" fill="none" stroke="#ff9ccd" stroke-width="3" style="shape-rendering:auto"/>
      <text x="70" y="108" fill="#ffffff" font-size="11" text-anchor="middle" font-weight="700" letter-spacing="2">HELIX/OPS</text>`;
    left += `<rect x="18" y="170" width="64" height="150" fill="#0a0910" stroke="#3a3346" stroke-width="2"/>`;
    const CH = (S.hist || []).slice(-14);
    CH.forEach((p, i) => {
      const prev = i ? CH[i - 1].used || 0 : p.used || 0, cur = p.used || 0;
      const up = cur >= prev;
      const yA = 300 - Math.min(prev, 100) * 1.1, yB = 300 - Math.min(cur, 100) * 1.1;
      const top = Math.min(yA, yB), h = Math.max(3, Math.abs(yA - yB));
      left += `<rect x="${24 + i * 4}" y="${top.toFixed(0)}" width="3" height="${h.toFixed(0)}" fill="${up ? "#39e58c" : "#ef4444"}"/>`;
    });
    left += `<text x="50" y="314" fill="#a19bb0" font-size="7" text-anchor="middle">TAPE</text>`;
    // banner
    left += `<rect x="190" y="30" width="56" height="86" fill="#1a1622" stroke="#2a2533"/><polygon points="190,116 218,132 246,116" fill="#1a1622" stroke="#2a2533"/>
      <text x="218" y="70" fill="#ff4fa3" font-size="22" text-anchor="middle" font-weight="900">H/</text><text x="218" y="92" fill="#a19bb0" font-size="7" text-anchor="middle" letter-spacing="1">TKY-06</text>`;

    // right: clock + needs board
    let right = `<rect x="742" y="34" width="86" height="52" fill="#0a0910" stroke="#3a3346" stroke-width="2"/>
      <text x="785" y="62" fill="#39e58c" font-size="20" text-anchor="middle" font-weight="700">${esc(jst())}</text>
      <text x="785" y="78" fill="#a19bb0" font-size="7" text-anchor="middle" letter-spacing="1">JST · TOKYO</text>
      <rect x="752" y="92" width="66" height="14" fill="#1a1622" stroke="#2a2533"/><text x="785" y="102" fill="#ffffff" font-size="7" text-anchor="middle" letter-spacing="1">LOCAL TIME</text>`;
    right += `<rect x="842" y="24" width="104" height="${Math.max(60, 30 + Math.min(needs.length, 6) * 12)}" fill="#0f0d15" stroke="#3a3346" stroke-width="2"/>
      <text x="850" y="38" fill="#ffffff" font-size="8" letter-spacing="1">NEEDS YOU · ${needs.length}</text>`;
    (needs.length ? needs.slice(0, 6) : [{ sev: "low", title: "all clear" }]).forEach((n, i) => {
      const col = n.sev === "high" ? "#ff4d6d" : (n.sev === "low" ? "#39e58c" : "#f59e0b");
      right += `<text x="850" y="${52 + i * 12}" fill="${col}" font-size="7">- ${esc(trunc(n.title.toUpperCase(), 18))}</text>`;
    });

    // head desk with helix
    let head = `<rect x="730" y="230" width="150" height="14" fill="#2a2533"/><rect x="730" y="244" width="150" height="4" fill="#1c1824"/>
      <rect x="734" y="248" width="5" height="34" fill="#1c1824"/><rect x="871" y="248" width="5" height="34" fill="#1c1824"/>
      <rect x="740" y="214" width="26" height="16" fill="#0a0910" stroke="#3a3346"/><rect x="744" y="218" width="18" height="8" fill="${hm.gateway_running ? "#39e58c" : "#ff4d6d"}" opacity=".7"/>
      <rect x="842" y="218" width="26" height="12" fill="#e9e4f2"/><rect x="845" y="221" width="20" height="1" fill="#a19bb0"/><rect x="845" y="224" width="20" height="1" fill="#a19bb0"/>
      <text x="805" y="296" fill="#ffffff" font-size="8" text-anchor="middle" letter-spacing="1">HEAD OF THE FLOOR</text>`;
    if (helix) {
      const sel = S.picked && S.sel === "helix";
      head += `<g data-agent="helix"><g class="${helix.online ? "bob b1" : ""}">
        ${sel ? `<rect x="783" y="181" width="44" height="44" fill="none" stroke="#ff4fa3" stroke-width="2"/>` : ""}
        ${sprite("ghost", helix.acc, helix.online, 3.6, 787, 186)}</g></g>`;
      const tl = ((S.trace || {}).timeline) || [];
      const last = tl[tl.length - 1];
      if (last) {
        const msg = trunc(`${last.summary || last.label || last.kind}`, 34);
        const w = Math.max(80, msg.length * 5.4 + 14);
        const bx = Math.min(940 - w, 805 - w / 2);
        head += `<rect x="${bx.toFixed(0)}" y="152" width="${w.toFixed(0)}" height="18" fill="#0d0b12" stroke="#f59e0b"/><polygon points="800,170 808,170 804,178" fill="#f59e0b"/>
          <text x="${(bx + 7).toFixed(0)}" y="164" fill="#ffffff" font-size="8">${esc(msg)}</text>`;
      }
    }

    // server rack = docker on unraid
    const cs = ((S.docker || {}).containers) || [];
    let rack = `<rect x="890" y="300" width="52" height="128" fill="#16131d" stroke="#3a3346" stroke-width="2"/>`;
    for (let i = 0; i < 10; i++) {
      const ctr = cs[i];
      rack += `<rect x="896" y="${308 + i * 12}" width="40" height="8" fill="#0a0910"/>`;
      if (ctr) rack += `<rect x="${926}" y="${310 + i * 12}" width="6" height="4" fill="${ctr.running ? "#39e58c" : "#ff4d6d"}" class="${ctr.running ? "blink" : ""}" style="animation-delay:${(i * 0.17).toFixed(2)}s"/>
        <rect x="900" y="${310 + i * 12}" width="${Math.min(22, String(ctr.name).length * 2)}" height="4" fill="#3a3346"/>`;
    }
    rack += `<text x="916" y="442" fill="#a19bb0" font-size="7" text-anchor="middle">DOCKER ${cs.filter((x) => x.running).length}/${cs.length || "—"}</text>`;

    // radar = rustdesk
    const r = S.remote || {};
    const rdOk = r.ok && (r.hbbs || {}).online && (r.hbbr || {}).online;
    const wave = rdOk ? "#39e58c" : "#ff4d6d";
    let radar = `<rect x="760" y="380" width="80" height="44" fill="#1a1622" stroke="#2a2533"/>
      <rect x="796" y="350" width="8" height="30" fill="#3a3346"/>
      <path d="M770 352 Q800 318 830 352 Z" fill="#c9c3d6" style="shape-rendering:auto"/><rect x="798" y="336" width="4" height="10" fill="#8b8698"/>
      <path d="M838 330 q8 8 0 16" fill="none" stroke="${wave}" stroke-width="2" class="blink" style="shape-rendering:auto"/>
      <path d="M846 324 q12 14 0 28" fill="none" stroke="${wave}" stroke-width="2" class="blink" style="shape-rendering:auto;animation-delay:.4s"/>
      <rect x="766" y="398" width="68" height="14" fill="#0d0b12" stroke="#3a3346"/><text x="800" y="408" fill="#ffffff" font-size="7" text-anchor="middle" letter-spacing="1">REMOTE RADAR</text>`;

    // couch + plants
    const couch = `<rect x="370" y="400" width="190" height="30" fill="#1f1b28"/><rect x="370" y="390" width="190" height="14" fill="#2a2533"/>
      <rect x="362" y="392" width="12" height="38" fill="#2a2533"/><rect x="556" y="392" width="12" height="38" fill="#2a2533"/>`;

    const ticker = `${(st.bot_mesh || {}).nodes ? `AGENTS ${on}/${list.length} ONLINE` : "AGENTS —"} · ${hm.model ? esc(String(hm.model).toUpperCase()) : "MODEL —"} · GATEWAY ${hm.gateway_running ? "UP" : (st.hermes ? "DOWN" : "—")} · NEEDS YOU ${needs.length}`;

    const desks = deskAgents.map((a, i) => desk(250 + (i % 3) * 150, 216 + Math.floor(i / 3) * 104, a, i, S)).join("");

    // floor perspective lines
    let floor = `<rect x="0" y="0" width="960" height="150" fill="#16121d"/><rect x="0" y="150" width="960" height="300" fill="#100d16"/><rect x="0" y="148" width="960" height="3" fill="#221d2b"/>`;
    for (let k = 0; k < 7; k++) floor += `<rect x="0" y="${170 + k * k * 6}" width="960" height="1" fill="#17131f"/>`;
    for (let k = -6; k <= 6; k++) floor += `<line x1="${480 + k * 40}" y1="151" x2="${480 + k * 170}" y2="450" stroke="#17131f" style="shape-rendering:auto"/>`;

    box.innerHTML = `<div class="ar-floor-hd">${ticker}</div>
      <svg viewBox="0 0 960 450" role="img" aria-label="Office floor: ${on} of ${list.length} agents online, fleet CPU ${c.used_pct ?? "unknown"} percent">
        ${floor}${left}${scr}${right}${plant(150, 186)}${plant(690, 186)}${plant(320, 396)}${plant(590, 396)}${couch}${desks}${head}${rack}${radar}
        <text x="480" y="160" fill="#39e58c" font-size="9" text-anchor="middle" letter-spacing="1">${esc((S.trace || {}).objective ? "ON THE DESK · " + trunc(S.trace.objective.toUpperCase(), 60) : "FLOOR IDLE")}</text>
      </svg>`;
    void deckState;
  }

  /* ───────────── placement + theme ───────────── */
  function place() {
    const roster = $("ar-roster"), floor = $("ar-floor");
    if (!roster || !floor) return;
    const field = document.body.classList.contains("field-term");
    if (field) {
      const after = $("ft-focus") || $("ft-strip");
      const hc = $("ar-ft-hermes");
      if (after && after.parentNode) {
        if (hc) after.parentNode.insertBefore(hc, after.nextSibling);
        after.parentNode.insertBefore(floor, after.nextSibling);
        after.parentNode.insertBefore(roster, after.nextSibling);
      }
    } else {
      const deck = $("deck");
      if (deck) { deck.insertBefore(floor, deck.firstChild); deck.insertBefore(roster, deck.firstChild); }
    }
  }

  let lastFloor = 0, floorTimer = null;
  function update(S) {
    if (!document.body.classList.contains("theme-arcade")) return;
    renderRoster(S);
    paintHeader();
    paintNeed(S);
    paintFtHermes(S);
    const now = Date.now();
    if (now - lastFloor > 2500) { lastFloor = now; renderFloor(S); }
    else if (!floorTimer) floorTimer = setTimeout(() => { floorTimer = null; lastFloor = Date.now(); renderFloor(global.HelixDeck.state); }, 2600 - (now - lastFloor));
  }

  function paintNeed(S) {
    const ban = $("ar-need");
    if (!ban) return;
    const field = document.body.classList.contains("field-term") && document.body.classList.contains("theme-arcade");
    const items = (S && S.stats && global.HelixDeck) ? global.HelixDeck.needsList() : [];
    if (!field || !items.length) { ban.hidden = true; return; }
    ban.hidden = false;
    const top = items[0];
    const sev = top.sev === "high" ? "high" : (top.sev === "low" ? "low" : "med");
    ban.className = sev;
    ban.setAttribute("aria-label", `Needs you: ${items.length} open. Top: ${top.title}`);
    ban.innerHTML = `<span class="sev">${esc(top.sev.toUpperCase())}</span><span class="tt">${esc(top.title)}</span>${items.length > 1 ? `<span class="more">+${items.length - 1}</span>` : ""}`;
  }

  /* compact Hermes card for the Field Terminal */
  function paintFtHermes(S) {
    const box = $("ar-ft-hermes");
    if (!box || !document.body.classList.contains("field-term")) return;
    const h = ((S.stats || {}).hermes) || null;
    const tr = S.trace || {};
    const stages = tr.stages || {};
    const order = [["REQUEST", "REQ"], ["INTERPRET", "INTERP"], ["PLAN", "PLAN"], ["TOOL", "TOOL"], ["OBSERVATION", "OBS"], ["DECISION", "DECIDE"], ["RESPONSE", "RESP"]];
    const lastLit = [...order].reverse().find(([k]) => stages[k]);
    const tl = tr.timeline || [];
    const ev = tl[tl.length - 1];
    box.innerHTML = `<div class="row"><span class="k">HERMES</span><span style="color:${h ? (h.gateway_running ? "#39e58c" : "#ff4d6d") : "#a19bb0"}">${h ? (h.gateway_running ? "● RUNNING" : "● DOWN") : "NO TELEMETRY"}${h && h.model ? " · " + esc(h.model) : ""}</span></div>
      <div class="dk-pipe" role="img" aria-label="Request pipeline">${order.map(([k, lab]) => `<span class="${stages[k] ? "lit" : ""}${lastLit && lastLit[0] === k ? " cur" : ""}">${lab}</span>`).join("")}</div>
      <div class="ev">${ev ? `<span style="color:#a19bb0">${esc(ev.t || "")}</span> <span style="color:#f59e0b">${esc(ev.kind)}</span> ${esc(ev.summary || ev.label || "")}` : `<span style="color:#a19bb0">no observable events yet_</span>`}</div>`;
  }

  function setTheme(arcade) {
    document.body.classList.toggle("theme-arcade", !!arcade);
    try { localStorage.setItem("helix.theme", arcade ? "arcade" : "crt"); } catch (e) {}
    const b = $("ar-tog");
    if (b) { b.textContent = "THEME: " + (arcade ? "ARCADE" : "CRT"); b.setAttribute("aria-pressed", arcade ? "true" : "false"); }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = arcade ? "#ff4fa3" : "#060705";
    const p = (typeof OPS === "string") ? OPS : ((location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "");
    const v = global.HELIX_ASSET_V || "";
    const ico = document.querySelector('link[rel="icon"]');
    const touch = document.querySelector('link[rel="apple-touch-icon"]');
    if (arcade) {
      if (ico) ico.href = p + "/helix-arcade-mark.svg?v=" + v;
      if (touch) touch.href = p + "/helix-arcade-mark.svg?v=" + v;
    } else {
      if (ico) ico.href = p + "/helix-core-mark.svg?v=" + v;
    }
    paintHeader();
    if (!arcade) {
      const slot = document.querySelector(".fetch-find");
      if (slot && $("q") && $("q").parentNode !== slot) slot.appendChild($("q"));
    } else if ($("ar-find") && $("q") && $("q").parentNode !== $("ar-find")) {
      $("ar-find").appendChild($("q"));
    }
    if (global.HelixDeck) { global.HelixDeck.rerender(); if (arcade) { lastFloor = 0; update(global.HelixDeck.state); } }
  }

  function paintHeader() {
    const hdr = $("ar-hdr");
    if (!document.body.classList.contains("theme-arcade")) return;
    if (!hdr) return;
    const S = (global.HelixDeck && global.HelixDeck.state) || {};
    const st = S.stats || {};
    const h = st.hermes || {};
    const ad = S.adze || {};
    const ts = st.tailscale || {};
    const up = ts.state === "Running" || ts.BackendState === "Running" || ts.online === true;
    const auth = st.auth_open ? "BYPASSED" : "ON";
    const chip = (ok, lab, extra) => `<span class="ar-chip"><i style="background:${ok ? "#39e58c" : "#ff4d6d"}"></i>${esc(lab)}${extra ? " " + esc(extra) : ""}</span>`;
    const chips = $("ar-chips");
    if (chips) chips.innerHTML = chip(up, "UPLINK") + chip(!!h.gateway_running, "GATEWAY") + chip(!!ad.online, "ADZE") + `<span class="ar-chip"><i style="background:${st.auth_open ? "#f59e0b" : "#39e58c"}"></i>AUTH ${esc(auth)}</span>`;
    const clk = $("ar-clock");
    if (clk) {
      try { clk.textContent = new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }) + " JST"; } catch (e) { clk.textContent = "--:--"; }
    }
    const dt = $("ar-date");
    if (dt) {
      try { dt.textContent = new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Tokyo", weekday: "short", day: "2-digit", month: "short" }).toUpperCase(); } catch (e) {}
    }
  }

  /* Desktop FLOOR: tag legacy OPERATIONS modules. ar-legacy = duplicated by the deck (hidden in arcade);
     ar-more = still useful, shown behind the MORE MODULES toggle. Nothing is moved or deleted, so CRT is untouched. */
  function tagLegacy() {
    const pane = $("pane-ops");
    if (!pane || $("ar-more-tog")) return;
    const legacy = [pane.querySelector(".cockpit .term.compute"), pane.querySelector(".btop"), $("hard"), $("inst-ridge"), $("git-box")];
    const pairs = pane.querySelectorAll(":scope > .pair");
    if (pairs[0]) legacy.push(pairs[0]);               // AGENT MATRIX + old BOTMESH
    legacy.forEach((el) => el && el.classList.add("ar-legacy"));
    const more = [pairs[1], pairs[2], $("alerts"), $("dock"), $("root")];   // TALK/HERDR, VAULT/SKILLS, alerts, links, host cards
    more.forEach((el) => el && el.classList.add("ar-more"));
    const tog = document.createElement("button");
    tog.type = "button"; tog.id = "ar-more-tog"; tog.setAttribute("aria-expanded", "false");
    tog.innerHTML = `<span>MORE MODULES ▾</span><small>talk · herdr · data vault · skills · hosts · links</small>`;
    tog.addEventListener("click", () => {
      const open = document.body.classList.toggle("ar-more-open");
      tog.setAttribute("aria-expanded", open ? "true" : "false");
      tog.querySelector("span").textContent = open ? "MORE MODULES ▴" : "MORE MODULES ▾";
      try { localStorage.setItem("helix.more", open ? "1" : "0"); } catch (e) {}
    });
    const cockpit = pane.querySelector(".cockpit");
    if (cockpit) cockpit.parentNode.insertBefore(tog, cockpit.nextSibling);
    try { if (localStorage.getItem("helix.more") === "1") { document.body.classList.add("ar-more-open"); tog.setAttribute("aria-expanded", "true"); tog.querySelector("span").textContent = "MORE MODULES ▴"; } } catch (e) {}
  }

  function mount() {
    if (!global.HelixDeck || !$("deck")) { setTimeout(mount, 150); return; }
    if ($("ar-roster")) return;
    const frame = document.createElement("div"); frame.id = "ar-frame"; frame.setAttribute("aria-hidden", "true");
    document.body.appendChild(frame);
    const roster = document.createElement("section"); roster.id = "ar-roster"; roster.setAttribute("aria-label", "Agent roster");
    const floor = document.createElement("section"); floor.id = "ar-floor"; floor.setAttribute("aria-label", "Office floor");
    document.body.appendChild(roster); document.body.appendChild(floor);
    if (!$("ar-hdr")) {
      const p = (typeof OPS === "string") ? OPS : ((location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "");
      const hdr = document.createElement("div");
      hdr.id = "ar-hdr";
      hdr.innerHTML = `<div class="ar-hdr-l"><img src="${p}/helix-arcade-mark.svg?v=${global.HELIX_ASSET_V || ""}" width="48" height="48" alt="HELIX/OPS"><div><div class="ar-word">HELIX<span>/</span>OPS</div><div class="ar-sub">HERMES COMMAND FLOOR · TOKYO-06 · 統合管制</div></div></div>
        <div class="ar-chips" id="ar-chips"></div>
        <div class="ar-hdr-r"><div class="ar-find" id="ar-find"></div><div class="ar-date" id="ar-date"></div><div class="ar-clock" id="ar-clock" aria-label="Japan time">--:-- JST</div></div>`;
      const logo = document.querySelector("header.logo");
      if (logo && logo.parentNode) logo.parentNode.insertBefore(hdr, logo);
      const q = $("q");
      if (q && $("ar-find")) $("ar-find").appendChild(q);
    }
    if (!$("ar-need")) {
      const ban = document.createElement("button");
      ban.type = "button"; ban.id = "ar-need"; ban.hidden = true;
      ban.setAttribute("aria-label", "Needs you");
      ban.addEventListener("click", () => document.querySelector('#tabs [data-tab="ops"]')?.click());
      const field = $("field");
      if (field) field.insertBefore(ban, field.firstChild);
      else document.body.appendChild(ban);
    }
    if (!$("ar-ft-hermes")) {
      const hc = document.createElement("section");
      hc.id = "ar-ft-hermes"; hc.setAttribute("aria-label", "Hermes");
      document.body.appendChild(hc);
    }
    tagLegacy();
    if (!$("ar-ft-nav")) {
      const nav = document.createElement("nav");
      nav.id = "ar-ft-nav";
      nav.setAttribute("aria-label", "Field terminal");
      [["ops", "FLOOR"], ["trace", "TRACE"], ["remote", "REMOTE"], ["more", "MODULES"]].forEach(([tab, lab]) => {
        const b = document.createElement("button");
        b.type = "button"; b.textContent = lab; b.dataset.tab = tab;
        b.addEventListener("click", () => {
          if (tab === "more") {
            const open = document.body.classList.toggle("nav-open");
            $("nav-toggle")?.setAttribute("aria-expanded", open ? "true" : "false");
            b.setAttribute("aria-expanded", open ? "true" : "false");
            if (open) $("tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }
          document.body.classList.remove("nav-open");
          document.querySelector(`#tabs [data-tab="${tab}"]`)?.click();
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
        nav.appendChild(b);
      });
      document.body.appendChild(nav);
    }
    place();
    matchMedia("(max-width: 767px)").addEventListener("change", () => setTimeout(place, 0));

    const pick = (e) => {
      const g = e.target.closest("[data-agent]");
      if (!g) return;
      global.HelixDeck.select(g.getAttribute("data-agent"));
      lastFloor = 0; update(global.HelixDeck.state);
    };
    roster.addEventListener("click", pick);
    floor.addEventListener("click", pick);

    const bar = $("sysbar");
    if (bar && !$("ar-tog")) {
      const b = document.createElement("button");
      b.type = "button"; b.id = "ar-tog";
      b.addEventListener("click", () => setTheme(!document.body.classList.contains("theme-arcade")));
      const anchor = $("deck-tog") || $("anim-tog");
      if (anchor && anchor.parentNode === bar) bar.insertBefore(b, anchor); else bar.appendChild(b);
    }
    global.HelixDeck.onUpdate(update);
    setInterval(() => { if (document.body.classList.contains("theme-arcade") && !document.hidden) { lastFloor = 0; renderFloor(global.HelixDeck.state); paintHeader(); } }, 30000);

    let want = "arcade";
    try { want = localStorage.getItem("helix.theme") || "arcade"; } catch (e) {}
    const q = new URLSearchParams(location.search).get("theme");
    if (q === "arcade" || q === "crt") want = q;
    setTheme(want === "arcade");
    document.addEventListener("keydown", (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target.tagName || ""))) return;
      const i = "1234567".indexOf(e.key);
      if (i < 0) return;
      const tabs = document.querySelectorAll("#tabs [data-tab]");
      if (tabs[i]) tabs[i].click();
    });
    document.getElementById("tabs")?.addEventListener("click", () => {
      const on = document.querySelector("#tabs button.on");
      const tab = on && on.dataset.tab;
      document.querySelectorAll("#ar-ft-nav button").forEach((b) => {
        b.classList.toggle("on", b.dataset.tab === tab || (b.dataset.tab === "more" && tab && !["ops", "trace", "remote"].includes(tab)));
      });
    });
  }

  global.HelixArcade = { mount, setTheme };
})(window);
