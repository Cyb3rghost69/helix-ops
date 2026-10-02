(() => {
  const TYPES = {
    reasoning: { label: "Reasoning", color: "#6ef0ff" },
    "tool-call": { label: "Tool Call", color: "#ffb347" },
    memory: { label: "Memory", color: "#c4a7ff" },
    decision: { label: "Decision", color: "#39ff14" },
    session: { label: "Session", color: "#7dffc3" },
    error: { label: "Error", color: "#ff3864" },
    manual: { label: "Manual", color: "#94a3b8" },
  };
  const BOT_COL = { orchestra: "#6adf64", bot: "#6aa8a8", peer: "#d4a017", channel: "#9cba90", memory: "#7CFF7A", human: "#d6d4c8" };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  const typeOf = (n) => {
    if (n.layer === "bot") return n.kind || "bot";
    const t = (n.metadata || {}).type;
    if (t && TYPES[t]) return t;
    for (const tag of n.tags || []) if (TYPES[tag]) return tag;
    return "manual";
  };
  const colorOf = (n) => n.layer === "bot" ? (BOT_COL[n.kind] || "#6ef0ff") : (TYPES[typeOf(n)] || TYPES.manual).color;

  let graph = { nodes: [], edges: [] };
  let mesh = { nodes: [], edges: [] };
  let view = "graph";
  let selected = null;
  let pos = {};
  let raf = 0;
  let drag = null;
  let packets = [];
  let tickN = 0;

  function mergedNodes() {
    const bots = (mesh.nodes || []).map(n => ({
      id: "bot-" + n.id,
      title: n.label,
      layer: "bot",
      kind: n.kind,
      online: !!n.online,
      host: n.host,
      content: `${n.kind} on ${n.host || "?"}`,
      tags: [n.kind, n.host].filter(Boolean),
    }));
    if (view === "graph") return graph.nodes;
    if (view === "combined") return bots.concat(graph.nodes);
    return graph.nodes;
  }

  function mergedEdges() {
    const ms = (graph.edges || []).map(e => ({ ...e, layer: "ms" }));
    if (view === "graph") return ms;
    const bot = (mesh.edges || []).map(e => ({
      source: "bot-" + e.from,
      target: "bot-" + e.to,
      relation: e.label,
      live: !!e.live,
      weight: e.weight || 0,
      layer: "bot",
    }));
    const bridges = [];
    if (view === "combined" && graph.nodes.length && mesh.nodes.some(n => n.id === "helix")) {
      bridges.push({ source: "bot-helix", target: graph.nodes[0].id, relation: "maps", layer: "bridge", live: true });
    }
    return bot.concat(ms, bridges);
  }

  function layoutTick(w, h) {
    const nodes = mergedNodes();
    const edges = mergedEdges();
    const cx = w / 2, cy = h / 2;
    const bots = nodes.filter(n => n.layer === "bot" && n.id !== "bot-helix");
    if (!pos["bot-helix"]) pos["bot-helix"] = { x: cx, y: cy, vx: 0, vy: 0 };
    pos["bot-helix"].x = cx; pos["bot-helix"].y = cy; pos["bot-helix"].pin = true;
    bots.forEach((n, i) => {
      const a = (i / Math.max(bots.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const tx = cx + Math.cos(a) * Math.min(w, h) * 0.22;
      const ty = cy + Math.sin(a) * Math.min(w, h) * 0.18;
      if (!pos[n.id]) pos[n.id] = { x: tx, y: ty, vx: 0, vy: 0 };
      pos[n.id].pin = true;
      pos[n.id].x += (tx - pos[n.id].x) * 0.08;
      pos[n.id].y += (ty - pos[n.id].y) * 0.08;
    });
    for (const n of nodes) {
      if (!pos[n.id]) {
        const ring = n.layer === "bot" ? 0.2 : 0.42;
        pos[n.id] = {
          x: cx + (Math.random() - 0.5) * w * ring,
          y: cy + (Math.random() - 0.5) * h * ring,
          vx: 0, vy: 0,
        };
      }
    }
    const ids = nodes.map(n => n.id);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]], b = pos[ids[j]];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.max(Math.hypot(dx, dy), 1);
        const f = 3800 / (dist * dist);
        const fx = (dx / dist) * f, fy = (dy / dist) * f;
        if (!a.pin) { a.vx -= fx; a.vy -= fy; }
        if (!b.pin) { b.vx += fx; b.vy += fy; }
      }
    }
    for (const e of edges) {
      const a = pos[e.source], b = pos[e.target];
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.max(Math.hypot(dx, dy), 1);
      const rest = e.layer === "bot" ? 110 : 150;
      const f = (dist - rest) * 0.03;
      const fx = (dx / dist) * f, fy = (dy / dist) * f;
      if (!a.pin) { a.vx += fx; a.vy += fy; }
      if (!b.pin) { b.vx -= fx; b.vy -= fy; }
    }
    for (const n of nodes) {
      const p = pos[n.id];
      if (p.pin || drag === n.id) continue;
      p.vx += (cx - p.x) * 0.012;
      p.vy += (cy - p.y) * 0.012;
      p.vx *= 0.86; p.vy *= 0.86;
      p.x += p.vx; p.y += p.vy;
      p.x = Math.max(28, Math.min(w - 28, p.x));
      p.y = Math.max(28, Math.min(h - 28, p.y));
    }
  }

  function syncPackets(edges) {
    const live = edges.filter(e => e.layer === "bot" && e.live);
    const keys = new Set(live.map(e => e.source + ">" + e.target));
    packets = packets.filter(p => keys.has(p.key) || keys.has(p.target + ">" + p.source));
    for (const e of live) {
      const key = e.source + ">" + e.target;
      const have = packets.filter(p => p.key === key).length;
      for (let i = have; i < 2; i++) {
        packets.push({ key, source: e.source, target: e.target, t: i * 0.45, color: "#7dffc3" });
        packets.push({ key: key + "-r", source: e.target, target: e.source, t: 0.2 + i * 0.45, color: "#6ef0ff" });
      }
    }
    for (const p of packets) {
      p.t += 0.012;
      if (p.t > 1) p.t -= 1;
    }
  }

  function drawGraph() {
    const svg = document.getElementById("ms-svg");
    if (!svg) return;
    const w = svg.clientWidth || 800, h = svg.clientHeight || 520;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const nodes = mergedNodes();
    const edges = mergedEdges();
    layoutTick(w, h);
    if (view === "combined") syncPackets(edges);
    tickN++;
    const lines = edges.map(e => {
      const a = pos[e.source], b = pos[e.target];
      if (!a || !b) return "";
      const cls = e.layer === "bot" ? (e.live ? "ms-edge bot-live flow" : "ms-edge bot-dim") : (e.layer === "bridge" ? "ms-edge bridge" : "ms-edge");
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${cls}"/>`;
    }).join("");
    const labels = edges.filter(e => e.layer === "bot").map(e => {
      const a = pos[e.source], b = pos[e.target];
      if (!a || !b) return "";
      return `<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 6}" class="ms-elabel">${esc(e.relation || "")}</text>`;
    }).join("");
    const pk = view === "combined" ? packets.map(p => {
      const a = pos[p.source], b = pos[p.target];
      if (!a || !b) return "";
      const x = a.x + (b.x - a.x) * p.t;
      const y = a.y + (b.y - a.y) * p.t;
      return `<circle cx="${x}" cy="${y}" r="3.2" fill="${p.color}" class="bot-pkt"/>`;
    }).join("") : "";
    const circles = nodes.map(n => {
      const p = pos[n.id];
      if (!p) return "";
      const sel = selected === n.id;
      const r = n.layer === "bot" ? (n.id === "bot-helix" ? 14 : 9) : (sel ? 11 : 7);
      const pulse = (n.layer === "bot" && n.online)
        ? `<circle cx="${p.x}" cy="${p.y}" r="${r + 4 + (tickN % 40) / 5}" fill="none" stroke="${colorOf(n)}" opacity="${0.35 - (tickN % 40) / 120}"/>`
        : "";
      return `<g class="ms-ng" data-id="${esc(n.id)}">
        ${pulse}
        <circle cx="${p.x}" cy="${p.y}" r="${r + 5}" fill="${colorOf(n)}" opacity="0.12"/>
        <circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${n.layer === "bot" && n.online === false ? "#222" : colorOf(n)}" stroke="${sel ? "#fff" : colorOf(n)}" stroke-width="${sel ? 2 : 1}"/>
        <text x="${p.x}" y="${p.y + r + 14}" class="ms-nlabel">${esc((n.title || "").slice(0, 22))}</text>
      </g>`;
    }).join("");
    svg.innerHTML = `<g>${lines}${labels}${pk}${circles}</g>`;
  }

  function inspect(id) {
    selected = id;
    const n = mergedNodes().find(x => x.id === id);
    const box = document.getElementById("ms-inspect");
    if (!n || !box) return;
    box.innerHTML = `<div class="ms-ity">${esc(n.layer === "bot" ? "bot / " + (n.kind || "") : typeOf(n))}</div>
      <div class="ms-ititle">${esc(n.title)}</div>
      <div class="ms-ibody">${esc(n.content || "")}</div>
      <div class="ms-itags">${(n.tags || []).map(tg => `<span>${esc(tg)}</span>`).join("")}</div>`;
  }

  function renderTimeline() {
    const pane = document.getElementById("ms-pane");
    const rows = [...graph.nodes].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
    pane.innerHTML = rows.map(n =>
      `<div class="ms-row" data-id="${esc(n.id)}"><i style="background:${colorOf(n)}"></i><b>${esc(n.title)}</b><span>${esc(typeOf(n))}</span><span class="mono">${esc((n.updated_at || "").slice(0, 19))}</span></div>`
    ).join("") || `<div class="empty">no nodes</div>`;
  }

  function renderClusters() {
    const pane = document.getElementById("ms-pane");
    const groups = {};
    for (const n of mergedNodes()) {
      const t = n.layer === "bot" ? "bot:" + (n.kind || "bot") : typeOf(n);
      (groups[t] ||= []).push(n);
    }
    pane.innerHTML = Object.entries(groups).map(([t, ns]) =>
      `<div class="ms-cluster"><h3>${esc(t)} · ${ns.length}</h3>${ns.map(n =>
        `<button type="button" class="ms-chip" data-id="${esc(n.id)}">${esc(n.title)}</button>`
      ).join("")}</div>`
    ).join("");
  }

  function renderSearch(q) {
    const pane = document.getElementById("ms-pane");
    const qq = (q || "").toLowerCase();
    const rows = mergedNodes().filter(n =>
      !qq || (n.title || "").toLowerCase().includes(qq) || (n.content || "").toLowerCase().includes(qq)
    );
    pane.innerHTML = `<input id="ms-q" type="search" placeholder="search nodes…" value="${esc(q || "")}"/>` +
      rows.map(n => `<div class="ms-row" data-id="${esc(n.id)}"><i style="background:${colorOf(n)}"></i><b>${esc(n.title)}</b><span>${esc((n.content || "").slice(0, 80))}</span></div>`).join("");
    const inp = document.getElementById("ms-q");
    if (inp) inp.addEventListener("input", (e) => renderSearch(e.target.value));
  }

  function showView() {
    const svg = document.getElementById("ms-svg");
    const pane = document.getElementById("ms-pane");
    cancelAnimationFrame(raf);
    const live = view === "combined" || view === "graph";
    if (live) {
      svg.style.display = "block";
      pane.style.display = "none";
      const loop = () => { drawGraph(); raf = requestAnimationFrame(loop); };
      loop();
    } else {
      svg.style.display = "none";
      pane.style.display = "block";
      if (view === "timeline") renderTimeline();
      else if (view === "clusters") renderClusters();
      else renderSearch("");
    }
  }

  async function loadGraph() {
    const r = await fetch("/api/mindscape/graph", { cache: "no-store" });
    if (!r.ok) throw new Error("graph " + r.status);
    graph = await r.json();
    const meta = document.getElementById("ms-meta");
    if (meta) meta.textContent = `${(mesh.nodes || []).length} bots · ${graph.nodes.length} thoughts · ${graph.edges.length} links`;
    showView();
  }

  function setMesh(m) {
    mesh = m || { nodes: [], edges: [] };
    const meta = document.getElementById("ms-meta");
    if (meta) meta.textContent = `${(mesh.nodes || []).length} bots · ${graph.nodes.length} thoughts · ${graph.edges.length} links`;
  }

  function bind() {
    const wrap = document.getElementById("ms-wrap");
    if (!wrap) return;
    wrap.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-view]");
      if (tab) {
        view = tab.dataset.view;
        wrap.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === view));
        showView();
        return;
      }
      if (e.target.id === "ms-seed") {
        fetch("/api/mindscape/seed", { method: "POST" }).then(() => { pos = {}; return loadGraph(); });
        return;
      }
      const hit = e.target.closest("[data-id]");
      if (hit) inspect(hit.dataset.id);
    });
    const svg = document.getElementById("ms-svg");
    svg.addEventListener("pointerdown", (e) => {
      const g = e.target.closest(".ms-ng");
      if (!g) return;
      drag = g.dataset.id;
      inspect(drag);
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag || !pos[drag]) return;
      const rect = svg.getBoundingClientRect();
      pos[drag].x = e.clientX - rect.left;
      pos[drag].y = e.clientY - rect.top;
      pos[drag].vx = 0; pos[drag].vy = 0;
    });
    svg.addEventListener("pointerup", () => { drag = null; });
  }

  window.helixMindscape = { loadGraph, bind, setMesh };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { bind(); loadGraph(); });
  else { bind(); loadGraph(); }
})();
