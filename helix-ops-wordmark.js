/* HELIX/OPS — amber/orange square-particle identity. State machine, not setTimeouts. */
(function (global) {
  const C = {
    amber: "#E08A2A",
    orange: "#C45E12",
    cream: "#EED9A6",
    flare: "#F6F1E4",
    dim: "#4A3218",
    phosphor: "#7CFF7A",
    warn: "#c44a3a",
    bg: "#050805",
  };

  const FULL = {
    DORMANT: 280, ACQUIRE: 420, MAP: 380, CORE_FORM: 520, CORE_SYNC: 380,
    EXPAND: 280, WORDMARK_BUILD: 1100, CALIBRATE: 360, LOCK: 240,
  };
  const FAST = {
    DORMANT: 40, ACQUIRE: 80, MAP: 60, CORE_FORM: 90, CORE_SYNC: 70,
    EXPAND: 50, WORDMARK_BUILD: 320, CALIBRATE: 90, LOCK: 70,
  };
  const ORDER = ["DORMANT", "ACQUIRE", "MAP", "CORE_FORM", "CORE_SYNC", "EXPAND", "WORDMARK_BUILD", "CALIBRATE", "LOCK"];

  function ease(t) {
    t = Math.max(0, Math.min(1, t));
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(a, b, t) {
    const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const A = p(a), B = p(b);
    return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
  }
  function pcol(p) {
    if (p.seed < 0.035) return C.flare;
    if (p.seed < 0.22) return mix(C.orange, C.cream, p.seed * 3);
    return mix(C.orange, C.amber, 0.25 + p.seed * 0.75);
  }

  function sampleWordmark(mobile) {
    const W = mobile ? 280 : 520;
    const H = mobile ? 56 : 72;
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const g = off.getContext("2d");
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#fff";
    g.textBaseline = "middle";
    g.textAlign = "left";
    const size = mobile ? 28 : 42;
    g.font = `700 ${size}px "IBM Plex Mono", ui-monospace, Menlo, "MS Gothic", monospace`;
    const text = "HELIX/OPS";
    const tw = g.measureText(text).width;
    const x0 = Math.max(4, (W - tw) / 2);
    const y0 = H * 0.48;
    g.fillText(text, x0, y0);
    const slashW = g.measureText("HELIX").width;
    const slashX = x0 + slashW;
    const img = g.getImageData(0, 0, W, H).data;
    const step = mobile ? 2 : 1;
    const cells = [];
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        if (img[(y * W + x) * 4 + 3] > 140) {
          cells.push({
            tx: x / W,
            ty: (y / H) * 0.62 + 0.08,
            slash: x >= slashX - 2 && x <= slashX + size * 0.42,
            seed: (x * 13 + y * 7) % 1000 / 1000,
          });
        }
      }
    }
    return { cells, W, H };
  }

  function dna(k, n, phase, r, h, off) {
    const u = n <= 1 ? 0 : k / (n - 1);
    const t = u * Math.PI * 2 * 2.2 + phase + off;
    return { x: Math.sin(t) * r, z: Math.cos(t) * r, y: (u - 0.5) * h, u };
  }

  function durSum(table) {
    return ORDER.reduce((s, k) => s + table[k], 0);
  }

  function phaseOf(ms, table) {
    let acc = 0;
    for (const k of ORDER) {
      const d = table[k];
      if (ms < acc + d) return { name: k, local: (ms - acc) / d, ms };
      acc += d;
    }
    return { name: "IDLE", local: 1, ms };
  }

  const instances = [];

  function apply(el, opt) {
    opt = opt || {};
    el.classList.add("howm");
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", "HELIX/OPS");
    const reducePref = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const anim0 = opt.anim || (reducePref ? "OFF" : "FULL");
    if (anim0 === "OFF" || reducePref) {
      fallback(el, opt);
      return;
    }

    el.querySelector(".howm-field")?.remove();
    let canvas = el.querySelector("canvas.howm-px");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "howm-px";
      canvas.setAttribute("aria-hidden", "true");
      el.appendChild(canvas);
    }
    let hud = el.querySelector(".howm-hud");
    if (!hud) {
      hud = document.createElement("div");
      hud.className = "howm-hud";
      el.appendChild(hud);
    }
    let sub = el.querySelector(".howm-sub");
    if (!sub) {
      sub = document.createElement("div");
      sub.className = "howm-sub";
      el.appendChild(sub);
    }

    const mobile = matchMedia("(max-width: 767px)").matches || matchMedia("(pointer: coarse)").matches;
    const sampled = sampleWordmark(mobile);
    const maxN = mobile ? 220 : 420;
    const cells = sampled.cells.length > maxN
      ? sampled.cells.filter((_, i) => i % Math.ceil(sampled.cells.length / maxN) === 0)
      : sampled.cells;

    const nDna = mobile ? 36 : 64;
    const particles = cells.map((c, i) => ({
      x: 0.12 + c.seed * 0.76,
      y: 0.72 + ((c.seed * 13) % 1) * 0.2,
      tx: c.tx,
      ty: c.ty,
      slash: c.slash,
      seed: c.seed,
      dnaK: i < nDna ? i : -1,
      role: i < nDna * 0.42 ? "a" : i < nDna * 0.84 ? "b" : i < nDna ? "p" : "glyph",
    }));

    const ctx = canvas.getContext("2d", { alpha: true });
    const st = {
      mode: "FULL",
      table: FULL,
      name: "DORMANT",
      t0: performance.now(),
      global: "normal",
      pulse: 0,
      pulseKind: "",
      raf: 0,
      hidden: false,
      lastIdleEvt: 0,
      idleEvt: "",
      dim: { w: 0, h: 0 },
    };
    try {
      const forceFull = /(?:\?|&)boot=full\b/.test(location.search);
      if (!forceFull && sessionStorage.getItem("helix_ops_logo_booted") === "1") {
        st.mode = "FAST";
        st.table = FAST;
      }
    } catch (e) {}

    function resize() {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(140, Math.floor(r.width));
      const h = Math.max(40, Math.floor(w * (mobile ? 0.38 : 0.28)));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      st.dim = { w, h };
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    function helixPos(p, ang, dnaR, dnaH) {
      if (p.dnaK < 0) return { x: 0.5, y: 0.42, z: 0, pair: false, dna: false };
      const strandN = Math.floor(nDna * 0.42);
      if (p.role === "a" || p.role === "b") {
        const pt = dna(p.dnaK % strandN, strandN, ang, dnaR, dnaH, p.role === "b" ? Math.PI : 0);
        return { x: 0.5 + pt.x, y: 0.42 + pt.y, z: pt.z, pair: false, dna: true };
      }
      const n = Math.max(2, nDna - strandN * 2);
      const u = (p.dnaK % n) / (n - 1);
      const k = Math.floor(u * (strandN - 1));
      const a = dna(k, strandN, ang, dnaR, dnaH, 0);
      const b = dna(k, strandN, ang, dnaR, dnaH, Math.PI);
      return { x: 0.5 + lerp(a.x, b.x, 0.5), y: 0.42 + lerp(a.y, b.y, 0.5), z: lerp(a.z, b.z, 0.5), pair: true, dna: true };
    }

    function tick(now) {
      if (st.hidden) { st.raf = requestAnimationFrame(tick); return; }
      if (st.name === "PROCESSING" && st.procUntil && now > st.procUntil) st.name = "IDLE";
      const elapsed = (now - st.t0);
      const ph = st.name === "IDLE" || st.name === "PROCESSING" || st.name === "WARNING"
        ? { name: st.name, local: 1 }
        : phaseOf(elapsed, st.table);
      if (ph.name === "IDLE" && st.name !== "IDLE" && st.name !== "PROCESSING" && st.name !== "WARNING") {
        st.name = "IDLE";
        try { sessionStorage.setItem("helix_ops_logo_booted", "1"); } catch (e) {}
      } else if (st.name !== "IDLE" && st.name !== "PROCESSING" && st.name !== "WARNING") {
        st.name = ph.name;
      }

      const { w, h } = st.dim;
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = false;

      const dnaR = mobile ? 0.16 : 0.09;
      const dnaHgt = mobile ? 0.55 : 0.42;
      const coreSpin = (now / 1000) * (st.name === "PROCESSING" ? 1.6 : st.name.indexOf("CORE") === 0 ? 1.1 : 0.28);
      const px = Math.max(2, Math.round(w / (mobile ? 90 : 140)));

      // scanline
      if (st.name === "ACQUIRE" || st.name === "CALIBRATE") {
        const sy = (ph.local || 0) * h;
        ctx.fillStyle = "rgba(224,138,42,0.22)";
        ctx.fillRect(0, sy, w, 2);
      }

      // calibration marks
      if (st.name === "MAP" || st.name === "CALIBRATE" || st.name === "LOCK") {
        ctx.strokeStyle = "rgba(224,138,42,0.4)";
        ctx.lineWidth = 1;
        const m = 6;
        ctx.beginPath();
        ctx.moveTo(m, m + 8); ctx.lineTo(m, m); ctx.lineTo(m + 8, m);
        ctx.moveTo(w - m, m + 8); ctx.lineTo(w - m, m); ctx.lineTo(w - m - 8, m);
        ctx.moveTo(m, h - m - 8); ctx.lineTo(m, h - m); ctx.lineTo(m + 8, h - m);
        ctx.moveTo(w - m, h - m - 8); ctx.lineTo(w - m, h - m); ctx.lineTo(w - m - 8, h - m);
        ctx.stroke();
      }

      // core ring
      const showCore = ["CORE_FORM", "CORE_SYNC", "EXPAND", "IDLE", "PROCESSING", "WARNING"].indexOf(st.name) >= 0
        || (st.name === "WORDMARK_BUILD" && (ph.local || 0) < 0.35);
      if (showCore) {
        const cx = w * 0.5, cy = h * 0.42;
        const rr = Math.min(w, h) * (st.name === "IDLE" || st.name === "PROCESSING" ? (mobile ? 0.16 : 0.11) : 0.18);
        ctx.strokeStyle = st.global === "warning" ? C.warn : C.amber;
        ctx.globalAlpha = 0.45;
        ctx.strokeRect(Math.round(cx - rr), Math.round(cy - rr), Math.round(rr * 2), Math.round(rr * 2));
        ctx.globalAlpha = 1;
        for (let i = 0; i < 8; i++) {
          const a = i * (Math.PI / 4) + coreSpin * 0.2;
          const x1 = cx + Math.cos(a) * (rr - 3);
          const y1 = cy + Math.sin(a) * (rr - 3);
          ctx.fillStyle = C.dim;
          ctx.fillRect(Math.round(x1) - 1, Math.round(y1) - 1, 2, 2);
        }
      }

      const buildT = st.name === "WORDMARK_BUILD" ? ease(ph.local || 0) : (st.name === "CALIBRATE" || st.name === "LOCK" || st.name === "IDLE" || st.name === "PROCESSING" || st.name === "WARNING" ? 1 : 0);
      const pulseX = st.pulse > 0 ? 1 - st.pulse : -1;
      if (st.pulse > 0) st.pulse = Math.max(0, st.pulse - 0.02);

      if (st.name === "IDLE" && now - st.lastIdleEvt > 28000 + Math.random() * 20000) {
        st.lastIdleEvt = now;
        st.idleEvt = ["CRC CHECK", "CORE PULSE", "GLYPH RESYNC"][Math.floor(Math.random() * 3)];
        st.pulse = 1;
        st.pulseKind = "idle";
      }

      const gcol = st.global === "offline" ? C.dim : st.global === "warning" ? mix(C.amber, C.warn, 0.25) : C.amber;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        let ax = p.tx, ay = p.ty, follow = 0.2, size = Math.max(1, px + (p.seed > 0.78 ? 1 : 0) - (p.seed < 0.12 ? 1 : 0)), alpha = 1, col = pcol(p), z = 0;
        const hp = helixPos(p, coreSpin, dnaR, dnaHgt);

        if (st.name === "DORMANT") {
          ax = 0.12 + p.seed * 0.76;
          ay = 0.38 + ((p.seed * 17) % 1) * 0.28;
          follow = 0.03;
          alpha = 0.06 + 0.2 * (ph.local || 0);
          col = C.dim;
          size = 1;
        } else if (st.name === "ACQUIRE") {
          ax = 0.5 + (p.seed - 0.5) * 0.9;
          ay = (ph.local || 0) * 0.9;
          follow = 0.08;
          alpha = 0.18 + 0.5 * (ph.local || 0);
          col = mix(C.dim, C.orange, ph.local || 0);
        } else if (st.name === "MAP") {
          ax = lerp(p.x, p.tx, 0.15);
          ay = lerp(0.5, p.ty, ease(ph.local || 0) * 0.3);
          follow = 0.1;
          alpha = 0.4;
        } else if (st.name === "CORE_FORM" || st.name === "CORE_SYNC") {
          if (p.dnaK >= 0) {
            ax = hp.x; ay = hp.y; z = hp.z;
            follow = 0.12 + 0.2 * ease(ph.local || 0);
            const depth = (z + 1) * 0.5;
            size = Math.max(1, Math.round(px * (0.7 + depth * 0.5)));
            alpha = (hp.pair ? 0.45 : 1) * (0.4 + depth * 0.6);
            col = depth > 0.72 ? C.flare : mix(C.orange, C.cream, depth);
            if (st.name === "CORE_SYNC") {
              const pu = (ph.local || 0);
              if (Math.abs(hp.y - (0.42 - dnaHgt / 2) - pu * dnaHgt) < 0.04) { col = C.flare; alpha = 1; }
            }
          } else {
            ax = 0.5 + (p.seed - 0.5) * 0.08;
            ay = 0.42 + ((p.seed * 9) % 1 - 0.5) * 0.06;
            follow = 0.08;
            alpha = 0.12;
            col = C.dim;
            size = 1;
          }
        } else if (st.name === "EXPAND") {
          const e = ease(ph.local || 0);
          ax = lerp(hp.dna === false ? 0.5 : hp.x, p.tx, e * 0.15);
          ay = lerp(hp.dna === false ? 0.42 : hp.y, p.ty, e * 0.15);
          follow = 0.08;
          alpha = 0.55;
        } else if (st.name === "WORDMARK_BUILD") {
          const t = ph.local || 0;
          let gate = 0;
          if (p.slash) gate = t >= 0.58 ? Math.min(1, (t - 0.58) / 0.12) : 0;
          else if (p.tx < 0.14) gate = Math.min(1, t / 0.16);
          else if (p.tx < 0.32) gate = t >= 0.16 ? Math.min(1, (t - 0.16) / 0.16) : 0;
          else if (p.tx < 0.52) gate = t >= 0.32 ? Math.min(1, (t - 0.32) / 0.18) : 0;
          else gate = t >= 0.70 ? Math.min(1, (t - 0.70) / 0.22) : 0;
          const unlock = ease(gate);
          ax = lerp(p.dnaK >= 0 ? hp.x : 0.5, p.tx, unlock);
          ay = lerp(p.dnaK >= 0 ? hp.y : 0.42, p.ty, unlock);
          if (unlock > 0 && unlock < 1) {
            ax += (p.seed - 0.5) * 0.04 * (1 - unlock);
            ay -= (1 - unlock) * 0.03;
          }
          follow = 0.1 + 0.45 * unlock;
          alpha = 0.12 + 0.88 * unlock;
          col = p.slash ? C.flare : mix(C.cream, C.amber, unlock);
        } else if (st.name === "CALIBRATE" || st.name === "LOCK") {
          ax = p.tx; ay = p.ty; follow = 0.55;
          if (Math.abs(p.ty - (ph.local || 0)) < 0.06) col = C.flare;
        } else {
          ax = p.tx; ay = p.ty;
          follow = 0.35;
          const breathe = 0.92 + 0.08 * Math.sin(now / 900 + p.seed * 6);
          alpha = breathe;
          if (p.slash && pulseX >= 0 && Math.abs(p.ty - (0.2 + (1 - pulseX) * 0.5)) < 0.08) {
            col = st.pulseKind === "warn" ? C.warn : C.cream;
            alpha = 1;
            size += 1;
          } else if (p.seed < 0.012 && Math.sin(now / 400 + p.seed * 40) > 0.92) {
            col = C.flare;
          }
        }

        p.x += (ax - p.x) * Math.min(1, follow);
        p.y += (ay - p.y) * Math.min(1, follow);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = col;
        ctx.fillRect(Math.round(p.x * w), Math.round(p.y * h), size, size);
      }
      ctx.globalAlpha = 1;

      // labels
      const labels = {
        DORMANT: "NO SIGNAL",
        ACQUIRE: "SYS://BOOT  CORE ADDRESS 0x0487  SIGNAL ACQUISITION",
        MAP: "COORDINATE LOCK  X:0487  Y:0216",
        CORE_FORM: "HELIX CORE FORMATION",
        CORE_SYNC: "CORE SYNCHRONIZED  演算核同期完了",
        EXPAND: "SYNC WAVE",
        WORDMARK_BUILD: "GLYPH MATRIX  HELIX → / → OPS",
        CALIBRATE: "ALIGN 100%  CRC OK  GLYPH MATRIX LOCK  CORE 04.87",
        LOCK: "CRC OK  ● ONLINE",
        IDLE: st.idleEvt || "● ONLINE",
        PROCESSING: "● PROCESSING",
        WARNING: "△ WARNING",
      };
      hud.textContent = labels[st.name] || "";
      hud.style.opacity = st.name === "IDLE" && !st.idleEvt ? "0.35" : "0.85";
      if (st.name === "IDLE" || st.name === "LOCK") {
        sub.innerHTML = mobile
          ? "FIELD TERMINAL<br><span class=\"howm-online\">● NOMINAL</span>"
          : "HELIX OPERATIONS SYSTEM · 東京統合管制<br>HOS://TKY-06 // CORE 04.87 · <span class=\"howm-online\">● ONLINE</span>";
        sub.style.opacity = "0.9";
      } else if (st.name === "CORE_SYNC") {
        sub.innerHTML = "HELIX CORE // SYNCHRONIZED<br>遺伝子演算核";
        sub.style.opacity = "0.85";
      } else {
        sub.style.opacity = "0.15";
      }

      st.raf = requestAnimationFrame(tick);
    }

    function onVis() {
      st.hidden = document.hidden;
    }
    document.addEventListener("visibilitychange", onVis);
    st.raf = requestAnimationFrame(tick);

    const api = {
      el,
      setAnim(mode) {
        if (mode === "OFF") {
          cancelAnimationFrame(st.raf);
          ro.disconnect();
          fallback(el, opt);
          return;
        }
        st.mode = mode === "REDUCED" ? "FAST" : "FULL";
        st.table = st.mode === "FAST" ? FAST : FULL;
      },
      setGlobal(g) { st.global = g || "normal"; if (g === "warning") st.name = "WARNING"; if (g === "normal" && st.name === "WARNING") st.name = "IDLE"; },
      pulse(kind) {
        st.pulse = 1;
        st.pulseKind = kind || "hermes";
        if (kind === "hermes" || kind === "adze") {
          st.name = "PROCESSING";
          st.procUntil = performance.now() + 900;
        }
      },
      stop() { cancelAnimationFrame(st.raf); ro.disconnect(); document.removeEventListener("visibilitychange", onVis); },
    };
    el._howm = api;
    instances.push(api);
  }

  function fallback(el, opt) {
    el.classList.add("howm", "howm-static");
    el.setAttribute("aria-label", "HELIX/OPS");
    let field = el.querySelector(".howm-field");
    if (!field) {
      field = document.createElement("div");
      field.className = "howm-field";
      el.appendChild(field);
    }
    const mask = `url("${(opt && opt.mask) || "helix-ops-slash.svg"}")`;
    field.style.webkitMaskImage = mask;
    field.style.maskImage = mask;
    let sub = el.querySelector(".howm-sub");
    if (!sub) {
      sub = document.createElement("div");
      sub.className = "howm-sub";
      el.appendChild(sub);
    }
    sub.innerHTML = "HELIX OPERATIONS SYSTEM · 東京統合管制<br>HOS://TKY-06 // CORE 04.87 · ● ONLINE";
    sub.style.opacity = "0.9";
  }

  function mount(selector, opt) {
    document.querySelectorAll(selector).forEach((el) => apply(el, opt));
  }

  global.HELIX_PARTICLE_CONFIG = { palette: C, FULL, FAST, DNA: { mobile: 36, desk: 64 } };
  global.HelixOpsWordmark = {
    mount,
    apply,
    setAnim(m) { instances.forEach((i) => i.setAnim && i.setAnim(m)); },
    setGlobal(g) { instances.forEach((i) => i.setGlobal && i.setGlobal(g)); },
    pulse(k) { instances.forEach((i) => i.pulse && i.pulse(k)); },
    C,
  };
})(typeof window !== "undefined" ? window : globalThis);
