/* HELIX OPS — cognitive trace. Observable events only. */
(function (global) {
  const STAGES = ["REQUEST", "INTERPRET", "PLAN", "TOOL", "OBSERVATION", "DECISION", "RESPONSE"];
  const POS = {
    command: [0.50, 0.07],
    hermes: [0.50, 0.22],
    plan: [0.50, 0.36],
    prefect: [0.18, 0.52],
    network: [0.50, 0.52],
    tool: [0.82, 0.52],
    scribe: [0.18, 0.64],
    foreman: [0.50, 0.64],
    canon: [0.82, 0.64],
    adze: [0.82, 0.36],
    result: [0.50, 0.78],
    response: [0.50, 0.93],
  };

  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function clock(s) {
    if (s == null) return "—";
    const n = Number(s);
    if (!Number.isFinite(n)) return "—";
    const m = Math.floor(n / 60);
    const r = n % 60;
    return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  }
  function api(p) {
    const OPS = (typeof global.OPS === "string") ? global.OPS : ((location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "");
    return OPS + p;
  }

  const state = {
    agent: "helix",
    run: "",
    retain: 24,
    data: null,
    selEvent: null,
    packets: [],
    flights: [],
    seenPkt: {},
    busKey: "",
    raf: 0,
    timer: 0,
  };

  function helArt(d) {
    const st = (d && d.stage) || "IDLE";
    const live = !!(d && d.live);
    const del = (d && d.delegates && d.delegates.length) || 0;
    if (!live && st === "IDLE") return " (·ω·)\n /| |\\";
    if (del) return " (·ω·)  ┌─┐\n /| |\\  └─┘";
    if (st === "TOOL" || st === "OBSERVATION") return " (·ω·)\n /|=|\\  ▦";
    if (st === "PLAN" || st === "INTERPRET" || st === "DECISION") return " (·ωo)\n /| |\\_";
    if (st === "RESPONSE") return " (·ω·)\n /| |\\";
    return " (·ω·)\n /| |\\";
  }

  function drawGraph(d) {
    const cv = document.getElementById("trace-cv");
    if (!cv) return;
    const w = cv.clientWidth || 320;
    const h = cv.clientHeight || 180;
    const ratio = Math.min(2, global.devicePixelRatio || 1);
    if (cv.width !== Math.floor(w * ratio) || cv.height !== Math.floor(h * ratio)) {
      cv.width = Math.floor(w * ratio);
      cv.height = Math.floor(h * ratio);
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(80,255,90,0.04)";
    for (let x = 0; x < w; x += 16) ctx.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 16) ctx.fillRect(0, y, w, 1);
    const xy = {};
    Object.keys(POS).forEach((k) => { xy[k] = { x: POS[k][0] * w, y: POS[k][1] * h }; });
    const edges = [
      ["command", "hermes"], ["hermes", "plan"],
      ["plan", "prefect"], ["plan", "network"], ["plan", "tool"],
      ["prefect", "result"], ["network", "result"], ["tool", "result"],
      ["hermes", "scribe"], ["hermes", "foreman"], ["hermes", "canon"], ["hermes", "adze"],
      ["result", "hermes"], ["hermes", "response"],
    ];
    ctx.strokeStyle = "rgba(106,223,100,0.22)";
    ctx.lineWidth = 1;
    edges.forEach(([a, b]) => {
      if (!xy[a] || !xy[b]) return;
      ctx.beginPath();
      ctx.moveTo(xy[a].x, xy[a].y);
      ctx.lineTo(xy[b].x, xy[b].y);
      ctx.stroke();
    });
    const active = {};
    (d.matrix || []).forEach((m) => { active[m.id === "helix" ? "hermes" : m.id] = m.status; });
    if (d.live) active.hermes = d.stage;
    if (d.stage === "PLAN" || d.stage === "INTERPRET") active.plan = "WORKING";
    if (d.stage === "TOOL" || d.stage === "OBSERVATION") active.tool = "TOOL";
    if (d.stage === "RESPONSE") active.response = "WORKING";
    if (d.stage === "REQUEST") active.command = "WORKING";
    Object.keys(xy).forEach((id) => {
      const p = xy[id];
      const st = active[id] || "";
      const on = st && st !== "DARK" && st !== "IDLE" && st !== "READY";
      ctx.fillStyle = on ? "#d4a017" : (st === "IDLE" || st === "READY" ? "#6adf64" : "#3a4638");
      ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
      ctx.fillStyle = on ? "#efe6c9" : "#7d8574";
      ctx.font = "9px ui-monospace, Menlo, monospace";
      ctx.fillText(id.toUpperCase(), p.x + 7, p.y + 3);
    });
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const now = performance.now();
    state.flights = (state.flights || []).filter((f) => now < f.t0 + f.dur);
    state.flights.forEach((pk) => {
      if (now < pk.t0) return;
      const a = xy[pk.from === "system" ? "tool" : (pk.from === "user" ? "command" : pk.from)];
      const b = xy[pk.to === "system" ? "tool" : (pk.to === "user" ? "response" : pk.to)];
      if (!a || !b) return;
      const u = Math.max(0, Math.min(1, (now - pk.t0) / pk.dur));
      const x = a.x + (b.x - a.x) * u;
      const y = a.y + (b.y - a.y) * u;
      ctx.fillStyle = "#d4a017";
      ctx.fillRect(x - 2, y - 2, 4, 4);
    });
  }

  function render(d) {
    state.data = d;
    const live = document.getElementById("trace-live");
    if (live) {
      live.textContent = d.replay ? "REPLAY ●" : (d.live ? "LIVE ●" : "IDLE ○");
      live.classList.toggle("off", !d.live && !d.replay);
    }
    const who = document.getElementById("trace-who");
    if (who) who.textContent = ((d.agent === "helix" ? "HERMES" : String(d.agent || "").toUpperCase()) + " // COGNITIVE TRACE");
    const mx = document.getElementById("trace-matrix");
    if (mx) {
      mx.innerHTML = (d.matrix || []).map((m) => {
        const mark = m.status === "THINKING" ? "◉" : (m.status === "DARK" ? "○" : "●");
        const on = m.id === state.agent ? " on" : "";
        return `<button type="button" data-agent="${esc(m.id)}" class="${on}"><span>${mark} ${esc(m.label)}</span><span class="st ${esc(m.status)}">${esc(m.status)}</span></button>`;
      }).join("") || `<div class="empty">NO TELEMETRY</div>`;
    }
    const sg = document.getElementById("trace-stages");
    if (sg) {
      const lit = d.stages || {};
      sg.innerHTML = STAGES.map((s) => {
        const cls = d.stage === s ? "cur" : (lit[s] ? "on" : "");
        return `<i class="${cls}">${s}</i>`;
      }).join("");
    }
    const stack = document.getElementById("trace-stack");
    if (stack) {
      const lit = d.stages || {};
      const req = (d.timeline || []).filter((x) => x.kind === "REQUEST").slice(-1)[0];
      const rsp = (d.timeline || []).filter((x) => x.kind === "RESPONSE").slice(-1)[0];
      const mark = (name) => d.stage === name ? "◉" : (lit[name] ? "●" : "○");
      const cls = (name) => d.stage === name ? "cur" : (lit[name] ? "on" : "");
      const plan = (d.plan || []).length ? d.plan.map((p) => esc(p)).join("\n") : (d.reasoning_summary || "NO TELEMETRY");
      const res = d.result ? `${d.result.tool || ""} // ${d.result.summary || ""}`.trim() : "NO TELEMETRY";
      const rows = [
        ["REQUEST", req && req.summary ? `“${req.summary}”` : (d.objective || "NO TELEMETRY")],
        ["PLAN", plan],
        ["TOOL", d.tool || "NO TELEMETRY"],
        ["RESULT", res],
        ["ANALYSIS", d.reasoning_summary || "NO TELEMETRY"],
        ["NEXT", d.next || "NO TELEMETRY"],
        ["RESPONSE", rsp && rsp.summary ? rsp.summary : (d.outcome || "NO TELEMETRY")],
      ];
      stack.innerHTML = rows.map(([n, b]) => {
        const empty = !b || b === "NO TELEMETRY";
        return `<div class="ts-row"><div class="ts-h ${cls(n === "ANALYSIS" ? "DECISION" : n)}">${mark(n === "ANALYSIS" ? "DECISION" : n)} ${n}</div><div class="ts-b${empty ? " empty" : ""}">${esc(b)}</div></div>`;
      }).join("");
    }
    const kv = document.getElementById("trace-kv");
    if (kv) {
      const tok = d.tokens ? `IN ${d.tokens.in ?? "—"} / OUT ${d.tokens.out ?? "—"}` : "NO TELEMETRY";
      const tps = d.tokens_per_s == null ? "NO TELEMETRY" : d.tokens_per_s + "/s";
      const res = d.result ? `${d.result.tool} · ${d.result.summary || ""}` : "NO TELEMETRY";
      kv.innerHTML = [
        ["OBJECTIVE", d.objective || "NO TELEMETRY"],
        ["STAGE", d.stage || "IDLE"],
        ["TOOL", d.tool || "NO TELEMETRY"],
        ["LAST RESULT", res],
        ["NEXT", d.next || "NO TELEMETRY"],
        ["OUTCOME", d.outcome || "NO TELEMETRY"],
        ["ELAPSED", clock(d.elapsed_s)],
        ["MODEL", d.model || "NO TELEMETRY"],
        ["TOKEN USAGE", tok],
        ["TOKENS/S", tps],
      ].map(([k, v]) => `<div><b>${k}</b> ${esc(v)}</div>`).join("");
    }
    const tl = document.getElementById("trace-tl");
    if (tl) {
      const items = (d.timeline || []).slice().reverse();
      tl.innerHTML = items.length
        ? items.map((ev) => {
          const open = state.selEvent && String(state.selEvent) === String(ev.id);
          let extra = "";
          if (open && ev.detail) {
            const det = ev.detail;
            extra = `<div class="exp">${esc(JSON.stringify({
              TOOL: det.tool,
              ARGUMENTS: det.arguments,
              DURATION: det.duration_s,
              STATUS: det.status,
              RESULT: det.result,
            }, null, 2))}</div>`;
          } else if (open && ev.summary) {
            extra = `<div class="exp">${esc(ev.summary)}</div>`;
          }
          return `<button type="button" data-ev="${esc(ev.id)}"><span class="k">${esc(ev.t)}</span>${esc(ev.label)}</button>${extra}`;
        }).join("")
        : `<div class="empty">idle_</div>`;
    }
    const st = document.getElementById("trace-stream");
    if (st) {
      if (!d.stream_available && !(d.stream || []).length) {
        st.innerHTML = `<div class="empty">NO TELEMETRY · observable events only</div>`;
      } else {
        const lines = (d.stream || []).slice();
        if (d.reasoning_summary) lines.push({ tag: "SUMMARY", text: d.reasoning_summary });
        if (d.next && d.next !== "NO TELEMETRY") lines.push({ tag: "NEXT", text: d.next });
        st.innerHTML = lines.map((ln) => `<div class="${esc(ln.tag)}">[${esc(ln.tag)}] ${esc(ln.text)}</div>`).join("") || `<div class="empty">idle_</div>`;
        st.scrollTop = st.scrollHeight;
      }
    }
    const ar = document.getElementById("trace-arch");
    if (ar) {
      ar.innerHTML = (d.archive || []).map((a) => {
        const on = state.run === a.id ? " on" : "";
        const dur = a.duration_s == null ? "" : (`  ${a.duration_s}s`);
        return `<button type="button" class="${on}" data-run="${esc(a.id)}">${esc(a.t)}  ${esc(a.title)}${esc(dur)}</button>`;
      }).join("") || `<div class="empty">NO TELEMETRY</div>`;
    }
    const card = document.getElementById("ft-trace-body");
    if (card) {
      const tool = d.tool ? `└─ ${d.tool}` : "└─ —";
      card.innerHTML = `<div class="ft-v">${esc(d.stage || "IDLE")}</div><div class="ft-k">${esc(tool)}</div><div class="ft-k">${d.live ? "ACTIVE" : "IDLE"}  ${esc(clock(d.elapsed_s))}</div>`;
    }
    const hel = document.getElementById("hel-01");
    if (hel) hel.textContent = helArt(d);
    const line = document.getElementById("hel-01-line");
    if (line) line.textContent = "HΞL-01: " + (d.hel_line || "standing by.");
    const key = (d.agent || "") + "|" + (d.session_id || "") + "|" + (state.run || "live");
    if (state.busKey !== key) {
      state.busKey = key;
      state.seenPkt = {};
      state.flights = [];
      if (d.replay) {
        (d.packets || []).forEach((p, i) => {
          state.seenPkt[p.id] = 1;
          state.flights.push({ from: p.from, to: p.to, t0: performance.now() + i * 170, dur: 720 });
        });
      }
    }
    if (!d.replay) {
      (d.packets || []).forEach((p) => {
        if (state.seenPkt[p.id]) return;
        state.seenPkt[p.id] = 1;
        if (!d.live) return;
        state.flights.push({ from: p.from, to: p.to, t0: performance.now(), dur: 720 });
      });
    }
    drawGraph(d);
  }

  async function load() {
    try {
      const q = new URLSearchParams({ agent: state.agent, retain: String(state.retain) });
      if (state.run) q.set("run", state.run);
      const r = await fetch(api("/api/trace?" + q.toString()), { cache: "no-store" });
      if (!r.ok) return;
      render(await r.json());
    } catch (e) {}
  }

  function loop() {
    drawGraph(state.data || { matrix: [], packets: [] });
    state.raf = requestAnimationFrame(loop);
  }

  function mount() {
    const root = document.getElementById("pane-trace");
    if (!root) return;
    root.addEventListener("click", (e) => {
      const ag = e.target.closest("[data-agent]");
      if (ag) {
        state.agent = ag.dataset.agent;
        state.run = "";
        load();
        return;
      }
      const ev = e.target.closest("[data-ev]");
      if (ev) {
        state.selEvent = state.selEvent === ev.dataset.ev ? null : ev.dataset.ev;
        if (state.data) render(state.data);
        return;
      }
      const run = e.target.closest("[data-run]");
      if (run) {
        state.run = run.dataset.run;
        load();
      }
    });
    document.getElementById("trace-close")?.addEventListener("click", () => {
      document.body.classList.remove("trace-open");
      document.querySelector('#tabs [data-tab="ops"]')?.click();
    });
    document.getElementById("ft-trace")?.addEventListener("click", () => {
      document.body.classList.add("trace-open");
      const b = document.querySelector('#tabs [data-tab="trace"]');
      if (b) b.click();
    });
    document.getElementById("trace-retain")?.addEventListener("change", (e) => {
      const n = parseInt(e.target.value, 10);
      if (n) {
        state.retain = Math.max(4, Math.min(48, n));
        try { localStorage.setItem("helix_trace_retain", String(state.retain)); } catch (err) {}
        load();
      }
    });
    try {
      const saved = parseInt(localStorage.getItem("helix_trace_retain") || "", 10);
      if (saved) state.retain = Math.max(4, Math.min(48, saved));
    } catch (e) {}
    const sel = document.getElementById("trace-retain");
    if (sel) sel.value = String(state.retain);
    load();
    state.timer = setInterval(load, 1500);
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cancelAnimationFrame(state.raf);
      state.raf = requestAnimationFrame(loop);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelAnimationFrame(state.raf);
      else if (!matchMedia("(prefers-reduced-motion: reduce)").matches) state.raf = requestAnimationFrame(loop);
    });
  }

  global.HelixTrace = { mount, open(agent) { state.agent = agent || "helix"; state.run = ""; load(); document.body.classList.add("trace-open"); }, state };
})(window);
