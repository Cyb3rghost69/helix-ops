/* HELIX/OPS — Helix avatar (SNES-style, no image files).
   64×64 sprite built from code in mirrored parts, so she is symmetric: back hair, body, neck, face,
   eyes/brows/mouth sprites (expression frames), bangs, front locks, then a 1px dark outline pass.
   Shading uses fixed colour ramps with ordered (Bayer) dithering, like 16-bit console art.
   Every part has integer offsets (bob, breath, hair line-sway), so any part can animate.
   Background is a separate parallax layer (banded sky, sun/moon, mountains, city, mode-7 floor grid)
   whose palette cross-fades with her mood; a BACKDROP pin overrides the mood palette.
   API: mount(canvas, { getMood, crop, still, scale }) → { destroy, setBackground(name|null), poke() } */
(function (G) {
  "use strict";
  const N = 64, CX = 32;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const bay = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
  const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const dxOf = (x) => x + 0.5 - CX;              // symmetric: dxOf(63 - x) === -dxOf(x)

  /* ───────── character palette ───────── */
  const K = {
    out: hex("#140c33"),
    f0: hex("#eafcff"), f1: hex("#c9f1fb"), f2: hex("#a0d7ee"), f3: hex("#77b2dc"),
    lash: hex("#1a1150"), white: hex("#f6fbff"), pink: hex("#ff3fa4"), mag: hex("#b8167a"), lpink: hex("#ffb3dc"), hi: hex("#ffffff"),
    red: hex("#ff2e4a"), dred: hex("#9a0a26"), lred: hex("#ffc2cc"),
    shadow: hex("#9a6ae6"), brow: hex("#3a6fc4"), blush: hex("#ff9bd2"),
    lip: hex("#8a48d0"), lipL: hex("#b884ec"), mIn: hex("#3a1650"), tongue: hex("#ff7fb8"),
    j0: hex("#43369c"), j1: hex("#2c2276"), j2: hex("#1d1654"), trim: hex("#ff4fa3"), zip: hex("#7fe3ff"),
    drip: hex("#8a5ae8"), sweat: hex("#7fe3ff"),
  };
  // hair ramps: index 0 top → 4 tips (blue → lilac → purple); *_D are strand/shadow versions
  const FR = ["#aee8ff", "#9fdcfb", "#b4b4f2", "#9a7cec", "#7a52dc"].map(hex);
  const FR_D = ["#6cbcf0", "#62aee8", "#8486dc", "#7356d0", "#5634b8"].map(hex);
  const BK = ["#3f86d6", "#3a78cc", "#5458c2", "#4a3cb0", "#382a96"].map(hex);
  const BK_D = ["#2c62b0", "#2a58a6", "#3e40a0", "#36288e", "#281c74"].map(hex);
  const HI = hex("#f2fdff");

  /* ───────── expression sprites (left side; mirrored for the right) ───────── */
  const EYE = {   // 7×5, top-left at (23, 27); K lash, W white, P pink, M deep, L light, H highlight
    open:   ["KKKKKK.", "KWPLPMK", ".PLHLPK", ".MPLPM.", "..MMM.."],
    half:   [".......", "KKKKKKK", ".PLHLPK", ".MPLPM.", "..MMM.."],
    closed: [".......", ".......", "KKKKKKK", ".......", "......."],
    sleep:  [".......", ".......", ".......", "KKKKKK.", ".KKKK.."],
    happy:  [".......", "..KKK..", ".K...K.", "K.....K", "......."],
    wide:   ["KKKKKK.", "KWLPLWK", ".LPHPLK", ".PLPLP.", "..MMM.."],
  };
  const MOUTH = { // 4 wide, top-left at (30, 36); m line, l lip, d inside, t tongue
    calm: [".mm.", ".ll."], happy: ["m..m", ".mm."], o: [".mm.", "mddm", ".mm."], flat: ["mmmm"],
    sleep: [".ll."], talk0: [".mm.", ".ll."], talk1: [".mm.", "mddm", ".ll."], talk2: [".mm.", "mddm", "mdtm", ".ll."],
  };
  const EC = { K: "lash", W: "white", P: "pink", M: "mag", L: "lpink", H: "hi" };
  const MC = { m: "lip", l: "lipL", d: "mIn", t: "tongue" };

  /* ───────── geometry (half-widths, symmetric) ───────── */
  function faceHW(y) {
    if (y < 13) return -1;
    if (y < 27) return 10.5 * Math.sqrt(Math.max(0, 1 - Math.pow((27 - y) / 15, 2)));
    if (y < 34) return 10.5 - (y - 27) * 0.45;
    if (y <= 40) return 7.35 - (y - 34) * 1.15;
    return -1;
  }
  const domeHW = (y) => (y <= 22 ? Math.sqrt(Math.max(0, 16.5 * 16.5 - (22 - y) * (22 - y))) : 16.5 + (y - 22) * 0.1);
  function bangBottom(a) {      // a = |dx|; pointed clumps every 4px, longer at the temples
    const u = (a - 0.5 + 400) % 4, zig = Math.min(u, 4 - u);
    return 22 + zig + (a > 7 ? Math.min(6, (a - 7) * 0.9) : 0);
  }
  const lockInner = (y) => (y < 34 ? Math.max(0, faceHW(y) - 0.6) : Math.max(6.5, 6.6 + (y - 36) * 0.22));
  const lockOuter = (y) => domeHW(y) - 0.6;
  function lockEnd(a) { const k = Math.floor((a - 6) / 3); return [60, 57, 61, 58, 62, 59][((k % 6) + 6) % 6] - ((a - 6) % 3 < 1 || (a - 6) % 3 > 2 ? 1 : 0); }
  function backEnd(a) { const k = Math.floor(a / 3); return [52, 54, 51, 53][k % 4]; }
  const shoulderHW = (y) => (y < 45 ? -1 : y < 54 ? 4.5 + 19 * Math.sqrt((y - 44) / 10) : 23.5 + (y - 54) * 0.25);
  const rampIdx = (x, y, y0, span) => Math.max(0, Math.min(4, Math.floor(((y - y0) / span) * 4 + bay(x, y))));

  /* ───────── background palettes (one per mood) + scene ───────── */
  const PAL = {
    calm:      { sky: ["#1b0f3a", "#4a1660", "#a3246e", "#ff6a7a"], sun: ["#ffe28a", "#ff8a4c"], far: "#3a1450", near: "#1c0c30", win: "#ffcf5a", grid: "#ff4fa3", floor: "#140824", stars: 0.3 },
    thinking:  { sky: ["#03100c", "#06231a", "#0c4630", "#1f8a52"], sun: ["#d8ffe6", "#39e58c"], far: "#0b2e20", near: "#051610", win: "#39e58c", grid: "#39e58c", floor: "#030c08", stars: 0 },
    talking:   { sky: ["#12052a", "#3a0a5e", "#7a1a9a", "#ff4fa3"], sun: ["#c8f8ff", "#22d3ee"], far: "#2a0f4a", near: "#150828", win: "#22d3ee", grid: "#22d3ee", floor: "#0c0418", stars: 0.15 },
    listening: { sky: ["#06122e", "#0b2a5e", "#155a9a", "#3fb0e0"], sun: ["#eefcff", "#9fe3ff"], far: "#0e2a52", near: "#081a36", win: "#a78bfa", grid: "#a78bfa", floor: "#050f22", stars: 0.2 },
    happy:     { sky: ["#2a4aa8", "#4a86e0", "#8cc8f4", "#ffe0b0"], sun: ["#fffbe0", "#ffd25a"], far: "#4a78b8", near: "#2e4c86", win: "#fff1a0", grid: "#39e58c", floor: "#16305a", stars: 0 },
    alert:     { sky: ["#1a0208", "#4a0614", "#8a0a22", "#ff2e4a"], sun: ["#ffd8a8", "#ff4d2e"], far: "#3a0610", near: "#1e030a", win: "#ff4d6d", grid: "#ff4d6d", floor: "#120206", stars: 0 },
    sleeping:  { sky: ["#03040f", "#070b26", "#0e1640", "#1e2a66"], sun: ["#fff6d8", "#c8c0ff"], far: "#0b1236", near: "#060a20", win: "#ffe08a", grid: "#3a4a9a", floor: "#03050f", stars: 1 },
  };
  const toRGB = (p) => ({ sky: p.sky.map(hex), sun: p.sun.map(hex), far: hex(p.far), near: hex(p.near), win: hex(p.win), grid: hex(p.grid), floor: hex(p.floor), stars: p.stars });
  const PALRGB = {}; Object.keys(PAL).forEach((k) => (PALRGB[k] = toRGB(PAL[k])));
  function lerpPal(cur, tgt, k) {
    const L = (a, b) => mix(a, b, k);
    return { sky: cur.sky.map((c, i) => L(c, tgt.sky[i])), sun: cur.sun.map((c, i) => L(c, tgt.sun[i])), far: L(cur.far, tgt.far), near: L(cur.near, tgt.near), win: L(cur.win, tgt.win), grid: L(cur.grid, tgt.grid), floor: L(cur.floor, tgt.floor), stars: cur.stars + (tgt.stars - cur.stars) * k };
  }
  function skyAt(p, y, x) {     // banded gradient (4px bands) with dithered seams, like HDMA sky
    const f = Math.min(0.999, y / 46) * 3, i = Math.floor(f), k = f - i;
    const band = Math.floor(k * 4) / 4, kk = band + (bay(x, y) < (k * 4 - Math.floor(k * 4)) ? 0.25 : 0);
    return mix(p.sky[i], p.sky[i + 1], Math.min(1, kk));
  }
  function drawBG(buf, p, t, mood, s) {
    const night = mood === "sleeping";
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let c;
      if (y < 46) {
        c = skyAt(p, y, x);
        // stars
        if (y < 30 && p.stars > 0.05 && hash(x, y) > 1 - 0.03 * p.stars) c = Math.sin(t * 3 + x * 7 + y) > -0.2 ? hex("#ffffff") : mix(c, hex("#ffffff"), 0.4);
        // sun (or moon at night), synthwave stripes scrolling down through the lower half
        if (!night) {
          const r = 25 + (mood === "talking" && s.speaking ? Math.round(Math.sin(t * 12)) : 0), dx = x + 0.5 - CX, dy = y + 0.5 - 27;
          if (dx * dx + dy * dy <= r * r && !(dy > 2 && Math.floor(dy + t * 3) % 4 === 0)) { const k = Math.max(0, Math.min(1, (dy + r) / (2 * r))); c = mix(p.sun[0], p.sun[1], Math.floor(k * 5 + bay(x, y) * 0.9) / 5); }
        } else {
          const dx = x - 49, dy = y - 12;
          if (dx * dx + dy * dy <= 30 && (dx + 2) * (dx + 2) + (dy - 1) * (dy - 1) > 22) c = p.sun[0];
        }
        // far mountains (slow scroll)
        const xm = x + t * 1.5, ym = 40 - 5 * Math.abs(Math.sin(xm * 0.085)) - 2 * Math.sin(xm * 0.23 + 1);
        if (y >= Math.round(ym)) c = y === Math.round(ym) ? mix(p.far, p.sun[1], 0.35) : p.far;
        // city skyline (faster scroll) with blinking windows
        const xc = Math.floor(x + t * 4), b = Math.floor(xc / 6), top = 45 - 3 - Math.floor(hash(b, 3) * 9);
        if (xc % 6 !== 5 && y >= top) {
          c = p.near;
          if (y > top && xc % 2 === 1 && y % 2 === 0 && hash(b * 7 + (xc % 6), y + Math.floor(t / 2.5)) > 0.62) c = p.win;
        }
      } else {
        // mode-7 style floor grid rushing towards the viewer
        const d = y - 43, z0 = 10 / d + t * 1.2, z1 = 10 / (d + 1) + t * 1.2;
        const hl = z0 - z1 < 0.9 && Math.floor(z0) !== Math.floor(z1);
        const X0 = (x - CX) / d * 1.4, X1 = (x + 1 - CX) / d * 1.4, vl = d >= 4 && Math.floor(X0) !== Math.floor(X1);
        c = hl || vl ? mix(p.floor, p.grid, Math.min(1, 0.3 + d / 22)) : d < 3 ? mix(p.floor, p.grid, 0.25 / d) : p.floor;
      }
      buf[y * N + x] = c;
    }
    // mood effects layered over the scene
    const P = (x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N) buf[y * N + x] = c; };
    if (mood === "thinking") for (let i = 0; i < 12; i++) {           // falling code
      const x = Math.floor(hash(i, 1) * N), y0 = Math.floor((hash(i, 2) * 60 + t * (6 + hash(i, 3) * 8)) % 50);
      for (let k = 0; k < 4; k++) P(x, y0 - k, mix(p.grid, p.sky[0], k / 4));
    }
    if (mood === "listening") for (let r = 0; r < 3; r++) {            // sound rings
      const R = ((t * 10 + r * 10) % 30) + 15;
      for (let a = 0; a < 64; a++) { const x = Math.round(CX + Math.cos(a / 64 * 6.283) * R), y = Math.round(30 + Math.sin(a / 64 * 6.283) * R * 0.7); if (y < 46) P(x, y, mix(buf[Math.max(0, Math.min(4095, y * N + x))] || p.win, p.win, 0.6)); }
    }
    if (mood === "happy") for (let i = 0; i < 3; i++) {                // drifting clouds
      const cx = Math.floor(((hash(i, 5) * 80 + t * (2 + i)) % 84) - 10), cy = 6 + i * 6;
      for (let x = -4; x <= 4; x++) for (let y = -1; y <= 1; y++) if (Math.abs(x) + Math.abs(y) * 3 <= 5) P(cx + x, cy + y, y === 1 ? hex("#dfeeff") : hex("#ffffff"));
    }
    if (mood === "alert" && Math.floor(t * 2.5) % 2 === 0) for (let i = 0; i < N * 46; i++) buf[i] = mix(buf[i], hex("#ff2e4a"), 0.18);
    if (mood === "alert") { const sy = Math.floor((t * 30) % 64); for (let x = 0; x < N; x++) P(x, sy, mix(buf[sy * N + x], hex("#ffffff"), 0.25)); }
    if (night) { const k = (t * 0.7) % 6; if (k < 1) for (let j = 0; j < 4; j++) P(Math.floor(4 + k * 30) - j, Math.floor(4 + k * 10) - Math.floor(j / 2), mix(hex("#ffffff"), p.sky[0], j / 4)); }
  }

  /* ───────── character ───────── */
  function drawChar(ch, s, t) {
    const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N) ch[y * N + x] = c; };
    const hy = s.headDY, by = s.bodyDY;
    const sway = (y) => (s.anim ? Math.round(Math.sin(t * 1.5 + y * 0.2) * s.swayAmp * Math.max(0, Math.min(1, (y - 32) / 22))) : 0);

    // 1. back hair (darker, behind everything)
    for (let y = 6; y < N; y++) for (let x = 0; x < N; x++) {
      const ly = y - hy, a = Math.abs(dxOf(x - sway(ly)));
      if (ly < 6 || a > domeHW(ly) || ly > backEnd(a)) continue;
      const i = rampIdx(x, ly, 34, 18), strand = Math.floor(a + 0.5) % 4 === 0;
      set(x, y, (strand ? BK_D : BK)[i]);
    }
    // 2. body + neck (breathing)
    for (let y = 36; y < N; y++) for (let x = 0; x < N; x++) {
      const ly = y - by, a = Math.abs(dxOf(x)), sh = shoulderHW(ly);
      if (ly >= 37 && ly <= 48 && a <= 3.5) set(x, y, ly - hy <= 40 ? K.f3 : a > 2.5 ? K.f3 : K.f2);
      if (sh < 0 || a > sh) continue;
      const vTop = 45 + (3.5 - Math.min(3.5, a)) * 1.4;              // V neckline
      if (a <= 3.5 && ly < vTop) continue;
      let c = ly <= 46 || (ly === 47 && a > 8) ? K.j0 : K.j1;
      if (a > sh - 1.2 && ly > 49) c = K.j2;
      if (Math.abs(a - 12) < 0.6 && ly > 52) c = K.j2;               // fold lines
      if (a <= 4.6 && Math.abs(ly - vTop) < 1.3) c = K.trim;          // pink collar trim
      if (a < 0.6 && ly > vTop + 1) c = (ly + Math.floor(t * 2)) % 6 === 0 ? K.hi : K.zip;  // zipper glint
      set(x, y, c);
    }
    set(25, 55 + by, K.zip); set(24, 55 + by, K.trim); set(25, 56 + by, K.trim); set(24, 56 + by, K.zip);   // pin badge
    // 3. face
    for (let y = 12; y <= 41; y++) for (let x = 0; x < N; x++) {
      const ly = y - hy, hw = faceHW(ly), a = Math.abs(dxOf(x));
      if (hw < 0 || a > hw) continue;
      let c = K.f1;
      if (a > hw - 1) c = K.f2;
      if (ly >= 37 && a > hw - 2) c = K.f2;
      set(x, y, c);
    }
    // 4. features (sprites, mirrored)
    const eyeName = s.eye, eye = EYE[eyeName] || EYE.open;
    const palSwap = s.mood === "alert" ? { P: "red", M: "dred", L: "lred" } : {};
    eye.forEach((row, r) => [...row].forEach((ch2, c) => {
      if (ch2 === ".") return;
      let key = palSwap[ch2] || EC[ch2];
      if (ch2 === "H" && s.twinkle) key = "hi";
      const col = K[key], y = 27 + r + hy + (ch2 !== "K" && s.lookY ? s.lookY : 0);
      set(23 + c, y, col); set(63 - (23 + c), y, col);
    }));
    if (eyeName === "open" || eyeName === "wide" || eyeName === "half") { set(22, 27 + hy, K.lash); set(41, 27 + hy, K.lash); set(21, 26 + hy, K.lash); set(42, 26 + hy, K.lash); }  // lash wings
    if (eyeName !== "happy") for (let c = 0; c < 5; c++) { set(23 + c, 26 + hy, K.shadow); set(63 - 23 - c, 26 + hy, K.shadow); }   // eyeshadow
    // brows
    const bl = s.brow;   // y offsets for outer..inner (4 px)
    for (let c = 0; c < 4; c++) { set(23 + c + 1, 24 + hy + bl[c], K.brow); set(63 - (24 + c), 24 + hy + bl[c], K.brow); }
    // blush (dithered)
    const blushRows = s.mood === "happy" || s.mood === "talking" ? 2 : 1;
    for (let r = 0; r < blushRows; r++) for (let c = 0; c < 4; c++) if ((c + r) % 2 === 0) { set(23 + c, 33 + r + hy, K.blush); set(63 - (23 + c), 33 + r + hy, K.blush); }
    set(31, 33 + hy, K.f2); set(32, 33 + hy, K.f2);                  // nose
    (MOUTH[s.mouth] || MOUTH.calm).forEach((row, r) => [...row].forEach((ch2, c) => { if (ch2 !== ".") set(30 + c, 36 + r + hy, K[MC[ch2]]); }));
    // 5. bangs (front, with angel-ring shine)
    for (let y = 4; y <= 30; y++) for (let x = 0; x < N; x++) {
      const ly = y - hy, a = Math.abs(dxOf(x));
      if (ly < 5 || a > domeHW(ly) - 0.4 || ly > bangBottom(a)) continue;
      const u = (a - 0.5 + 400) % 4;
      let c = FR[0];
      const ringY = 12 + Math.round((a / 16) * (a / 16) * 4);
      if (ly > ringY + 2 && (u < 0.6 || u > 3.4)) c = FR_D[0];        // clump separations below the shine
      if (ly < ringY && a > 9 && bay(x, ly) < (a - 9) / 8) c = FR_D[0];  // crown shading toward the sides
      if (ly >= bangBottom(a) - 1) c = FR_D[1];                       // tips shaded
      if (a > domeHW(ly) - 1.6) c = FR_D[0];                          // edge shade
      const ring = 12 + Math.round((a / 16) * (a / 16) * 4);
      if ((ly === ring || ly === ring + 1) && u > 0.8 && u < 3.2 && a < 14) c = HI;
      if (s.anim && ly === ring && Math.abs(a - ((t * 6) % 18)) < 1) c = hex("#ffffff");
      set(x, y, c);
    }
    // 6. front locks (over shoulders, swaying, purple tips + drips)
    for (let y = 18; y < N; y++) for (let x = 0; x < N; x++) {
      const ly = y - hy, sw = sway(ly), a = Math.abs(dxOf(x - Math.sign(dxOf(x)) * sw));
      if (ly < 20 || a < lockInner(ly) || a > lockOuter(ly) || ly > lockEnd(a)) continue;
      const i = rampIdx(x, ly, 42, 18), u = (a - 6 + 300) % 3;
      let c = (u < 0.7 ? FR_D : FR)[i];
      if (a < lockInner(ly) + 1) c = FR_D[i];                         // shadow against the face
      if (ly >= lockEnd(a) - 1) c = FR_D[Math.min(4, i + 1)];
      set(x, y, c);
    }
    // drips falling from a few tips
    if (s.anim) [9, 15, 12].forEach((a, i) => {
      const per = 3.2 + i, k = ((t + i * 1.3) % per) / per; if (k > 0.35) return;
      const yy = lockEnd(a) + 1 + Math.floor(k * 12) + hy, xx = Math.round(CX - 0.5 + (i % 2 ? a : -a));
      set(xx, yy, K.drip);
    });
  }
  function outline(ch) {
    const o = new Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (ch[y * N + x]) continue;
      if ((x > 0 && ch[y * N + x - 1]) || (x < N - 1 && ch[y * N + x + 1]) || (y > 0 && ch[(y - 1) * N + x]) || (y < N - 1 && ch[(y + 1) * N + x])) o[y * N + x] = 1;
    }
    for (let i = 0; i < N * N; i++) if (o[i]) ch[i] = K.out;
  }

  /* ───────── mood → pose ───────── */
  function pose(mood, now, st, ctx) {
    const s = { mood, anim: ctx.moving, headDY: 0, bodyDY: 0, swayAmp: 1, eye: "open", mouth: "calm", brow: [1, 0, 0, 0], twinkle: ctx.twinkle, lookY: 0 };
    const t = ctx.t, breath = ctx.moving ? (Math.sin(t * 1.7) > 0.3 ? 1 : 0) : 0;
    s.bodyDY = breath; s.headDY = breath;
    if (mood === "calm") { s.mouth = "calm"; }
    if (mood === "listening") { s.eye = "wide"; s.brow = [0, -1, -1, -1]; s.mouth = "o"; }
    if (mood === "thinking") { s.eye = "half"; s.brow = [1, 0, -1, -1]; s.mouth = "flat"; s.lookY = -1; }
    if (mood === "talking") { s.mouth = st.speaking ? ["talk0", "talk1", "talk2", "talk1"][Math.floor(now / 110) % 4] : "talk0"; s.brow = [0, -1, -1, 0]; if (ctx.moving && st.speaking) s.headDY += Math.floor(now / 330) % 2; }
    if (mood === "happy") { s.eye = "happy"; s.mouth = "happy"; s.brow = [0, -1, -1, 0]; s.swayAmp = 2; if (ctx.moving) s.headDY = -Math.round(Math.abs(Math.sin(t * 5))), s.bodyDY = s.headDY; }
    if (mood === "alert") { s.eye = "wide"; s.brow = [-1, -1, 0, 1]; s.mouth = "o"; if (ctx.moving && Math.floor(t * 8) % 7 === 0) s.headDY += 1; }
    if (mood === "sleeping") { s.eye = "sleep"; s.mouth = "sleep"; s.brow = [1, 1, 1, 1]; s.swayAmp = 0.5; if (ctx.moving) s.headDY = 1 + (Math.sin(t * 0.9) > 0 ? 1 : 0); s.bodyDY = s.headDY - 1; }
    if (ctx.blink && (s.eye === "open" || s.eye === "wide" || s.eye === "half")) s.eye = "closed";
    if (ctx.hop) s.headDY -= 1;
    return s;
  }
  function props(buf, mood, t, moving) {
    const P = (x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N) buf[y * N + x] = c; };
    const W = hex("#ffffff"), O = K.out;
    if (mood === "thinking") { const k = moving ? Math.floor(t * 3) % 4 : 3; for (let i = 0; i < k; i++) { P(48 + i * 3, 9, W); P(49 + i * 3, 9, W); P(48 + i * 3, 10, W); P(49 + i * 3, 10, W); } }
    if (mood === "sleeping") { const k = moving ? Math.floor(t * 1.2) % 3 : 2; [[45, 14], [50, 9], [55, 4]].forEach(([x, y], i) => { if (i > k) return; [[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]].forEach(([dx, dy]) => P(x + dx, y + dy, W)); }); }
    if (mood === "alert") {
      if (!moving || Math.floor(t * 3) % 2 === 0) { for (let y = 4; y <= 9; y++) { P(52, y, K.red); P(53, y, K.red); P(51, y, O); P(54, y, O); } P(52, 11, K.red); P(53, 11, K.red); }
      const sy = 24 + (moving ? Math.floor(t * 2) % 4 : 0); P(44, sy, K.sweat); P(44, sy + 1, K.sweat); P(45, sy + 1, K.sweat);
    }
    if (mood === "happy" && moving) [[10, 14], [53, 16], [8, 36], [56, 38]].forEach(([x, y], i) => { if (Math.floor(t * 4 + i) % 3 === 0) { P(x, y, W); P(x - 1, y, K.lpink); P(x + 1, y, K.lpink); P(x, y - 1, K.lpink); P(x, y + 1, K.lpink); } });
  }

  /* ───────── renderer ───────── */
  function mount(canvas, opts) {
    opts = opts || {};
    const crop = opts.crop || [0, 0, N, N];
    const off = document.createElement("canvas"); off.width = crop[2]; off.height = crop[3];
    const octx = off.getContext("2d"), img = octx.createImageData(crop[2], crop[3]), px = img.data;
    const ctx = canvas.getContext("2d");
    const bg = new Array(N * N), ch = new Array(N * N);
    let running = true, last = 0, blinkAt = performance.now() + 2000, blinkUntil = 0, fixedBg = null, hopT = 0, twinkleAt = 0, curMood = null;
    let pal = null, lastNow = 0;
    const t0 = performance.now();

    function size() {
      const box = canvas.parentNode.getBoundingClientRect();
      const want = Math.max(crop[2], Math.floor(Math.min(box.width || 300, opts.size || 9999)));
      const dpr = Math.min(3, G.devicePixelRatio || 1), hgt = Math.round(want * crop[3] / crop[2]);
      canvas.style.width = want + "px"; canvas.style.height = hgt + "px";
      canvas.width = Math.round(want * dpr); canvas.height = Math.round(hgt * dpr);
    }
    function draw(now) {
      const anim = opts.still ? "off" : (G.Helix && G.Helix.SET.anim) || "full", moving = anim !== "off";
      const st = (opts.getMood && opts.getMood()) || { mood: "calm" };
      const mood = PALRGB[st.mood] ? st.mood : "calm", t = moving ? (now - t0) / 1000 : 0;
      if (curMood && mood !== curMood) hopT = now;
      curMood = mood;
      if (moving && mood !== "sleeping" && now > blinkAt) { blinkUntil = now + 120; blinkAt = now + 2200 + Math.random() * 3800; }
      if (moving && now > twinkleAt + 1700) twinkleAt = now;
      // palette eases towards the target colours (smooth colour change with mood)
      const target = PALRGB[fixedBg || mood];
      const dt = Math.min(0.25, Math.max(0, (now - lastNow) / 1000)); lastNow = now;
      pal = !pal || !moving ? target : lerpPal(pal, target, Math.min(1, dt * 2.5));
      const s = pose(mood, now, st, { moving, t, blink: now < blinkUntil, twinkle: now - twinkleAt < 150, hop: now - hopT < 260 });
      s.speaking = !!st.speaking;
      drawBG(bg, pal, t, mood, s);
      ch.fill(undefined); drawChar(ch, s, t); outline(ch);
      for (let i = 0; i < N * N; i++) if (ch[i]) bg[i] = ch[i];
      props(bg, mood, t, moving);
      for (let j = 0; j < crop[3]; j++) for (let i = 0; i < crop[2]; i++) {
        const c = bg[(j + crop[1]) * N + i + crop[0]], k = (j * crop[2] + i) * 4;
        px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; px[k + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    }
    function frame(now) {
      if (!running) return;
      const anim = (G.Helix && G.Helix.SET.anim) || "full";
      if (now - last > 1000 / (anim === "full" ? 20 : 8)) { last = now; draw(now); }
      if (anim === "off") setTimeout(() => G.requestAnimationFrame(frame), 400); else G.requestAnimationFrame(frame);
    }
    if (opts.still) { const sc = opts.scale || 2; canvas.width = crop[2] * sc; canvas.height = crop[3] * sc; draw(performance.now()); return { destroy() {}, setBackground() {}, poke() {} }; }
    const ro = new ResizeObserver(() => { size(); draw(performance.now()); });
    ro.observe(canvas.parentNode);
    size(); G.requestAnimationFrame(frame);
    return {
      destroy() { running = false; ro.disconnect(); },
      setBackground(name) { fixedBg = name && PALRGB[name] ? name : null; },
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
    mount(c, { still: true, scale: 2, crop: [16, 8, 32, 32], getMood: () => ({ mood: mood || "calm" }) });
    return (faceCache[mood] = c.toDataURL());
  }
  G.HelixAvatar = { mount, moodOf, face, BACKGROUNDS: Object.keys(PAL) };
})(window);
