/* HELIX OPS — MEMORY MATRIX. Telemetry only. */
(function (global) {
  const state = { data: null, sel: null, flights: [], lastWrite: "", seenNoc: new Set() };

  function api(p) {
    const OPS = (location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "";
    return OPS + p;
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function cells(util) {
    if (util == null) return "N/A";
    const n = Math.max(0, Math.min(80, Math.round((Number(util) / 100) * 80)));
    let out = "";
    for (let r = 0; r < 5; r++) {
      const addr = (r * 0x100).toString(16).toUpperCase().padStart(4, "0");
      let row = "";
      for (let c = 0; c < 16; c++) row += (r * 16 + c) < n ? "■" : "□";
      out += `${addr}  ${row}\n`;
    }
    return out.trimEnd();
  }
  function utilLine(b) {
    if (b.utilization == null) {
      if (b.entries != null) return String(b.entries) + " REC";
      if (b.bytes != null) return Math.round(b.bytes / 1024) + " KB";
      return "N/A";
    }
    return b.utilization + "%";
  }
  function cls(b) {
    const p = b.pressure;
    if (p === "FULL" || p === "CAPACITY WARNING") return "fault";
    if (p === "ELEVATED" || p === "CONSOLIDATION ADVISED") return "warn";
    return "";
  }
  function bar(pct, amber) {
    if (pct == null) return `<div class="mm-bar"><i style="width:0"></i></div>`;
    return `<div class="mm-bar${amber ? " amber" : ""}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
  }
  function topo(banks) {
    const rows = (banks || []).filter((b) => b.status && b.status !== "NONE");
    const by = (t) => rows.filter((b) => b.type === t).map((b) => b.id);
    const join = (xs) => (xs.length ? xs.join(" · ") : "");
    const core = join(by("CORE"));
    const user = join(by("USER").slice(0, 3));
    const sess = join(by("SESSION").concat(by("INDEX")).slice(0, 3));
    const ext = join(by("EXTERNAL"));
    const proj = join(by("PROJECT"));
    const ag = join(by("AGENT").slice(0, 6));
    return [
      "                HERMES",
      "                   │",
      core || user ? ("       " + [core, user].filter(Boolean).join("   ")) : "",
      sess ? ("       " + sess) : "",
      "              COGNITIVE CORE",
      ext ? ("            " + ext) : "",
      proj ? ("            " + proj) : "",
      ag ? ("            " + ag) : "",
    ].filter(Boolean).join("\n");
  }

  function fillHome(d) {
    const el = document.getElementById("ft-matrix-body");
    if (!el) return;
    const rows = (d.banks || []).slice(0, 5).map((b) => {
      const u = b.utilization;
      const fill = u == null ? "──────────" : "▓".repeat(Math.round(u / 10)) + "░".repeat(10 - Math.round(u / 10));
      return `${b.id} ${b.name.replace(" MEMORY", "").replace(" PROFILE", "")}\n${fill} ${utilLine(b)}`;
    });
    el.innerHTML = `<div class="ft-v">MEMORY MATRIX</div><div class="ft-k">${esc(rows.join(" · ") || "NO TELEMETRY")}</div>`;
  }

  function fillHermes(d) {
    const box = document.getElementById("hermes-mem-ind");
    if (!box) return;
    const core = (d.banks || []).find((b) => b.type === "CORE") || {};
    const user = (d.banks || []).find((b) => b.type === "USER") || {};
    const ext = (d.banks || []).find((b) => b.type === "EXTERNAL") || {};
    const ctx = d.context || {};
    const pix = (u) => {
      if (u == null) return "N/A";
      const n = Math.round(u / 10);
      return "█".repeat(n) + "░".repeat(10 - n) + " " + u + "%";
    };
    box.innerHTML = `MEM  ${pix(core.utilization)}<br>USER ${pix(user.utilization)}<br>CTX  ${ctx.utilization == null ? "N/A" : pix(ctx.utilization)}<br>EXT  ${ext.status === "ONLINE" ? "● ONLINE" : "○ OFFLINE"}`;
  }

  function fillDetail(b) {
    const el = document.getElementById("mm-detail");
    if (!el || !b) { if (el) el.innerHTML = ""; return; }
    const x = b.extra || {};
    const util = b.utilization == null ? "N/A" : b.utilization + "%";
    el.innerHTML = `<div class="ident">MEM://${esc(b.id)} · ${esc(b.name)}</div>
      <div class="mm-cells">${esc(cells(b.utilization))}</div>
      <div class="mm-kv">
        <span class="k">STATUS</span><span>${esc(b.status)} ${esc(b.pressure || "")}</span>
        <span class="k">TYPE</span><span>${esc(b.type)}</span>
        <span class="k">BACKEND</span><span>${esc(b.backend)}</span>
        <span class="k">CAPACITY</span><span>${b.limit == null ? "UNBOUNDED" : (b.used + " / " + b.limit + " " + (b.capacityType || ""))}</span>
        <span class="k">UTILIZATION</span><span>${esc(util)}</span>
        <span class="k">FREE</span><span>${b.free == null ? "N/A" : b.free}</span>
        <span class="k">ENTRIES</span><span>${b.entries == null ? "—" : b.entries}</span>
        <span class="k">WRITE</span><span>${esc(b.writeMode || "—")}</span>
        <span class="k">LAST WRITE</span><span>${b.lastWrite == null ? "—" : esc(String(b.lastWrite))}</span>
        <span class="k">LAST READ</span><span>${b.lastRead == null ? "N/A" : esc(String(b.lastRead))}</span>
        <span class="k">HEAD</span><span>${esc(x.head || x.current || "—")}</span>
        <span class="k">SYNC</span><span>${esc(x.sync || "")}</span>
        <span class="k">RECORDS</span><span>${x.records == null && b.entries == null ? "—" : esc(x.records ?? b.entries)}</span>
        <span class="k">CAPABILITY</span><span>${esc(Object.entries(b.capabilities || {}).filter((kv) => kv[1]).map((kv) => kv[0].toUpperCase()).join(" · ") || "—")}</span>
      </div>`;
  }

  function drawBus(cv, d) {
    if (!cv) return;
    const th = (global.HelixGraph && HelixGraph.theme && HelixGraph.theme()) || {
      bg: "#050805", primary: "#7CFF7A", border: "#2a4a2a"
    };
    const ctx = cv.getContext("2d");
    const w = cv.width = cv.clientWidth || 320;
    const h = cv.height = 36;
    ctx.fillStyle = th.bg || "#050805";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = th.border || "#2a4a2a";
    ctx.beginPath(); ctx.moveTo(8, h / 2); ctx.lineTo(w - 8, h / 2); ctx.stroke();
    ctx.fillStyle = th.primary || "#7CFF7A";
    ctx.font = "10px monospace";
    ctx.fillText("MEM BUS", 10, 12);
    state.flights = state.flights.filter((f) => {
      f.x += 0.04;
      if (f.x > 1) return false;
      ctx.fillRect(8 + f.x * (w - 20), h / 2 - 2, 4, 4);
      return true;
    });
  }

  function ensureGraphs() {
    if (document.getElementById("mm-g-core")) return;
    const host = document.querySelector(".mm");
    if (!host) return;
    const box = document.createElement("div");
    box.className = "mm-box mm-graphs";
    box.innerHTML = `<div class="ident">CORE UTILIZATION // TIME</div><canvas id="mm-g-core" class="mm-g" height="72" aria-label="core util"></canvas>
      <div class="ident">USER UTILIZATION // TIME</div><canvas id="mm-g-user" class="mm-g" height="72" aria-label="user util"></canvas>
      <div class="ident">SESSION GROWTH</div><canvas id="mm-g-sess" class="mm-g" height="72" aria-label="session growth"></canvas>`;
    host.appendChild(box);
  }

  function paintGraphs(d) {
    ensureGraphs();
    const g = global.HelixGraph;
    if (!g) return;
    const hist = d.history || [];
    function series(id, field) {
      if (!id) return [];
      const rows = hist.filter((h) => h.bank === id && h[field] != null);
      return rows.length ? [{ y: rows.map((h) => Number(h[field])) }] : [];
    }
    const core = (d.banks || []).find((b) => b.type === "CORE");
    const user = (d.banks || []).find((b) => b.type === "USER" && b.source === "Hermes") || (d.banks || []).find((b) => b.type === "USER");
    const sess = (d.banks || []).find((b) => b.type === "SESSION");
    g.drawTrace(document.getElementById("mm-g-core"), series(core && core.id, "utilization"), { min: 0, max: 100 });
    g.drawTrace(document.getElementById("mm-g-user"), series(user && user.id, "utilization"), { min: 0, max: 100 });
    g.drawTrace(document.getElementById("mm-g-sess"), series(sess && sess.id, "used"), {});
  }

  function emitNoc(d) {
    const noc = global.HelixNoc;
    if (!noc || !noc.ingestEvent) return;
    (d.events || []).forEach((e) => {
      const key = String(e.t || "") + String(e.code || "");
      if (!key || state.seenNoc.has(key)) return;
      state.seenNoc.add(key);
      noc.ingestEvent({ node: "helix", kind: "mem", text: String(e.code || "").slice(0, 90) });
    });
  }

  function render(d) {
    state.data = d;
    fillHome(d);
    fillHermes(d);
    const cap = document.getElementById("mm-cap");
    const disc = d.discovery || {};
    if (cap) cap.textContent = `BANKS ${String(d.bankCount || 0).padStart(2, "0")} · ${d.code || ""} · LAST ${disc.lastDiscovery || d.discoveredAt || ""}`;
    const grid = document.getElementById("mm-grid");
    if (grid) {
      grid.innerHTML = (d.banks || []).map((b) =>
        `<button type="button" class="mm-bank ${cls(b)}${state.sel === b.id ? " on" : ""}" data-mm="${esc(b.id)}">
          <div class="id">${esc(b.id)} ${b.status === "ONLINE" ? "●" : "○"}</div>
          <div class="nm">${esc(b.name)}</div>
          <div class="st">${esc(utilLine(b))}</div>
        </button>`
      ).join("");
    }
    const tp = document.getElementById("mm-topo");
    if (tp) tp.textContent = topo(d.banks || []);
    const rev = document.getElementById("mm-rev");
    if (rev) {
      const r = d.revision || {};
      rev.innerHTML = `DISK ${esc(r.disk || "—")} · SESSION ${esc(r.session || "—")}` +
        (r.pendingLoad ? `<br>△ MEMORY REVISION PENDING · NEXT SESSION LOAD` : "");
    }
    const ctxEl = document.getElementById("mm-ctx");
    if (ctxEl) {
      const c = d.context || {};
      ctxEl.innerHTML = `CTX ${c.used == null ? "NO TELEMETRY" : c.used + " TOK"} · LIMIT ${c.limit == null ? "UNKNOWN" : c.limit} · UTIL N/A`;
    }
    const ev = document.getElementById("mm-ev");
    if (ev) {
      ev.innerHTML = (d.events || []).slice().reverse().map((e) =>
        `<div>${esc(e.t || "")} ${esc(e.code || "")}</div>`
      ).join("") || `<div class="empty">no mem events_</div>`;
    }
    const hline = document.getElementById("hel-01-line");
    if (hline && d.hel01) hline.textContent = "HΞL-01: " + d.hel01;
    if (state.sel) {
      const b = (d.banks || []).find((x) => x.id === state.sel);
      fillDetail(b);
    }
    const last = (d.events || []).filter((e) => String(e.code).includes("WRITE")).pop();
    if (last && last.code !== state.lastWrite) {
      state.lastWrite = last.code;
      state.flights.push({ x: 0 });
      if (globalThis.HelixOpsWordmark && HelixOpsWordmark.pulse) HelixOpsWordmark.pulse("hermes");
    }
    drawBus(document.getElementById("mm-cv"), d);
    emitNoc(d);
    paintGraphs(d);
  }

  async function load() {
    if (document.hidden) return;
    try {
      const r = await fetch(api("/api/matrix"), { cache: "no-store" });
      const d = await r.json();
      render(d);
    } catch (e) {}
  }
  async function rescan() {
    try {
      const r = await fetch(api("/api/matrix"), { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"act":"rescan"}' });
      const d = await r.json();
      render(d);
    } catch (e) {}
  }

  function mount() {
    document.getElementById("mm-grid")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mm]");
      if (!b) return;
      state.sel = b.dataset.mm;
      const bank = (state.data?.banks || []).find((x) => x.id === state.sel);
      fillDetail(bank);
      document.querySelectorAll(".mm-bank").forEach((x) => x.classList.toggle("on", x === b));
    });
    document.getElementById("mm-rescan")?.addEventListener("click", rescan);
    document.getElementById("mm-close")?.addEventListener("click", () => {
      document.querySelector('#tabs [data-tab="ops"]')?.click();
    });
    document.getElementById("ft-matrix")?.addEventListener("click", () => {
      document.querySelector('#tabs [data-tab="matrix"]')?.click();
    });
    document.getElementById("hermes-mem-ind")?.addEventListener("click", () => {
      document.querySelector('#tabs [data-tab="matrix"]')?.click();
    });
    load();
    setInterval(load, 8000);
  }

  global.HelixMatrix = { mount, load, rescan, state };
})(typeof window !== "undefined" ? window : globalThis);
