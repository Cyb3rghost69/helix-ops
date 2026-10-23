/* HELIX/OPS — Helix avatar rig (no image files).
   A 48×48 pixel character built from code: separate layers for background, back hair, shoulders,
   neck, face, features and front hair. Every part has its own transform, so the whole avatar can
   animate: breathing, head bob/tilt, hair sway + drips, blinking, gaze, lip-sync, mood props.
   The background is its own layer with a theme per mood, cross-faded on change.
   API: mount(canvas, { getMood, crop, size }) → { destroy, setBackground(name|null), poke(kind) } */
(function (G) {
  "use strict";
  const N = 48, HX = 24, HY = 19;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const C = {
    hair: hex("#a6e6ff"), hairMid: hex("#6cc6f2"), hairDeep: hex("#3a96de"), hairHi: hex("#e2f9ff"), hairEdge: hex("#2f77c4"),
    p1: hex("#8a5ae8"), p2: hex("#6640d4"), p3: hex("#452cb8"), p4: hex("#2e1f9a"),
    face: hex("#d2f5ff"), faceSh: hex("#a5dcf3"), faceSh2: hex("#7cc0e6"), neck: hex("#8fcdeb"),
    shadow: hex("#9a5ee0"), lip: hex("#7a3cc4"), lip2: hex("#a866e2"), mouthIn: hex("#2a1660"), nose: hex("#8a52d0"),
    eye: hex("#ff3fa4"), eyeHi: hex("#ffe0f1"), lash: hex("#1b1470"), red: hex("#ff4d6d"), blush: hex("#ff9bd2"),
    body: hex("#241a5e"), body2: hex("#33267a"), collar: hex("#ff4fa3"), white: hex("#ffffff"), sweat: hex("#7fe3ff"),
  };
  const h2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const colN = Array.from({ length: N }, (_, x) => h2(x, 7));
  const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

  /* ───────── background themes (each returns rgb for a pixel) ───────── */
  const BG = {
    calm(x, y, t) {            // slow sunburst behind her head, dashboard pinks on deep night
      const dx = x + 0.5 - HX, dy = y + 0.5 - (HY - 2), d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const base = lerp(hex("#1a1036"), hex("#0d0a1a"), Math.min(1, d / 34));
      if (d > 12 && Math.floor(((a + Math.PI) / (2 * Math.PI)) * 24 + t * 0.25) % 2 === 0) return lerp(base, d > 22 ? hex("#ff4fa3") : hex("#c23d8f"), Math.max(0.18, 0.55 - d / 70));
      return (x + y) % 6 === 0 ? lerp(base, hex("#2a1d4a"), 0.6) : base;
    },
    thinking(x, y, t) {        // circuit grid with packets orbiting her head
      const base = (x % 6 === 0 || y % 6 === 0) ? hex("#1c1530") : hex("#110d1f");
      for (let i = 0; i < 4; i++) {
        const a = t * (0.9 + i * 0.25) + i * 1.6, r = 13 + i * 3;
        const ox = Math.round(HX + Math.cos(a) * r), oy = Math.round(HY - 2 + Math.sin(a) * r * 0.8);
        if (Math.abs(x - ox) <= 0 && Math.abs(y - oy) <= 0) return hex(i % 2 ? "#f59e0b" : "#ffd27a");
        const tx = Math.round(HX + Math.cos(a - 0.15) * r), ty = Math.round(HY - 2 + Math.sin(a - 0.15) * r * 0.8);
        if (x === tx && y === ty) return hex("#7a4d10");
      }
      if ((x % 6 === 0 || y % 6 === 0) && h2(x, y) > 0.9) return hex("#3a2a14");
      return base;
    },
    talking(x, y, t, s) {      // rings pulsing out from her mouth while she speaks
      const d = Math.hypot(x + 0.5 - HX, y + 0.5 - 24);
      const base = hex("#160d24");
      const k = (d - t * 9) % 7;
      if (s.speaking && d > 8 && k > -0.5 && k < 0.6) return lerp(base, hex("#ff4fa3"), Math.max(0.15, 0.8 - d / 40));
      return y % 3 === 0 ? hex("#1b1030") : base;
    },
    listening(x, y, t) {       // equaliser bars rising at the bottom
      const base = lerp(hex("#140f2a"), hex("#0d0a18"), y / N);
      const bar = Math.floor(x / 3), h = 4 + Math.floor((Math.sin(t * 6 + bar * 1.3) + 1) * 4 + h2(bar, Math.floor(t * 4)) * 5);
      if (x % 3 !== 2 && y >= N - h) return lerp(hex("#a78bfa"), hex("#ff4fa3"), (N - y) / 18);
      return base;
    },
    happy(x, y, t) {           // sparkles drifting up
      const base = lerp(hex("#12221d"), hex("#0d0a18"), y / N);
      for (let i = 0; i < 9; i++) {
        const sx = Math.floor(h2(i, 3) * N), sy = Math.floor((h2(i, 9) * N - t * (5 + i)) % N + N) % N;
        if (x === sx && y === sy) return hex(i % 3 === 0 ? "#39e58c" : i % 3 === 1 ? "#ff4fa3" : "#ffffff");
        if ((x === sx && Math.abs(y - sy) === 1) || (y === sy && Math.abs(x - sx) === 1)) return hex(i % 2 ? "#1f6b4a" : "#7a2c58");
      }
      return base;
    },
    alert(x, y, t) {           // red hazard stripes scrolling, flashing
      const on = Math.floor(t * 2.5) % 2 === 0;
      const stripe = Math.floor((x + y + t * 8) / 4) % 2 === 0;
      return stripe ? (on ? hex("#3a0d1c") : hex("#2a0a16")) : hex("#160812");
    },
    sleeping(x, y, t) {        // night sky, twinkling stars, pixel moon
      const base = lerp(hex("#0b0d2a"), hex("#05060f"), y / N);
      const mx = 38, my = 9, md = Math.hypot(x - mx, y - my);
      if (md < 4.5 && Math.hypot(x - mx - 2, y - my + 1) > 3.6) return hex("#fff1b8");
      if (h2(x, y) > 0.985) return Math.sin(t * 2 + x * y) > 0 ? hex("#ffffff") : hex("#6f6aa8");
      return base;
    },
  };
  BG.calm.label = "SUNBURST";

  /* ───────── character layers (local coords, transforms applied by caller) ───────── */
  function hairColor(x, y, t, depthFrom) {
    const sx = Math.max(0, Math.min(N - 1, Math.round(x + Math.sin(y * 0.24 + colN[Math.max(0, Math.min(N - 1, x | 0))] * 6) * 1.1)));
    const strand = h2(Math.floor(sx / 2) * 2 + (y > 30 ? 1 : 0), 3) * 0.6 + colN[sx] * 0.4;
    const depth = (y - depthFrom) / 14;
    if (depth > 0 && h2(x | 0, y | 0) < depth * 0.95) { const n = h2((x | 0) * 3, y | 0); return n > 0.66 ? C.p1 : n > 0.33 ? C.p2 : C.p3; }
    const shimmer = ((Math.floor(y) + Math.floor(t * 5)) % 15 === Math.floor(strand * 15)) && strand > 0.4;
    if (shimmer) return C.hairHi;
    return strand > 0.74 ? C.hairHi : strand > 0.46 ? C.hair : strand > 0.2 ? C.hairMid : C.hairDeep;
  }
  function dripEnd(x, t, anim) { return 43 + Math.floor(colN[x] * 5) + (anim && colN[x] > 0.6 ? Math.floor((t * 1.5 + colN[x] * 9) % 4) : 0); }

  /* head group: returns [rgb, depth] or null. depth: 1 back hair, 4 face, 5 features, 6 front hair */
  function headPx(x, y, s, t) {
    const fx = (x + 0.5 - HX) / 8.3, fy = (y + 0.5 - (HY + 0.3)) / 9.6, inFace = fx * fx + fy * fy <= 1;
    const ax = Math.abs(x + 0.5 - HX);
    const end = dripEnd(Math.max(0, Math.min(N - 1, x | 0)), t, s.anim);
    // front hair: bangs + side locks hugging the face
    const bangBottom = 12 + (h2(x | 0, 1) > 0.55 ? 1 : 0) + (ax < 1.5 ? -1 : 0) + (ax > 6 ? 1 : 0);
    if (y >= 4 && y <= bangBottom && ax <= 9 && Math.hypot(x + 0.5 - HX, y + 0.5 - (HY - 2)) <= 13.6) return [hairColor(x, y, t, 34), 6];
    if (y >= 13 && y <= end && ax >= 8.1 && ax <= 10.6 + Math.max(0, y - 27) * 0.14) {
      const c = hairColor(x, y, t, 32);
      return [ax < 8.8 && y < 28 ? C.hairEdge : c, 6];
    }
    // face + features
    if (inFace && y >= 9) {
      const e = fx * fx + fy * fy;
      let c = e > 0.8 ? C.faceSh2 : e > 0.58 ? C.faceSh : C.face;
      if (y >= 27) c = C.faceSh;
      const f = feature(x | 0, y | 0, s, t);
      if (f) return [f, 5];
      return [c, 4];
    }
    // back hair: dome + long fall behind the shoulders
    const dome = Math.hypot(x + 0.5 - HX, y + 0.5 - (HY - 2)) <= 13.8 && y <= HY;
    const fall = y > HY - 1 && y <= end && ax <= 13.6 + (y - HY) * 0.13;
    if (dome || fall) {
      let c = hairColor(x, y, t, 30);
      if (ax > 12.8 + Math.max(0, y - HY) * 0.13) c = y > 30 ? C.p3 : C.hairEdge;
      if (y >= end - 1 && y > 30) c = C.p2;
      return [c, 1];
    }
    return null;
  }
  function feature(x, y, s, t) {
    const L = HX - 4, R = HX + 3, EY = HY;
    const lx = s.look[0], ly = s.look[1];
    // eyeshadow
    if (y === EY - 3 && ((x >= L - 2 && x <= L + 1) || (x >= R - 1 && x <= R + 2))) return C.lash;
    if (y === EY - 2 && ((x >= L - 3 && x <= L + 2) || (x >= R - 2 && x <= R + 3))) return C.shadow;
    if (y === EY - 1 && (x === L - 3 || x === R + 3)) return C.shadow;
    const mood = s.mood;
    const eyeAt = (ex) => {
      const cx = ex + lx, cy = EY + ly;
      const dx = x - ex, dy = y - EY;
      if (mood === "sleeping") return ((dy === 1 && Math.abs(dx) <= 1) || (dy === 0 && Math.abs(dx) === 2)) ? C.lash : null;
      if (s.blink) return (dy === 0 && Math.abs(dx) <= 2) ? C.lash : null;
      if (mood === "happy") return ((dy === 0 && Math.abs(dx) === 2) || (dy === -1 && Math.abs(dx) <= 1)) ? C.lash : null;
      const col = mood === "alert" ? C.red : C.eye, ddx = x - cx, ddy = y - cy;
      if (ddx === 0 && ddy === 0) return s.twinkle ? C.white : C.eyeHi;
      if ((ddy === 0 && Math.abs(ddx) <= 2) || (ddx === 0 && Math.abs(ddy) <= 2)) return (Math.abs(ddx) === 2 || Math.abs(ddy) === 2) && mood !== "alert" ? C.blush : col;
      if (Math.abs(ddx) === 1 && Math.abs(ddy) === 1) return C.lash;
      return null;
    };
    const el = eyeAt(L) || eyeAt(R);
    if (el) return el;
    if (mood === "alert" && y === EY - 4 && (x === L - 1 || x === L || x === R || x === R + 1)) return C.lash;
    if ((mood === "happy" || mood === "talking") && y === EY + 3 && (x === L - 2 || x === L - 3 || x === R + 2 || x === R + 3)) return C.blush;
    // nose
    if (x === HX && y === HY + 3) return C.nose;
    // mouth
    const M = HY + 6;
    if (mood === "talking") {
      const o = s.mouthOpen;
      if (y === M && x >= HX - 1 && x <= HX + 1) return C.lip;
      if (o >= 1 && y === M + 1 && x >= HX - 1 && x <= HX + 1) return x === HX ? C.mouthIn : C.lip2;
      if (o >= 2 && y === M + 2 && x === HX) return C.lip2;
      if (o === 0 && y === M + 1 && x === HX) return C.lip2;
      return null;
    }
    if (mood === "happy") { if ((y === M && (x === HX - 2 || x === HX + 2)) || (y === M + 1 && x >= HX - 1 && x <= HX + 1)) return C.lip; return null; }
    if (mood === "listening" || mood === "alert") { if (y === M && x === HX) return C.lip; if (y === M + 1 && x === HX) return C.mouthIn; return null; }
    if (mood === "thinking") { if (y === M + 1 && x >= HX - 1 && x <= HX) return C.lip; if (y === M && x === HX + 1) return C.lip; return null; }
    if (mood === "sleeping") { if (y === M + 1 && x === HX) return C.lip2; return null; }
    if (y === M && x >= HX - 1 && x <= HX + 1) return x === HX ? C.lip : C.lip2;
    if (y === M + 1 && x === HX) return C.lip2;
    return null;
  }
  /* body group: shoulders + neck (breathing transform) */
  function bodyPx(x, y) {
    const ax = Math.abs(x + 0.5 - HX);
    if (y >= 27 && y <= 32 && ax <= 2.6) return [y < 29 ? C.faceSh2 : C.neck, 3];
    if (y >= 33 && ax <= 9 + (y - 33) * 1.2) {
      if (y === 33 || (y === 34 && ax > 2.6)) return [C.collar, 2];
      if (y <= 35 && ax <= 2.6) return [C.neck, 3];
      return [h2(x, y) > 0.85 ? C.body2 : C.body, 2];
    }
    return null;
  }

  /* ───────── renderer ───────── */
  function mount(canvas, opts) {
    opts = opts || {};
    const crop = opts.crop || [0, 0, N, N];
    const off = document.createElement("canvas"); off.width = crop[2]; off.height = crop[3];
    const octx = off.getContext("2d"), img = octx.createImageData(crop[2], crop[3]), px = img.data;
    const ctx = canvas.getContext("2d");
    let running = true, last = 0, blinkAt = performance.now() + 2000, blinkUntil = 0, lookT = 0, look = [0, 0], fixedBg = null;
    let curMood = null, prevBg = null, bgFadeT = 0, hopT = 0, twinkleAt = 0;
    const t0 = performance.now();

    function size() {
      const box = canvas.parentNode.getBoundingClientRect();
      // fill the box exactly (square); nearest-neighbour keeps the pixels crisp
      const want = Math.max(crop[2], Math.floor(Math.min(box.width || 300, opts.size || 9999)));
      const dpr = Math.min(3, G.devicePixelRatio || 1), hgt = Math.round(want * crop[3] / crop[2]);
      canvas.style.width = want + "px"; canvas.style.height = hgt + "px";
      canvas.width = Math.round(want * dpr); canvas.height = Math.round(hgt * dpr);
      ctx.imageSmoothingEnabled = false;
    }

    function draw(now) {
      const anim = opts.still ? "off" : (G.Helix && G.Helix.SET.anim) || "full", moving = anim !== "off";
      const st = (opts.getMood && opts.getMood()) || { mood: "calm" };
      const mood = st.mood || "calm", t = moving ? (now - t0) / 1000 : 0;
      if (mood !== curMood) { prevBg = curMood; bgFadeT = now; if (curMood) hopT = now; curMood = mood; }
      // blink + gaze + twinkle
      if (moving && mood !== "sleeping" && now > blinkAt) { blinkUntil = now + 130; blinkAt = now + 2000 + Math.random() * 4000; }
      if (moving && now > lookT) { lookT = now + 1500 + Math.random() * 2500; look = mood === "thinking" ? [-1, -1] : mood === "listening" ? [0, 0] : [[0, 0], [0, 0], [-1, 0], [1, 0], [0, 1]][Math.floor(Math.random() * 5)]; }
      if (mood === "thinking") look = [-1, -1];
      if (moving && now > twinkleAt + 1800) twinkleAt = now;
      const s = {
        mood, anim: anim === "full", blink: now < blinkUntil, look, twinkle: now - twinkleAt < 160,
        speaking: !!st.speaking, mouthOpen: st.speaking ? [0, 1, 2, 1][Math.floor(now / 105) % 4] : 0,
      };
      // transforms
      const breath = moving ? Math.round((Math.sin(t * 1.6) + 1) / 2) : 0;
      let bob = 0, tilt = 0, swayAmp = 0.6;
      if (moving) {
        if (mood === "talking") bob = st.speaking ? Math.round(Math.sin(t * 9) * 0.6) : 0;
        if (mood === "happy") bob = -Math.round(Math.abs(Math.sin(t * 5)) * 1.4);
        if (mood === "calm") bob = Math.round(Math.sin(t * 1.2) * 0.6);
        if (mood === "sleeping") bob = 1 + Math.round((Math.sin(t * 0.9) + 1) / 2);
        if (now - hopT < 300) bob -= 1;
        swayAmp = mood === "happy" ? 1.4 : mood === "talking" ? 0.9 : mood === "sleeping" ? 0.3 : 0.7;
      }
      if (mood === "listening") tilt = 0.12; else if (mood === "thinking") tilt = -0.08; else if (mood === "sleeping") tilt = 0.1;
      const bgName = fixedBg || mood, bgFn = BG[bgName] || BG.calm, prevFn = prevBg ? (BG[prevBg] || BG.calm) : null;
      const fade = prevFn && !fixedBg ? Math.min(1, (now - bgFadeT) / 600) : 1;
      for (let j = 0; j < crop[3]; j++) {
        const y = j + crop[1];
        const hy = y - bob, sway = moving ? Math.sin(t * 1.3 + hy * 0.22) * swayAmp * Math.max(0, (hy - 14) / 26) : 0;
        for (let i = 0; i < crop[2]; i++) {
          const x = i + crop[0];
          // head group (bob + tilt + hair sway below the jaw)
          const hx = x - (hy - HY) * tilt - (hy > 22 ? sway : 0);
          const hp = headPx(Math.floor(hx), Math.floor(hy), s, t);
          const bp = bodyPx(x, y - breath);
          let rgb;
          if (hp && (!bp || hp[1] > bp[1])) rgb = hp[0];
          else if (bp) rgb = bp[0];
          else {
            rgb = bgFn(x, y, t, s);
            if (fade < 1) rgb = lerp(prevFn(x, y, t, s), rgb, fade);
          }
          const k = (j * crop[2] + i) * 4;
          px[k] = rgb[0]; px[k + 1] = rgb[1]; px[k + 2] = rgb[2]; px[k + 3] = 255;
        }
      }
      // mood props drawn over everything
      const P = (x, y, c) => { x -= crop[0]; y -= crop[1]; if (x < 0 || y < 0 || x >= crop[2] || y >= crop[3]) return; const k = (y * crop[2] + x) * 4; px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; };
      if (mood === "thinking" && moving) { const k = Math.floor(t * 3) % 4; for (let i = 0; i < k; i++) P(34 + i * 2, 4, C.white); }
      if (mood === "sleeping") { const k = moving ? Math.floor(t * 1.2) % 3 : 2; [[33, 10], [36, 7], [39, 4]].forEach(([x, y], i) => { if (i <= k) { P(x, y, C.white); P(x + 1, y, C.white); P(x + 1, y + 1, C.white); P(x, y + 2, C.white); P(x + 1, y + 2, C.white); } }); }
      if (mood === "alert") { if (!moving || Math.floor(t * 3) % 2 === 0) { for (let y = 3; y <= 6; y++) P(37, y, C.red); P(37, 8, C.red); } P(HX + 8, HY - 3 + (moving ? Math.floor(t * 2) % 3 : 0), C.sweat); }
      if (mood === "happy" && moving) [[12, 9], [36, 11], [10, 27], [38, 29]].forEach(([x, y], i) => { if (Math.floor(t * 4 + i) % 3 === 0) { P(x, y, C.white); P(x - 1, y, C.eyeHi); P(x + 1, y, C.eyeHi); P(x, y - 1, C.eyeHi); P(x, y + 1, C.eyeHi); } });
      octx.putImageData(img, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    }

    function frame(now) {
      if (!running) return;
      const anim = (G.Helix && G.Helix.SET.anim) || "full";
      if (now - last > 1000 / (anim === "full" ? 24 : 8)) { last = now; draw(now); }
      if (anim === "off") setTimeout(() => G.requestAnimationFrame(frame), 400); else G.requestAnimationFrame(frame);
    }
    if (opts.still) { const sc = opts.scale || 2; canvas.width = crop[2] * sc; canvas.height = crop[3] * sc; draw(performance.now()); return { destroy() {} }; }
    const ro = new ResizeObserver(() => { size(); draw(performance.now()); });
    ro.observe(canvas.parentNode);
    size(); G.requestAnimationFrame(frame);
    return {
      destroy() { running = false; ro.disconnect(); },
      setBackground(name) { fixedBg = name && BG[name] ? name : null; bgFadeT = performance.now(); },
      poke() { hopT = performance.now(); },
    };
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

  /* tiny still portrait (head crop) for chat bubbles, cached per mood */
  const faceCache = {};
  function face(mood) {
    if (faceCache[mood]) return faceCache[mood];
    const c = document.createElement("canvas");
    mount(c, { still: true, scale: 2, crop: [10, 3, 28, 28], getMood: () => ({ mood: mood || "calm" }) });
    return (faceCache[mood] = c.toDataURL());
  }
  G.HelixAvatar = { mount, moodOf, face, BACKGROUNDS: Object.keys(BG) };
})(window);
