/* global HelixDiscord */
(function () {
  const p = () => (typeof OPS === "string" ? OPS : (location.pathname === "/ops" || location.pathname.startsWith("/ops/") ? "/ops" : ""));
  function set(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
  function load() {
    return fetch(p() + "/api/discord", { credentials: "same-origin", cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const gw = d.gateway || {};
        const a = d.auth || {};
        const e = d.errors || {};
        const r = d.routing || {};
        set("hxd-cap", d.ok ? "CONNECTED" : "DOWN");
        set("hxd-bot", d.bot || "—");
        set("hxd-gw", gw.state || "—");
        set("hxd-users", String(a.allowed_users ?? "—"));
        set("hxd-ch", String(a.allowed_channels ?? "—"));
        set("hxd-ai", (r.provider || "—") + " / " + (r.model || "—"));
        set("hxd-err", e.last || "—");
        set("hxd-re", String(e.reconnects_log ?? "—"));
        set("hxd-unauth", String(e.unauthorized_log ?? "—"));
        set("hxd-last", d.last_connected || "—");
        set("hxd-note", d.note || "");
      })
      .catch(() => set("hxd-cap", "UNAVAILABLE"));
  }
  function boot() {
    if (!document.getElementById("pane-discord")) return;
    load();
    setInterval(() => { if (!document.getElementById("pane-discord")?.hidden) load(); }, 15000);
    document.getElementById("hxd-refresh")?.addEventListener("click", load);
  }
  globalThis.HelixDiscord = { load };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
