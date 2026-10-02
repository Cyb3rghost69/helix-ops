/* HELIX OPS — REMOTE MATRIX. Real RustDesk snapshot only. */
(function (global) {
  const state = { data: null, sel: null, q: "", overlay: null, flights: [], lastSig: "" };

  function api(p) {
    const OPS = (location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "";
    return OPS + p;
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function groupId(id) {
    const d = String(id || "").replace(/\D/g, "");
    return d.replace(/(\d{3})(?=\d)/g, "$1 ").trim() || "NO TELEMETRY";
  }
  function led(on) {
    if (on === true) return "on";
    if (on === false) return "off";
    return "uk";
  }
  function stLabel(on) {
    if (on === true) return "ONLINE";
    if (on === false) return "OFFLINE";
    return "REGISTERED";
  }
  function bar(pct) {
    const n = Math.max(0, Math.min(100, Number(pct) || 0));
    return `<div class="rd-bar"><i style="width:${n}%"></i></div>`;
  }

  function fillHome(d) {
    const nOn = d.counts?.online ?? 0;
    const nOff = d.counts?.offline ?? 0;
    const n = d.counts?.devices ?? 0;
    const el = document.getElementById("ft-remote-body");
    if (el) {
      el.innerHTML = `<div class="ft-v">REMOTE MATRIX</div>
        <div class="ft-k">● ${String(nOn).padStart(2, "0")} ONLINE · ○ ${String(nOff).padStart(2, "0")} OFFLINE</div>
        <div class="ft-k">HBBS ${d.hbbs?.online ? "●" : "○"} · HBBR ${d.hbbr?.online ? "●" : "○"} · ${n} NODES</div>`;
    }
    const line = document.getElementById("hel-01-line");
    if (line && d.hel01) line.textContent = "HΞL-01: " + d.hel01;
  }

  function drawTopo(d) {
    const cv = document.getElementById("rd-cv");
    if (!cv) return;
    const w = cv.clientWidth || 320;
    const h = 180;
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#050805";
    ctx.fillRect(0, 0, w, h);
    const core = { x: w / 2, y: 36 };
    const nodes = d.devices || [];
    ctx.strokeStyle = "#3a4a30";
    ctx.lineWidth = 1;
    nodes.forEach((n, i) => {
      const x = ((i + 0.5) / Math.max(nodes.length, 1)) * (w - 24) + 12;
      const y = 130;
      ctx.beginPath();
      ctx.moveTo(core.x, core.y + 10);
      ctx.lineTo(x, y - 10);
      ctx.stroke();
      ctx.fillStyle = n.rustdesk_online === true ? "#6adf64" : (n.rustdesk_online === false ? "#5a3028" : "#d4a017");
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.fillStyle = "#9cba90";
      ctx.font = "9px ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText((n.name || n.id).slice(0, 10), x, y + 16);
    });
    ctx.fillStyle = "#efe6c9";
    ctx.fillRect(core.x - 7, core.y - 7, 14, 14);
    ctx.fillStyle = "#d4a017";
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText("RUSTDESK CORE", core.x, 16);
    ctx.fillText(d.hbbs?.online && d.hbbr?.online ? "HBBS/HBBR ●" : "DEGRADED", core.x, 58);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      state.flights = state.flights.filter((f) => f.u < 1);
      state.flights.forEach((f) => {
        f.u += 0.04;
        const x = core.x + (f.x - core.x) * Math.min(1, f.u);
        const y = core.y + (f.y - core.y) * Math.min(1, f.u);
        ctx.fillStyle = "#d4a017";
        ctx.fillRect(x - 2, y - 2, 4, 4);
      });
    }
  }

  function pulse(d, id) {
    const cv = document.getElementById("rd-cv");
    const w = cv?.clientWidth || 320;
    const nodes = d.devices || [];
    const i = nodes.findIndex((n) => n.id === id);
    if (i < 0) return;
    const x = ((i + 0.5) / Math.max(nodes.length, 1)) * (w - 24) + 12;
    state.flights.push({ x, y: 130, u: 0 });
  }

  function rowHtml(n) {
    const open = state.sel === n.id ? " open" : "";
    const hx = n.helix;
    const cpu = n.telemetry && n.telemetry.cpu_pct;
    const mem = n.telemetry && n.telemetry.mem_total_gb
      ? Math.round(100 * (n.telemetry.mem_used_gb || 0) / n.telemetry.mem_total_gb)
      : null;
    const plat = n.platform || "NO TELEMETRY";
    const hostLine = hx ? `HELIX ${esc(hx.name)} ● MATCH` : "HELIX — UNLINKED";
    const mapOpts = (state.data.helix_hosts || []).map((h) =>
      `<option value="${esc(h.id)}"${hx && hx.id === h.id ? " selected" : ""}>${esc(h.name)}</option>`
    ).join("");
    const tele = (cpu != null || mem != null)
      ? `CPU ${cpu == null ? "NO TELEMETRY" : Math.round(cpu) + "%"}${cpu != null ? bar(cpu) : ""}
         MEM ${mem == null ? "NO TELEMETRY" : mem + "%"}${mem != null ? bar(mem) : ""}`
      : `<div class="empty">NO TELEMETRY</div>`;
    return `<div class="rd-row${open}" data-rid="${esc(n.id)}">
      <i class="rd-led ${led(n.rustdesk_online)}"></i>
      <div>
        <div class="nm">${n.favorite ? "★ " : ""}${esc(n.name)}</div>
        <div class="meta">${esc(plat)} · ${stLabel(n.rustdesk_online)} · ${esc(hostLine)}</div>
        <div class="rd-id">RUSTDESK ${esc(groupId(n.id))}</div>
      </div>
      <div class="rd-acts">
        <button type="button" data-rd="launch">REMOTE</button>
        <button type="button" data-rd="copy">COPY ID</button>
        <button type="button" data-rd="fav">${n.favorite ? "UNPIN" : "PIN"}</button>
        <button type="button" data-rd="more">DETAILS</button>
      </div>
      <div class="rd-detail">
        <div class="rd-kv">
          <b>ID</b><span class="rd-id">${esc(groupId(n.id))}</span>
          <b>PLATFORM</b><span>${esc(plat)}</span>
          <b>IP</b><span>${esc(n.ip || "NO TELEMETRY")}</span>
          <b>SOURCE</b><span>${esc(n.source || "NO TELEMETRY")}</span>
          <b>HELIX</b><span>${hx ? esc(hx.name) + " / " + esc(hx.id) : "UNLINKED"}</span>
        </div>
        ${tele}
        <label class="ident">LINK TO HELIX HOST</label>
        <select data-rd="map">${mapOpts}<option value="">— none —</option></select>
      </div>
    </div>`;
  }

  function render(d) {
    const q = state.q.trim().toLowerCase();
    const list = (d.devices || []).filter((n) => {
      if (!q) return true;
      const blob = [n.name, n.id, n.hostname, n.platform, n.helix && n.helix.name, n.helix && n.helix.id].join(" ").toLowerCase();
      return blob.includes(q);
    });
    const core = document.getElementById("rd-core");
    if (core) {
      const up = d.uptime_s != null ? Math.floor(d.uptime_s / 3600) + "h " + Math.floor((d.uptime_s % 3600) / 60) + "m" : "NO TELEMETRY";
      core.innerHTML = `<div class="ident">RUSTDESK CORE · 遠隔接続サーバー</div>
        <div class="rd-leds">
          <span class="${d.hbbs?.online ? "" : "off"}">${d.hbbs?.online ? "●" : "○"} HBBS ${d.hbbs?.online ? "ONLINE" : "DOWN"} :${esc(d.hbbs?.port)}</span>
          <span class="${d.hbbr?.online ? "" : "off"}">${d.hbbr?.online ? "●" : "○"} HBBR ${d.hbbr?.online ? "ONLINE" : "DOWN"} :${esc(d.hbbr?.port)}</span>
        </div>
        <div class="rd-counts">
          <div><b>${esc(d.counts?.devices ?? 0)}</b><span>DEVICES</span></div>
          <div><b>${esc(d.counts?.online ?? 0)}</b><span>ONLINE</span></div>
          <div><b>${esc(d.counts?.offline ?? 0)}</b><span>OFFLINE</span></div>
          <div><b>—</b><span>SESSIONS</span></div>
        </div>
        <div class="meta">HOST ${esc(d.host)} · ${esc(d.edition).toUpperCase()} · UPTIME ${esc(up)} · ${esc(d.docker_status || d.docker_state || "")}</div>
        <div class="rd-svc">
          <span>${d.hbbs?.online ? "●" : "○"} RUSTDESK/HBBS</span>
          <span>${d.hbbr?.online ? "●" : "○"} RUSTDESK/HBBR</span>
          <span>API ${d.capabilities?.api_port_open ? "●" : "○ CLOSED (OSS)"}</span>
        </div>`;
    }
    const cap = document.getElementById("rd-cap");
    if (cap) {
      const c = d.capabilities || {};
      cap.textContent = `CAPS  HEALTH ${c.server_health ? "YES" : "NO"} · DIR YES · ONLINE ${c.online_status ? "YES" : "NO"} · SESSIONS NO · LAUNCH YES · TELEMETRY VIA HELIX · API NO`;
    }
    const box = document.getElementById("rd-list");
    if (box) box.innerHTML = list.map(rowHtml).join("") || `<div class="empty">NO RUSTDESK PEERS</div>`;
    const ev = document.getElementById("rd-events");
    if (ev) {
      ev.innerHTML = (d.events || []).map((e) => `<div>${esc(e.t)} ${esc(e.kind)}  ${esc(e.text)}</div>`).join("") || `<div class="empty">NO TELEMETRY</div>`;
    }
    fillHome(d);
    drawTopo(d);
  }

  function overlay(lines, ms) {
    let el = state.overlay;
    if (!el) {
      el = document.createElement("div");
      el.className = "rd-overlay";
      el.innerHTML = "<pre></pre>";
      document.body.appendChild(el);
      state.overlay = el;
    }
    el.hidden = false;
    el.querySelector("pre").textContent = lines.join("\n");
    if (ms) setTimeout(() => { el.hidden = true; }, ms);
  }

  async function launch(id) {
    if (!confirm("Launch RustDesk to " + groupId(id) + "?")) return;
    const d = state.data;
    pulse(d || { devices: [] }, id);
    overlay(["REMOTE REQUEST", "DEVICE LOOKUP", "RUSTDESK", "LINK REQUEST", "CLIENT LAUNCH"], 700);
    const url = "rustdesk://connection/new/" + id;
    try {
      await fetch(api("/api/remote"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "launch", id, confirm: true, execute: true }),
      });
    } catch (e) {}
    location.href = url;
  }

  async function post(body) {
    const r = await fetch(api("/api/remote"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  async function load() {
    try {
      const r = await fetch(api("/api/remote"), { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      state.data = d;
      render(d);
    } catch (e) {}
  }

  function cli(arg) {
    const out = document.getElementById("rd-cli");
    const d = state.data || { devices: [] };
    const q = (arg || "").trim();
    let lines = ["REMOTE MATRIX"];
    if (!q) {
      (d.devices || []).forEach((n, i) => {
        lines.push(String(i + 1).padStart(2, "0") + " " + (n.name || n.id) + "  " + stLabel(n.rustdesk_online));
      });
    } else if (q.toLowerCase().startsWith("search ")) {
      const s = q.slice(7).toLowerCase();
      (d.devices || []).filter((n) => JSON.stringify(n).toLowerCase().includes(s)).forEach((n) => {
        lines.push(n.name + "  " + groupId(n.id) + "  " + stLabel(n.rustdesk_online));
      });
    } else {
      const hit = (d.devices || []).find((n) =>
        (n.name || "").toLowerCase() === q.toLowerCase() || n.id === q.replace(/\s/g, "") || (n.helix && n.helix.id === q.toLowerCase())
      );
      if (!hit) lines.push("NO MATCH");
      else {
        lines = [
          "REMOTE TARGET: " + hit.name,
          "STATUS: " + stLabel(hit.rustdesk_online),
          "RUSTDESK: " + groupId(hit.id),
          hit.helix ? "HELIX: " + hit.helix.name : "HELIX: UNLINKED",
        ];
        state.sel = hit.id;
        render(d);
      }
    }
    if (out) out.textContent = lines.join("\n");
    return lines.join("\n");
  }

  function mount() {
    document.getElementById("rd-list")?.addEventListener("click", async (e) => {
      const row = e.target.closest(".rd-row");
      if (!row) return;
      const id = row.dataset.rid;
      const act = e.target.closest("[data-rd]")?.dataset.rd;
      if (act === "copy") {
        try { await navigator.clipboard.writeText(id); } catch (err) {}
        return;
      }
      if (act === "launch") { launch(id); return; }
      if (act === "fav") {
        const on = !(state.data.devices || []).find((n) => n.id === id)?.favorite;
        await post({ action: "favorite", id, on });
        load();
        return;
      }
      if (act === "more" || !act) {
        state.sel = state.sel === id ? null : id;
        render(state.data);
      }
    });
    document.getElementById("rd-list")?.addEventListener("change", async (e) => {
      const sel = e.target.closest("select[data-rd=map]");
      if (!sel) return;
      const row = e.target.closest(".rd-row");
      await post({ action: "map", id: row.dataset.rid, helix_id: sel.value });
      load();
    });
    document.getElementById("rd-q")?.addEventListener("input", (e) => {
      state.q = e.target.value || "";
      if (state.data) render(state.data);
    });
    document.getElementById("ft-remote")?.addEventListener("click", () => {
      document.querySelector('#tabs [data-tab="remote"]')?.click();
    });
    document.getElementById("remote-close")?.addEventListener("click", () => {
      document.querySelector('#tabs [data-tab="ops"]')?.click();
    });
    load();
    setInterval(() => {
      if (document.hidden) return;
      load();
    }, 8000);
  }

  global.HelixRemote = { mount, load, cli, state };
})(typeof window !== "undefined" ? window : globalThis);
