/* HELIX OPS — dual cognitive core display. No secrets. */
(function (global) {
  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function api(p) {
    const OPS = (typeof global.OPS === "string") ? global.OPS : ((location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "");
    return OPS + p;
  }
  const state = { online: false, last: {}, model: "", mode: "" };
  async function tick() {
    const box = document.getElementById("dual-core");
    if (!box) return;
    try {
      const r = await fetch(api("/api/adze"), { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      state.online = !!d.online;
      state.last = d.last || {};
      state.model = d.model || "";
      state.mode = d.mode || "";
      const hs = document.getElementById("dual-hermes-st");
      const as = document.getElementById("dual-adze-st");
      const mid = document.getElementById("dual-mid");
      const x = document.getElementById("dual-x");
      const hel = document.getElementById("hel-01-line");
      const online = !!d.online;
      const last = d.last || {};
      if (hs) hs.textContent = "GROK · LEAD";
      if (as) as.textContent = online ? ((d.model || "OPENAI") + " · " + (last.state || d.mode || "READY").toUpperCase()) : "OPENAI PROVIDER UNAVAILABLE";
      if (mid) {
        const st = last.state || (online ? "STANDBY" : "ADZE // OFFLINE");
        mid.textContent = "DELIBERATION\n" + st;
      }
      if (x) {
        const ev = d.events || [];
        x.innerHTML = ev.length
          ? ev.map((e) => `<div>${esc(e.t || "")}  ${esc(e.kind || "")}  ${esc(e.state || e.summary || "")}</div>`).join("")
          : `<div class="empty">no exchange_</div>`;
      }
      if (hel && last.state) {
        const map = {
          "ADZE REVIEWING": "ADZE is reviewing Hermes’ proposal.",
          "CONSENSUS REACHED": "Consensus reached.",
          "CONSENSUS NOT REACHED": "Unresolved objection detected.",
          "ADZE // OFFLINE": "Secondary cognition offline.",
        };
        const line = map[last.state] || (last.kind === "start" ? "Secondary cognition online." : "");
        if (line) hel.textContent = "HΞL-01: " + line;
      }
    } catch (e) {}
  }
  function mount() {
    tick();
    setInterval(tick, 2500);
  }
  global.HelixAdze = { mount, state };
})(window);
