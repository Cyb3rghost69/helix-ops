/* HELIX graph engine — technical instruments. Real series only; never invent samples. */
(function (global) {
  const buffers = new Map();
  function theme() {
    return (global.HelixTheme && HelixTheme.get()) || {
      primary: "#7CFF7A", warning: "#E08A2A", secondary: "#6aa8a8",
      bg: "#050805", border: "#243024", persist: 0.3, text: "#e8e4d4"
    };
  }
  function buf(id, cap) {
    if (!buffers.has(id)) buffers.set(id, { cap: cap || 180, t: [], y: [] });
    const b = buffers.get(id);
    if (cap && b.cap !== cap) b.cap = cap;
    return b;
  }
  function push(id, value, ts) {
    if (value == null || Number.isNaN(Number(value))) return;
    const b = buf(id);
    b.t.push(ts == null ? Date.now() : ts);
    b.y.push(Number(value));
    while (b.y.length > b.cap) { b.t.shift(); b.y.shift(); }
  }
  function cssColor(c, a) {
    if (!c) return "rgba(124,255,122," + a + ")";
    if (c.startsWith("rgb")) return c;
    const h = c.replace("#", "");
    if (h.length !== 6) return c;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  const io = (typeof IntersectionObserver !== "undefined")
    ? new IntersectionObserver((ents) => { ents.forEach((e) => { e.target._hxOff = !e.isIntersecting; }); }, { threshold: 0.02 })
    : null;
  function fit(canvas) {
    if (io && !canvas._hxIo) { canvas._hxIo = 1; io.observe(canvas); }
    const dpr = Math.min(2, global.devicePixelRatio || 1);
    const w = canvas.clientWidth || 240;
    const h = canvas.clientHeight || 120;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }
  function clear(ctx, w, h, persist) {
    const th = theme();
    if (persist > 0.05 && (global.HelixTheme && HelixTheme.state.motion === "enhanced")) {
      ctx.fillStyle = cssColor(th.bg, 1 - persist * 0.65);
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = th.bg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.strokeStyle = th.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.strokeStyle = cssColor(th.border, 0.35);
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx.moveTo(1, y);
      ctx.lineTo(w - 1, y);
    }
    ctx.stroke();
  }
  function drawTrace(canvas, series, opts) {
    opts = opts || {};
    if (!canvas || canvas.closest && canvas.closest("[hidden]")) return;
    if (document.hidden) return;
    if (canvas._hxOff) return;
    const { ctx, w, h } = fit(canvas);
    const th = theme();
    clear(ctx, w, h, th.persist);
    const rows = (series || []).filter((s) => s && s.y && s.y.length);
    if (!rows.length) {
      ctx.fillStyle = th.text;
      ctx.globalAlpha = 0.45;
      ctx.font = "10px ui-monospace, Menlo, monospace";
      ctx.fillText("NO TELEMETRY", 8, h / 2);
      ctx.globalAlpha = 1;
      return;
    }
    let ymin = opts.min;
    let ymax = opts.max;
    if (ymin == null || ymax == null) {
      let mn = Infinity, mx = -Infinity;
      rows.forEach((s) => s.y.forEach((v) => { if (v < mn) mn = v; if (v > mx) mx = v; }));
      if (!isFinite(mn)) { mn = 0; mx = 1; }
      if (mn === mx) { mn -= 1; mx += 1; }
      if (ymin == null) ymin = mn;
      if (ymax == null) ymax = mx;
    }
    const pad = 6;
    const span = ymax - ymin || 1;
    const hist = !!(opts.recorded || (document.body && document.body.classList.contains("hx-hist")));
    rows.forEach((s) => {
      const col = s.color || th.primary;
      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.lineWidth = s.width || 1.2;
      const n = s.y.length;
      s.y.forEach((v, i) => {
        const x = pad + (i / Math.max(1, n - 1)) * (w - pad * 2);
        const y = h - pad - ((v - ymin) / span) * (h - pad * 2);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      const last = s.y[n - 1];
      const lx = pad + (w - pad * 2);
      const ly = h - pad - ((last - ymin) / span) * (h - pad * 2);
      ctx.fillStyle = cssColor(col, 0.5);
      ctx.beginPath();
      ctx.arc(lx, ly, 2.2, 0, Math.PI * 2);
      ctx.fill();
      if (opts.area) {
        ctx.lineTo(w - pad, h - pad);
        ctx.lineTo(pad, h - pad);
        ctx.closePath();
        ctx.fillStyle = cssColor(col, 0.12);
        ctx.fill();
      }
    });
    if (opts.label) {
      ctx.fillStyle = th.text;
      ctx.globalAlpha = 0.5;
      ctx.font = "9px ui-monospace, Menlo, monospace";
      ctx.fillText(String(opts.label), pad, 11);
      ctx.fillText(hist ? "RECORDED" : "LIVE", Math.max(pad, w - 52), 11);
      ctx.globalAlpha = 1;
    }
    if (opts.inspect != null && rows[0]) {
      const i = Math.max(0, Math.min(rows[0].y.length - 1, opts.inspect));
      const x = pad + (i / Math.max(1, rows[0].y.length - 1)) * (w - pad * 2);
      ctx.strokeStyle = th.warning;
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, h - pad);
      ctx.stroke();
    }
  }
  function drawScope(canvas, samples, color) {
    drawTrace(canvas, [{ y: samples || [], color: color }], { min: null, max: null });
  }
  function drawBars(canvas, cells) {
    if (!canvas || document.hidden) return;
    const { ctx, w, h } = fit(canvas);
    const th = theme();
    clear(ctx, w, h, 0);
    const n = (cells || []).length;
    if (!n) {
      ctx.fillStyle = th.text;
      ctx.globalAlpha = 0.45;
      ctx.font = "10px ui-monospace, Menlo, monospace";
      ctx.fillText("NO TELEMETRY", 8, h / 2);
      ctx.globalAlpha = 1;
      return;
    }
    const gap = 3;
    const bw = (w - 8 - gap * (n - 1)) / n;
    cells.forEach((c, i) => {
      const v = Math.max(0, Math.min(1, Number(c.v) || 0));
      const x = 4 + i * (bw + gap);
      const bh = v * (h - 16);
      ctx.fillStyle = c.color || th.primary;
      ctx.fillRect(x, h - 8 - bh, bw, bh);
    });
  }
  function drawHeat(canvas, rows, cols, values) {
    if (!canvas || document.hidden) return;
    const { ctx, w, h } = fit(canvas);
    const th = theme();
    clear(ctx, w, h, 0);
    if (!values || !values.length) {
      ctx.fillStyle = th.text;
      ctx.globalAlpha = 0.45;
      ctx.font = "10px ui-monospace, Menlo, monospace";
      ctx.fillText("NO TELEMETRY", 8, h / 2);
      ctx.globalAlpha = 1;
      return;
    }
    const cw = w / cols;
    const rh = h / rows;
    for (let i = 0; i < values.length; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const v = Math.max(0, Math.min(1, Number(values[i]) || 0));
      ctx.fillStyle = cssColor(th.primary, 0.08 + v * 0.7);
      ctx.fillRect(c * cw + 1, r * rh + 1, cw - 2, rh - 2);
    }
  }
  global.HelixGraph = { push, buf, drawTrace, drawScope, drawBars, drawHeat, theme, buffers };
})(window);
