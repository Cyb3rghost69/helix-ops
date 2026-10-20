(function () {
  function p() {
    return (typeof OPS === "string") ? OPS : ((location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  async function load() {
    const r = await fetch(p() + "/api/ecc", { credentials: "same-origin", cache: "no-store" });
    const d = await r.json();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("hecc-ver", d.version || "—");
    set("hecc-skills", String(d.skills ?? "—"));
    set("hecc-agents", String(d.agents ?? "—"));
    set("hecc-cmd", String(d.commands ?? "—"));
    set("hecc-sec", d.security_pack ? "ON" : "OFF");
    set("hecc-cli", d.cli ? "ecc-universal" : "MISSING");
    set("hecc-note", d.note || "");
    const cap = document.getElementById("hecc-cap");
    if (cap) cap.textContent = d.ok ? "ONLINE" : "OFFLINE";
  }
  async function post(body) {
    const r = await fetch(p() + "/api/ecc", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json();
  }
  function bind() {
    document.getElementById("hecc-consult")?.addEventListener("click", async () => {
      const q = (document.getElementById("hecc-q")?.value || "").trim();
      const out = document.getElementById("hecc-out");
      if (out) out.textContent = "CONSULT…";
      const d = await post({ action: "consult", query: q });
      if (out) out.textContent = d.text || d.error || "—";
    });
    document.getElementById("hecc-chat")?.addEventListener("click", async () => {
      const q = (document.getElementById("hecc-q")?.value || "").trim();
      const out = document.getElementById("hecc-out");
      if (out) out.textContent = "ECC PROFILE…";
      const d = await post({ action: "chat", message: q });
      if (out) out.textContent = d.text || d.error || "—";
    });
    document.getElementById("hecc-refresh")?.addEventListener("click", load);
  }
  globalThis.HelixEcc = { load };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
