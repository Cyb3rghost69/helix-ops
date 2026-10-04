/* HELIX visual system — apply tokens without scattering theme ifs in panels. */
(function (global) {
  const KEY = "helix_ops_visual";
  const THEMES = {
    "helix-89": {
      label: "HELIX/89",
      hel: "",
      tokens: {
        "--hx-bg": "#050805",
        "--hx-surface": "#070b07",
        "--hx-surface-raised": "#0b100b",
        "--hx-primary": "#7CFF7A",
        "--hx-primary-bright": "#c8ffc0",
        "--hx-primary-dim": "#3a8a38",
        "--hx-secondary": "#6aa8a8",
        "--hx-warning": "#E08A2A",
        "--hx-critical": "#c44a3a",
        "--hx-text": "#e8e4d4",
        "--hx-text-muted": "#7d8574",
        "--hx-grid": "rgba(80,255,90,0.035)",
        "--hx-border": "#243024",
        "--hx-trace": "#6aa8a8",
        "--hx-glow-strength": "0.32",
        "--hx-persist": "0.35",
        "--hx-scan-opacity": "0.7",
        "--hx-noise-opacity": "0.08",
        "--hx-font-display": "ui-monospace, Menlo, \"MS Gothic\", monospace",
        "--hx-font-data": "ui-monospace, Menlo, \"MS Gothic\", monospace",
        "--hx-radius": "0px",
        "--hx-line-width": "1px"
      }
    },
    "mono-crt": {
      label: "MONOCHROME CRT",
      hel: "hx-hel-mono",
      tokens: {
        "--hx-bg": "#000000",
        "--hx-surface": "#0a0a0a",
        "--hx-surface-raised": "#141414",
        "--hx-primary": "#e6e6e6",
        "--hx-primary-bright": "#ffffff",
        "--hx-primary-dim": "#888888",
        "--hx-secondary": "#b0b0b0",
        "--hx-warning": "#c8c8c8",
        "--hx-critical": "#ffffff",
        "--hx-text": "#e8e8e8",
        "--hx-text-muted": "#8a8a8a",
        "--hx-grid": "rgba(255,255,255,0.04)",
        "--hx-border": "#333333",
        "--hx-trace": "#aaaaaa",
        "--hx-glow-strength": "0.12",
        "--hx-persist": "0.08",
        "--hx-scan-opacity": "0.95",
        "--hx-noise-opacity": "0.05"
      }
    },
    amber: {
      label: "AMBER TERMINAL",
      hel: "hx-hel-amber",
      tokens: {
        "--hx-bg": "#0a0700",
        "--hx-surface": "#120e04",
        "--hx-surface-raised": "#1a1408",
        "--hx-primary": "#ffb000",
        "--hx-primary-bright": "#ffd27a",
        "--hx-primary-dim": "#a06e00",
        "--hx-secondary": "#c48920",
        "--hx-warning": "#ff8800",
        "--hx-critical": "#ff5533",
        "--hx-text": "#ffcc66",
        "--hx-text-muted": "#a07830",
        "--hx-grid": "rgba(255,176,0,0.05)",
        "--hx-border": "#3a2a10",
        "--hx-trace": "#ffb000",
        "--hx-glow-strength": "0.4",
        "--hx-persist": "0.42",
        "--hx-scan-opacity": "0.65",
        "--hx-noise-opacity": "0.07"
      }
    },
    aerospace: {
      label: "AEROSPACE WHITE",
      hel: "hx-hel-aero",
      tokens: {
        "--hx-bg": "#e6e2d8",
        "--hx-surface": "#f4f1ea",
        "--hx-surface-raised": "#ffffff",
        "--hx-primary": "#1e2a1e",
        "--hx-primary-bright": "#000000",
        "--hx-primary-dim": "#4a5548",
        "--hx-secondary": "#3a4a55",
        "--hx-warning": "#8a4a12",
        "--hx-critical": "#8a2020",
        "--hx-text": "#1a1c18",
        "--hx-text-muted": "#5a5e56",
        "--hx-grid": "rgba(20,30,20,0.06)",
        "--hx-border": "#b8b4aa",
        "--hx-trace": "#3a4a55",
        "--hx-glow-strength": "0.05",
        "--hx-persist": "0.05",
        "--hx-scan-opacity": "0.28",
        "--hx-noise-opacity": "0.02"
      }
    },
    "night-ops": {
      label: "NIGHT OPS",
      hel: "hx-hel-night",
      tokens: {
        "--hx-bg": "#020304",
        "--hx-surface": "#07090a",
        "--hx-surface-raised": "#0c1012",
        "--hx-primary": "#4a7a5a",
        "--hx-primary-bright": "#7cba8c",
        "--hx-primary-dim": "#2a4a34",
        "--hx-secondary": "#3a5a68",
        "--hx-warning": "#a07030",
        "--hx-critical": "#8a3030",
        "--hx-text": "#c4c8c0",
        "--hx-text-muted": "#5a645c",
        "--hx-grid": "rgba(74,122,90,0.04)",
        "--hx-border": "#1a2420",
        "--hx-trace": "#3a5a68",
        "--hx-glow-strength": "0.18",
        "--hx-persist": "0.16",
        "--hx-scan-opacity": "0.25",
        "--hx-noise-opacity": "0.04"
      }
    },
    custom: {
      label: "CUSTOM",
      hel: "",
      tokens: {}
    }
  };
  const MOTION = ["off", "reduced", "standard", "enhanced"];

  function deviceClass() {
    const w = innerWidth;
    if (w <= 767) return "mobile";
    if (w <= 1366) return "tablet";
    return "desktop";
  }
  function storageKey() {
    return KEY + "_" + deviceClass();
  }
  function load() {
    try {
      return JSON.parse(localStorage.getItem(storageKey()) || "null") || {};
    } catch (e) {
      return {};
    }
  }
  function save(partial) {
    const next = Object.assign(load(), partial, { t: Date.now() });
    try { localStorage.setItem(storageKey(), JSON.stringify(next)); } catch (e) {}
    return next;
  }
  function contrastOk(bg, fg) {
    function lum(hex) {
      const h = hex.replace("#", "");
      if (h.length !== 6) return 0;
      const r = parseInt(h.slice(0, 2), 16) / 255;
      const g = parseInt(h.slice(2, 4), 16) / 255;
      const b = parseInt(h.slice(4, 6), 16) / 255;
      const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    const L1 = lum(bg);
    const L2 = lum(fg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    return ratio >= 3.5;
  }
  function hexToRgb(hex) {
    const h = String(hex || "").replace("#", "");
    if (h.length !== 6) return "124,255,122";
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",");
  }
  function applyTokens(tokens) {
    const root = document.documentElement;
    Object.entries(tokens).forEach(([k, v]) => {
      if (v == null || v === "") return;
      root.style.setProperty(k, String(v));
    });
    const primary = tokens["--hx-primary"] || getComputedStyle(root).getPropertyValue("--hx-primary").trim();
    const themeColor = tokens["--hx-bg"] || getComputedStyle(root).getPropertyValue("--hx-bg").trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && themeColor) meta.setAttribute("content", themeColor);
    root.style.setProperty("--hx-primary-rgb", hexToRgb(primary));
  }
  function flashReconfig(from, to) {
    const el = document.getElementById("hx-reconfig");
    if (!el) return;
    el.hidden = false;
    el.textContent = "DISPLAY RECONFIGURATION\n" + (from || "").toUpperCase() + " → " + (to || "").toUpperCase() + "\nVISUAL BUS RESET";
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches || state.motion === "off";
    setTimeout(() => { el.hidden = true; }, reduce ? 80 : 520);
  }
  function helClass(theme) {
    document.body.classList.remove("hx-hel-mono", "hx-hel-amber", "hx-hel-aero", "hx-hel-night");
    const c = (THEMES[theme] || {}).hel;
    if (c) document.body.classList.add(c);
  }
  const state = {
    theme: "helix-89",
    motion: "enhanced",
    custom: {},
    layout: "auto"
  };

  function resolveMotion(want) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return want === "off" ? "off" : "reduced";
    }
    return MOTION.includes(want) ? want : "enhanced";
  }
  function mapAnimLegacy(motion) {
    if (motion === "off") return "OFF";
    if (motion === "reduced") return "REDUCED";
    return "FULL";
  }
  function applyMotion(motion, persist) {
    state.motion = resolveMotion(motion);
    document.body.setAttribute("data-hx-motion", state.motion);
    const b = document.getElementById("anim-tog");
    if (b) b.textContent = "ANIM: " + state.motion.toUpperCase();
    if (global.HelixOpsWordmark && HelixOpsWordmark.setAnim) {
      HelixOpsWordmark.setAnim(mapAnimLegacy(state.motion));
    }
    if (global.HelixNoc && HelixNoc.state) {
      HelixNoc.state.anim = state.motion === "off" ? "off" : (state.motion === "reduced" ? "reduced" : "full");
    }
    document.documentElement.style.setProperty("--hx-animation-speed", state.motion === "enhanced" ? "1" : state.motion === "standard" ? "0.8" : state.motion === "reduced" ? "0.4" : "0");
    if (persist !== false) save({ motion: state.motion });
    document.dispatchEvent(new CustomEvent("helix-motion", { detail: { motion: state.motion } }));
    paintVisual();
  }
  function applyTheme(name, opts) {
    opts = opts || {};
    const prev = state.theme;
    let id = THEMES[name] ? name : "helix-89";
    state.theme = id;
    let tokens = Object.assign({}, THEMES["helix-89"].tokens, (THEMES[id] && THEMES[id].tokens) || {});
    if (id === "custom") {
      const c = Object.assign({}, load().custom || {}, state.custom || {});
      state.custom = c;
      if (c.primary) tokens["--hx-primary"] = c.primary;
      if (c.secondary) tokens["--hx-secondary"] = c.secondary;
      if (c.bg) tokens["--hx-bg"] = c.bg;
      if (c.warning) tokens["--hx-warning"] = c.warning;
      if (c.critical) tokens["--hx-critical"] = c.critical;
      if (c.bg && c.primary && !contrastOk(c.bg, c.primary)) {
        tokens["--hx-primary"] = THEMES["helix-89"].tokens["--hx-primary"];
      }
      tokens["--hx-scan-opacity"] = String(c.scan == null ? 0.5 : c.scan);
      tokens["--hx-noise-opacity"] = String(c.noise == null ? 0.06 : c.noise);
      tokens["--hx-glow-strength"] = String(c.glow == null ? 0.28 : c.glow);
      tokens["--hx-persist"] = String(c.persist == null ? 0.3 : c.persist);
    }
    applyTokens(tokens);
    document.body.setAttribute("data-hx-theme", id);
    helClass(id);
    if (!opts.silent && prev && prev !== id) flashReconfig((THEMES[prev] || {}).label || prev, (THEMES[id] || {}).label || id);
    if (opts.persist !== false) save({ theme: id, custom: state.custom });
    document.dispatchEvent(new CustomEvent("helix-theme", { detail: { theme: id, tokens: tokens } }));
    paintVisual();
  }
  function cycleMotion() {
    const i = MOTION.indexOf(state.motion);
    applyMotion(MOTION[(i + 1) % MOTION.length]);
  }
  function get() {
    const cs = getComputedStyle(document.documentElement);
    const read = (k) => cs.getPropertyValue(k).trim();
    return {
      theme: state.theme,
      motion: state.motion,
      layout: state.layout,
      primary: read("--hx-primary") || "#7CFF7A",
      secondary: read("--hx-secondary") || "#6aa8a8",
      warning: read("--hx-warning") || "#E08A2A",
      critical: read("--hx-critical") || "#c44a3a",
      bg: read("--hx-bg") || "#050805",
      text: read("--hx-text") || "#e8e4d4",
      border: read("--hx-border") || "#243024",
      persist: parseFloat(read("--hx-persist") || "0.3") || 0.3,
      glow: parseFloat(read("--hx-glow-strength") || "0.28") || 0.28
    };
  }
  function paintVisual() {
    const box = document.getElementById("hx-visual");
    if (!box) return;
    const themes = Object.keys(THEMES).map((id) => {
      const on = state.theme === id ? " on" : "";
      const tok = Object.assign({}, THEMES["helix-89"].tokens, THEMES[id].tokens || {});
      const bg = tok["--hx-bg"] || "#050805";
      const fg = tok["--hx-primary"] || "#7CFF7A";
      return `<button type="button" data-hx-theme="${id}" class="hx-tile${on}" style="--tile-bg:${bg};--tile-fg:${fg}"><i></i>${THEMES[id].label}</button>`;
    }).join("");
    const mots = MOTION.map((m) => {
      const on = state.motion === m ? " on" : "";
      return `<button type="button" data-hx-motion="${m}" class="${on.trim()}">${m.toUpperCase()}</button>`;
    }).join("");
    const c = state.custom || {};
    box.innerHTML = `<div class="ident">VISUAL SYSTEM · 表示系統</div>
      <div class="hx-bar" id="hx-theme-bar">${themes}</div>
      <div class="ident">MOTION PROFILE</div>
      <div class="hx-bar" id="hx-motion-bar">${mots}</div>
      <div class="ident">CUSTOM</div>
      <div class="hx-bar">
        <label>PHOSPHOR <input type="color" data-hx-c="primary" value="${c.primary || "#7CFF7A"}"></label>
        <label>SECONDARY <input type="color" data-hx-c="secondary" value="${c.secondary || "#6aa8a8"}"></label>
        <label>BACKGROUND <input type="color" data-hx-c="bg" value="${c.bg || "#050805"}"></label>
        <label>WARNING <input type="color" data-hx-c="warning" value="${c.warning || "#E08A2A"}"></label>
        <label>CRITICAL <input type="color" data-hx-c="critical" value="${c.critical || "#c44a3a"}"></label>
      </div>
      <p class="dim">Contrast floor enforced. Custom cannot drop below readable phosphor on background.</p>
      <div class="ident">CUSTOM DEPTH</div>
      <div class="hx-bar">
        <label>GLOW <input type="range" min="0" max="1" step="0.05" data-hx-n="glow" value="${c.glow == null ? 0.28 : c.glow}"></label>
        <label>SCAN <input type="range" min="0" max="1" step="0.05" data-hx-n="scan" value="${c.scan == null ? 0.5 : c.scan}"></label>
        <label>NOISE <input type="range" min="0" max="0.2" step="0.01" data-hx-n="noise" value="${c.noise == null ? 0.06 : c.noise}"></label>
        <label>PERSIST <input type="range" min="0" max="0.8" step="0.05" data-hx-n="persist" value="${c.persist == null ? 0.3 : c.persist}"></label>
      </div>`;
  }
  function bindVisual() {
    const box = document.getElementById("hx-visual");
    if (!box || box.dataset.bound) return;
    box.dataset.bound = "1";
    box.addEventListener("click", (e) => {
      const t = e.target.closest("[data-hx-theme]");
      if (t) applyTheme(t.getAttribute("data-hx-theme"));
      const m = e.target.closest("[data-hx-motion]");
      if (m) applyMotion(m.getAttribute("data-hx-motion"));
    });
    box.addEventListener("input", (e) => {
      const inp = e.target.closest("[data-hx-c]");
      const rng = e.target.closest("[data-hx-n]");
      if (inp) {
        state.custom = Object.assign({}, state.custom, { [inp.getAttribute("data-hx-c")]: inp.value });
        applyTheme("custom");
      }
      if (rng) {
        state.custom = Object.assign({}, state.custom, { [rng.getAttribute("data-hx-n")]: Number(rng.value) });
        applyTheme("custom");
      }
    });
  }
  function mount() {
    const stored = load();
    state.theme = stored.theme || "helix-89";
    state.custom = stored.custom || {};
    state.layout = stored.layout || "auto";
    applyTheme(state.theme, { silent: true, persist: false });
    applyMotion(stored.motion || "enhanced", false);
    paintVisual();
    bindVisual();
    const tog = document.getElementById("anim-tog");
    if (tog && !tog.dataset.hxBound) {
      tog.dataset.hxBound = "1";
      tog.addEventListener("click", (ev) => {
        ev.stopImmediatePropagation();
        cycleMotion();
      }, true);
    }
  }
  global.HelixTheme = { mount, applyTheme, applyMotion, cycleMotion, get, THEMES, deviceClass, save, load, state };
})(window);
