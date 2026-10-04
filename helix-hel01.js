/* H.E.L.I.X. SYSTEM OPERATOR — event-driven ASCII, not Hermes. */
(function (global) {
  const FACES = {
    IDLE: " (·ω·)\n /| |\\\\",
    BLINK: " (·-·)\n /| |\\\\",
    OBSERVING: " (·ω·)\n /| |\\\\",
    TYPING: " (·ωo)\n /| |\\\\",
    THINKING: " (｀·ω·´)\n /| |\\\\",
    NETWORK: " (·ω·)~\n /| |\\\\",
    MEMORY: " (·ω·)*\n /| |\\\\",
    "HERMES ACTIVE": " (｀·ω·´)\n /| |\\\\",
    "ADZE ACTIVE": " (·ω·;)\n /| |\\\\",
    REMOTE: " (·ω·)~\n /| |\\\\",
    WARNING: " (·ω·)!\n /| |\\\\",
    RECOVERY: " (·ω·)\n /| |\\\\"
  };
  const state = { mode: "IDLE", line: "standing by.", t: 0, lastLine: "" };
  let blinkOn = false;

  function paint() {
    const face = FACES[state.mode] || FACES.IDLE;
    const shown = (state.mode === "IDLE" && blinkOn) ? FACES.BLINK : face;
    const hel = document.getElementById("hel-01");
    const desk = document.getElementById("hel-01-desk");
    const line = document.getElementById("hel-01-line");
    if (hel) hel.textContent = shown;
    if (desk) desk.textContent = shown.replace(/\n/g, " ") + "  HΞL-01 // " + state.mode;
    if (line) line.textContent = "HΞL-01: " + state.line;
  }
  function note(mode, line) {
    if (!mode) return;
    const next = String(mode).toUpperCase();
    const msg = (line || "").trim();
    if (next === state.mode && msg === state.lastLine) return;
    state.mode = FACES[next] ? next : state.mode;
    if (msg && msg !== state.lastLine) {
      state.line = msg.slice(0, 80);
      state.lastLine = msg;
    }
    state.t = Date.now();
    paint();
  }
  function derive() {
    const orch = global.HelixOrch && HelixOrch.state;
    const noc = (global.HelixNoc && HelixNoc.state) || {};
    const rem = (global.HelixRemote && HelixRemote.state && HelixRemote.state.data) || {};
    const mx = (global.HelixMatrix && HelixMatrix.state && HelixMatrix.state.data) || {};
    const ad = (global.HelixAdze && HelixAdze.state) || {};
    const helix = (noc.agents && noc.agents.helix) || {};
    const sys = orch && orch.system;
    if (sys === "CRITICAL" || sys === "DEGRADED") {
      return note("WARNING", sys === "CRITICAL" ? "Critical attention." : "Subsystem degraded.");
    }
    if (sys === "RECOVERY") return note("RECOVERY", "All priority events resolved.");
    if (helix.status === "busy" || /busy|tool/i.test(String((noc.hermes || {}).status || ""))) {
      return note("HERMES ACTIVE", "Hermes processing.");
    }
    if (ad.online && /REVIEWING/i.test(String(ad.state || (ad.last && ad.last.state) || ""))) {
      return note("ADZE ACTIVE", "ADZE deliberation.");
    }
    if (mx.wrote) return note("MEMORY", "Memory commit confirmed.");
    const core = (mx.banks || []).find((b) => b.type === "CORE") || {};
    if (core.utilization != null && core.utilization >= 90) return note("MEMORY", "Memory pressure elevated.");
    if (rem.hbbs === false) return note("REMOTE", "Remote uplink check.");
    if (rem.session) return note("REMOTE", "Remote session.");
    if (sys === "BUSY" || sys === "ACTIVE") return note("OBSERVING", "System " + String(sys).toLowerCase() + ".");
    if (sys === "ATTENTION") return note("WARNING", "System attention.");
    note("IDLE", "System nominal.");
  }
  function mount() {
    paint();
    setInterval(() => {
      blinkOn = !blinkOn;
      if (state.mode === "IDLE") paint();
    }, 1400);
    setInterval(derive, 1200);
  }
  global.HelixHel01 = { mount, note, derive, state };
})(window);
