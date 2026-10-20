/* global HelixCommunity */
(function () {
  const p = () => (typeof OPS === "string" ? OPS : (location.pathname === "/ops" || location.pathname.startsWith("/ops/") ? "/ops" : ""));
  function set(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v == null || v === "" ? "—" : String(v);
  }
  async function load() {
    const cap = document.getElementById("hxc-cap");
    if (cap) cap.textContent = "SCAN";
    try {
      const r = await fetch(p() + "/api/community", { cache: "no-store" });
      const d = await r.json();
      set("hxc-mxid", d.mxid);
      set("hxc-room", d.room);
      set("hxc-ai", (d.provider || "") + " / " + (d.model || ""));
      set("hxc-gw", d.gateway_live ? "LIVE" : "CONFIGURED_OFF");
      set("hxc-tools", (d.tools_matrix || []).join(",") || "—");
      set("hxc-priv", (d.tools_privileged_present || []).length ? (d.tools_privileged_present.join(",")) : "NONE");
      set("hxc-mention", d.mention_only ? "MENTION ONLY" : "OPEN");
      set("hxc-mem", d.isolation && d.isolation.honcho_memory ? "HONCHO" : "SESSION ONLY");
      set("hxc-note", d.note || "");
      if (cap) cap.textContent = d.ok ? "READY" : "FAULT";
    } catch (e) {
      set("hxc-note", "FETCH FAIL");
      if (cap) cap.textContent = "FAULT";
    }
  }
  globalThis.HelixCommunity = { load };
  document.addEventListener("DOMContentLoaded", () => {
    const b = document.getElementById("hxc-refresh");
    if (b) b.addEventListener("click", load);
  });
})();
