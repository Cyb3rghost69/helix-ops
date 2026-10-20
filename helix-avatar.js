(function (global) {
  const KEY = "helix_ops_avatar";
  const EXPRS = ["ready", "listen", "think", "speak", "happy", "curious", "concern", "wait", "offline"];
  const LABELS = {
    ready: "Ready", listen: "Listening", think: "Working", speak: "Responding",
    happy: "Ready", curious: "Ready", concern: "Error", wait: "Waiting for approval", offline: "Offline"
  };
  function p() {
    return (typeof OPS === "string") ? OPS : ((location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "");
  }
  function loadCfg() {
    try { return Object.assign({ vis: true, size: "large", anim: "normal", bg: true, preview: "" }, JSON.parse(localStorage.getItem(KEY) || "{}")); }
    catch (e) { return { vis: true, size: "large", anim: "normal", bg: true, preview: "" }; }
  }
  function saveCfg(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} }
  const cfg = loadCfg();
  const st = {
    expr: "ready", hold: 0, blink: 0, mouth: 0, name: "—", model: "—", provider: "—",
    online: true, err: "", amp: 0, chat: false, voice: "", preview: ""
  };
  let raf = 0;

  function motionOff() {
    return document.body.getAttribute("data-hx-motion") === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches || cfg.anim === "subtle" && false;
  }
  function reduced() {
    return document.body.getAttribute("data-hx-motion") === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  const PIX = global.HelixAvatarPixels || { w: 48, h: 64, pal: [], rle: [] };
  const GRID = new Uint8Array(PIX.w * PIX.h);
  (function decode() {
    let i = 0;
    const r = PIX.rle || [];
    for (let k = 0; k + 1 < r.length; k += 2) {
      const n = r[k];
      const v = r[k + 1];
      for (let c = 0; c < n && i < GRID.length; c++) GRID[i++] = v;
    }
  })();

  const MOOD = {
    ready: { a: "#ff2bd6", b: "#1a0060", n: 18, speed: 0.00035, pulse: 0.08 },
    listen: { a: "#00e5ff", b: "#5a007a", n: 20, speed: 0.0014, pulse: 0.18 },
    think: { a: "#b44cff", b: "#120040", n: 16, speed: 0.00022, pulse: 0.12 },
    speak: { a: "#ff66cc", b: "#2a0055", n: 22, speed: 0.0018, pulse: 0.28 },
    happy: { a: "#ffe600", b: "#ff2bd6", n: 20, speed: 0.0009, pulse: 0.22 },
    curious: { a: "#7dfffb", b: "#4a0088", n: 18, speed: 0.0007, pulse: 0.14 },
    concern: { a: "#ff5533", b: "#0a0018", n: 12, speed: 0.00015, pulse: 0.05 },
    wait: { a: "#ffb000", b: "#3a0066", n: 14, speed: 0.0004, pulse: 0.2 },
    offline: { a: "#334", b: "#111", n: 8, speed: 0, pulse: 0 }
  };

  function drawMood(ctx, W, H, expr, t) {
    const m = MOOD[expr] || MOOD.ready;
    ctx.fillStyle = m.b;
    ctx.fillRect(0, 0, W, H);
    if (!cfg.bg) return;
    const cx = W / 2;
    const cy = H * 0.18;
    const spin = (m.speed || 0) * (t || 0);
    const pulse = 1 + ((m.pulse || 0) * (reduced() ? 0 : Math.sin((t || 0) * 0.004)));
    const n = m.n || 16;
    for (let i = 0; i < n; i++) {
      const a0 = spin + (i / n) * Math.PI * 2;
      const a1 = a0 + Math.PI / n;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a0) * W * pulse, cy + Math.sin(a0) * H * pulse);
      ctx.lineTo(cx + Math.cos(a1) * W * pulse, cy + Math.sin(a1) * H * pulse);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? m.a : m.b;
      ctx.globalAlpha = expr === "offline" ? 0.25 : 0.55;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawSprite(ctx, ox, oy, s, expr) {
    const pal = PIX.pal || [];
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < PIX.h; y++) {
      for (let x = 0; x < PIX.w; x++) {
        const v = GRID[y * PIX.w + x];
        if (v === 255) continue;
        let col = pal[v] || "#000";
        if (expr === "offline") col = "#445";
        ctx.fillStyle = col;
        ctx.fillRect(ox + x * s, oy + y * s, s, s);
      }
    }
  }

  function drawChar(ctx, W, H, expr, t) {
    ctx.clearRect(0, 0, W, H);
    drawMood(ctx, W, H, expr, t);
    const s = Math.max(1, Math.floor(Math.min(W / PIX.w, H / PIX.h)));
    const ox = Math.floor((W - PIX.w * s) / 2);
    const oy = Math.floor((H - PIX.h * s) / 2);
    let tilt = 0;
    if (!reduced() && (expr === "listen" || expr === "curious")) tilt = expr === "curious" ? 0.05 : -0.05;
    ctx.save();
    if (tilt) {
      ctx.translate(W / 2, H / 2);
      ctx.rotate(tilt);
      ctx.translate(-W / 2, -H / 2);
    }
    if (expr === "concern") ctx.filter = "saturate(0.75) brightness(0.85)";
    else if (expr === "happy") ctx.filter = "saturate(1.12) brightness(1.05)";
    else ctx.filter = "none";
    drawSprite(ctx, ox, oy, s, expr);
    ctx.filter = "none";
    const blink = st.blink > 0;
    const eyeY = oy + 16 * s;
    const mouthY = oy + 24 * s;
    const cx = ox + 24 * s;
    if (expr === "think") {
      ctx.fillStyle = "rgba(10,0,40,0.45)";
      ctx.fillRect(cx - 8 * s, eyeY, 5 * s, s);
      ctx.fillRect(cx + 3 * s, eyeY, 5 * s, s);
    }
    if (expr === "concern") {
      ctx.fillStyle = "rgba(0,20,50,0.55)";
      ctx.fillRect(cx - 9 * s, eyeY - 2 * s, 6 * s, s);
      ctx.fillRect(cx + 3 * s, eyeY - s, 6 * s, s);
    }
    if (expr === "curious") {
      ctx.fillStyle = "rgba(0,20,50,0.5)";
      ctx.fillRect(cx - 9 * s, eyeY - 3 * s, 5 * s, s);
    }
    if (blink || expr === "offline") {
      ctx.fillStyle = "rgba(20,10,40,0.8)";
      ctx.fillRect(cx - 9 * s, eyeY, 6 * s, s);
      ctx.fillRect(cx + 3 * s, eyeY, 6 * s, s);
    }
    if (expr === "speak" && st.mouth) {
      ctx.fillStyle = "#1a001a";
      ctx.fillRect(cx - 3 * s, mouthY, 6 * s, 2 * s);
    } else if (expr === "happy") {
      ctx.fillStyle = "#1a001a";
      ctx.fillRect(cx - 3 * s, mouthY + s, s, s);
      ctx.fillRect(cx + 2 * s, mouthY + s, s, s);
      ctx.fillRect(cx - 2 * s, mouthY + 2 * s, 4 * s, s);
    } else if (expr === "wait") {
      ctx.fillStyle = "#1a001a";
      ctx.fillRect(cx - 2 * s, mouthY, 4 * s, 2 * s);
    }
    ctx.restore();
  }

  function paintAll(ts) {
    const expr = st.preview || st.expr;
    const canvases = ["hx-av-cv", "hx-av-mini-cv", "hx-av-big-cv"];
    canvases.forEach((id) => {
      const c = document.getElementById(id);
      if (!c) return;
      const w = c.width = c.clientWidth || 160;
      const h = c.height = c.clientHeight || 160;
      drawChar(c.getContext("2d"), w, h, expr, ts);
    });
    const name = document.getElementById("hx-av-name");
    if (name) name.textContent = st.name;
    const md = document.getElementById("hx-av-model");
    if (md) md.textContent = (st.provider && st.provider !== "—") ? (st.provider + " / " + st.model) : st.model;
    const lab = document.getElementById("hx-av-status");
    if (lab) lab.textContent = LABELS[expr] || expr;
    const er = document.getElementById("hx-av-err");
    if (er) er.textContent = expr === "concern" ? (st.err || "REQUEST FAILED") : "";
  }

  function setExpr(next, holdMs) {
    if (st.preview) return;
    const now = Date.now();
    if (now < st.hold && next !== "offline" && next !== "wait" && next !== "concern") return;
    if (st.expr === next) return;
    st.expr = next;
    st.hold = now + (holdMs || (cfg.anim === "expressive" ? 900 : 650));
  }

  function resolve() {
    if (st.preview) return;
    if (!st.online) { setExpr("offline", 400); return; }
    if (st.voice === "LISTENING") { setExpr("listen", 300); return; }
    if (st.voice === "SPEAKING") { setExpr("speak", 300); return; }
    if (st.wait) { setExpr("wait", 400); return; }
    if (st.chat || st.working) { setExpr("think", 400); return; }
    if (st.err && Date.now() < st.errUntil) { setExpr("concern", 400); return; }
    if (st.happyUntil && Date.now() < st.happyUntil) { setExpr("happy", 400); return; }
    setExpr("ready", 200);
  }

  function loop(ts) {
    if (document.hidden || !cfg.vis) { raf = 0; return; }
    if (!reduced() && cfg.anim !== "subtle") {
      if (st.blink > 0) st.blink -= 1;
      else if (Math.random() < 0.008 && (st.expr === "ready" || st.preview === "ready")) st.blink = 6;
      if (st.expr === "speak" || st.preview === "speak") st.mouth = (Math.floor(ts / 120) % 2);
    }
    paintAll(ts);
    raf = requestAnimationFrame(loop);
  }
  function startLoop() {
    if (raf) cancelAnimationFrame(raf);
    if (document.hidden || !cfg.vis) { paintAll(0); return; }
    raf = requestAnimationFrame(loop);
  }

  async function refreshId() {
    try {
      const [ag, ctx, hs, ap, jobs] = await Promise.all([
        fetch(p() + "/api/agents", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch(p() + "/api/ctx", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch(p() + "/api/hermes/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch(p() + "/api/approvals", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch(p() + "/api/compute/jobs", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
      ]);
      const helix = ((ag && ag.agents) || []).find((a) => a.id === "helix") || {};
      st.name = helix.label || helix.id || (ctx && ctx.ok ? "HELIX" : "—");
      if (st.name && st.name === "helix") st.name = "HELIX";
      st.model = (ctx && ctx.model) || helix.model || "—";
      st.provider = (ctx && ctx.provider) || helix.provider || "—";
      st.online = !!(hs && hs.online);
      st.wait = !!(ap && ap.count);
      const run = jobs && ((jobs.running || []).length || (jobs.active || []).length);
      st.working = !!run;
      if (!st.online) st.expr = st.preview || "offline";
      resolve();
    } catch (e) {
      st.online = false;
      resolve();
    }
  }

  function applyLayout() {
    document.body.classList.toggle("hx-av-off", !cfg.vis);
    document.body.classList.toggle("hx-av-compact", cfg.size === "compact");
    const pan = document.getElementById("hx-av");
    if (pan) pan.hidden = !cfg.vis || cfg.size === "compact";
  }

  function paintSettings() {
    const vis = document.getElementById("hx-av-vis");
    const sz = document.getElementById("hx-av-size");
    const an = document.getElementById("hx-av-anim");
    const bg = document.getElementById("hx-av-bg");
    const pr = document.getElementById("hx-av-preview");
    if (vis) vis.checked = !!cfg.vis;
    if (sz) sz.value = cfg.size;
    if (an) an.value = cfg.anim;
    if (bg) bg.checked = !!cfg.bg;
    if (pr && !pr.options.length) {
      pr.appendChild(new Option("LIVE (no preview)", ""));
      EXPRS.forEach((e) => pr.appendChild(new Option("PREVIEW · " + e, e)));
    }
    if (pr) pr.value = cfg.preview || "";
  }

  function bind() {
    document.getElementById("hx-av-cv")?.addEventListener("click", () => {
      const inp = document.getElementById("prompt-in");
      if (inp) { inp.focus(); inp.scrollIntoView({ block: "center" }); }
    });
    document.getElementById("hx-av-mini")?.addEventListener("click", () => {
      const box = document.getElementById("hx-av-portrait");
      if (box) box.hidden = !box.hidden;
      startLoop();
    });
    document.getElementById("hx-av-portrait")?.addEventListener("click", (e) => {
      if (e.target.id === "hx-av-portrait" || e.target.id === "hx-av-close") {
        document.getElementById("hx-av-portrait").hidden = true;
      }
    });
    document.getElementById("hx-av-vis")?.addEventListener("change", (e) => { cfg.vis = e.target.checked; saveCfg(cfg); applyLayout(); startLoop(); });
    document.getElementById("hx-av-size")?.addEventListener("change", (e) => { cfg.size = e.target.value; saveCfg(cfg); applyLayout(); startLoop(); });
    document.getElementById("hx-av-anim")?.addEventListener("change", (e) => { cfg.anim = e.target.value; saveCfg(cfg); });
    document.getElementById("hx-av-bg")?.addEventListener("change", (e) => { cfg.bg = e.target.checked; saveCfg(cfg); });
    document.getElementById("hx-av-preview")?.addEventListener("change", (e) => {
      cfg.preview = e.target.value;
      st.preview = cfg.preview;
      saveCfg(cfg);
      paintAll(0);
    });
    document.addEventListener("helix-chat", (ev) => {
      const ph = ev.detail && ev.detail.phase;
      if (ph === "start") { st.chat = true; st.err = ""; resolve(); }
      if (ph === "ok") { st.chat = false; st.happyUntil = Date.now() + 1600; st.err = ""; resolve(); }
      if (ph === "err") { st.chat = false; st.err = String((ev.detail && ev.detail.error) || "FAILED"); st.errUntil = Date.now() + 4000; resolve(); }
    });
    document.addEventListener("helix-voice", (ev) => {
      st.voice = (ev.detail && ev.detail.state) || "";
      if (st.voice !== "SPEAKING") st.mouth = 0;
      resolve();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; }
      else startLoop();
    });
    document.addEventListener("helix-motion", () => startLoop());
  }

  function mount() {
    st.preview = cfg.preview || "";
    applyLayout();
    paintSettings();
    bind();
    refreshId();
    setInterval(() => { if (!document.hidden && cfg.vis) refreshId(); }, 4000);
    startLoop();
  }

  global.HelixAvatar = { mount, EXPRS, setExpr, st };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})(window);
