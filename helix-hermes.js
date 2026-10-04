/* HELIX/OPS — Hermes Agent chat. No API keys in this file. */
(function (global) {
  const SESSION = "helix-main";
  const log = [];

  function api(p) {
    const OPS = (typeof global.OPS === "string")
      ? global.OPS
      : ((location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "");
    return OPS + p;
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function paint() {
    const box = document.getElementById("thoughts");
    if (!box || !log.length) return;
    box.innerHTML = log.map((it) => {
      const k = it.role === "user" ? "k-user" : (it.ok === false ? "k-thought" : "k-assistant");
      const who = it.role === "user" ? "you" : "hermes";
      return `<div class="row ${k}"><span class="who">${who}&gt;</span>${esc(it.text)}</div>`;
    }).join("");
    box.scrollTop = box.scrollHeight;
    const fa = document.getElementById("ft-act");
    if (fa) {
      fa.innerHTML = log.slice(-8).reverse().map((it) => `<div>${esc(it.text)}</div>`).join("");
    }
    const vxu = document.getElementById("vx-user");
    const vxh = document.getElementById("vx-helix");
    const lastU = [...log].reverse().find((x) => x.role === "user");
    const lastA = [...log].reverse().find((x) => x.role === "assistant");
    if (vxu && lastU) vxu.textContent = lastU.text;
    if (vxh && lastA) vxh.textContent = lastA.text;
  }
  async function sendToHermes(message) {
    const text = String(message || "").trim();
    if (!text) return null;
    log.push({ role: "user", text });
    paint();
    let d = { success: false, error: "network", source: "hermes" };
    try {
      const r = await fetch(api("/api/hermes/chat"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: SESSION }),
      });
      d = await r.json().catch(() => d);
    } catch (e) {
      d = { success: false, error: "network", source: "hermes" };
    }
    const reply = d && d.success ? String(d.message || "") : (
      d && d.error === "timeout" ? "HERMES TIMEOUT"
        : d && d.error === "authentication" ? "HERMES AUTH FAILED"
          : d && d.error === "unavailable" ? "HERMES UNAVAILABLE"
            : (d && d.message) || "HERMES NO REPLY"
    );
    log.push({ role: "assistant", text: reply, ok: !!(d && d.success) });
    paint();
    if (d && d.success && global.HelixVoice && typeof global.HelixVoice.speak === "function") {
      global.HelixVoice.speak(reply);
    }
    return d;
  }
  async function tickStatus() {
    const box = document.getElementById("hermes-api-kv");
    if (!box) return;
    try {
      const r = await fetch(api("/api/hermes/status"), { cache: "no-store" });
      const d = r.ok ? await r.json() : {};
      const on = !!d.online;
      const lat = d.latency == null ? "—" : d.latency + " ms";
      const sess = d.session || SESSION;
      const noc = global.HelixNoc && HelixNoc.state && HelixNoc.state.hermes || {};
      const mx = global.HelixMatrix && HelixMatrix.state && HelixMatrix.state.data || {};
      const core = (mx.banks || []).find((b) => b.type === "CORE") || {};
      const mem = core.utilization == null ? "N/A" : core.utilization + "%";
      const ctx = (mx.context && mx.context.utilization != null) ? mx.context.utilization + "%" : "N/A";
      box.innerHTML =
        `<div>HERMES AGENT ${on ? "ONLINE" : "OFFLINE"}</div>` +
        `<div>MODEL ${esc(noc.model || "NO TELEMETRY")} / ${esc(noc.provider || "—")}</div>` +
        `<div>API LATENCY ${esc(lat)}</div>` +
        `<div>MEM ${esc(mem)} · CTX ${esc(ctx)}</div>` +
        `<div>ACTIVE SESSION ${esc(sess)}</div>`;
      const st = document.getElementById("hermes-api-flag");
      if (st) st.textContent = on ? "ONLINE" : "OFFLINE";
    } catch (e) {
      box.innerHTML = `<div>HERMES AGENT OFFLINE</div><div>API LATENCY —</div><div>ACTIVE SESSION ${SESSION}</div>`;
    }
  }
  function hasChat() {
    return log.length > 0;
  }
  function mount() {
    tickStatus();
    setInterval(tickStatus, 5000);
  }
  global.sendToHermes = sendToHermes;
  global.HelixHermes = { send: sendToHermes, mount, hasChat, session: SESSION };
})(window);
