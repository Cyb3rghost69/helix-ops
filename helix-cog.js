/* Cognitive load — observable Hermes/ADZE/compute only. Never fake intelligence %. */
(function (global) {
  const traces = { inference: [], context: [], tools: [], agents: [], gpu: [], memory: [] };
  const CAP = 90;
  let inspect = null;
  let lastThought = 0;
  let lastMemCode = "";
  let pulseEvents = [];

  function api(p) {
    const OPS = (typeof global.OPS === "string") ? global.OPS : ((location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "");
    return OPS + p;
  }
  function push(name, v) {
    if (v == null || Number.isNaN(Number(v))) return;
    const a = traces[name];
    if (!a) return;
    a.push(Number(v));
    while (a.length > CAP) a.shift();
    if (global.HelixGraph) HelixGraph.push("cog-" + name, v);
  }
  function bar(el, n) {
    if (!el) return;
    const v = n == null ? null : Math.max(0, Math.min(100, n));
    el.innerHTML = v == null
      ? "<span class=\"dim\">NO TELEMETRY</span>"
      : "<span class=\"bar\"><i style=\"width:" + v + "%\"></i></span><span>" + Math.round(v) + "</span>";
  }
  function stateLabel(sample) {
    const busy = sample.busy;
    const cpu = sample.cpu;
    if (sample.gateway === false) return "NOMINAL / GW CHECK";
    if (busy && cpu != null && cpu >= 85) return "SATURATED";
    if (busy) return "HIGH";
    if (sample.tools > 0) return "ACTIVE";
    return "LOW";
  }
  function draw() {
    const g = global.HelixGraph;
    const th = g ? g.theme() : { primary: "#7CFF7A", warning: "#E08A2A", secondary: "#6aa8a8" };
    const live = document.getElementById("hx-cog-live");
    if (g && live) {
      const series = [];
      if (traces.inference.length) series.push({ y: traces.inference, color: th.primary });
      if (traces.context.length) series.push({ y: traces.context, color: th.secondary });
      if (traces.tools.length) series.push({ y: traces.tools, color: th.warning });
      if (traces.agents.length) series.push({ y: traces.agents, color: "#c8ffc0" });
      if (traces.gpu.length) series.push({ y: traces.gpu, color: "#6aa8a8" });
      if (traces.memory.length) series.push({ y: traces.memory, color: th.warning });
      g.drawTrace(live, series, { min: 0, max: 100, inspect: inspect, label: "CH1 INF  CH2 CTX  CH3 MEM" });
    }
    const sc = document.getElementById("hx-cog-scope");
    if (g && sc) g.drawScope(sc, traces.inference);
    const heat = document.getElementById("hx-act-heat");
    if (g && heat) {
      const lanes = [traces.inference, traces.tools, traces.agents, traces.context, traces.gpu, traces.memory];
      const last = lanes.map((a) => (a.length ? a[a.length - 1] / 100 : 0));
      const vals = [];
      for (let r = 0; r < 6; r++) {
        const src = lanes[r] || [];
        for (let c = 0; c < 24; c++) {
          const idx = src.length - 24 + c;
          vals.push(idx >= 0 ? (src[idx] / 100) : 0);
        }
      }
      if (last.every((x) => !x) && !traces.inference.length && !traces.memory.length) g.drawHeat(heat, 6, 24, []);
      else g.drawHeat(heat, 6, 24, vals);
    }
  }
  function pulse(kind) {
    pulseEvents.push({ t: Date.now(), kind: kind });
    if (pulseEvents.length > 40) pulseEvents.shift();
    const osc = document.getElementById("hx-cog-osc");
    if (!osc || !global.HelixGraph) return;
    const now = Date.now();
    const samples = [];
    for (let i = 0; i < 80; i++) {
      const t = now - (80 - i) * 40;
      let y = 20;
      pulseEvents.forEach((p) => {
        const dt = t - p.t;
        if (dt < 0 || dt > 700) return;
        const mag = p.kind === "tool" ? 48 : p.kind === "adze" ? 36 : p.kind === "mem" ? 22 : 16;
        y += mag * Math.exp(-dt / 180) * Math.sin(dt / 25);
      });
      samples.push(y);
    }
    HelixGraph.drawScope(osc, samples, (HelixGraph.theme() || {}).secondary);
  }
  function paintVector(s) {
    const box = document.getElementById("hx-cog-vec");
    if (!box) return;
    function row(name, v) {
      if (v == null) return `<div class="r"><span>${name}</span><span class="dim">NO TELEMETRY</span><span></span></div>`;
      const n = Math.max(0, Math.min(100, v));
      return `<div class="r"><span>${name}</span><span class="bar"><i style="width:${n}%"></i></span><span>${Math.round(n)}</span></div>`;
    }
    box.innerHTML = row("INFERENCE", s.inf)
      + row("CONTEXT", s.ctx)
      + row("TOOLS", s.tools)
      + row("AGENTS", s.agents)
      + row("GPU", s.gpu)
      + row("MEMORY", s.mem)
      + `<div class="hx-state-lbl">STATE: ${s.label}</div>`;
  }
  function paintTokens(h) {
    const el = document.getElementById("hx-tokens");
    if (!el) return;
    const inT = h.prompt_tokens != null ? h.prompt_tokens : h.input_tokens;
    const outT = h.completion_tokens != null ? h.completion_tokens : h.output_tokens;
    const tps = h.tokens_per_sec != null ? h.tokens_per_sec : h.tps;
    const ctx = h.context_used != null ? h.context_used : null;
    const parts = [];
    parts.push("IN " + (inT == null ? "NO TELEMETRY" : inT));
    parts.push("OUT " + (outT == null ? "NO TELEMETRY" : outT));
    parts.push("T/S " + (tps == null ? "NO TELEMETRY" : tps));
    parts.push("CTX " + (ctx == null ? "NO TELEMETRY" : ctx));
    el.textContent = parts.join(" · ");
  }
  function paintPipe(sample) {
    const el = document.getElementById("hx-pipe");
    if (!el) return;
    const st = sample.stage || "idle";
    const nodes = ["USER", "HERMES", "MEMORY", "TOOL", "ADZE", "RESPONSE"];
    el.innerHTML = nodes.map((n) => {
      const on = (st === n.toLowerCase()) || (sample.busy && n === "HERMES") || (sample.adze && n === "ADZE") || (sample.memWrite && n === "MEMORY");
      return `<span class="${on ? "on" : "dim"}">${n}</span>`;
    }).join("<span class=\"dim\"> → </span>");
  }
  function paintOrbit(agents) {
    const el = document.getElementById("hx-orbit");
    if (!el) return;
    const names = ["helix", "adze", "prefect", "foreman", "scribe", "canon"];
    const live = names.filter((n) => agents && agents[n]);
    if (!live.length) {
      el.textContent = "NO TELEMETRY";
      return;
    }
    el.textContent = live.map((n) => {
      const st = (agents[n] && agents[n].status) || "dark";
      return n.toUpperCase() + ":" + String(st).toUpperCase();
    }).join(" · ");
  }
  function paintPressure(c) {
    const el = document.getElementById("hx-pressure");
    if (!el) return;
    const cpu = c.used_pct;
    const mem = (c.mem_total_gb > 0) ? (100 * c.mem_used_gb / c.mem_total_gb) : null;
    const gpu = (c.gpu && (c.gpu.util != null ? c.gpu.util : c.gpu.used_pct));
    const parts = [
      ["CPU", cpu],
      ["RAM", mem],
      ["GPU", gpu]
    ];
    let bot = null;
    let botV = -1;
    parts.forEach((p) => {
      if (p[1] != null && p[1] > botV) { botV = p[1]; bot = p[0]; }
    });
    el.innerHTML = parts.map((p) => {
      if (p[1] == null) return `<div>${p[0]} NO TELEMETRY</div>`;
      return `<div>${p[0]} ${Math.round(p[1])}%</div>`;
    }).join("") + (bot && botV >= 70 ? `<div class="hx-why">BOTTLENECK ${bot}</div>` : `<div class="dim">NO BOTTLENECK</div>`);
    if (global.HelixGraph) {
      HelixGraph.drawBars(document.getElementById("hx-pressure-bars"), parts.map((p) => ({
        v: p[1] == null ? 0 : p[1] / 100,
        color: p[1] == null ? "transparent" : undefined
      })));
    }
  }
  function ingestThoughts(items) {
    const rows = items || [];
    const latest = rows[0];
    if (latest && latest.ts && latest.ts !== lastThought) {
      lastThought = latest.ts;
      const k = String(latest.kind || latest.k || latest.type || "");
      if (/tool/i.test(k)) pulse("tool");
      else if (/adze/i.test(k)) pulse("adze");
      else pulse("tok");
    }
    const tools = rows.filter((x) => /tool/i.test(String(x.kind || x.k || ""))).length;
    push("tools", Math.min(100, tools * 12));
  }
  async function tick() {
    if (document.hidden) return;
    const noc = global.HelixNoc && HelixNoc.state || {};
    const h = noc.hermes || {};
    const c = noc.compute || {};
    const agents = noc.agents || {};
    const helix = agents.helix || {};
    const busy = helix.status === "busy" || /busy|tool/i.test(String(h.status || ""));
    const cpu = c.used_pct;
    const tps = h.tokens_per_sec != null ? h.tokens_per_sec : h.tps;
    if (tps != null) push("inference", Math.min(100, Number(tps)));
    if (helix.status) push("agents", helix.status === "busy" ? 70 : helix.status === "idle" ? 20 : 5);
    const gpu = c.gpu && (c.gpu.util != null ? c.gpu.util : c.gpu.used_pct);
    if (gpu != null) push("gpu", gpu);
    const ctx = h.context_pct != null ? h.context_pct : null;
    if (ctx != null) push("context", ctx);
    const mx = (global.HelixMatrix && HelixMatrix.state && HelixMatrix.state.data) || {};
    const coreB = (mx.banks || []).find((b) => b.type === "CORE") || {};
    if (coreB.utilization != null) push("memory", coreB.utilization);
    const lastEv = (mx.events || []).filter((e) => /WRITE|CONSOLIDATE/.test(String(e.code || ""))).pop();
    if (lastEv && lastEv.code !== lastMemCode) {
      lastMemCode = lastEv.code;
      pulse("mem");
    }
    const sample = {
      inf: traces.inference.length ? traces.inference[traces.inference.length - 1] : null,
      ctx: ctx,
      tools: traces.tools.length ? traces.tools[traces.tools.length - 1] : null,
      agents: traces.agents.length ? traces.agents[traces.agents.length - 1] : null,
      gpu: gpu,
      mem: coreB.utilization != null ? coreB.utilization : null,
      memWrite: !!mx.wrote,
      busy: busy,
      cpu: cpu,
      gateway: h.gateway_running,
      adze: !!(global.HelixAdze && HelixAdze.state && HelixAdze.state.online),
      label: stateLabel({ busy, cpu, gateway: h.gateway_running, tools: traces.tools.slice(-1)[0] || 0 }),
      stage: mx.wrote ? "memory" : (busy ? "hermes" : "idle")
    };
    paintVector(sample);
    paintTokens(h);
    paintPipe(sample);
    paintOrbit(agents);
    paintPressure(c);
    draw();
    if (global.HelixPriority) {
      HelixPriority.ingest({
        hermes: h,
        compute: c,
        mesh: noc.mesh,
        agents: agents,
        thoughts: noc.thoughts,
        remote: (global.HelixRemote && HelixRemote.state && HelixRemote.state.data) || {},
        matrix: (global.HelixMatrix && HelixMatrix.state && HelixMatrix.state.data) || {},
        adze: (global.HelixAdze && HelixAdze.state) || {}
      });
    }
  }
  function bindInspect() {
    const live = document.getElementById("hx-cog-live");
    if (!live || live.dataset.bound) return;
    live.dataset.bound = "1";
    const freeze = (ev) => {
      const r = live.getBoundingClientRect();
      const x = ((ev.clientX || (ev.touches && ev.touches[0].clientX) || 0) - r.left) / r.width;
      inspect = Math.round(x * Math.max(0, traces.inference.length - 1));
      const box = document.getElementById("hx-cog-inspect");
      if (box) {
        const inf = traces.inference[inspect];
        box.textContent = inspect == null ? "LIVE" : ("T+" + inspect + "  INFERENCE " + (inf == null ? "NO TELEMETRY" : Math.round(inf)));
      }
      live.setAttribute("aria-pressed", "true");
    };
    live.addEventListener("pointerdown", freeze);
    document.getElementById("hx-cog-livebtn")?.addEventListener("click", () => {
      inspect = null;
      const box = document.getElementById("hx-cog-inspect");
      if (box) box.textContent = "LIVE";
    });
  }
  function mount() {
    bindInspect();
    tick();
    setInterval(tick, 1000);
    document.addEventListener("helix-theme", draw);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) draw(); });
  }
  global.HelixCog = { mount, tick, ingestThoughts, pulse, traces };
})(window);
