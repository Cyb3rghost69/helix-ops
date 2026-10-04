/* HELIX OPS — network control canvas. Real APIs only. */
(function (global) {
  const ST = {
    busy: { fill: "#efe6c9", label: "BUSY" },
    idle: { fill: "#d4a017", label: "IDLE" },
    online: { fill: "#6adf64", label: "ONLINE" },
    degraded: { fill: "#e09030", label: "DEGRADED" },
    dark: { fill: "#5a4038", label: "OFFLINE" },
    unknown: { fill: "#5a5a52", label: "UNKNOWN" },
  };

  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function ageTxt(s) {
    if (s == null) return "NO TELEMETRY";
    if (s < 60) return s + "s";
    if (s < 3600) return Math.floor(s / 60) + "m";
    return Math.floor(s / 3600) + "h";
  }
  function statusOf(n, agent) {
    if (agent) {
      if (agent.status === "busy") return "busy";
      if (agent.status === "idle") return "idle";
      if (agent.status === "dark") return n.online ? "idle" : "dark";
    }
    if (n.online) return "online";
    return "dark";
  }

  const state = {
    mesh: { nodes: [], edges: [] },
    agents: {},
    hosts: [],
    hermes: {},
    network: {},
    compute: null,
    events: [],
    hist: {},
    seen: {},
    sel: null,
    filter: "",
    follow: true,
    paused: false,
    anim: "full",
    packets: [],
    scope: [],
    lastIf: null,
    lastIfT: 0,
    scan: 0,
    raf: 0,
    t0: performance.now(),
  };

  function animMode() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return "off";
    return state.anim;
  }

  function merge() {
    const agents = state.agents;
    return (state.mesh.nodes || []).map((n) => {
      const a = agents[n.id] || {};
      const st = statusOf(n, a);
      return Object.assign({}, n, a, { status: st, st });
    });
  }

  function posMap(nodes, w, h) {
    const cx = w / 2, cy = h / 2;
    const pos = {};
    const others = nodes.filter((n) => n.id !== "helix");
    pos.helix = { x: cx, y: cy };
    others.forEach((n, i) => {
      const a = (i / Math.max(others.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const rx = Math.min(w, h) * 0.38;
      const ry = Math.min(w, h) * 0.32;
      pos[n.id] = { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
    });
    return pos;
  }

  function pushEvent(ev) {
    const row = Object.assign({ t: Date.now() / 1000 }, ev);
    state.events.unshift(row);
    if (state.events.length > 80) state.events.length = 80;
    const id = ev.node;
    if (id) {
      state.hist[id] = state.hist[id] || [];
      state.hist[id].unshift(row);
      if (state.hist[id].length > 24) state.hist[id].length = 24;
    }
    renderEvents();
    if (state.sel === id) renderInspect();
  }

  function noteDiffs(nodes) {
    nodes.forEach((n) => {
      const prev = state.seen[n.id];
      const now = n.online ? "on" : "off";
      if (!prev) {
        state.seen[n.id] = { on: now, born: performance.now(), st: n.st };
        pushEvent({ node: n.id, kind: "connect", text: (n.label || n.id) + " LINK ESTABLISHED" });
        return;
      }
      if (prev.on !== now) {
        prev.on = now;
        pushEvent({
          node: n.id,
          kind: now === "on" ? "connect" : "lost",
          text: (n.label || n.id) + (now === "on" ? " LINK ESTABLISHED" : " SIGNAL LOST"),
        });
        prev.born = performance.now();
        prev.lost = now === "off" ? performance.now() : 0;
      }
      if (prev.st !== n.st) {
        prev.st = n.st;
        pushEvent({ node: n.id, kind: "status", text: (n.label || n.id) + " STATUS " + (ST[n.st] || ST.unknown).label });
      }
    });
  }

  function draw(cv) {
    const ctx = cv.getContext("2d");
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = cv.clientWidth || 640;
    const h = cv.clientHeight || 360;
    if (cv.width !== Math.floor(w * dpr)) {
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    const mode = animMode();
    const nodes = merge().filter((n) => {
      const q = state.filter;
      if (!q) return true;
      const blob = (n.label + " " + n.id + " " + n.host + " " + n.kind + " " + n.st + " " + (n.role || "")).toLowerCase();
      return blob.includes(q);
    });
    const pos = posMap(state.mesh.nodes || [], w, h);
    const now = performance.now();

    ctx.strokeStyle = "rgba(106,223,100,0.08)";
    ctx.lineWidth = 1;
    for (let x = 20; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 20; y < h; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.fillStyle = "rgba(125,133,116,0.45)";
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.fillText("SECTOR 04  ネットワーク制御  X:" + Math.round(w) + " Y:" + Math.round(h), 8, 12);

    if (mode === "full") {
      state.scan += 0.004;
      if (state.scan > 1.4) state.scan = 0;
      const sr = state.scan * Math.min(w, h) * 0.55;
      ctx.strokeStyle = "rgba(212,160,23,0.18)";
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, sr, 0, Math.PI * 2);
      ctx.stroke();
    }

    const edges = state.mesh.edges || [];
    edges.forEach((e) => {
      const a = pos[e.from], b = pos[e.to];
      if (!a || !b) return;
      ctx.strokeStyle = e.live ? "rgba(106,223,100,0.55)" : "rgba(90,64,56,0.35)";
      ctx.lineWidth = e.live ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = "rgba(125,133,116,0.8)";
      ctx.font = "9px ui-monospace, Menlo";
      ctx.fillText((e.label || "") + (e.weight ? " · " + e.weight : ""), (a.x + b.x) / 2, (a.y + b.y) / 2 - 6);
    });

    if (mode === "full" && !document.hidden) {
      const live = edges.filter((e) => e.live && pos[e.from] && pos[e.to]);
      live.forEach((e) => {
        const measured = Number(e.weight || 0) > 0;
        const rate = measured ? Math.min(2.2, 0.4 + e.weight / 40) : 0.12;
        if (Math.random() < rate / 60) {
          state.packets.push({ e, u: 0, measured, s: 2 + Math.random() });
        }
      });
      state.packets = state.packets.filter((p) => p.u < 1);
      state.packets.forEach((p) => {
        p.u += 0.012 * p.s;
        const a = pos[p.e.from], b = pos[p.e.to];
        if (!a || !b) return;
        const x = a.x + (b.x - a.x) * p.u;
        const y = a.y + (b.y - a.y) * p.u;
        ctx.fillStyle = p.measured ? "#efe6c9" : "rgba(106,223,100,0.55)";
        ctx.fillRect(Math.round(x), Math.round(y), 3, 3);
      });
    }

    nodes.forEach((n) => {
      const p = pos[n.id];
      if (!p) return;
      const rec = state.seen[n.id] || {};
      const ageN = now - (rec.born || 0);
      const st = ST[n.st] || ST.unknown;
      let r = n.id === "helix" ? 14 : 8;
      let alpha = 1;
      if (ageN < 800 && rec.on === "on") {
        r = r * (ageN / 800);
        alpha = ageN / 800;
      }
      if (rec.lost && now - rec.lost < 900) {
        alpha = 1 - (now - rec.lost) / 900;
      }
      ctx.globalAlpha = Math.max(0.15, alpha);
      ctx.fillStyle = st.fill;
      ctx.fillRect(Math.round(p.x - r / 2), Math.round(p.y - r / 2), Math.round(r), Math.round(r));
      if (n.id === "helix") {
        const ang = now / 700;
        for (let k = 0; k < 8; k++) {
          const t = k / 7 * Math.PI * 2;
          const x = p.x + Math.sin(t + ang) * 5;
          const y = p.y + (k / 7 - 0.5) * 16;
          ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = state.sel === n.id ? "#efe6c9" : "#d6d4c8";
      ctx.font = "10px ui-monospace, Menlo";
      ctx.textAlign = "center";
      ctx.fillText(n.label || n.id, p.x, p.y + r + 12);
      ctx.fillStyle = st.fill;
      ctx.font = "8px ui-monospace, Menlo";
      ctx.fillText(st.label, p.x, p.y + r + 22);
      ctx.textAlign = "left";
      if (state.sel === n.id) {
        ctx.strokeStyle = "#d4a017";
        ctx.strokeRect(p.x - r - 4, p.y - r - 4, r + 8, r + 8);
      }
    });
  }

  function renderList() {
    const el = document.getElementById("noc-list");
    if (!el) return;
    const q = state.filter;
    el.innerHTML = merge().filter((n) => {
      if (!q) return true;
      return (n.label + n.id + n.host + n.kind + n.st).toLowerCase().includes(q);
    }).map((n) => {
      const st = ST[n.st] || ST.unknown;
      return `<button type="button" class="noc-ni${state.sel === n.id ? " on" : ""}" data-nid="${esc(n.id)}">
        <i style="background:${st.fill}"></i>${esc(n.label)} <span>${esc(st.label)}</span>
      </button>`;
    }).join("") || `<p class="empty">NO NODES</p>`;
  }

  function renderTele() {
    const el = document.getElementById("noc-tele");
    if (!el) return;
    const nodes = merge();
    const on = nodes.filter((n) => n.st !== "dark").length;
    const busy = nodes.filter((n) => n.st === "busy").length;
    const idle = nodes.filter((n) => n.st === "idle").length;
    const off = nodes.filter((n) => n.st === "dark").length;
    const c = state.compute || {};
    const h = state.hermes || {};
    const rows = [
      ["CONNECTED", nodes.length],
      ["ACTIVE / BUSY", busy],
      ["IDLE", idle],
      ["OFFLINE", off],
      ["CPU", c.used_pct != null ? c.used_pct + "%" : "NO TELEMETRY"],
      ["MEM", c.mem_total_gb ? c.mem_used_gb + "/" + c.mem_total_gb + "G" : "NO TELEMETRY"],
      ["GATEWAY", h.gateway_running ? "UP" : (h.gateway_running === false ? "DOWN" : "NO TELEMETRY")],
      ["MODEL", h.model || "NO TELEMETRY"],
    ];
    el.innerHTML = rows.map(([k, v]) => `<div><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("");
    const strip = document.getElementById("noc-strip-live");
    if (strip) {
      strip.textContent = `ACTIVE ${String(busy).padStart(3, "0")} | IDLE ${String(idle).padStart(3, "0")} | OFFLINE ${String(off).padStart(3, "0")} | SYS: ${h.gateway_running ? "NOMINAL" : "CHECK"}`;
    }
  }

  function renderEvents() {
    const el = document.getElementById("noc-events");
    if (!el) return;
    const rows = state.paused ? state.events : state.events;
    el.innerHTML = rows.slice(0, 40).map((e) => {
      const when = e.t ? new Date(e.t * 1000).toLocaleTimeString("en-GB", { hour12: false }) : "";
      return `<div class="noc-ev k-${esc(e.kind || "")}"><span class="t">${esc(when)}</span> ${esc(e.node || "SYS")}  ${esc(e.text || "")}</div>`;
    }).join("") || `<p class="empty">NO EVENTS</p>`;
    if (state.follow && !state.paused) el.scrollTop = 0;
  }

  function renderInspect() {
    const el = document.getElementById("noc-inspect");
    if (!el) return;
    const id = state.sel;
    if (!id) {
      el.innerHTML = `<p class="empty">SELECT NODE_  接続ノード</p>`;
      return;
    }
    const n = merge().find((x) => x.id === id) || { id };
    const st = ST[n.st] || ST.unknown;
    const host = (state.hosts || []).find((h) => String(h.id || h.name || "").toLowerCase().includes(n.host || "zzz"));
    const hist = state.hist[id] || [];
    const ticks = hist.slice(0, 16).map((e, i) => {
      const x = 8 + i * 10;
      return `<rect x="${x}" y="8" width="3" height="14" fill="${e.kind === "lost" ? "#c44a3a" : "#6adf64"}"/>`;
    }).join("");
    el.innerHTML = `<div class="noc-id">NODE://${esc((n.label || id).toUpperCase())}</div>
      <div class="rule"></div>
      <div class="kv">
        <span class="k">STATUS</span><span class="v">${esc(st.label)}</span>
        <span class="k">KIND</span><span class="v">${esc(n.kind || "—")}</span>
        <span class="k">HOST</span><span class="v">${esc(n.host || "—")}</span>
        <span class="k">ROLE</span><span class="v">${esc(n.role || "—")}</span>
        <span class="k">LAST</span><span class="v">${esc(ageTxt(n.age_s))}</span>
        <span class="k">SOURCE</span><span class="v">${esc(n.source || "—")}</span>
        <span class="k">SESSION</span><span class="v">${esc(n.title || "—")}</span>
        <span class="k">DOING</span><span class="v">${esc(n.doing || "—")}</span>
      </div>
      <div class="ath">thk&gt; ${esc(n.thinking || "—")}</div>
      ${host && host.ping_ms != null ? `<div class="kv"><span class="k">PING</span><span class="v">${esc(host.ping_ms)} ms</span></div>` : ""}
      ${host && host.mem_total_gb ? `<div class="kv"><span class="k">MEM</span><span class="v">${esc(host.mem_used_gb)} / ${esc(host.mem_total_gb)} GB</span></div>` : ""}
      <div class="ident">ACTIVITY</div>
      <svg viewBox="0 0 180 28" class="noc-ticks">${ticks}</svg>
      <div class="noc-hist">${hist.slice(0, 8).map((e) => {
        const when = e.t ? new Date(e.t * 1000).toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit" }) : "";
        return `<div>${esc(when)}  ${esc(e.text)}</div>`;
      }).join("") || "NO TELEMETRY"}</div>`;
  }

  function drawScope(cv) {
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = cv.clientWidth || 400;
    const h = cv.clientHeight || 72;
    if (cv.width !== Math.floor(w * dpr)) {
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(106,223,100,0.12)";
    for (let y = 0; y < h; y += 12) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    const samples = state.scope;
    if (samples.length < 2) {
      ctx.fillStyle = "#7d8574";
      ctx.font = "10px ui-monospace";
      ctx.fillText("CPU FLEET  (live /api/compute)", 8, h / 2);
      return;
    }
    ctx.beginPath();
    samples.forEach((v, i) => {
      const x = (i / Math.max(samples.length - 1, 1)) * w;
      const y = h - 4 - (Math.max(0, Math.min(100, v)) / 100) * (h - 8);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.strokeStyle = "#6adf64";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  function loop(now) {
    if (!document.hidden && animMode() !== "off") {
      const cv = document.getElementById("noc-cv");
      if (cv) draw(cv);
      drawScope(document.getElementById("noc-scope"));
    }
    state.raf = requestAnimationFrame(loop);
  }

  function select(id) {
    state.sel = id;
    renderList();
    renderInspect();
  }

  function ingestStats(d) {
    state.mesh = d.bot_mesh || state.mesh;
    state.hosts = d.hosts || [];
    state.hermes = d.hermes || {};
    state.network = d.network || {};
    noteDiffs(merge());
    renderList();
    renderTele();
    renderInspect();
  }
  function ingestAgents(d) {
    const map = {};
    (d.agents || []).forEach((a) => { map[a.id] = a; });
    state.agents = map;
    noteDiffs(merge());
    renderList();
    renderTele();
    if (state.sel) renderInspect();
  }
  function ingestThoughts(items) {
    const it = (items || [])[0];
    if (!it || !it.text) return;
    const key = String(it.kind) + "|" + String(it.text).slice(0, 80);
    if (state._lastThought === key) return;
    state._lastThought = key;
    if (it.kind === "thought") return;
    pushEvent({ node: "helix", kind: it.kind || "log", text: String(it.text).slice(0, 90) });
  }
  function ingestCompute(d) {
    state.compute = d;
    if (d && d.used_pct != null) {
      state.scope.push(Number(d.used_pct));
      if (state.scope.length > 90) state.scope.shift();
    }
    renderTele();
  }

  function bind() {
    document.getElementById("noc-list")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-nid]");
      if (b) select(b.dataset.nid);
    });
    document.getElementById("noc-cv")?.addEventListener("click", (e) => {
      const cv = e.currentTarget;
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const pos = posMap(state.mesh.nodes || [], r.width, r.height);
      let hit = null, best = 9999;
      Object.keys(pos).forEach((id) => {
        const p = pos[id];
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < 22 && d < best) { best = d; hit = id; }
      });
      if (hit) select(hit);
    });
    document.getElementById("noc-q")?.addEventListener("input", (e) => {
      state.filter = (e.target.value || "").trim().toLowerCase();
      renderList();
    });
    document.getElementById("noc-pause")?.addEventListener("click", () => {
      state.paused = !state.paused;
      state.follow = !state.paused;
      const b = document.getElementById("noc-pause");
      if (b) b.textContent = state.paused ? "FOLLOW" : "PAUSE";
    });
    document.getElementById("noc-clear")?.addEventListener("click", () => {
      state.events = [];
      renderEvents();
    });
    document.getElementById("anim-tog")?.addEventListener("click", () => {
      state.anim = state.anim === "full" ? "reduced" : state.anim === "reduced" ? "off" : "full";
      const b = document.getElementById("anim-tog");
      if (b) b.textContent = "ANIM: " + state.anim.toUpperCase();
      if (globalThis.HelixOpsWordmark) HelixOpsWordmark.setAnim(state.anim.toUpperCase());
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.raf) {
        cancelAnimationFrame(state.raf);
        state.raf = 0;
      } else if (!document.hidden && !state.raf) {
        state.raf = requestAnimationFrame(loop);
      }
    });
  }

  function mount() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) state.anim = "off";
    bind();
    renderList();
    renderTele();
    renderInspect();
    renderEvents();
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(loop);
  }

  global.HelixNoc = { mount, ingestStats, ingestAgents, ingestThoughts, ingestCompute, ingestEvent: pushEvent, select, state };
})(window);
