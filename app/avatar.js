/* HELIX/OPS — Helix's animated pixel avatar.
   A 40×64 cross-stitch-style pixel portrait drawn live: pink sunburst rays on deep blue, long pale-blue
   hair that darkens into dripping purple, star eyes, lilac lips. Expressions follow Helix's real mood:
   calm · listening · thinking · talking · happy · alert · sleeping (blinks, hair shimmer, drips and
   rotating rays are continuous; everything stops under animation OFF / reduced motion). */
(function (G) {
  "use strict";
  const GW = 40, GH = 64, CX = 20, HY = 18;
  const P = {
    bg: "#1d17a3", bg2: "#140f7c", ray: "#ff2f9e", ray2: "#ff63bb",
    hair: "#9fe3ff", hairMid: "#63c3f0", hairDeep: "#3a98df", hairHi: "#d8f7ff",
    face: "#cbf3ff", faceSh: "#9fd9f1", faceSh2: "#78bde3",
    shadow: "#8b53d6", lip: "#6d34b8", lip2: "#9a5ad8", nose: "#7a46c8",
    eye: "#ff3fa4", eyeHi: "#ffd6ec", lash: "#1a1478",
    p1: "#7b50e2", p2: "#5c38cd", p3: "#3f28b2", p4: "#2a1c95", body: "#231888",
    blush: "#ff8fcf", red: "#ff4d6d", orange: "#ff8a3d", white: "#ffffff", grid: "rgba(10,6,60,0.22)",
  };
  const h2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const colN = Array.from({ length: GW }, (_, x) => h2(x, 7));

  function grey(hex, k) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, l = (r + g + b) / 3;
    const m = (v) => Math.round(v * (1 - k) + l * k * 0.75);
    return "#" + [m(r), m(g), m(b)].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  function mount(canvas, opts) {
    opts = opts || {};
    const ctx = canvas.getContext("2d");
    let running = true, last = 0, blinkAt = performance.now() + 2500, blinkUntil = 0, cell = 6, mouthPhase = 0;
    const t0 = performance.now();

    function size() {
      const r = canvas.parentNode.getBoundingClientRect();
      const maxH = opts.maxHeight || 560;
      const wAvail = Math.max(120, r.width || 300);
      cell = Math.max(2, Math.floor(Math.min(wAvail / GW, maxH / GH)));
      const dpr = Math.min(2, G.devicePixelRatio || 1);
      canvas.style.width = cell * GW + "px"; canvas.style.height = cell * GH + "px";
      canvas.width = cell * GW * dpr; canvas.height = cell * GH * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false;
    }

    function draw(now) {
      const anim = (G.Helix && G.Helix.SET.anim) || "full";
      const st = (opts.getMood && opts.getMood()) || { mood: "calm" };
      const mood = st.mood || "calm";
      const t = anim === "off" ? 0 : (now - t0) / 1000;
      const sleepy = mood === "sleeping";
      const tint = (c) => (sleepy ? grey(c, 0.55) : c);
      // blink scheduler
      if (anim !== "off" && !sleepy && now > blinkAt) { blinkUntil = now + 140; blinkAt = now + 2200 + Math.random() * 3800; }
      const blinking = now < blinkUntil;
      const spin = mood === "thinking" ? 1.4 : mood === "talking" ? 0.9 : mood === "happy" ? 1.1 : mood === "alert" ? 0.6 : sleepy ? 0.05 : 0.35;
      const rayA = mood === "alert" ? P.orange : P.ray, rayB = mood === "alert" ? P.red : P.ray2;
      const pulse = mood === "happy" ? (Math.sin(t * 6) + 1) / 2 : 0;

      const C = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x * cell, y * cell, cell, cell); };
      for (let y = 0; y < GH; y++) {
        for (let x = 0; x < GW; x++) {
          const dx = x + 0.5 - CX, dy = y + 0.5 - HY, d = Math.hypot(dx, dy);
          // hair silhouette
          const widen = Math.max(0, y - HY) * 0.07;
          const xl = 6 - widen, xr = 34 + widen;
          const end = 54 + Math.floor(colN[x] * 7) + (anim === "full" && colN[x] > 0.62 ? Math.floor((t * 1.6 + colN[x] * 9) % 5) : 0);
          const inHead = d <= 14.2 && y <= HY;
          const inSides = y > HY && x + 0.5 >= xl && x + 0.5 <= xr && y <= end;
          const fx = (x + 0.5 - CX) / 7.6, fy = (y + 0.5 - 22.5) / 9.6, inFace = fx * fx + fy * fy <= 1 && y >= 14;
          const inInner = y >= 31 && Math.abs(x + 0.5 - CX) < 6.2 + (y - 31) * 0.16 && y <= end;
          let c;
          if (inFace && !(y < 16 && (Math.abs(x + 0.5 - CX) > 2.5 - (y - 14) * 1.5 || y < 15))) {
            // face with soft edge shading
            const e = fx * fx + fy * fy;
            c = e > 0.82 ? P.faceSh2 : e > 0.62 ? P.faceSh : P.face;
            if (y >= 30) c = P.faceSh;
          } else if (inInner) {
            const n = h2(x >> 1, y >> 1), n2 = h2(x, y);
            c = n > 0.86 ? P.p1 : n > 0.68 ? P.p2 : n2 > 0.75 ? P.p3 : n > 0.4 ? P.p4 : P.body;
          } else if (inHead || inSides) {
            // long hair: pale blue strands, highlights that shimmer downwards, purple towards the ends
            // wavy strands: sample the column noise along a gentle sine so hair falls in clumps, not bars
            const sx = Math.max(0, Math.min(GW - 1, Math.round(x + Math.sin(y * 0.22 + colN[x] * 6) * 1.1)));
            const strand = h2(Math.floor(sx / 2) * 2 + (y > 30 ? 1 : 0), 3) * 0.6 + colN[sx] * 0.4, depth = (y - 36) / 22;
            const shimmer = anim !== "off" && ((y + Math.floor(t * 5)) % 13 === Math.floor(strand * 13)) && strand > 0.35;
            if (depth > 0 && h2(x, y) < depth * 0.9) {
              const n = h2(x * 3, y);
              c = n > 0.66 ? P.p1 : n > 0.33 ? P.p2 : P.p3;
            } else if (shimmer) c = P.hairHi;
            else c = strand > 0.72 ? P.hairHi : strand > 0.45 ? P.hair : strand > 0.2 ? P.hairMid : P.hairDeep;
            if (Math.abs(x + 0.5 - xl) < 1 || Math.abs(x + 0.5 - xr) < 1) c = y > 40 ? P.p3 : P.hairDeep;
            // shadow where the hair meets the face
            const fxs = (x + 0.5 - CX) / 8.8, fys = (y + 0.5 - 22.5) / 10.4;
            if (y > 14 && y < 33 && fxs * fxs + fys * fys <= 1 && depth <= 0) c = P.hairDeep;
            if (y >= end - 1 && y > 40) c = P.p2;
          } else {
            // background: sunburst rays from the head, deep blue below
            const ang = Math.atan2(dy, dx);
            const stripe = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 30 + t * spin) % 2 === 0;
            const rayZone = y < 44 - Math.abs(dx) * 0.1;
            if (rayZone && d > 13 && stripe) c = (d > 24 ? rayA : rayB);
            else c = (x + Math.floor(y / 2)) % 7 === 0 && y > 40 ? P.bg2 : P.bg;
            if (pulse && c === rayA) c = pulse > 0.5 ? P.ray2 : P.ray;
          }
          C(x, y, tint(c));
        }
      }

      // ── face features ──
      const L = 16, R = 24, EY = 20;
      // eyeshadow band
      for (let x = 13; x <= 18; x++) C(x, EY - 1, tint(P.shadow));
      for (let x = 22; x <= 27; x++) C(x, EY - 1, tint(P.shadow));
      const star = (ex, ey, big, col) => {
        C(ex, ey, P.eyeHi); C(ex - 1, ey, col); C(ex + 1, ey, col); C(ex, ey - 1, col); C(ex, ey + 1, col);
        if (big) { C(ex - 2, ey, col); C(ex + 2, ey, col); C(ex, ey - 2, col); C(ex, ey + 2, col); }
        // dark lash rays (the reference's X-shaped lashes)
        C(ex - 2, ey - 1, P.lash); C(ex + 2, ey - 1, P.lash); C(ex - 2, ey + 1, P.lash); C(ex + 2, ey + 1, P.lash);
        C(ex - 3, ey, P.lash); C(ex + 3, ey, P.lash);
      };
      const closed = (ex, ey, curveDown) => { for (let i = -2; i <= 2; i++) C(ex + i, ey + (curveDown && Math.abs(i) === 2 ? -1 : 0), P.lash); };
      const happyEye = (ex, ey) => { C(ex - 2, ey + 1, P.lash); C(ex - 1, ey, P.lash); C(ex, ey - 1, P.lash); C(ex + 1, ey, P.lash); C(ex + 2, ey + 1, P.lash); };
      const look = mood === "thinking" ? { dx: -1, dy: -1 } : { dx: 0, dy: 0 };
      if (sleepy) { closed(L, EY + 1, true); closed(R, EY + 1, true); }
      else if (blinking) { closed(L, EY, false); closed(R, EY, false); }
      else if (mood === "happy") { happyEye(L, EY); happyEye(R, EY); }
      else {
        const big = mood === "listening" || mood === "alert";
        const col = mood === "alert" ? P.red : P.eye;
        star(L + look.dx, EY + look.dy, big, col); star(R + look.dx, EY + look.dy, big, col);
      }
      if (mood === "alert") { C(L - 2, EY - 3, P.lash); C(L - 1, EY - 2, P.lash); C(R + 2, EY - 3, P.lash); C(R + 1, EY - 2, P.lash); }
      if (mood === "happy" || mood === "talking") { C(14, 23, P.blush); C(15, 23, P.blush); C(25, 23, P.blush); C(26, 23, P.blush); }
      // nose
      C(20, 24, tint(P.nose)); C(20, 25, tint(P.faceSh));
      // mouth
      const M = 27;
      if (mood === "talking") {
        mouthPhase = Math.floor(now / 110) % 4;
        const open = st.speaking === false ? 0 : [0, 1, 2, 1][mouthPhase];
        for (let x = 18; x <= 22; x++) C(x, M, P.lip);
        if (open >= 1) { for (let x = 19; x <= 21; x++) C(x, M + 1, P.body); C(18, M + 1, P.lip); C(22, M + 1, P.lip); }
        if (open >= 2) { for (let x = 19; x <= 21; x++) C(x, M + 2, P.body); C(18, M + 2, P.lip2); C(22, M + 2, P.lip2); }
        for (let x = 19; x <= 21; x++) C(x, M + 1 + open, P.lip2);
      } else if (mood === "happy") {
        C(17, M, P.lip); C(23, M, P.lip); for (let x = 18; x <= 22; x++) C(x, M + 1, P.lip2); C(19, M, P.body); C(20, M, P.body); C(21, M, P.body);
      } else if (mood === "alert" || mood === "listening") {
        C(19, M, P.lip); C(20, M, P.lip); C(21, M, P.lip); C(19, M + 1, P.lip2); C(20, M + 1, P.body); C(21, M + 1, P.lip2); C(20, M + 2, P.lip2);
      } else if (mood === "thinking") {
        for (let x = 18; x <= 21; x++) C(x, M + 1, P.lip); C(22, M, P.lip);
      } else {
        // calm: closed lilac lips like the reference
        for (let x = 18; x <= 22; x++) C(x, M, tint(P.lip)); C(20, M, tint(P.body));
        for (let x = 19; x <= 21; x++) C(x, M + 1, tint(P.lip2));
      }

      // ── mood props ──
      if (mood === "thinking" && anim !== "off") { const k = Math.floor(t * 3) % 4; for (let i = 0; i < 3; i++) if (i < k) { C(30 + i * 2, 5, P.white); } }
      if (sleepy) { const k = anim === "off" ? 0 : Math.floor(t * 1.5) % 3; [[30, 8], [33, 5], [36, 2]].forEach(([x, y], i) => { if (i <= k) { C(x, y, P.white); C(x + 1, y, P.white); C(x + 1, y + 1, P.white); C(x, y + 2, P.white); C(x + 1, y + 2, P.white); } }); }
      if (mood === "alert" && (anim === "off" || Math.floor(t * 3) % 2 === 0)) { for (let y = 2; y <= 5; y++) C(34, y, P.red); C(34, 7, P.red); }
      if (mood === "happy" && anim !== "off") { [[5, 10], [33, 12], [8, 30], [31, 32]].forEach(([x, y], i) => { if (Math.floor(t * 4 + i) % 3 === 0) { C(x, y, P.white); C(x - 1, y, P.eyeHi); C(x + 1, y, P.eyeHi); C(x, y - 1, P.eyeHi); C(x, y + 1, P.eyeHi); } }); }
      if (mood === "listening" && anim !== "off") { const k = Math.floor(t * 4) % 3; for (let i = 0; i <= k; i++) { C(3, 20 - i * 2, P.white); C(36, 20 - i * 2, P.white); } }

      // cross-stitch grid like the reference
      if (cell >= 5) {
        ctx.fillStyle = P.grid;
        for (let x = 1; x < GW; x++) ctx.fillRect(x * cell, 0, 1, GH * cell);
        for (let y = 1; y < GH; y++) ctx.fillRect(0, y * cell, GW * cell, 1);
      }
    }

    function frame(now) {
      if (!running) return;
      const anim = (G.Helix && G.Helix.SET.anim) || "full";
      const fps = anim === "full" ? 20 : 8;
      if (now - last > 1000 / fps) { last = now; draw(now); }
      if (anim === "off") setTimeout(() => G.requestAnimationFrame(frame), 500); else G.requestAnimationFrame(frame);
    }
    const ro = new ResizeObserver(() => { size(); draw(performance.now()); });
    ro.observe(canvas.parentNode);
    size(); G.requestAnimationFrame(frame);
    return { destroy() { running = false; ro.disconnect(); }, redraw() { draw(performance.now()); } };
  }

  /* mood from real state */
  function moodOf(ctx) {
    const H = G.Helix, st = H.D("stats"), tr = H.D("trace");
    if (st && st.hermes && !st.hermes.gateway_running && !ctx.chatConfigured) return { mood: "sleeping", why: "gateway is down" };
    if (ctx.streaming) return { mood: "talking", speaking: ctx.speaking !== false, why: "replying to you" };
    if (ctx.waiting) return { mood: "thinking", why: "thinking about your message" };
    if (tr && tr.live) return { mood: "thinking", why: "working on: " + (tr.objective || tr.stage || "a request") };
    if (ctx.typing) return { mood: "listening", why: "listening" };
    if (ctx.happyUntil && Date.now() < ctx.happyUntil) return { mood: "happy", why: "done" };
    const high = st ? H.needsList().filter((x) => x.sev === "high") : [];
    if (high.length) return { mood: "alert", why: high[0].title };
    if (st && st.hermes && !st.hermes.gateway_running) return { mood: "sleeping", why: "gateway is down" };
    return { mood: "calm", why: "standing by" };
  }

  G.HelixAvatar = { mount, moodOf };
})(window);
