(function () {
  function p() {
    return (typeof OPS === "string") ? OPS : ((location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function row(item) {
    return `<div class="hx-appr-row">
      <span>${esc(item.source)} · ${esc(item.policy)} · ${esc(item.task)}</span>
      <button type="button" data-appr="${esc(item.id)}" data-allow="true">APPROVE</button>
      <button type="button" data-appr="${esc(item.id)}" data-allow="false">DENY</button>
    </div>`;
  }
  async function load() {
    const r = await fetch(p() + "/api/approvals", { credentials: "same-origin", cache: "no-store" });
    const d = await r.json();
    const n = d.count || 0;
    const body = document.getElementById("hx-attn-body");
    const nn = document.getElementById("hx-attn-n");
    if (nn) nn.textContent = String(n).padStart(2, "0");
    const box = document.getElementById("hx-appr-list");
    const items = d.items || [];
    if (box) box.innerHTML = items.map(row).join("") || `<div class="dim">NO WAITING APPROVALS</div><p class="dim">${esc(d.hermes_note || "")}</p>`;
    if (body) {
      body.innerHTML = items.length
        ? items.slice(0, 4).map(row).join("")
        : '<span class="empty">ATTN // 00 · NOMINAL</span>';
    }
  }
  async function decide(id, allow) {
    await fetch(p() + "/api/approvals", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, allow }),
    });
    load();
    if (globalThis.HelixCompute && HelixCompute.load) HelixCompute.load();
  }
  function bind() {
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-appr]");
      if (b) {
        decide(b.getAttribute("data-appr"), b.getAttribute("data-allow") === "true");
        return;
      }
      if (e.target.closest("#hx-appr-all")) {
        fetch(p() + "/api/approvals", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approve_all: true, allow: true }),
        }).then(load);
      }
      if (e.target.closest("#hx-appr-deny-all")) {
        fetch(p() + "/api/approvals", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approve_all: true, allow: false }),
        }).then(load);
      }
    });
    load();
    setInterval(load, 8000);
  }
  globalThis.HelixApprovals = { load };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
