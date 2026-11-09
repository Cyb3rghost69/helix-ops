/* HELIX OPS — RAGNAR SHIELD. Real scan results only; missing values are NO TELEMETRY. */
(function (global) {
  const state = { data: null, sel: null, showMuted: false, busy: false, timer: null };
  const SEV = ["high", "med", "low", "info"];

  function api(p) {
    const OPS = (location.pathname === "/ops" || location.pathname.startsWith("/ops/")) ? "/ops" : "";
    return OPS + p;
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function $(id) { return document.getElementById(id); }
  function hhmm(t) {
    if (!t) return "—";
    const d = new Date(t * 1000);
    return d.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  function ago(t) {
    if (!t) return "never";
    const s = Math.max(0, Date.now() / 1000 - t);
    if (s < 90) return Math.round(s) + "s ago";
    if (s < 5400) return Math.round(s / 60) + "m ago";
    if (s < 172800) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }

  async function post(body) {
    const r = await fetch(api("/api/shield"), {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return r.json().catch(() => ({ ok: false }));
  }

  function fillScore(rep) {
    const box = document.querySelector(".sh-score");
    if (!rep) {
      $("sh-score").textContent = "--";
      $("sh-grade").textContent = "·";
      $("sh-sev").innerHTML = `<span class="sev-info">NO SCAN YET</span>`;
      return;
    }
    box.className = "sh-box sh-score g-" + String(rep.grade || "").toLowerCase();
    $("sh-score").textContent = String(rep.score).padStart(3, "0");
    $("sh-grade").textContent = rep.grade;
    $("sh-bar").querySelector("i").style.width = rep.score + "%";
    const c = rep.counts || {};
    $("sh-sev").innerHTML = `<span class="sev-high">HIGH ${c.high || 0}</span><span class="sev-med">MED ${c.med || 0}</span><span class="sev-low">LOW ${c.low || 0}</span>` +
      (rep.muted ? `<span class="sev-info">MUTED ${rep.muted}</span>` : "") +
      (rep.resolved ? `<span class="sev-low">RESOLVED ${rep.resolved}</span>` : "");
  }

  function fillCtl(d) {
    const st = d.state || {}, rep = d.report;
    const run = $("sh-run");
    const prog = $("sh-prog");
    run.disabled = !!st.scanning || state.busy;
    run.textContent = st.scanning ? "[ SCANNING… ]" : "[ RUN SCAN ]";
    prog.hidden = !st.scanning;
    if (st.scanning) {
      const pct = st.total ? Math.round((st.done / st.total) * 100) : 4;
      prog.querySelector("i").style.width = pct + "%";
    }
    const lines = [];
    if (st.scanning) {
      lines.push(`PHASE   ${st.phase}`, `HOSTS   ${st.done}/${st.total || "?"}`, `ELAPSED ${Math.round(Date.now() / 1000 - (st.started || Date.now() / 1000))}s`);
    } else if (rep) {
      lines.push(`LAST    ${hhmm(rep.finished)} · ${ago(rep.finished)}`, `TOOK    ${(rep.ms / 1000).toFixed(1)}s · ${rep.hosts.length} hosts · ${rep.ports_checked} ports`);
    } else lines.push("NO SCAN YET — RUN SCAN to baseline the LAN");
    lines.push(`NEXT    ${d.interval_h ? (d.next_scan ? hhmm(d.next_scan) : "scheduler warming") + ` · every ${d.interval_h}h` : "manual only"}`);
    lines.push(`SOURCE  ${d.remote ? "UNRAID " + d.remote : "LOCAL (Mac Mini)"}`);
    if (st.error) lines.push(`FAULT   ${st.error}`);
    if (d.remote_error) lines.push(`FAULT   ${d.remote_error}`);
    $("sh-ctl").textContent = lines.join("\n");
    $("sh-cap").innerHTML = `SCOPE ${esc((d.scope || []).join(", ") || "—")}<br>BASELINE ${d.baseline ? d.baseline.devices : 0} DEV · ${d.baseline ? d.baseline.muted : 0} MUTED`;
    $("sh-mods").innerHTML = (d.modules || []).map((m) => `<span class="${m.on ? "" : "off"}" title="${esc(m.label)}">${m.on ? "●" : "○"} ${esc(m.id)}</span>`).join("");
  }

  function drawHist(hist) {
    const cv = $("sh-hist");
    if (!cv) return;
    const w = cv.clientWidth || 300, h = cv.clientHeight || 72, dpr = global.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext("2d");
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "#142014"; g.lineWidth = 1;
    for (let y = 0; y <= 4; y++) { g.beginPath(); g.moveTo(0, Math.round((h - 1) * y / 4) + 0.5); g.lineTo(w, Math.round((h - 1) * y / 4) + 0.5); g.stroke(); }
    g.font = "9px ui-monospace, monospace";
    if (!hist || !hist.length) { g.fillStyle = "#7d8574"; g.fillText("NO TELEMETRY", 6, h / 2 + 3); return; }
    const n = hist.length, step = n > 1 ? (w - 8) / (n - 1) : 0;
    const px = (i) => 4 + i * step, py = (s) => 4 + (h - 8) * (1 - s / 100);
    hist.forEach((p, i) => {  // high-finding ticks along the floor
      if (p.high) { g.fillStyle = "#c44a3a"; g.fillRect(Math.round(px(i)) - 1, h - 3 - Math.min(12, p.high * 3), 3, Math.min(12, p.high * 3)); }
    });
    g.strokeStyle = "#7CFF7A"; g.lineWidth = 1.5; g.beginPath();
    hist.forEach((p, i) => { const x = px(i), y = py(p.score); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    hist.forEach((p, i) => { g.fillStyle = "#b8ffb0"; g.fillRect(Math.round(px(i)) - 1, Math.round(py(p.score)) - 1, 3, 3); });
    g.fillStyle = "#7d8574"; g.fillText("100", w - 20, 11); g.fillText(String(hist[n - 1].score), 6, 11);
  }

  function fillGrid(rep) {
    const grid = $("sh-grid");
    if (!rep) { grid.innerHTML = `<div class="empty">no telemetry_</div>`; $("sh-grid-sub").textContent = ""; return; }
    const hosts = rep.hosts.slice().sort((a, b) => (SEV.indexOf(a.worst) + 1 || 9) - (SEV.indexOf(b.worst) + 1 || 9) || (b.open.length - a.open.length));
    $("sh-grid-sub").textContent = `· ${hosts.length} hosts · ${hosts.reduce((n, h) => n + h.open.length, 0)} open ports` + (rep.skipped_out_of_scope ? ` · ${rep.skipped_out_of_scope} out of scope` : "");
    grid.innerHTML = hosts.map((h) => `<button type="button" class="sh-host w-${esc(h.worst)}${state.sel === h.ip ? " on" : ""}" data-sh="${esc(h.ip)}">
      <div class="ip">${esc(h.ip)} <span class="sev-${esc(h.worst)}">${h.worst === "high" || h.worst === "med" ? "▲" : "■"}</span></div>
      <div class="nm">${esc(h.name || h.owner || "unnamed")}</div>
      <div class="pt">${h.open.length ? h.open.map((p) => p.port).join(" ") : "NO OPEN PORTS"}</div></button>`).join("") || `<div class="empty">no hosts in scope_</div>`;
  }

  function fillDetail() {
    const box = $("sh-detail");
    const rep = state.data && state.data.report;
    const h = rep && rep.hosts.find((x) => x.ip === state.sel);
    if (!h) { box.hidden = true; return; }
    box.hidden = false;
    const rows = h.open.map((p) => {
      const t = p.tls;
      const tls = t ? `${esc(t.protocol)} · ${esc(t.cipher)} · ${t.bits}b · PFS ${t.pfs ? "YES" : "NO"}${t.legacy && t.legacy !== "UNTESTABLE" ? " · LEGACY " + esc(t.legacy) : ""}${t.cert ? ` · cert ${esc(t.cert.cn)}${t.cert.days_left != null ? " " + t.cert.days_left + "d" : ""}${t.cert.self_signed ? " self-signed" : ""}` : ""}` : "—";
      return `<tr><td>${p.port}</td><td>${esc(p.service)}</td><td>${tls}</td></tr>`;
    }).join("");
    const checks = h.checks.filter((c) => !c.check.startsWith("port-")).map((c) => `<tr><td class="sev-${c.sev}">${c.sev.toUpperCase()}</td><td>${esc(c.port)}</td><td>${esc(c.title)}<br><span class="sev-info">${esc(c.detail)}</span></td></tr>`).join("");
    box.innerHTML = `<div class="ident">${esc(h.name || h.ip)} · ${esc(h.ip)} · ${esc(h.owner)}${h.mac ? " · " + esc(h.mac) : ""}${h.vendor ? " · " + esc(h.vendor) : ""}</div>
      <table><thead><tr><th>PORT</th><th>SERVICE</th><th>TRANSCRYPT</th></tr></thead><tbody>${rows || `<tr><td colspan="3">no open ports in list</td></tr>`}</tbody></table>
      ${checks ? `<table style="margin-top:8px"><thead><tr><th>SEV</th><th>PORT</th><th>CHECK</th></tr></thead><tbody>${checks}</tbody></table>` : ""}`;
  }

  function fillFindings(rep) {
    const box = $("sh-find");
    if (!rep) { box.innerHTML = `<div class="empty">no telemetry_</div>`; return; }
    const list = rep.findings.filter((f) => state.showMuted || !f.muted);
    $("sh-find-sub").textContent = `· ${list.length}${state.showMuted ? " incl. muted" : ""}`;
    box.innerHTML = list.map((f) => `<div class="sh-f${f.muted ? " muted" : ""}">
      <span class="tag sev-${f.sev}">${f.sev.toUpperCase()}</span>
      <div><div class="t">${esc(f.title)}${f.new ? `<span class="new">NEW</span>` : ""}</div>
      <div class="d">${esc(f.host)}${f.ip && f.host !== f.ip ? " · " + esc(f.ip) : ""}${f.port ? ":" + esc(f.port) : ""} — ${esc(f.detail)}</div></div>
      <button type="button" data-mute="${esc(f.key)}" data-on="${f.muted ? 1 : 0}" title="${f.muted ? "unmute" : "accept risk and mute"}">${f.muted ? "UNMUTE" : "MUTE"}</button></div>`).join("") ||
      `<div class="empty">ALL CLEAR · 異常なし</div>`;
  }

  function fillUnifi(rep) {
    const box = $("sh-unifi");
    if (!rep) { box.innerHTML = `<div class="empty">no telemetry_</div>`; return; }
    const u = rep.unifi || {};
    const nd = rep.new_devices || [];
    let html = "";
    if (rep.baseline_seeded_now) html += `<div class="k">BASELINE SEEDED THIS SCAN — future new devices will be flagged</div>`;
    html += `<div class="k">NEW DEVICES · ${nd.length}</div>`;
    html += nd.map((d) => `<div class="row"><div>${esc(d.name || "unnamed")} <span class="sev-info">${esc(d.ip)} · ${esc(d.mac || "no mac")}${d.vendor ? " · " + esc(d.vendor) : ""}${d.wired === false && d.ssid ? " · " + esc(d.ssid) : ""}</span></div>
      <button type="button" data-ack="${esc(d.dev)}" data-name="${esc(d.name)}" data-ip="${esc(d.ip)}">ACK</button></div>`).join("") || `<div class="sev-info">none</div>`;
    html += `<div class="k">UNIFI GEAR · ${u.ok ? (u.devices || []).length : "OFFLINE"}</div>`;
    if (!u.ok) html += `<div class="sev-info">${esc(u.error || "NO TELEMETRY")}</div>`;
    html += (u.devices || []).map((d) => `<div class="row"><div>${esc(d.name)} <span class="sev-info">${esc(d.model)} · ${esc(d.firmware)}</span></div><span class="${d.updatable ? "sev-med" : "sev-low"}">${d.updatable ? "UPDATE" : String(d.state || "OK").toUpperCase()}</span></div>`).join("");
    html += `<div class="k">IPS / THREAT · 24H</div>`;
    if (!u.ips_available) html += `<div class="sev-info">NO TELEMETRY — this UniFi key can't read IPS events</div>`;
    else html += (u.ips || []).slice(0, 12).map((e) => `<div class="row"><div>${esc(e.sig)} <span class="sev-info">${esc(e.src)} → ${esc(e.dst)}</span></div><span class="sev-med">${esc(String(e.action || "").toUpperCase())}</span></div>`).join("") || `<div class="sev-low">no IPS events</div>`;
    if ((u.alarms || []).length) {
      html += `<div class="k">ALARMS</div>` + u.alarms.slice(0, 8).map((a) => `<div class="row"><div>${esc(a.msg || a.key)}</div><span class="sev-info">${hhmm(a.t)}</span></div>`).join("");
    }
    box.innerHTML = `<div class="sh-u">${html}</div>`;
  }

  function fillHome(d) {
    const el = $("ft-shield-body");
    if (!el) return;
    const r = d.report;
    el.innerHTML = r
      ? `<div class="ft-v">${r.score} ${esc(r.grade)}</div><div class="ft-k">HIGH ${r.counts.high} · MED ${r.counts.med} · ${esc(ago(r.finished))}</div>`
      : `<div class="ft-v">SHIELD</div><div class="ft-k">${d.state && d.state.scanning ? "SCANNING_" : "NO SCAN YET"}</div>`;
  }

  function render() {
    const d = state.data;
    if (!d) return;
    fillCtl(d);
    fillScore(d.report);
    drawHist(d.history);
    fillGrid(d.report);
    fillDetail();
    fillFindings(d.report);
    fillUnifi(d.report);
    fillHome(d);
  }

  async function load() {
    try {
      const r = await fetch(api("/api/shield"), { credentials: "same-origin" });
      if (!r.ok) throw new Error(r.status);
      state.data = await r.json();
      render();
      const scanning = state.data.state && state.data.state.scanning;
      clearTimeout(state.timer);
      state.timer = setTimeout(load, scanning ? 1500 : 15000);
    } catch (e) {
      $("sh-ctl") && ($("sh-ctl").textContent = "SHIELD API OFFLINE · NO TELEMETRY");
      clearTimeout(state.timer);
      state.timer = setTimeout(load, 20000);
    }
  }

  async function scan() {
    state.busy = true;
    $("sh-run").disabled = true;
    const r = await post({ action: "scan" });
    state.busy = false;
    if (!r.ok && r.error) $("sh-ctl").textContent = "SCAN REFUSED · " + r.error;
    setTimeout(load, 400);
  }

  function mount() {
    $("sh-run")?.addEventListener("click", scan);
    $("sh-showmuted")?.addEventListener("click", (e) => {
      state.showMuted = !state.showMuted;
      e.target.textContent = state.showMuted ? "[ HIDE MUTED ]" : "[ SHOW MUTED ]";
      e.target.classList.toggle("hot", state.showMuted);
      render();
    });
    $("sh-grid")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sh]");
      if (!b) return;
      state.sel = state.sel === b.dataset.sh ? null : b.dataset.sh;
      render();
    });
    $("sh-find")?.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-mute]");
      if (!b) return;
      b.disabled = true;
      await post({ action: b.dataset.on === "1" ? "unmute" : "mute", key: b.dataset.mute });
      const f = state.data.report.findings.find((x) => x.key === b.dataset.mute);
      if (f) f.muted = b.dataset.on !== "1";
      render();
    });
    $("sh-unifi")?.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-ack]");
      if (!b) return;
      b.disabled = true;
      b.textContent = "OK";
      await post({ action: "ack_device", dev: b.dataset.ack, name: b.dataset.name, ip: b.dataset.ip });
    });
    $("sh-close")?.addEventListener("click", () => document.querySelector('#tabs [data-tab="ops"]')?.click());
    $("ft-shield")?.addEventListener("click", () => document.querySelector('#tabs [data-tab="shield"]')?.click());
    global.addEventListener("resize", () => state.data && drawHist(state.data.history));
    load();
  }

  global.HelixShield = { mount, load, scan, state };
})(typeof window !== "undefined" ? window : globalThis);
