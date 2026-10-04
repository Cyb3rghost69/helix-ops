/* HELIX SYSTEM ORCHESTRATOR — one coordinator, real telemetry only. */
(function (global) {
  const KEY = "helix_ops_orch";
  const NAV = {
    status: "ops", hermes: "ops", cognitive: "ops", memory: "matrix",
    network: "net", nodes: "ops", remote: "remote", services: "sec",
    storage: "sec", security: "sec", events: "ops", theme: "control", layout: "control"
  };
  const IDS = {
    hermes: "COG://HERMES-01", cog: "COG://LOAD-01", adze: "COG://ADZE-01",
    memory: "MEM://HERMES-01", net: "NET://PULSE-01", botmesh: "NET://BOTMESH",
    remote: "REM://RUSTDESK", system: "SYS://CORE-01", events: "SYS://BUS-01"
  };
  const state = {
    system: "NOMINAL",
    chips: {},
    bottleneck: { name: "NONE", evidence: [], likely: false },
    flight: [],
    histMode: false,
    histT: null,
    recovered: [],
    idle: true,
    fps: 60,
    lastHel: "",
    age: {},
    cfg: {
      adaptive: true, autoPromote: true, criticalOverride: true,
      sensitivity: "NORMAL", recoveryHold: "NORMAL", density: "standard", recorder: "1H"
    }
  };

  function loadCfg() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null") || {};
      state.cfg = Object.assign({}, state.cfg, raw);
    } catch (e) {}
  }
  function saveCfg(partial) {
    state.cfg = Object.assign({}, state.cfg, partial, { t: Date.now() });
    try { localStorage.setItem(KEY, JSON.stringify(state.cfg)); } catch (e) {}
    applyCfg();
    paintCfg();
  }
  function applyCfg() {
    document.body.setAttribute("data-hx-density", state.cfg.density || "standard");
    const p = global.HelixPriority;
    if (p && p.setCfg) p.setCfg(state.cfg);
  }

  function markAge(src) { state.age[src] = Date.now(); }
  function ageLabel(src, maxMs) {
    const t = state.age[src];
    if (!t) return "NO TELEMETRY";
    const a = Date.now() - t;
    if (a > (maxMs || 45000)) return "STALE";
    return "LIVE";
  }

  function derive(sample) {
    sample = sample || {};
    const h = sample.hermes || {};
    const c = sample.compute || {};
    const mx = sample.matrix || {};
    const rem = sample.remote || {};
    const mesh = sample.mesh || {};
    const ad = sample.adze || {};
    const agents = sample.agents || {};
    const helix = agents.helix || {};
    const banks = mx.banks || [];
    const core = banks.find((b) => b.type === "CORE") || {};
    const lost = (mesh.nodes || []).filter((n) => n.online === false);
    const busy = helix.status === "busy" || /busy|tool/i.test(String(h.status || ""));
    const gw = h.gateway_running;
    const cpu = c.used_pct;
    const ram = (c.mem_total_gb > 0) ? (100 * c.mem_used_gb / c.mem_total_gb) : null;
    const gpu = c.gpu && (c.gpu.util != null ? c.gpu.util : c.gpu.used_pct);
    const vram = c.gpu && (c.gpu.vram_pct != null ? c.gpu.vram_pct : c.gpu.mem_pct);
    const memU = core.utilization;
    const extOff = banks.some((b) => b.type === "EXTERNAL" && b.status === "OFFLINE");
    const sessOff = banks.some((b) => b.type === "SESSION" && b.status === "OFFLINE");
    const prio = (global.HelixPriority && HelixPriority.snapshot && HelixPriority.snapshot()) || [];
    const top = prio[0] || { score: 0, id: "" };
    const crit = prio.filter((x) => x.score >= 80);
    const warn = prio.filter((x) => x.score >= 60);

    let system = "NOMINAL";
    if (gw === false) system = "DEGRADED";
    if (lost.length || rem.hbbs === false || extOff || sessOff) system = "DEGRADED";
    if (crit.length) system = "CRITICAL";
    else if (warn.length) system = "ATTENTION";
    else if (busy) system = "BUSY";
    else if (helix.status === "idle" && gw) system = "ACTIVE";
    if (gw === false && !h.model) system = system === "CRITICAL" ? "CRITICAL" : "OFFLINE";
    const calm = system === "NOMINAL" || system === "ACTIVE";
    if (calm && ["DEGRADED", "CRITICAL", "ATTENTION"].indexOf(sample.prev) >= 0) {
      state.recoveryUntil = Date.now() + 8000;
      system = "RECOVERY";
    }
    if (calm && state.recoveryUntil && Date.now() < state.recoveryUntil) system = "RECOVERY";

    const evidence = [];
    let bot = "NONE";
    let likely = false;
    if (vram != null && vram >= 90) { bot = "VRAM"; evidence.push("VRAM " + Math.round(vram) + "%"); likely = true; }
    else if (gpu != null && gpu >= 92 && busy) { bot = "GPU"; evidence.push("GPU " + Math.round(gpu) + "%"); likely = true; }
    else if (cpu != null && cpu >= 90) { bot = "CPU"; evidence.push("CPU " + Math.round(cpu) + "%"); likely = true; }
    else if (ram != null && ram >= 90) { bot = "RAM"; evidence.push("RAM " + Math.round(ram) + "%"); likely = true; }
    else if (extOff) { bot = "EXTERNAL PROVIDER"; evidence.push("HONCHO OFFLINE"); likely = true; }

    const idle = !busy && (cpu == null || cpu < 35) && !warn.length && !lost.length;
    const chips = {
      hermes: gw ? (busy ? "BUSY" : "ON") : "OFF",
      net: (sample.tsOnline || gw) ? "ON" : "CHECK",
      mem: memU == null ? "—" : (memU >= 80 ? "WARN" : "ON"),
      remote: rem.hbbs === false ? "OFF" : (rem.hbbs ? "ON" : "—"),
      svc: "ON"
    };
    return { system, chips, bottleneck: { name: bot, evidence, likely }, idle, busy, memU, cpu, ram, gpu, top };
  }

  function glyph(sys) {
    if (sys === "CRITICAL" || sys === "OFFLINE") return "×";
    if (sys === "DEGRADED" || sys === "ATTENTION") return "△";
    if (sys === "RECOVERY") return "✓";
    return "●";
  }

  function speak(line) {
    if (!line || line === state.lastHel) return;
    state.lastHel = line;
    const h = document.getElementById("hel-01-line");
    if (h) h.textContent = "HΞL-01: " + line;
    const desk = document.getElementById("hel-01-desk");
    if (desk) {
      const mood = state.system === "CRITICAL" ? "(×﹏×)" : state.system === "ATTENTION" ? "(·ω·;)" : state.idle ? "(·ω·)" : "(｀·ω·´)";
      desk.textContent = " " + mood + "  HΞL-01 // " + state.system + "\n /| |\\";
    }
  }

  function record(d) {
    const cap = state.cfg.recorder === "7D" ? 400 : state.cfg.recorder === "24H" ? 360 : state.cfg.recorder === "6H" ? 240 : 180;
    const row = {
      t: Date.now(),
      system: d.system,
      cpu: d.cpu == null ? null : Math.round(d.cpu),
      ram: d.ram == null ? null : Math.round(d.ram),
      mem: d.memU == null ? null : d.memU,
      bottleneck: d.bottleneck.name,
      top: d.top && d.top.id,
      score: d.top && d.top.score
    };
    const last = state.flight[0];
    if (last && last.system === row.system && last.top === row.top && last.mem === row.mem && Math.abs((last.cpu || 0) - (row.cpu || 0)) < 3) {
      return;
    }
    state.flight.unshift(row);
    while (state.flight.length > cap) state.flight.pop();
  }

  function paintHeader(d) {
    const el = document.getElementById("hx-sys-state");
    if (el) {
      el.textContent = glyph(d.system) + " SYSTEM " + d.system;
      el.setAttribute("data-sev", d.system);
    }
    const chips = document.getElementById("hx-sys-chips");
    if (chips) {
      const c = d.chips;
      chips.textContent = "HERMES " + (c.hermes === "ON" || c.hermes === "BUSY" ? "●" : "○")
        + "  NET " + (c.net === "ON" ? "●" : "○")
        + "  MEM " + (c.mem === "WARN" ? "△" : (c.mem === "ON" ? "●" : "○"))
        + "  REMOTE " + (c.remote === "ON" ? "●" : (c.remote === "OFF" ? "×" : "○"))
        + "  SVC " + (c.svc === "ON" ? "●" : "○");
    }
    const ft = document.querySelector("#field .ft-title small");
    if (ft) ft.textContent = "FIELD TERMINAL · NODE://TKY-06 · " + glyph(d.system) + " SYSTEM " + d.system;
    document.body.setAttribute("data-hx-idle", d.idle ? "1" : "0");
    document.body.setAttribute("data-hx-sys", d.system);
    const bn = document.getElementById("hx-bottleneck");
    if (bn) {
      if (d.bottleneck.name === "NONE") bn.textContent = "BOTTLENECK  NONE";
      else bn.innerHTML = (d.bottleneck.likely ? "BOTTLENECK  " : "LIKELY BOTTLENECK  ")
        + d.bottleneck.name + "<div class=\"dim\">" + d.bottleneck.evidence.join(" · ") + "</div>";
    }
    const fl = document.getElementById("hx-flight");
    if (fl) {
      if (state.histMode) {
        fl.innerHTML = "<div class=\"ident\">HISTORICAL MODE · " + new Date(state.histT).toLocaleTimeString("en-GB", { hour12: false })
          + "</div><button type=\"button\" id=\"hx-live\">[ RETURN LIVE ]</button>";
      } else {
        fl.innerHTML = state.flight.slice(0, 8).map((r) => {
          const t = new Date(r.t).toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
          return "<button type=\"button\" class=\"hx-fl\" data-hx-t=\"" + r.t + "\">" + t + "  " + r.system
            + (r.mem != null ? "  MEM " + r.mem + "%" : "") + "</button>";
        }).join("") || "<div class=\"empty\">no recorder_</div>";
      }
    }
    Object.keys(IDS).forEach((id) => {
      document.querySelectorAll("[data-hx-panel=\"" + id + "\"]").forEach((el) => {
        el.setAttribute("data-hx-id", IDS[id]);
      });
    });
  }

  function paintCfg() {
    const box = document.getElementById("hx-orch-cfg");
    if (!box) return;
    const c = state.cfg;
    function bar(key, opts, cur) {
      return opts.map((o) => "<button type=\"button\" data-orch=\"" + key + "\" data-v=\"" + o + "\" class=\"" + (String(cur).toLowerCase() === String(o).toLowerCase() ? "on" : "") + "\">" + o + "</button>").join("");
    }
    box.innerHTML = "<div class=\"ident\">HELIX CONFIGURATION · システム設定</div>"
      + "<div class=\"ident\">ADAPTIVE LAYOUT</div><div class=\"hx-bar\">" + bar("adaptive", ["ON", "OFF"], c.adaptive ? "ON" : "OFF") + "</div>"
      + "<div class=\"ident\">AUTO PROMOTION</div><div class=\"hx-bar\">" + bar("autoPromote", ["ON", "OFF"], c.autoPromote ? "ON" : "OFF") + "</div>"
      + "<div class=\"ident\">CRITICAL OVERRIDE</div><div class=\"hx-bar\">" + bar("criticalOverride", ["ON", "OFF"], c.criticalOverride ? "ON" : "OFF") + "</div>"
      + "<div class=\"ident\">PROMOTION SENSITIVITY</div><div class=\"hx-bar\">" + bar("sensitivity", ["LOW", "NORMAL", "HIGH"], c.sensitivity) + "</div>"
      + "<div class=\"ident\">RECOVERY HOLD</div><div class=\"hx-bar\">" + bar("recoveryHold", ["SHORT", "NORMAL", "LONG"], c.recoveryHold) + "</div>"
      + "<div class=\"ident\">DISPLAY DENSITY</div><div class=\"hx-bar\">" + bar("density", ["compact", "standard", "dense"], c.density) + "</div>"
      + "<div class=\"ident\">FLIGHT RECORDER</div><div class=\"hx-bar\">" + bar("recorder", ["1H", "6H", "24H"], c.recorder) + "</div>"
      + "<p class=\"dim\">Defaults: adaptive ON · auto promotion ON · sensitivity NORMAL · theme HELIX/89 · motion ENHANCED. Contrast floor enforced.</p>";
  }

  function tick() {
    if (document.hidden) return;
    const noc = (global.HelixNoc && HelixNoc.state) || {};
    if (noc.hermes) markAge("hermes");
    if (noc.compute) markAge("compute");
    const sample = {
      hermes: noc.hermes || {},
      compute: noc.compute || {},
      mesh: noc.mesh || {},
      agents: noc.agents || {},
      thoughts: noc.thoughts || [],
      remote: (global.HelixRemote && HelixRemote.state && HelixRemote.state.data) || {},
      matrix: (global.HelixMatrix && HelixMatrix.state && HelixMatrix.state.data) || {},
      adze: (global.HelixAdze && HelixAdze.state) || {},
      tsOnline: !!(noc.hermes && noc.hermes.gateway_running),
      prev: state.system
    };
    const d = derive(sample);
    const prev = state.system;
    state.system = d.system;
    state.chips = d.chips;
    state.bottleneck = d.bottleneck;
    state.idle = d.idle;
    if (!state.histMode) {
      record(d);
      paintHeader(d);
    }
    if (d.system !== prev) {
      if (d.system === "NOMINAL") speak("System nominal.");
      else if (d.system === "CRITICAL") speak((d.top && d.top.why) || "Critical attention.");
      else if (d.system === "ATTENTION") speak((d.top && d.top.label ? d.top.label + " requires attention." : "System attention."));
      else if (d.system === "BUSY") speak("Hermes inference load elevated.");
      else if (d.system === "DEGRADED") speak("Subsystem degraded.");
      else if (d.system === "RECOVERY") speak("All priority events resolved.");
      else if (d.system === "OFFLINE") speak("Uplink check.");
    }
    const mot = global.HelixTheme && HelixTheme.state && HelixTheme.state.motion;
    if (mot === "enhanced") {
      document.documentElement.style.setProperty("--hx-animation-speed", d.idle ? "0.45" : "1");
    }
  }

  function go(tab) {
    const b = document.querySelector("#tabs [data-tab=\"" + tab + "\"]");
    if (b) b.click();
  }

  function bind() {
    const box = document.getElementById("hx-orch-cfg");
    if (box && !box.dataset.bound) {
      box.dataset.bound = "1";
      box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-orch]");
        if (!b) return;
        const k = b.getAttribute("data-orch");
        let v = b.getAttribute("data-v");
        if (k === "adaptive" || k === "autoPromote" || k === "criticalOverride") v = v === "ON";
        saveCfg({ [k]: v });
      });
    }
    document.getElementById("hx-flight")?.addEventListener("click", (e) => {
      const live = e.target.closest("#hx-live");
      if (live) {
        state.histMode = false;
        state.histT = null;
        document.body.classList.remove("hx-hist");
        tick();
        return;
      }
      const b = e.target.closest("[data-hx-t]");
      if (!b) return;
      state.histMode = true;
      state.histT = Number(b.getAttribute("data-hx-t"));
      document.body.classList.add("hx-hist");
      paintHeader({ system: state.system, chips: state.chips, bottleneck: state.bottleneck, idle: state.idle, top: {} });
    });
    const q = document.getElementById("q");
    if (q && !q.dataset.orch) {
      q.dataset.orch = "1";
      q.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const cmd = String(q.value || "").trim().toLowerCase();
        if (NAV[cmd]) {
          e.preventDefault();
          go(NAV[cmd]);
          q.value = "";
        }
      });
    }
  }

  function mount() {
    loadCfg();
    applyCfg();
    paintCfg();
    bind();
    tick();
    setInterval(tick, 1000);
  }

  global.HelixOrch = { mount, tick, derive, state, saveCfg, go, IDS, ageLabel };
})(window);
