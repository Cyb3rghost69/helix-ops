/* global HelixComms */
(function () {
  const p = () => (typeof OPS === "string" ? OPS : (location.pathname === "/ops" || location.pathname.startsWith("/ops/") ? "/ops" : ""));
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function set(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }
  function spark(hist) {
    const cv = document.getElementById("hxc-spark");
    if (!cv || !cv.getContext) return;
    const w = cv.width = cv.clientWidth || 320;
    const h = cv.height = 72;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#050805";
    ctx.fillRect(0, 0, w, h);
    const pts = (hist || []).map((r) => Number(r.pub_ms || r.lan_ms || 0)).filter((n) => n > 0);
    if (!pts.length) {
      ctx.fillStyle = "#3a5a3a";
      ctx.fillText("NO SAMPLES", 8, 40);
      return;
    }
    const max = Math.max.apply(null, pts.concat([1]));
    ctx.strokeStyle = "#7cff6b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((n, i) => {
      const x = (i / Math.max(pts.length - 1, 1)) * (w - 4) + 2;
      const y = h - 4 - (n / max) * (h - 10);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  function draw(d) {
    d = d || {};
    const hs = d.homeserver || {};
    const cf = d.cloudflare || {};
    const gw = d.gateway || {};
    const bot = d.bot || {};
    const fed = d.federation || {};
    const enc = d.encryption || {};
    const tr = d.traffic || {};
    set("hxc-cap", d.ok ? "NOMINAL" : "FAULT");
    set("hxc-hs", hs.status || "—");
    set("hxc-cf", cf.status || "—");
    set("hxc-gw", gw.status || "—");
    set("hxc-bot", bot.mxid || "—");
    set("hxc-e2ee", (enc.mode || "—").toUpperCase());
    set("hxc-fed", fed.closed ? "CLOSED" : "OPEN");
    set("hxc-sess", tr.matrix_sessions == null ? tr.session_quality || "—" : String(tr.matrix_sessions));
    set("hxc-note", gw.note || "");
    set("hxc-err", (d.errors || []).join(" · ") || "NO FAULTS");
    const topo = document.getElementById("hxc-topo");
    if (topo) {
      topo.innerHTML = (d.topology || []).map((n) =>
        `<div class="hxc-node ${n.ok ? "on" : "off"}">${esc(n.label)}<b>${n.ok ? "UP" : "DOWN"}</b></div>`
      ).join("") || "<div class=\"dim\">NO TOPOLOGY</div>";
    }
    spark(tr.hist);
  }
  function load() {
    return fetch(p() + "/api/comms", { credentials: "same-origin", cache: "no-store" })
      .then((r) => r.json())
      .then(draw)
      .catch(() => draw({ ok: false, errors: ["COMMS UNAVAILABLE"], topology: [] }));
  }
  function boot() {
    if (!document.getElementById("pane-comms")) return;
    load();
    setInterval(() => {
      if (!document.getElementById("pane-comms")?.hidden) load();
    }, 15000);
    document.getElementById("hxc-refresh")?.addEventListener("click", load);
  }
  globalThis.HelixComms = { load };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
