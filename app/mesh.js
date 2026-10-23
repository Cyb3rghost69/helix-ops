/* HELIX/OPS — BOTMESH ARENA
   Animated pixel canvas: agents as mascots on an arena, links glow with traffic, and every real
   message (bot↔bot from /api/talk, Helix requests/tool calls/replies from /api/trace) flies as a
   pixel packet from sender to receiver, then pops a speech bubble. On load it replays recent real
   traffic (labelled REPLAY), then switches to LIVE. Idle animation only reflects real status. */
(function (G) {
  "use strict";
  const H = () => G.Helix;
  const TWO_PI = Math.PI * 2;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const PX = (v) => Math.round(v);

  /* ── turn store data into mesh events ── */
  function toolTarget(name) {
    const n = String(name || "").toLowerCase();
    for (const b of ["prefect", "foreman", "canon", "scribe", "adze"]) if (n.includes(b)) return b;
    if (n === "delegate_task") return "prefect";
    if (/web|browser|search|fetch|extract/.test(n)) return "web";
    if (/docker|unraid|array|container/.test(n)) return "unraid";
    if (/honcho|memory|recall|remember/.test(n)) return "honcho";
    if (/umbrel/.test(n)) return "umbrel";
    if (/telegram|send_message/.test(n)) return "telegram";
    return "tools";
  }
  function clockToEpoch(hms) {
    const m = String(hms || "").match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const d = new Date(); d.setHours(+m[1], +m[2], +m[3], 0);
    let t = d.getTime() / 1000; if (t > Date.now() / 1000 + 120) t -= 86400;
    return t;
  }
  function collectEvents() {
    const M = H().store.mesh;
    if (M && !M.unsupported && M.seq >= 0) {
      return M.events.map((e) => ({ key: "m|" + e.id, from: e.from, to: e.to, text: e.text || "", kind: e.kind || "talk", t: e.t || 0, title: e.title || "", agent: e.agent }));
    }
    return collectLegacy();
  }
  function collectLegacy() {
    const { talkItems, D } = H();
    const ev = [];
    talkItems().forEach((m) => {
      if (!m.from || !m.to) return;
      ev.push({ key: "t|" + m.sid + "|" + m.t + "|" + m.from, from: m.from, to: m.to, text: m.text || "", kind: "talk", t: m.t || 0, title: m.title || "" });
    });
    const tr = D("trace") || {};
    const src = /telegram/i.test(tr.source || "") ? "telegram" : "user";
    (tr.timeline || []).forEach((e) => {
      const t = clockToEpoch(e.t) || 0, base = "x|" + (tr.session_id || "") + "|" + e.id + "|" + e.kind;
      const det = e.detail || {};
      if (e.kind === "REQUEST") ev.push({ key: base, from: src, to: "helix", text: e.summary || "request", kind: "request", t });
      else if (e.kind === "TOOL") { const tool = det.tool || (e.summary || "").split(" ")[0]; ev.push({ key: base, from: "helix", to: toolTarget(tool), text: "▸ " + (tool || "tool"), kind: "tool", t }); }
      else if (e.kind === "RESULT") { const tool = det.tool || String(e.summary || "").split(" //")[0]; ev.push({ key: base, from: toolTarget(tool), to: "helix", text: e.summary || "result", kind: "result", t }); }
      else if (e.kind === "DELEGATE") ev.push({ key: base, from: "helix", to: toolTarget(e.summary || det.to || ""), text: e.summary || "delegate", kind: "delegate", t });
      else if (e.kind === "RESPONSE") ev.push({ key: base, from: "helix", to: src, text: e.summary || "reply", kind: "reply", t });
    });
    ev.sort((a, b) => a.t - b.t);
    return ev;
  }

  /* ── engine ── */
  function Mesh(canvas, opts) {
    opts = opts || {};
    const ctx = canvas.getContext("2d");
    const S = {
      W: 0, H: 0, dpr: 1, nodes: new Map(), links: new Map(), packets: [], parts: [], queue: [],
      seen: new Set(), mode: "boot", lastEvent: 0, sel: null, hover: null, t0: performance.now(), running: true,
      replayed: false, compact: !!opts.compact, stars: [], events: [], view: opts.view || "arena",
    };
    const WALKERS = new Set(["helix", "prefect", "foreman", "canon", "scribe", "adze", "worker"]);
    const listeners = { select: null, mode: null, event: null };

    function size() {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(280, r.width || canvas.parentNode.clientWidth || 600);
      const portrait = w < 620;
      const floor = S.view === "floor";
      const h = opts.height || (S.compact ? Math.round(w * (portrait ? 0.95 : 0.5)) : Math.round(w * (portrait ? (floor ? 1.42 : 1.18) : (floor ? 0.6 : 0.56))));
      S.dpr = Math.min(2, G.devicePixelRatio || 1);
      S.W = w; S.H = h; S.portrait = portrait;
      canvas.style.height = h + "px";
      canvas.width = Math.round(w * S.dpr); canvas.height = Math.round(h * S.dpr);
      ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); ctx.imageSmoothingEnabled = false;
      S.stars = Array.from({ length: Math.round(w * h / 9000) }, (_, i) => ({ x: (i * 97.3) % w, y: (i * 53.7 + (i * i) % 31) % h, p: i % 7 }));
      layout();
    }

    /* ring layout: Helix centre; channels left, workers below, services right, web/tools top */
    // evenly spaced ring, clockwise from the top: channels → workers → services → web/tools
    const RING = ["telegram", "prefect", "foreman", "canon", "scribe", "adze", "worker", "honcho", "unraid", "umbrel", "tools", "web", "user"];
    /* FLOOR: the office from the reference — desks for agents, stations for channels/services */
    const FLOOR_L = { helix: [0.79, 0.42], prefect: [0.25, 0.42], foreman: [0.43, 0.42], canon: [0.61, 0.42], scribe: [0.25, 0.7], adze: [0.43, 0.7], worker: [0.79, 0.72],
      telegram: [0.07, 0.44], user: [0.07, 0.8], web: [0.2, 0.12], tools: [0.61, 0.74], honcho: [0.34, 0.92], unraid: [0.94, 0.6], umbrel: [0.94, 0.86] };
    const FLOOR_P = { helix: [0.66, 0.22], telegram: [0.14, 0.22], prefect: [0.3, 0.4], foreman: [0.68, 0.4], canon: [0.3, 0.56], scribe: [0.68, 0.56], adze: [0.3, 0.72], worker: [0.68, 0.72],
      web: [0.14, 0.07], user: [0.1, 0.9], honcho: [0.36, 0.9], tools: [0.62, 0.9], unraid: [0.9, 0.9], umbrel: [0.92, 0.6] };
    function floorLayout() {
      const P = S.portrait ? FLOOR_P : FLOOR_L;
      let extra = 0;
      S.nodes.forEach((n) => {
        let f = P[n.id];
        if (!f) { f = [0.5 + (extra % 3) * 0.08, 0.92]; extra++; }
        n.tx = f[0] * S.W; n.ty = f[1] * S.H;
        if (n.x == null || !n.trip) { if (n.x == null) { n.x = n.tx; n.y = n.ty; } }
      });
    }
    function layout() {
      if (S.view === "floor") { floorLayout(); return; }
      const top = S.compact ? 18 : 40, cx = S.W / 2, cy = top + (S.H - top) / 2 + 6;
      const rx = S.W * (S.portrait ? 0.37 : 0.4), ry = (S.H - top) * (S.portrait ? 0.39 : 0.37);
      const ring = [...S.nodes.keys()].filter((id) => id !== "helix").sort((a, b) => (RING.indexOf(a) + 1 || 99) - (RING.indexOf(b) + 1 || 99));
      S.nodes.forEach((n) => {
        if (n.id === "helix") { n.tx = cx; n.ty = cy; }
        else {
          const i = ring.indexOf(n.id), a = -Math.PI / 2 + (i + 0.5) * TWO_PI / ring.length;
          n.tx = cx + Math.cos(a) * rx; n.ty = cy + Math.sin(a) * ry;
        }
        if (n.x == null) { n.x = n.tx; n.y = n.ty; }
      });
    }
    function scale() { return S.compact ? (S.portrait ? 2.6 : 3) : (S.portrait ? 3 : Math.max(3.4, Math.min(5, S.W / 240))); }

    function node(id) {
      let n = S.nodes.get(id);
      if (!n) {
        const m = H().meta(id);
        n = { id, acc: m.acc, name: m.name, on: false, status: "dark", bubble: null, flash: 0, pulse: [], recv: 0, sent: 0, thinking: "", phase: Math.random() * TWO_PI };
        S.nodes.set(id, n); layout();
      }
      return n;
    }
    function link(a, b) {
      const k = a < b ? a + "|" + b : b + "|" + a;
      let l = S.links.get(k);
      if (!l) { l = { k, a, b, count: 0, heat: 0, live: false, last: 0, dir: {} }; S.links.set(k, l); }
      return l;
    }

    /* data in */
    function setAgents(list, edges) {
      list.forEach((a) => {
        const n = node(a.id);
        n.on = a.online; n.status = a.status; n.thinking = a.status === "busy" ? (a.doing || a.thinking || "") : ""; n.label = a.label;
      });
      ["web", "tools"].forEach((v) => { const n = node(v); n.on = true; n.status = "idle"; n.virtual = true; });
      (edges || []).forEach((e) => { if (e.from && e.to) { node(e.from); node(e.to); const l = link(e.from, e.to); l.live = !!e.live; l.label = l.label || e.label; } });
    }
    function ingest(events) {
      const fresh = events.filter((e) => !S.seen.has(e.key));
      fresh.forEach((e) => S.seen.add(e.key));
      if (!fresh.length) { if (!S.replayed && S.mode === "boot" && events.length === 0) setMode("wait"); return; }
      fresh.forEach((e) => { node(e.from); node(e.to); const l = link(e.from, e.to); l.count++; l.last = Math.max(l.last, e.t || 0); l.dir[e.from] = (l.dir[e.from] || 0) + 1; S.events.push(e); });
      if (S.events.length > 400) S.events.splice(0, S.events.length - 400);
      if (!S.replayed) {
        S.replayed = true;
        const recent = fresh.slice(-(S.compact ? 12 : 24));
        if (recent.length) { setMode("replay"); recent.forEach((e, i) => S.queue.push({ e, at: performance.now() + 500 + i * (S.compact ? 520 : 650), replay: true })); }
        else setMode("wait");
      } else {
        fresh.forEach((e, i) => S.queue.push({ e, at: performance.now() + i * 380, replay: false }));
      }
    }
    function replay(n) {
      const recent = S.events.slice(-(n || 24));
      S.queue = recent.map((e, i) => ({ e, at: performance.now() + 300 + i * 600, replay: true }));
      if (recent.length) setMode("replay");
    }
    function setMode(m) { if (S.mode === m) return; S.mode = m; if (listeners.mode) listeners.mode(m); }

    function launch(q) {
      const e = q.e, a = S.nodes.get(e.from), b = S.nodes.get(e.to);
      if (!a || !b) return;
      const l = link(e.from, e.to); l.heat = Math.min(1, l.heat + 0.55);
      a.flash = 1; a.sent++;
      const dist = Math.hypot(b.tx - a.tx, b.ty - a.ty);
      if (S.view === "floor" && WALKERS.has(a.id) && a !== b && !a.trip) {
        // walk over to the receiver's desk/station, say it, walk back
        const ang = Math.atan2(a.ty - b.ty, a.tx - b.tx), stop = 5 * scale() * 2.4;
        const dx = b.tx + Math.cos(ang) * stop, dy = b.ty + Math.sin(ang) * stop;
        const d = Math.hypot(dx - a.x, dy - a.y), dur = Math.max(500, Math.min(2200, d / 0.16));
        a.trip = { e, b, phase: "go", t0: performance.now(), dur, sx: a.x, sy: a.y, dx, dy, col: a.acc, replay: q.replay };
      } else S.packets.push({ e, a, b, t0: performance.now(), dur: Math.max(650, Math.min(1500, dist * 3.2)), col: a.acc, replay: q.replay });
      S.lastEvent = performance.now();
      if (!q.replay) setMode("live");
      H().bleep(e.kind === "reply" ? 990 : e.kind === "tool" ? 660 : 770, 0.035);
      if (listeners.event) listeners.event(e, q.replay);
    }
    function arrive(p) {
      const b = p.b; b.flash = 1; b.recv++; b.pulse.push({ t0: performance.now(), col: p.col });
      const txt = String(p.e.text || "").replace(/\s+/g, " ").trim();
      if (txt) p.a.bubble = { text: txt, t0: performance.now(), col: p.a.acc, to: p.b.name };
      for (let i = 0; i < 10; i++) S.parts.push({ x: b.x, y: b.y, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3 - 1, life: 1, col: p.col });
    }

    /* draw */
    function frame(now) {
      if (!S.running) return;
      const anim = H().SET.anim;
      const W = S.W, Hh = S.H, sc = scale(), t = (now - S.t0) / 1000;
      while (S.queue.length && S.queue[0].at <= now) launch(S.queue.shift());
      if (S.mode === "replay" && !S.queue.length && !S.packets.some((p) => p.replay)) setMode(S.lastEvent && now - S.lastEvent < 20000 ? "live" : "wait");
      if (S.mode === "live" && now - S.lastEvent > 25000) setMode("wait");

      // move nodes: walkers follow their trip on the floor, everyone else eases to their slot
      S.nodes.forEach((n) => {
        const tr = n.trip;
        if (tr && S.view === "floor") {
          const k = Math.min(1, (now - tr.t0) / tr.dur), e2 = ease(k);
          if (tr.phase === "go") { n.x = tr.sx + (tr.dx - tr.sx) * e2; n.y = tr.sy + (tr.dy - tr.sy) * e2; n.walking = true; if (k >= 1) { arrive({ a: n, b: tr.b, e: tr.e, col: tr.col }); tr.phase = "talk"; tr.t0 = now; tr.dur = 1300; } }
          else if (tr.phase === "talk") { n.walking = false; if (k >= 1) { tr.phase = "back"; tr.t0 = now; tr.sx = n.x; tr.sy = n.y; tr.dur = Math.max(500, Math.min(2200, Math.hypot(n.tx - n.x, n.ty - n.y) / 0.16)); } }
          else { n.x = tr.sx + (n.tx - tr.sx) * e2; n.y = tr.sy + (n.ty - tr.sy) * e2; n.walking = true; if (k >= 1) { n.trip = null; n.walking = false; } }
        } else { if (tr) n.trip = null; n.walking = false; n.x += (n.tx - n.x) * 0.12; n.y += (n.ty - n.y) * 0.12; }
      });
      if (S.view === "floor") { drawRoom(t, anim); drawFloorNodes(now, t, anim, sc); drawPackets(now); drawParts(); drawBubbles(now); return loop(anim); }

      // background
      ctx.fillStyle = "#0d0a13"; ctx.fillRect(0, 0, W, Hh);
      ctx.fillStyle = "rgba(255,79,163,0.06)";
      const g = 16, off = anim === "full" ? (t * 6) % g : 0;
      for (let x = -g + off; x < W; x += g) ctx.fillRect(PX(x), 0, 1, Hh);
      for (let y = -g + off; y < Hh; y += g) ctx.fillRect(0, PX(y), W, 1);
      S.stars.forEach((s) => { const tw = anim === "off" ? 0.5 : (Math.sin(t * 2 + s.p) + 1) / 2; ctx.fillStyle = `rgba(255,255,255,${0.08 + tw * 0.25})`; ctx.fillRect(PX(s.x), PX(s.y), 2, 2); });
      // floor glow under helix
      const hx = S.nodes.get("helix");
      if (hx) { const gr = ctx.createRadialGradient(hx.x, hx.y, 4, hx.x, hx.y, Math.min(W, Hh) * 0.42); gr.addColorStop(0, "rgba(255,79,163,0.16)"); gr.addColorStop(1, "rgba(255,79,163,0)"); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, Hh); }

      // links
      S.links.forEach((l) => {
        const a = S.nodes.get(l.a), b = S.nodes.get(l.b); if (!a || !b) return;
        l.heat = Math.max(0, l.heat - 0.004);
        const active = l.heat > 0.02, sel = S.sel && (l.a === S.sel || l.b === S.sel);
        const w = 1 + Math.min(4, Math.log2(1 + l.count));
        const col = active ? mix(a.acc, b.acc) : (sel ? "#ffffff" : (l.live || l.count ? "#3a3350" : "#231f2d"));
        const dash = l.live || l.count ? 6 : 3;
        drawPixelLine(a.x, a.y, b.x, b.y, w, col, active ? 0.35 + l.heat * 0.65 : (sel ? 0.8 : 0.55), dash, anim === "off" ? 0 : (active ? t * 40 : t * 8), !l.live && !l.count);
      });

      drawPackets(now); drawParts();
      drawArenaNodes(now, t, anim, sc);
      drawBubbles(now);
      return loop(anim);
    }

    function loop(anim) {
      if (anim !== "off" || S.packets.length || S.queue.length || [...S.nodes.values()].some((n) => n.trip)) G.requestAnimationFrame(frame);
      else setTimeout(() => G.requestAnimationFrame(frame), 1000);
    }
    function drawPackets(now) {
      S.packets = S.packets.filter((p) => {
        const k = (now - p.t0) / p.dur;
        if (k >= 1) { arrive(p); return false; }
        const e2 = ease(Math.max(0, k));
        const x = p.a.x + (p.b.x - p.a.x) * e2, y = p.a.y + (p.b.y - p.a.y) * e2 - Math.sin(e2 * Math.PI) * 18;
        for (let i = 6; i > 0; i--) {
          const kk = Math.max(0, e2 - i * 0.025), tx = p.a.x + (p.b.x - p.a.x) * kk, ty = p.a.y + (p.b.y - p.a.y) * kk - Math.sin(kk * Math.PI) * 18;
          ctx.globalAlpha = 0.08 * (7 - i); ctx.fillStyle = p.col; ctx.fillRect(PX(tx - 3), PX(ty - 3), 6, 6);
        }
        ctx.globalAlpha = 1;
        const s = S.portrait ? 3 : 4;
        // pixel envelope
        ctx.fillStyle = "#0b0910"; ctx.fillRect(PX(x - 3.5 * s), PX(y - 2.5 * s), 7 * s, 5 * s);
        ctx.fillStyle = p.col; ctx.fillRect(PX(x - 3 * s), PX(y - 2 * s), 6 * s, 4 * s);
        ctx.fillStyle = "#ffffff"; ctx.fillRect(PX(x - 2 * s), PX(y - 1 * s), s, s); ctx.fillRect(PX(x - s), PX(y), s, s); ctx.fillRect(PX(x), PX(y), s, s); ctx.fillRect(PX(x + s), PX(y - s), s, s);
        return true;
      });
    }
    function drawParts() {
      S.parts = S.parts.filter((q) => { q.x += q.vx; q.y += q.vy; q.vy += 0.08; q.life -= 0.03; if (q.life <= 0) return false; ctx.globalAlpha = q.life; ctx.fillStyle = q.col; ctx.fillRect(PX(q.x), PX(q.y), 3, 3); ctx.globalAlpha = 1; return true; });
    }
    function drawArenaNodes(now, t, anim, sc) {
      const font = S.portrait ? 8 : 10;
      S.nodes.forEach((n) => {
        const big = n.id === "helix" ? 1.45 : 1;
        const s = sc * big, half = 5 * s;
        const bob = anim === "full" && n.on ? Math.round(Math.sin(t * 3 + n.phase) * 1.5) : 0;
        const x = n.x, y = n.y + bob;
        // heartbeat ping while waiting (only for online nodes — reflects real status)
        if (S.mode === "wait" && n.on && !n.virtual && anim !== "off") {
          const ph = ((t + n.phase) % 4) / 4;
          if (ph < 0.5) { ctx.strokeStyle = n.acc; ctx.globalAlpha = (0.5 - ph) * 0.8; ctx.lineWidth = 2; pixelRing(x, n.y, half + 6 + ph * 40); ctx.globalAlpha = 1; }
        }
        n.pulse = n.pulse.filter((p) => { const k = (now - p.t0) / 900; if (k >= 1) return false; ctx.strokeStyle = p.col; ctx.globalAlpha = 1 - k; ctx.lineWidth = 3; pixelRing(x, n.y, half + 4 + k * 34); ctx.globalAlpha = 1; return true; });
        // pad
        ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(PX(x - half - 4), PX(n.y + half + 2), PX(2 * half + 8), 4);
        const padCol = n.on ? n.acc : "#3a3346";
        ctx.fillStyle = "#15121c"; ctx.fillRect(PX(x - half - 6), PX(y - half - 6), PX(2 * half + 12), PX(2 * half + 12));
        ctx.strokeStyle = padCol; ctx.lineWidth = 2; ctx.globalAlpha = n.on ? 0.9 : 0.5; ctx.strokeRect(PX(x - half - 6) + 1, PX(y - half - 6) + 1, PX(2 * half + 12) - 2, PX(2 * half + 12) - 2); ctx.globalAlpha = 1;
        if (n.flash > 0) { ctx.fillStyle = n.acc; ctx.globalAlpha = n.flash * 0.35; ctx.fillRect(PX(x - half - 6), PX(y - half - 6), PX(2 * half + 12), PX(2 * half + 12)); ctx.globalAlpha = 1; n.flash = Math.max(0, n.flash - 0.05); }
        if (S.sel === n.id || S.hover === n.id) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.strokeRect(PX(x - half - 10), PX(y - half - 10), PX(2 * half + 20), PX(2 * half + 20)); }
        H().drawSprite(ctx, n.id, n.on, x - half, y - half, s);
        // status lamp
        const lc = !n.on ? "#ff4d6d" : n.status === "busy" ? "#f59e0b" : "#39e58c";
        const blinkOn = n.status !== "busy" || anim === "off" || Math.floor(t * 2) % 2 === 0;
        if (blinkOn) { ctx.fillStyle = lc; ctx.fillRect(PX(x + half + 1), PX(y - half - 4), 6, 6); }
        // name plate
        ctx.font = `${font}px Silkscreen, "Press Start 2P", monospace`; ctx.textAlign = "center"; ctx.textBaseline = "top";
        const label = n.name, tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = "rgba(11,9,16,0.85)"; ctx.fillRect(PX(x - tw / 2), PX(n.y + half + 9), PX(tw), font + 6);
        ctx.fillStyle = n.on ? n.acc : "#8b8698"; ctx.fillText(label, PX(x), PX(n.y + half + 12));
        if (n.sent + n.recv && !S.compact) {
          const c = String(n.sent + n.recv); ctx.font = `${font - 1}px Silkscreen, monospace`;
          const cw = ctx.measureText(c).width + 8; ctx.fillStyle = n.acc; ctx.fillRect(PX(x - half - 8), PX(y - half - 10), PX(cw), font + 4);
          ctx.fillStyle = "#0b0910"; ctx.textAlign = "left"; ctx.fillText(c, PX(x - half - 4), PX(y - half - 8));
        }
      });
    }

    /* ── FLOOR view drawing ── */
    function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(PX(x), PX(y), PX(w), PX(h)); }
    function drawRoom(t, anim) {
      const W = S.W, Hh = S.H, wall = Hh * (S.portrait ? 0.13 : 0.24);
      // floor tiles
      px(0, 0, W, Hh, "#100d16");
      const tile = S.portrait ? 20 : 26;
      for (let y = wall; y < Hh; y += tile) for (let x = ((y / tile) % 2) * tile; x < W; x += tile * 2) px(x, y, tile, tile, "#13101a");
      // wall + baseboard
      px(0, 0, W, wall, "#18131f"); px(0, wall - 4, W, 4, "#ff4fa3"); px(0, wall, W, 3, "#0b0910");
      for (let x = 0; x < W; x += 48) px(x, 0, 2, wall - 4, "#1d1726");
      // big wall screen: real fleet CPU history
      const sw = Math.min(W * 0.34, 380), sh = wall * 0.7, sx = W * 0.5 - sw / 2 + (S.portrait ? W * 0.1 : 0), sy = wall * 0.12;
      px(sx - 3, sy - 3, sw + 6, sh + 6, "#3a3346"); px(sx, sy, sw, sh, "#0a0910");
      const hist = (H().store.hist || []).slice(-60), mx = Math.max(10, ...hist.map((h) => h.used || 0));
      if (hist.length > 1) {
        ctx.strokeStyle = "#39e58c"; ctx.lineWidth = 2; ctx.beginPath();
        hist.forEach((h, i) => { const x = sx + 6 + i * (sw - 12) / (hist.length - 1), y = sy + sh - 6 - (h.used || 0) / mx * (sh - 18); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
      }
      const last = hist[hist.length - 1];
      ctx.font = `${S.portrait ? 8 : 10}px Silkscreen, monospace`; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = "#ffffff";
      ctx.fillText("FLEET CPU " + (last && last.used != null ? Math.round(last.used) + "%" : "—"), PX(sx + 6), PX(sy + 4));
      // clock + poster
      if (!S.portrait) {
        const cx = W * 0.86, cw = 90;
        px(cx - 3, wall * 0.18 - 3, cw + 6, wall * 0.5 + 6, "#3a3346"); px(cx, wall * 0.18, cw, wall * 0.5, "#0a0910");
        ctx.font = `${Math.round(wall * 0.3)}px VT323, monospace`; ctx.fillStyle = "#39e58c"; ctx.textAlign = "center";
        ctx.fillText(H().jst(), PX(cx + cw / 2), PX(wall * 0.2));
        px(W * 0.04, wall * 0.15, 70, wall * 0.62, "#1f1a28"); ctx.fillStyle = "#ff4fa3"; ctx.font = "bold 18px Silkscreen, monospace"; ctx.fillText("H/", PX(W * 0.04 + 35), PX(wall * 0.25));
        ctx.font = "7px Silkscreen, monospace"; ctx.fillStyle = "#a7a1b6"; ctx.fillText("TKY-06", PX(W * 0.04 + 35), PX(wall * 0.52));
      }
      // plants + couch
      const plant = (x, y) => { px(x - 7, y, 14, 12, "#2a2533"); px(x - 1, y - 18, 3, 18, "#1f6b3a"); px(x - 9, y - 12, 8, 3, "#2f8f4e"); px(x + 2, y - 15, 9, 3, "#2f8f4e"); px(x - 8, y - 6, 9, 3, "#27a35a"); px(x + 2, y - 8, 8, 3, "#27a35a"); };
      if (!S.portrait) { plant(W * 0.14, wall + 30); plant(W * 0.7, wall + 30); plant(W * 0.52, Hh - 20); px(W * 0.12 - 40, Hh - 34, 90, 22, "#1f1b28"); px(W * 0.12 - 40, Hh - 40, 90, 8, "#2a2533"); }
      else { plant(W * 0.86, wall + 24); plant(W * 0.06, Hh * 0.62); }
      // stations + desks
      S.nodes.forEach((n) => {
        const x = n.tx, y = n.ty, s = scale();
        if (WALKERS.has(n.id)) {
          const big = n.id === "helix" ? 1.4 : 1, dw = 22 * s * big / 1.6 + 30, mon = n.on ? (n.status === "busy" ? n.acc : "#1f6b3a") : "#241f2e";
          // monitor + desk behind the seat
          px(x - 15 * big, y - 5 * s - 34 * big, 30 * big, 20 * big, "#3a3346"); px(x - 13 * big, y - 5 * s - 32 * big, 26 * big, 16 * big, "#0a0910");
          if (n.on) { for (let i = 0; i < 5; i++) { const h = 3 + ((Math.floor(t * 3) + i * 7 + n.phase * 10) % 9) * (n.status === "busy" ? 1 : 0.4); px(x - 11 * big + i * 5 * big, y - 5 * s - 18 * big - h * big, 3 * big, h * big, mon); } }
          px(x - 2, y - 5 * s - 14 * big, 4, 3, "#2a2533");
          px(x - dw / 2, y - 5 * s - 11 * big, dw, 10 * big, "#2a2533"); px(x - dw / 2, y - 5 * s - 1 * big, dw, 3, "#1c1824");
          px(x - dw / 2 + 3, y - 5 * s + 2, 3, 12, "#1c1824"); px(x + dw / 2 - 6, y - 5 * s + 2, 3, 12, "#1c1824");
          if (n.id === "helix" && !S.portrait) { ctx.font = "7px Silkscreen, monospace"; ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.fillText("HEAD OF THE FLOOR", PX(x), PX(y + 5 * s * big + 24)); }
        } else drawStation(n, x, y, s, t, anim);
      });
    }
    function drawStation(n, x, y, s, t, anim) {
      const on = n.on, a = n.acc, w = 12 * s, h = 12 * s;
      if (n.id === "telegram") { px(x - w / 2, y - h * 0.9, w, h * 1.5, "#1d2b3a"); px(x - w / 2 + 3, y - h * 0.9 + 3, w - 6, h * 1.5 - 6, "#0f1720"); px(x - w / 2, y - h * 0.9, w, 4, a); }
      else if (n.id === "user") { px(x - w / 2, y - h, w, h * 1.6, "#2a2533"); px(x - w / 2 + 4, y - h + 4, w - 8, h * 1.6 - 4, "#1a1622"); px(x + w / 2 - 10, y, 4, 4, "#facc15"); }
      else if (n.id === "web") { px(x - w * 0.7, y - h * 0.55, w * 1.4, h * 1.1, "#3a3346"); px(x - w * 0.7 + 3, y - h * 0.55 + 3, w * 1.4 - 6, h * 1.1 - 6, "#14203a"); for (let i = 0; i < 6; i++) px(x - w * 0.6 + i * w * 0.22, y + h * 0.15 - (i % 3) * 5, w * 0.12, (i % 3) * 5 + 6, "#1e2d4d"); }
      else if (n.id === "tools") { px(x - w, y - 6, w * 2, 8, "#5a3d23"); px(x - w + 4, y + 2, 4, 14, "#3e2a18"); px(x + w - 8, y + 2, 4, 14, "#3e2a18"); }
      else if (n.id === "honcho") { px(x - w * 0.6, y - h * 0.9, w * 1.2, h * 1.5, "#2a3320"); for (let i = 0; i < 3; i++) { px(x - w * 0.6 + 3, y - h * 0.9 + 4 + i * h * 0.48, w * 1.2 - 6, h * 0.4, "#3a4a2a"); px(x - 3, y - h * 0.9 + 8 + i * h * 0.48, 6, 3, a); } }
      else if (n.id === "unraid" || n.id === "umbrel") {
        px(x - w * 0.55, y - h * 1.2, w * 1.1, h * 2, "#16131d"); px(x - w * 0.55, y - h * 1.2, w * 1.1, 3, "#3a3346");
        for (let i = 0; i < 6; i++) { px(x - w * 0.45, y - h * 1.1 + i * h * 0.3, w * 0.9, h * 0.2, "#0a0910"); const blink = anim === "off" || Math.floor(t * 2 + i) % 3 !== 0; if (blink) px(x + w * 0.25, y - h * 1.05 + i * h * 0.3, 4, 3, on ? (i === 5 && n.id === "unraid" ? "#ff4d6d" : "#39e58c") : "#3a3346"); }
      }
      return a;
    }
    function drawFloorNodes(now, t, anim, sc) {
      const font = S.portrait ? 7 : 9;
      const list = [...S.nodes.values()].sort((a, b) => a.y - b.y);
      list.forEach((n) => {
        const walker = WALKERS.has(n.id), big = n.id === "helix" ? 1.4 : 1, s = (walker ? sc : sc * 0.75) * big, half = 5 * s;
        const step = n.walking && anim !== "off" ? (Math.floor(now / 140) % 2) * 3 : (anim === "full" && n.on && walker ? Math.round(Math.sin(t * 3 + n.phase) * 1.2) : 0);
        const x = n.x, y = (walker ? n.y : n.ty - half * 0.2) - step;
        n.pulse = n.pulse.filter((p) => { const k = (now - p.t0) / 900; if (k >= 1) return false; ctx.strokeStyle = p.col; ctx.globalAlpha = 1 - k; pixelRing(x, y, half + 4 + k * 30); ctx.globalAlpha = 1; return true; });
        if (S.mode === "wait" && walker && n.on && anim !== "off") { const ph = ((t + n.phase) % 4) / 4; if (ph < 0.4) { ctx.strokeStyle = n.acc; ctx.globalAlpha = (0.4 - ph); pixelRing(x, y, half + 6 + ph * 30); ctx.globalAlpha = 1; } }
        if (walker) { ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(PX(x - half * 0.9), PX(n.y + half - 1), PX(half * 1.8), 4); }
        if (S.sel === n.id || S.hover === n.id) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.strokeRect(PX(x - half - 5), PX(y - half - 5), PX(2 * half + 10), PX(2 * half + 10)); }
        if (n.flash > 0) { ctx.fillStyle = n.acc; ctx.globalAlpha = n.flash * 0.3; ctx.fillRect(PX(x - half - 3), PX(y - half - 3), PX(2 * half + 6), PX(2 * half + 6)); ctx.globalAlpha = 1; n.flash = Math.max(0, n.flash - 0.05); }
        H().drawSprite(ctx, n.id, n.on, x - half, y - half, s);
        const lc = !n.on ? "#ff4d6d" : n.status === "busy" ? "#f59e0b" : "#39e58c";
        if (walker && (n.status !== "busy" || anim === "off" || Math.floor(t * 2) % 2 === 0)) px(x + half, y - half - 3, 5, 5, lc);
        ctx.font = `${font}px Silkscreen, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "top";
        const tw = ctx.measureText(n.name).width + 8, ly = (walker ? n.y : n.ty) + half + (walker ? 6 : 10);
        ctx.fillStyle = "rgba(11,9,16,0.85)"; ctx.fillRect(PX(x - tw / 2), PX(ly), PX(tw), font + 5);
        ctx.fillStyle = n.on ? n.acc : "#8b8698"; ctx.fillText(n.name, PX(x), PX(ly + 2));
        if (!n.on && walker && !n.trip) { ctx.font = "10px VT323, monospace"; ctx.fillStyle = "#8b8698"; ctx.textAlign = "left"; ctx.fillText("z z", PX(x + half + 2), PX(y - half - 12)); }
      });
    }

    // bubbles: newest "said" bubbles first (capped so they never pile up), then "thinking" for busy agents
    function drawBubbles(now) {
      const life = S.compact ? 4 : 7, cap = S.compact ? 2 : (S.portrait ? 2 : 4);
      S.nodes.forEach((n) => { if (n.bubble && (now - n.bubble.t0) / 1000 > life) n.bubble = null; });
      const said = [...S.nodes.values()].filter((n) => n.bubble).sort((a, b) => b.bubble.t0 - a.bubble.t0).slice(0, cap);
      const think = S.compact ? [] : [...S.nodes.values()].filter((n) => !n.bubble && n.thinking).slice(0, Math.max(0, cap - said.length));
      said.concat(think).reverse().forEach((n) => {
        const half = 5 * scale() * (n.id === "helix" ? (S.view === "floor" ? 1.4 : 1.45) : 1);
        const by = S.view === "floor" && !WALKERS.has(n.id) ? n.ty - half * 1.6 : n.y - half - 14;
        if (n.bubble) drawBubble(n.x, by, n.bubble.text, n.bubble.col, Math.min(1, life - (now - n.bubble.t0) / 1000), false);
        else drawBubble(n.x, by, n.thinking, n.acc, 0.8, true);
      });
    }

    function drawPixelLine(x1, y1, x2, y2, w, col, alpha, dash, offset, dotted) {
      const len = Math.hypot(x2 - x1, y2 - y1), steps = Math.max(1, Math.floor(len / 3));
      ctx.fillStyle = col; ctx.globalAlpha = alpha;
      const sz = Math.max(2, Math.round(w));
      for (let i = 0; i <= steps; i++) {
        const d = i * 3 + (offset || 0);
        if (dotted ? (Math.floor(d / 3) % 3 !== 0) : (Math.floor(d / dash) % 2 === 1)) continue;
        const k = i / steps;
        ctx.fillRect(PX(x1 + (x2 - x1) * k - sz / 2), PX(y1 + (y2 - y1) * k - sz / 2), sz, sz);
      }
      ctx.globalAlpha = 1;
    }
    function pixelRing(x, y, r) {
      const n = Math.max(12, Math.floor(r * 0.9));
      for (let i = 0; i < n; i++) { const a = i / n * TWO_PI; ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(PX(x + Math.cos(a) * r), PX(y + Math.sin(a) * r), 2, 2); }
    }
    function drawBubble(x, y, text, col, alpha, thinking) {
      const font = S.portrait ? 10 : 11;
      ctx.font = `${font}px "IBM Plex Mono", ui-monospace, monospace`;
      const maxW = Math.min(S.portrait ? 140 : 200, S.W * 0.4);
      const words = String(text).split(" "); const lines = []; let cur = "";
      for (const wd of words) { const tst = cur ? cur + " " + wd : wd; if (ctx.measureText(tst).width > maxW && cur) { lines.push(cur); cur = wd; if (lines.length === 2) break; } else cur = tst; }
      if (lines.length < 2 && cur) lines.push(cur);
      if (lines.length === 2 && words.join(" ").length > lines.join(" ").length + 1) lines[1] = lines[1].replace(/.{0,2}$/, "…");
      const bw = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width))) + 14, bh = lines.length * (font + 3) + 10;
      let bx = x - bw / 2; bx = Math.max(6, Math.min(S.W - bw - 6, bx));
      const by = Math.max(S.compact ? 6 : 36, y - bh - 6);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#0b0910"; ctx.fillRect(PX(bx - 2), PX(by - 2), PX(bw + 4), PX(bh + 4));
      ctx.fillStyle = thinking ? "#15121c" : "#1d1826"; ctx.fillRect(PX(bx), PX(by), PX(bw), PX(bh));
      ctx.fillStyle = col;
      if (thinking) { for (let i = 0; i < bw; i += 6) { ctx.fillRect(PX(bx + i), PX(by), 3, 2); ctx.fillRect(PX(bx + i), PX(by + bh - 2), 3, 2); } }
      else { ctx.fillRect(PX(bx), PX(by), PX(bw), 2); ctx.fillRect(PX(bx), PX(by + bh - 2), PX(bw), 2); ctx.fillRect(PX(bx), PX(by), 2, PX(bh)); ctx.fillRect(PX(bx + bw - 2), PX(by), 2, PX(bh)); }
      const tx = PX(Math.max(bx + 8, Math.min(bx + bw - 12, x)));
      ctx.fillRect(tx, PX(by + bh), 6, 4); ctx.fillRect(tx + 2, PX(by + bh + 4), 2, 3);
      ctx.fillStyle = thinking ? "#c9c3d6" : "#ffffff"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      lines.forEach((l, i) => ctx.fillText((thinking && i === 0 ? "… " : "") + l, PX(bx + 7), PX(by + 6 + i * (font + 3))));
      ctx.globalAlpha = 1;
    }
    function mix(a, b) {
      const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      try { const x = p(a), y = p(b); return "#" + x.map((v, i) => Math.round((v + y[i]) / 2).toString(16).padStart(2, "0")).join(""); } catch (e) { return a; }
    }

    /* interaction */
    function hit(ev) {
      const r = canvas.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      let best = null, bd = 1e9;
      S.nodes.forEach((n) => { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } });
      return bd < 5 * scale() * 1.6 + 14 ? best : null;
    }
    canvas.addEventListener("click", (ev) => { const n = hit(ev); S.sel = n ? n.id : null; if (listeners.select) listeners.select(S.sel); });
    canvas.addEventListener("mousemove", (ev) => { const n = hit(ev); S.hover = n ? n.id : null; canvas.style.cursor = n ? "pointer" : "default"; });
    canvas.setAttribute("role", "img");

    const ro = new ResizeObserver(() => size()); ro.observe(canvas.parentNode);
    size(); G.requestAnimationFrame(frame);

    return {
      setAgents, ingest, replay,
      select(id) { S.sel = id; },
      setView(v) { if (S.view === v) return; S.view = v; S.nodes.forEach((n) => { n.trip = null; }); size(); },
      view() { return S.view; },
      on(k, f) { listeners[k] = f; },
      stats() {
        const now = Date.now() / 1000, hr = S.events.filter((e) => e.t && now - e.t < 3600);
        let busiest = null; S.links.forEach((l) => { if (l.count && (!busiest || l.count > busiest.count)) busiest = l; });
        return { total: S.events.length, hour: hr.length, links: [...S.links.values()].filter((l) => l.count).length, busiest, mode: S.mode, nodes: S.nodes };
      },
      links() { return [...S.links.values()].filter((l) => l.count).sort((a, b) => b.count - a.count); },
      events() { return S.events.slice(); },
      destroy() { S.running = false; ro.disconnect(); },
      label(id) { const n = S.nodes.get(id); return n ? n.name : id; },
    };
  }

  G.HelixMesh = { Mesh, collectEvents, toolTarget };
})(window);
