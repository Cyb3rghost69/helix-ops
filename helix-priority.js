/* HELIX priority engine — deterministic, hysteresis, explainable. No layout jitter. */
(function (global) {
  const MARGIN = 12;
  const MIN_SHOW = 8000;
  const COOLDOWN = 6000;
  const DECAY_MS = 25000;
  const panels = {
    hermes: { base: 45, label: "HERMES", tab: "ops" },
    cog: { base: 42, label: "COGNITIVE LOAD", tab: "ops" },
    system: { base: 30, label: "SYSTEM CORE", tab: "sec" },
    net: { base: 28, label: "NETWORK PULSE", tab: "net" },
    memory: { base: 26, label: "MEMORY MATRIX", tab: "matrix" },
    botmesh: { base: 24, label: "BOTMESH", tab: "ops" },
    remote: { base: 22, label: "REMOTE MATRIX", tab: "remote" },
    events: { base: 18, label: "EVENT BUS", tab: "ops" },
    adze: { base: 20, label: "DUAL COGNITIVE CORE", tab: "trace" },
    medic: { base: 16, label: "MEDIC", tab: "medic" }
  };
  const scores = {};
  const why = {};
  const pins = {};
  const mute = {};
  const history = [];
  let primary = ["hermes", "cog"];
  let lastPromote = 0;
  let holdUntil = 0;
  let interactingUntil = 0;
  let lastHel = "";
  let cfg = { adaptive: true, autoPromote: true, criticalOverride: true, sensitivity: "NORMAL", recoveryHold: "NORMAL" };
  const recovered = [];

  function margin() {
    return cfg.sensitivity === "HIGH" ? 8 : cfg.sensitivity === "LOW" ? 18 : MARGIN;
  }
  function minShow() {
    return cfg.recoveryHold === "LONG" ? 14000 : cfg.recoveryHold === "SHORT" ? 4000 : MIN_SHOW;
  }
  function setCfg(next) {
    cfg = Object.assign({}, cfg, next || {});
  }

  function now() { return Date.now(); }
  function decay(prev, t) {
    const age = now() - (t || 0);
    if (age > DECAY_MS) return Math.max(0, prev - 8);
    return prev;
  }
  function bump(id, add, reason, severity) {
    if (!panels[id] || mute[id]) return;
    const prev = scores[id] || { v: panels[id].base, t: now() };
    const v = Math.min(100, Math.max(0, decay(prev.v, prev.t) + add));
    scores[id] = { v: v, t: now(), sev: severity || 0 };
    if (reason) why[id] = reason;
  }
  function snapshot() {
    const out = [];
    Object.keys(panels).forEach((id) => {
      const base = panels[id].base;
      const row = scores[id] || { v: base, t: 0, sev: 0 };
      let v = decay(row.v, row.t);
      if (pins[id]) v = Math.max(v, 90);
      out.push({
        id,
        label: panels[id].label,
        tab: panels[id].tab,
        score: Math.round(v),
        why: why[id] || "BASE PRIORITY",
        pin: !!pins[id],
        parts: explain(id, v)
      });
    });
    out.sort((a, b) => b.score - a.score);
    return out;
  }
  function explain(id, total) {
    const base = panels[id].base;
    const row = scores[id] || { v: base, sev: 0 };
    return [
      ["BASE PRIORITY", base],
      ["SEVERITY", row.sev || 0],
      ["ACTIVE DELTA", Math.round(total - base)]
    ];
  }
  function ingest(sample) {
    sample = sample || {};
    const h = sample.hermes || {};
    const c = sample.compute || {};
    const mesh = sample.mesh || {};
    const rem = sample.remote || {};
    const mx = sample.matrix || {};
    const ad = sample.adze || {};
    const medic = sample.medic || {};
    const thoughts = sample.thoughts || [];
    const busy = (sample.agents && sample.agents.helix && sample.agents.helix.status === "busy") || /busy|tool/i.test(String(h.status || ""));
    if (busy) bump("hermes", 18, "ACTIVE REQUEST", 20);
    if (thoughts.length) bump("cog", 8, "INFERENCE ACTIVITY", 5);
    if (h.gateway_running === false) bump("hermes", 40, "GATEWAY DOWN", 80);
    const cpu = c.used_pct;
    if (cpu != null && cpu >= 85) bump("system", 25, "CPU " + Math.round(cpu) + "%", 60);
    else if (cpu != null && cpu >= 70) bump("system", 10, "CPU " + Math.round(cpu) + "%", 30);
    const ram = (c.mem_total_gb > 0) ? (100 * c.mem_used_gb / c.mem_total_gb) : null;
    if (ram != null && ram >= 84) bump("system", 28, "RAM " + Math.round(ram) + "%", 70);
    const nodes = mesh.nodes || [];
    const lost = nodes.filter((n) => n.online === false);
    if (lost.length) bump("botmesh", 40, "NODE " + (lost[0].name || lost[0].id || "") + " LINK LOST", 91);
    if (rem.hbbs === false) bump("remote", 45, "HBBS OFFLINE", 85);
    const banks = (mx && mx.banks) || [];
    if (mx && mx.ok === false) bump("memory", 20, "MATRIX SCAN FAIL", 40);
    banks.forEach((b) => {
      const u = b.utilization;
      if (u == null) return;
      if (u >= 90) bump("memory", 42, (b.id || "MEM") + " " + u + "%", 85);
      else if (u >= 80) bump("memory", 32, (b.name || "CORE MEMORY") + " " + u + "%", 70);
      else if (u >= 70) bump("memory", 18, (b.id || "MEM") + " " + u + "%", 50);
    });
    if (mx && mx.revision && mx.revision.pendingLoad) bump("memory", 22, "SESSION SNAPSHOT STALE", 45);
    if (banks.length) {
      const ext = banks.find((b) => b.type === "EXTERNAL");
      if (ext && ext.status === "OFFLINE") bump("memory", 36, "EXTERNAL MEMORY OFFLINE", 80);
      const sess = banks.find((b) => b.type === "SESSION");
      if (sess && sess.status === "OFFLINE") bump("memory", 40, "SESSION DATABASE ERROR", 85);
    }
    if (ad && ad.online === false) bump("adze", 6, "ADZE OFFLINE", 10);
    if (ad && /DIVERGENCE|NOT REACHED/i.test(String((ad.last && ad.last.state) || ad.state || ""))) bump("adze", 35, "COGNITIVE DIVERGENCE", 70);
    if (medic && medic.need) bump("medic", 30, "MEDIC ATTENTION", 60);
    tickLayout();
  }
  function tickLayout() {
    if (now() < interactingUntil) return;
    const list = snapshot();
    const top = list.filter((x) => !mute[x.id]);
    if (!top.length) return;
    const cand = top[0];
    const cur = primary[0];
    const curRow = top.find((x) => x.id === cur) || { score: 0 };
    const pinnedTop = top.find((x) => x.pin);
    let next = primary.slice();
    if (pinnedTop) {
      const crit = cand.sev >= 90 && cfg.criticalOverride && cand.score >= (pinnedTop.score || 0) + margin();
      if (crit && cand.id !== pinnedTop.id) {
        next = [cand.id, pinnedTop.id].slice(0, 2);
        lastPromote = now();
        holdUntil = now() + minShow();
        history.unshift({ t: now(), id: cand.id, dir: "up", why: cand.why, score: cand.score });
        flash("CRITICAL OVERRIDE");
        speak(cand.label + " promoted. " + cand.why);
      } else {
        next[0] = pinnedTop.id;
      }
    } else if (!cfg.autoPromote) {
      /* operator disabled promotion */
    } else if (cand.id !== cur && cand.score >= curRow.score + margin() && now() >= holdUntil) {
      next = [cand.id, cur].filter((v, i, a) => a.indexOf(v) === i).slice(0, 2);
      lastPromote = now();
      holdUntil = now() + minShow();
      history.unshift({ t: now(), id: cand.id, dir: "up", why: cand.why, score: cand.score });
      if (history.length > 24) history.pop();
      flash("DISPLAY PRIORITY UPDATED");
      speak(cand.label + " promoted. " + cand.why);
    } else if (cand.score < 40 && now() - lastPromote > COOLDOWN && primary[0] !== "hermes") {
      const prev = primary[0];
      next = ["hermes", "cog"];
      history.unshift({ t: now(), id: prev, dir: "down", why: "RECOVERY VERIFIED", score: cand.score });
      recovered.unshift({ t: now(), label: panels[prev] ? panels[prev].label : prev });
      if (recovered.length > 6) recovered.pop();
      speak("Nominal. Returning display to standard configuration.");
    }
    primary = next;
    render();
  }
  function flash(msg) {
    const el = document.getElementById("hx-prio-flash");
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
    setTimeout(() => { el.hidden = true; }, 900);
  }
  function speak(line) {
    if (line === lastHel) return;
    lastHel = line;
    const h = document.getElementById("hel-01-line");
    if (h) h.textContent = "HΞL-01: " + line;
  }
  function render() {
    const list = snapshot();
    const attn = document.getElementById("hx-attn-body");
    if (attn) {
      const hot = list.filter((x) => x.score >= 60).slice(0, 4);
      const rec = recovered.filter((r) => now() - r.t < 6000);
      attn.innerHTML = (hot.length || rec.length)
        ? hot.map((x) => `<button type="button" class="hx-alert ${x.score >= 80 ? "crit" : "warn"}" data-hx-go="${x.tab}" data-hx-id="${x.id}">${x.score >= 80 ? "×" : "△"} ${esc(x.label)} ${x.score} · ${esc(x.why)}</button>`).join("")
          + rec.map((r) => `<span class="hx-alert rec">✓ RECOVERED ${esc(r.label)}</span>`).join("")
        : `<span class="empty">ATTN // 00 · NOMINAL</span>`;
    }
    const n = document.getElementById("hx-attn-n");
    if (n) n.textContent = String(list.filter((x) => x.score >= 60).length).padStart(2, "0");
    const whyBox = document.getElementById("hx-why");
    if (whyBox) {
      const id = primary[0];
      const row = list.find((x) => x.id === id);
      if (row) {
        whyBox.innerHTML = `<div class="ident">${esc(row.label)}</div>
          <div>PRIORITY // ${row.score}</div>
          <div class="hx-why">PROMOTED: ${esc(row.why)}</div>
          ${row.parts.map((p) => `<div class="dim">${esc(p[0]).padEnd(18, " ")} ${p[1] >= 0 ? "+" : ""}${p[1]}</div>`).join("")}
          <div>TOTAL ${row.score}</div>`;
      }
    }
    const hist = document.getElementById("hx-hist");
    if (hist) {
      hist.innerHTML = history.slice(0, 8).map((h) => {
        const t = new Date(h.t).toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit" });
        return `<div>${t} ${esc(panels[h.id] ? panels[h.id].label : h.id)} ${h.dir === "up" ? "↑" : "↓"}</div>`;
      }).join("") || `<div class="empty">no promotions_</div>`;
    }
    document.querySelectorAll("[data-hx-panel]").forEach((el) => {
      const id = el.getAttribute("data-hx-panel");
      const row = list.find((x) => x.id === id);
      if (!row) return;
      let attn = "normal";
      if (row.score >= 80) attn = "critical";
      else if (row.score >= 60) attn = "warning";
      else if (row.score >= 40) attn = "attention";
      else if (row.score >= 20) attn = "active";
      el.setAttribute("data-attn", attn);
      const w = el.querySelector(".hx-why");
      if (w && primary[0] === id) w.textContent = "PROMOTED: " + row.why + " // " + row.score;
    });
    const ft = document.querySelector(".ft-grid");
    if (ft && document.body.classList.contains("field-term") && now() >= interactingUntil) {
      const order = ["hermes", "cog", "system", "net", "memory", "remote", "botmesh", "events"];
      const ranked = snapshot().map((x) => x.id);
      const seq = ranked.filter((id) => order.includes(id)).concat(order.filter((id) => !ranked.includes(id)));
      const cards = [...ft.children];
      cards.forEach((c, i) => { c.style.order = String(Math.min(i, 20)); });
    }
    const go = (tab) => {
      const b = document.querySelector('#tabs [data-tab="' + tab + '"]');
      if (b) b.click();
    };
    document.getElementById("hx-attn-body")?.querySelectorAll("[data-hx-go]")?.forEach((b) => {
      b.onclick = () => go(b.getAttribute("data-hx-go"));
    });
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function pin(id, on) {
    if (on) pins[id] = true; else delete pins[id];
    render();
  }
  function markInteract() {
    interactingUntil = now() + 4000;
  }
  function mount() {
    ["pointerdown", "keydown", "touchstart"].forEach((ev) => {
      document.addEventListener(ev, markInteract, { passive: true });
    });
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-hx-pin]");
      if (!btn) return;
      const id = btn.getAttribute("data-hx-pin");
      const on = !btn.classList.contains("on");
      btn.classList.toggle("on", on);
      btn.textContent = on ? "PINNED" : "PIN";
      pin(id, on);
    });
    render();
    setInterval(tickLayout, 2500);
  }
  global.HelixPriority = { mount, ingest, snapshot, pin, setCfg, history, why: () => snapshot() };
})(window);
