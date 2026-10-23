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
      replayed: false, compact: !!opts.compact, stars: [], events: [],
    };
    const listeners = { select: null, mode: null, event: null };

    function size() {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(280, r.width || canvas.parentNode.clientWidth || 600);
      const portrait = w < 620;
      const h = opts.height || (S.compact ? Math.round(w * (portrait ? 0.95 : 0.5)) : Math.round(w * (portrait ? 1.18 : 0.56)));
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
    const RING = ["telegram", "prefect", "foreman", "canon", "scribe", "adze", "honcho", "unraid", "umbrel", "tools", "web", "user"];
    function layout() {
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
      S.packets.push({ e, a, b, t0: performance.now(), dur: Math.max(650, Math.min(1500, dist * 3.2)), col: a.acc, replay: q.replay });
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

      // move nodes toward their slots (smooth relayout)
      S.nodes.forEach((n) => { n.x += (n.tx - n.x) * 0.12; n.y += (n.ty - n.y) * 0.12; });

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

      // packets
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

      // particles
      S.parts = S.parts.filter((q) => { q.x += q.vx; q.y += q.vy; q.vy += 0.08; q.life -= 0.03; if (q.life <= 0) return false; ctx.globalAlpha = q.life; ctx.fillStyle = q.col; ctx.fillRect(PX(q.x), PX(q.y), 3, 3); ctx.globalAlpha = 1; return true; });

      // nodes
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

      // bubbles: newest "said" bubbles first (capped so they never pile up), then "thinking" for busy agents
      const life = S.compact ? 4 : 7, cap = S.compact ? 2 : (S.portrait ? 2 : 4);
      S.nodes.forEach((n) => { if (n.bubble && (now - n.bubble.t0) / 1000 > life) n.bubble = null; });
      const said = [...S.nodes.values()].filter((n) => n.bubble).sort((a, b) => b.bubble.t0 - a.bubble.t0).slice(0, cap);
      const think = S.compact ? [] : [...S.nodes.values()].filter((n) => !n.bubble && n.thinking).slice(0, Math.max(0, cap - said.length));
      said.concat(think).reverse().forEach((n) => {
        const half = 5 * scale() * (n.id === "helix" ? 1.45 : 1);
        if (n.bubble) drawBubble(n.x, n.y - half - 14, n.bubble.text, n.bubble.col, Math.min(1, life - (now - n.bubble.t0) / 1000), false);
        else drawBubble(n.x, n.y - half - 14, n.thinking, n.acc, 0.8, true);
      });

      if (anim !== "off" || S.packets.length || S.queue.length) G.requestAnimationFrame(frame);
      else setTimeout(() => G.requestAnimationFrame(frame), 1000);
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
