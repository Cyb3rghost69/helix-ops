/* global HelixMedic */
(function () {
  const p = () => (typeof OPS === "string" ? OPS : (location.pathname === "/ops" || location.pathname.startsWith("/ops/") ? "/ops" : ""));
  let data = {};
  function api(path, body) {
    const opt = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {};
    return fetch(p() + path, opt).then((r) => r.json());
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function load() {
    api("/api/medic").then((d) => { data = d || {}; draw(); }).catch(() => { data = { error: "MEDIC UNAVAILABLE" }; draw(); });
  }
  function draw() {
    const st = document.getElementById("hm-state");
    const grid = document.getElementById("hm-grid");
    const note = document.getElementById("hm-err");
    const compact = document.getElementById("hm-compact");
    const c = data.counts || {};
    if (st) st.textContent = "FLEET  " + (data.fleet || "SCAN") + "  ·  GUARD  " + (data.guard || "—");
    if (compact) {
      compact.textContent = data.compact
        ? ("HELIX MEDIC  BIGBOI  " + (c.healthy || 0) + "/" + (c.total || 0) + " HEALTHY  AUTO " + (data.auto_restart ? "ON" : "OFF") + "  MAC  0/0  INCIDENTS " + ((data.incidents || []).length) + "  STATUS NOMINAL")
        : "";
    }
    if (note) note.textContent = data.error || "";
    const rows = data.containers || [];
    const show = data.compact ? rows.filter((x) => x.phase && x.phase !== "HEALTHY").slice(0, 12) : rows.slice(0, 24);
    if (grid) {
      grid.innerHTML = (show.length ? show : rows.slice(0, 8)).map((r) =>
        `<article class="hm-card"><div class="ident">${esc(r.name)}</div><div>${esc(r.state)} · ${esc(r.phase)} · ${esc(r.mode)}</div><div class="dim">${esc(r.status || "")}</div></article>`
      ).join("") || "<div class=\"dim\">NO CONTAINERS</div>";
    }
  }
  function boot() {
    if (!document.getElementById("pane-medic")) return;
    load();
    setInterval(() => { if (!document.getElementById("pane-medic")?.hidden) load(); }, 15000);
    document.getElementById("hm-refresh")?.addEventListener("click", load);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  globalThis.HelixMedic = { load };
})();
