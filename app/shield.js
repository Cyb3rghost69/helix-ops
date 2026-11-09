/* HELIX/OPS — SHIELD page: RAGNAR SHIELD LAN exposure audit.
   Real scan results only (local scanner or the Unraid helix-shield container). Missing data is NO TELEMETRY. */
(function (G) {
  "use strict";
  const X = G.Helix;
  const { esc, $, $$ } = X;
  const SEV = ["high", "med", "low", "info"];
  const SEVCOL = { high: "var(--red)", med: "var(--orange)", low: "var(--green)", info: "var(--mute)", clean: "var(--green)" };
  const GRADECOL = { A: "var(--green)", B: "var(--lime)", C: "var(--orange)", D: "var(--red)", F: "var(--red)" };
  const ago = (t) => { if (!t) return "never"; const s = Math.max(0, Date.now() / 1000 - t); return s < 90 ? Math.round(s) + "s ago" : s < 5400 ? Math.round(s / 60) + "m ago" : s < 172800 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago"; };
  const when = (t) => t ? new Date(t * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  const SH_ICON = "M11 2h2v1h3v1h3v8h-1v3h-2v2h-2v2h-2v2h-2v-2H9v-2H7v-2H5v-3H4V4h3V3h4z";
  const shieldSVG = (col, size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true"><path d="${SH_ICON}" fill="${col}"/><path d="M8 8h8v4h-1v2h-2v2h-2v-2H9v-2H8z" fill="#0b0910" opacity=".55"/></svg>`;

  async function post(body) {
    const r = await fetch(X.api("/api/shield"), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 401) { location.href = X.api("/login"); return {}; }
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (!r.ok && !d.error) d.error = r.status === 403 ? "read-only account" : "HTTP " + r.status;
    return d;
  }

  function shieldPage(el) {
    el.classList.add("sh-page");
    let snap = null, timer = null, dead = false, showMuted = false;

    el.innerHTML = `
      <div class="pagehd"><div><div class="crumbs"><a href="#/">FLOOR</a> › SHIELD</div><h1>SHI<span>ELD</span></h1>
        <p>Ragnar-derived LAN exposure audit — open ports, passwordless services, weak TLS, cleartext logins and new devices. Read-only probes, your LAN only.</p></div>
        <div class="row sh-acts"><button class="btn sm" id="sh-muted">SHOW MUTED</button><button class="btn sm pri" id="sh-run">▶ RUN SCAN</button></div></div>
      <div class="grid">
        <section class="pn c4 sh-scorecard"><div class="hd"><h2><span class="dot"></span>DEFENSE SCORE</h2><small id="sh-when">—</small></div>
          <div class="bd"><div class="sh-scoreline"><span class="sh-shield" id="sh-ico"></span><div class="num" id="sh-num">--<small>/100</small></div><span class="sh-grade" id="sh-grade">·</span></div>
          <div class="pixbar" id="sh-pix"></div><div class="row sh-sev" id="sh-sev"></div></div></section>
        <section class="pn c4"><div class="hd"><h2><span class="dot"></span>SCANNER</h2><small id="sh-src">—</small></div>
          <div class="bd stack"><div class="sh-kv" id="sh-kv"></div><div class="bar" id="sh-prog" hidden><i style="width:0"></i></div></div></section>
        <section class="pn c4"><div class="hd"><h2><span class="dot"></span>HISTORY</h2><small id="sh-hsub">score per scan</small></div>
          <div class="bd"><canvas class="sh-hist" id="sh-hist" aria-label="score history"></canvas><div class="sh-mods" id="sh-mods"></div></div></section>
        <section class="pn c12"><div class="hd"><h2><span class="dot"></span>HOST GRID</h2><small id="sh-gsub">tap a host for ports + checks</small></div>
          <div class="bd"><div id="sh-grid"><div class="loader"><div class="blocks"><i></i><i></i><i></i><i></i></div>LOADING_</div></div></div></section>
        <section class="pn c7"><div class="hd"><h2><span class="dot"></span>FINDINGS</h2><small id="sh-fsub"></small></div><div class="sh-find" id="sh-find"></div></section>
        <section class="pn c5"><div class="hd"><h2><span class="dot"></span>UNIFI INTEL</h2><small>new devices · gear · IPS</small></div><div class="bd" id="sh-unifi"></div></section>
      </div>
      <p class="sh-foot muted">Checks ported from <a href="https://github.com/imperador/ragnar" target="_blank" rel="noopener">Ragnar</a> (netServ · transCrypt · webI). No floods, injection, fuzzing or password guessing — see docs/SHIELD.md.</p>`;

    async function load() {
      try {
        snap = await X.fetchJSON("/api/shield", 15000);
        if (!dead) render();
      } catch (e) {
        if (!snap) $("#sh-grid", el).innerHTML = `<div class="empty">SHIELD API UNREACHABLE — ${esc(e.message)}</div>`;
      }
      clearTimeout(timer);
      if (!dead) timer = setTimeout(load, snap && snap.state && snap.state.scanning ? 1500 : 15000);
    }

    function render() {
      const r = snap.report, st = snap.state || {};
      // score card
      const g = r ? r.grade : null, col = g ? GRADECOL[g] : "var(--mute)";
      $("#sh-ico", el).innerHTML = shieldSVG(col, 40);
      $("#sh-num", el).innerHTML = `${r ? r.score : "--"}<small>/100</small>`;
      $("#sh-num", el).style.color = r ? col : "";
      const gr = $("#sh-grade", el); gr.textContent = g || "·"; gr.style.color = col; gr.style.borderColor = col;
      const on = r ? Math.round(r.score / 5) : 0;
      $("#sh-pix", el).innerHTML = Array.from({ length: 20 }, (_, i) => `<i class="${i < on ? "on" : ""}" style="${i < on ? `background:${col}` : ""}"></i>`).join("");
      const c = (r && r.counts) || {};
      $("#sh-sev", el).innerHTML = r ? `<span class="tag high">HIGH ${c.high || 0}</span><span class="tag med">MED ${c.med || 0}</span><span class="tag ok">LOW ${c.low || 0}</span>${r.muted ? `<span class="tag">MUTED ${r.muted}</span>` : ""}${r.resolved ? `<span class="tag ok">FIXED ${r.resolved}</span>` : ""}` : `<span class="tag">NO SCAN YET</span>`;
      $("#sh-when", el).textContent = r ? ago(r.finished) : "no scan yet";
      // scanner
      const run = $("#sh-run", el);
      run.disabled = !!st.scanning; run.textContent = st.scanning ? "SCANNING…" : "▶ RUN SCAN";
      const prog = $("#sh-prog", el); prog.hidden = !st.scanning;
      if (st.scanning) $("i", prog).style.width = (st.total ? Math.round(st.done / st.total * 100) : 5) + "%";
      $("#sh-src", el).textContent = snap.remote ? "UNRAID · " + snap.remote : "LOCAL · MAC MINI";
      const kv = [];
      if (st.scanning) kv.push(["PHASE", st.phase], ["HOSTS", `${st.done}/${st.total || "?"}`]);
      else if (r) kv.push(["LAST", `${when(r.finished)} · ${(r.ms / 1000).toFixed(1)}s`], ["COVERED", `${r.hosts.length} hosts · ${r.ports_checked} ports`]);
      kv.push(["NEXT", snap.interval_h ? `${snap.next_scan ? when(snap.next_scan) : "scheduler warming"} · every ${snap.interval_h}h` : "manual only"]);
      kv.push(["SCOPE", (snap.scope || []).join(", ") || "—"], ["BASELINE", `${snap.baseline ? snap.baseline.devices : 0} devices · ${snap.baseline ? snap.baseline.muted : 0} muted`]);
      if (st.error) kv.push(["FAULT", st.error]);
      if (snap.remote_error) kv.push(["FAULT", snap.remote_error]);
      $("#sh-kv", el).innerHTML = kv.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v ${k === "FAULT" ? "bad" : ""}">${esc(v)}</div>`).join("");
      $("#sh-mods", el).innerHTML = (snap.modules || []).map((m) => `<span class="tag ${m.on ? "ok" : ""}" title="${esc(m.label)}">${m.on ? "●" : "○"} ${esc(m.id)}</span>`).join("");
      drawHist();
      grid(r); findings(r); unifi(r);
    }

    function drawHist() {
      const cv = $("#sh-hist", el), hist = snap.history || [];
      const w = cv.clientWidth || 300, h = cv.clientHeight || 90, dpr = (G.devicePixelRatio || 1) * (X.zoom ? X.zoom() : 1);
      cv.width = w * dpr; cv.height = h * dpr;
      const g = cv.getContext("2d"); g.scale(dpr, dpr); g.imageSmoothingEnabled = false;
      g.fillStyle = "#241f2e"; for (let y = 0; y <= 4; y++) g.fillRect(0, Math.round((h - 1) * y / 4), w, 1);
      g.font = "16px VT323, monospace";
      if (!hist.length) { g.fillStyle = "#6f6880"; g.fillText("NO TELEMETRY", 8, h / 2 + 5); return; }
      const step = hist.length > 1 ? (w - 12) / (hist.length - 1) : 0, px = (i) => Math.round(6 + i * step), py = (s) => Math.round(6 + (h - 14) * (1 - s / 100));
      hist.forEach((p, i) => { if (p.high) { g.fillStyle = "#ff4d6d"; const bh = Math.min(14, p.high * 3); g.fillRect(px(i) - 1, h - bh, 3, bh); } });
      g.fillStyle = "#39e58c";
      for (let i = 1; i < hist.length; i++) {        // stepped pixel line
        const x0 = px(i - 1), x1 = px(i), y0 = py(hist[i - 1].score), y1 = py(hist[i].score), xm = Math.round((x0 + x1) / 2);
        g.fillRect(x0, y0, xm - x0, 2); g.fillRect(xm, Math.min(y0, y1), 2, Math.abs(y1 - y0) + 2); g.fillRect(xm, y1, x1 - xm, 2);
      }
      hist.forEach((p, i) => { g.fillStyle = "#ffffff"; g.fillRect(px(i) - 2, py(p.score) - 1, 4, 4); });
      g.fillStyle = "#a7a1b6"; g.fillText(String(hist[hist.length - 1].score), w - 22, 14);
      $("#sh-hsub", el).textContent = `${hist.length} scan${hist.length === 1 ? "" : "s"}`;
    }

    function grid(r) {
      const box = $("#sh-grid", el);
      if (!r) { box.innerHTML = `<div class="empty">No scan yet — press ▶ RUN SCAN. The first scan also records today's devices as your baseline.</div>`; return; }
      const hosts = r.hosts.slice().sort((a, b) => ((SEV.indexOf(a.worst) + 1) || 9) - ((SEV.indexOf(b.worst) + 1) || 9) || b.open.length - a.open.length);
      $("#sh-gsub", el).textContent = `${hosts.length} hosts · ${hosts.reduce((n, x) => n + x.open.length, 0)} open ports${r.skipped_out_of_scope ? ` · ${r.skipped_out_of_scope} out of scope` : ""}`;
      const card = (x) => `<button class="sh-host w-${esc(x.worst)}" data-ip="${esc(x.ip)}">
        <span class="sh-hi">${shieldSVG(SEVCOL[x.worst] || "var(--mute)", 22)}</span>
        <span class="sh-ht"><b class="ell">${esc(x.name || "unnamed")}</b><small>${esc(x.ip)}</small>
        <span class="sh-ports">${x.open.length ? x.open.map((p) => `<i>${p.port}</i>`).join("") : `<em>no risky ports</em>`}</span></span></button>`;
      // group by owner; "unknown" goes first and dashed — an unowned device is the one to look at
      const groups = new Map();
      hosts.forEach((x) => { const o = (x.owner && x.owner !== "infra") ? x.owner : "unknown"; if (!groups.has(o)) groups.set(o, []); groups.get(o).push(x); });
      const rank = (list) => Math.min(...list.map((x) => (SEV.indexOf(x.worst) + 1) || 9));
      const order = [...groups.keys()].sort((a, b) => (b === "unknown") - (a === "unknown") || rank(groups.get(a)) - rank(groups.get(b)) || groups.get(b).length - groups.get(a).length);
      box.innerHTML = order.map((o) => { const list = groups.get(o), bad = list.filter((x) => x.worst === "high" || x.worst === "med").length;
        return `<div class="sh-group ${o === "unknown" ? "unknown" : ""}"><div class="sh-gh"><b>${o === "unknown" ? "UNKNOWN OWNER" : esc(o.toUpperCase())}</b>${o === "unknown" ? `<span class="muted">— whose are these? name them in clients-aliases.json</span>` : ""}<span class="n">${list.length} host${list.length === 1 ? "" : "s"}${bad ? ` · <span class="warn">${bad} need a look</span>` : ""}</span></div>
          <div class="sh-grid">${list.map(card).join("")}</div></div>`; }).join("") || `<div class="empty">no hosts in scope</div>`;
    }

    function hostSheet(ip) {
      const x = snap.report && snap.report.hosts.find((h) => h.ip === ip);
      if (!x) return;
      const ports = x.open.map((p) => {
        const t = p.tls;
        const tls = t ? `${esc(t.protocol)} · ${esc(t.cipher)} · ${t.bits}b · PFS ${t.pfs ? "✓" : "✗"}${t.legacy && t.legacy !== "UNTESTABLE" ? ` · accepts ${esc(t.legacy)}` : ""}${t.cert ? ` · cert ${esc(t.cert.cn)}${t.cert.days_left != null ? " (" + t.cert.days_left + "d)" : ""}${t.cert.self_signed ? " self-signed" : ""}` : ""}` : "";
        return `<div class="li"><span class="tag">${p.port}</span><div class="grow"><div class="t1">${esc(p.service)}</div>${tls ? `<div class="t2">${tls}</div>` : ""}</div></div>`;
      }).join("") || `<div class="empty">no ports from the risk list are open</div>`;
      const checks = x.checks.filter((c) => !c.check.startsWith("port-")).sort((a, b) => SEV.indexOf(a.sev) - SEV.indexOf(b.sev))
        .map((c) => `<div class="li"><span class="tag ${c.sev === "info" ? "" : c.sev === "low" ? "ok" : c.sev}">${c.sev.toUpperCase()}</span><div class="grow"><div class="t1">${esc(c.title)}${c.port ? ` <span class="muted">:${esc(c.port)}</span>` : ""}</div><div class="t2">${esc(c.detail)}</div></div></div>`).join("");
      X.openSheet("insp", `<div class="sh-sheet"><div class="row" style="gap:12px">${shieldSVG(SEVCOL[x.worst] || "var(--mute)", 36)}<div><h3>${esc(x.name || x.ip)}</h3>
        <div class="muted">${esc(x.ip)} · ${esc(x.owner)}${x.mac ? " · " + esc(x.mac) : ""}${x.vendor ? " · " + esc(x.vendor) : ""}</div></div></div>
        <div class="k" style="margin:14px 0 6px">OPEN PORTS · NETSERV / TRANSCRYPT</div><div class="list">${ports}</div>
        ${checks ? `<div class="k" style="margin:14px 0 6px">CHECKS · WEBI / PROBES</div><div class="list">${checks}</div>` : ""}</div>`);
    }

    function findings(r) {
      const box = $("#sh-find", el);
      if (!r) { box.innerHTML = `<div class="empty">NO TELEMETRY</div>`; return; }
      const list = r.findings.filter((f) => showMuted || !f.muted);
      $("#sh-fsub", el).textContent = `${list.length}${showMuted ? " incl. muted" : ""}`;
      box.innerHTML = list.map((f) => `<div class="sh-f${f.muted ? " muted" : ""}">
        <span class="tag ${f.sev === "low" ? "ok" : f.sev}">${f.sev.toUpperCase()}</span>
        <div class="grow"><div class="t1">${esc(f.title)}${f.new ? ` <span class="tag fill" style="background:var(--yellow)">NEW</span>` : ""}</div>
        <div class="t2">${esc(f.host)}${f.ip && f.host !== f.ip ? " · " + esc(f.ip) : ""}${f.port ? ":" + esc(f.port) : ""} — ${esc(f.detail)}${f.known ? ` <span class="ok">· routine on a known device</span>` : ""}</div></div>
        <button class="btn sm" data-mute="${esc(f.key)}" data-on="${f.muted ? 1 : 0}" title="${f.muted ? "count it again" : "accept this risk"}">${f.muted ? "UNMUTE" : "MUTE"}</button></div>`).join("")
        || `<div class="empty"><span class="px">${shieldSVG("var(--green)", 32)}</span>ALL CLEAR — nothing open that shouldn't be</div>`;
    }

    function unifi(r) {
      const box = $("#sh-unifi", el);
      if (!r) { box.innerHTML = `<div class="empty">NO TELEMETRY</div>`; return; }
      const u = r.unifi || {}, nd = r.new_devices || [];
      let h = r.baseline_seeded_now ? `<div class="sh-note">Baseline recorded this scan — from now on, unknown devices get flagged here.</div>` : "";
      h += `<div class="k">NEW DEVICES · ${nd.length}</div><div class="list">` + (nd.map((d) => `<div class="li"><span class="tag ${d.owner === "unknown" ? "med" : ""}">${d.wired === false ? "WIFI" : d.wired ? "WIRE" : "LAN"}</span>
        <div class="grow"><div class="t1 ell">${esc(d.name || "unnamed")}</div><div class="t2">${esc(d.ip)} · ${esc(d.mac || "no mac")}${d.vendor ? " · " + esc(d.vendor) : ""}${d.ssid ? " · " + esc(d.ssid) : ""}</div></div>
        <button class="btn sm" data-ack="${esc(d.dev)}" data-name="${esc(d.name)}" data-ip="${esc(d.ip)}">ACK</button></div>`).join("") || `<div class="muted sh-none">none since last baseline</div>`) + `</div>`;
      h += `<div class="k">UNIFI GEAR · ${u.ok ? (u.devices || []).length : "OFFLINE"}</div><div class="list">`;
      h += u.ok ? (u.devices || []).map((d) => `<div class="li"><div class="grow"><div class="t1 ell">${esc(d.name)}</div><div class="t2">${esc(d.model)} · ${esc(d.firmware)}</div></div><span class="tag ${d.updatable ? "med" : "ok"}">${d.updatable ? "UPDATE" : esc(String(d.state || "OK").toUpperCase())}</span></div>`).join("") : `<div class="muted sh-none">${esc(u.error || "NO TELEMETRY")}</div>`;
      h += `</div><div class="k">IPS / THREATS · 24H</div><div class="list">`;
      h += !u.ips_available ? `<div class="muted sh-none">NO TELEMETRY — this UniFi key can't read IPS events</div>`
        : ((u.ips || []).slice(0, 12).map((e) => `<div class="li"><div class="grow"><div class="t1">${esc(e.sig)}</div><div class="t2">${esc(e.src)} → ${esc(e.dst)}</div></div><span class="tag med">${esc(String(e.action || "").toUpperCase())}</span></div>`).join("") || `<div class="ok sh-none">no IPS events</div>`);
      h += `</div>`;
      if ((u.alarms || []).length) h += `<div class="k">ALARMS</div><div class="list">` + u.alarms.slice(0, 8).map((a) => `<div class="li"><div class="grow"><div class="t1">${esc(a.msg || a.key)}</div></div><span class="muted">${esc(when(a.t))}</span></div>`).join("") + `</div>`;
      box.innerHTML = h;
    }

    el.addEventListener("click", async (e) => {
      const host = e.target.closest(".sh-host");
      if (host) { X.bleep(660, 0.03); hostSheet(host.dataset.ip); return; }
      const mb = e.target.closest("[data-mute]");
      if (mb) {
        mb.disabled = true;
        const d = await post({ action: mb.dataset.on === "1" ? "unmute" : "mute", key: mb.dataset.mute });
        if (d.ok) { const f = snap.report.findings.find((x) => x.key === mb.dataset.mute); if (f) f.muted = mb.dataset.on !== "1"; render(); X.toast(mb.dataset.on === "1" ? "Unmuted — counts again next scan" : "Muted — accepted risk, out of the score next scan"); }
        else { mb.disabled = false; X.toast("⚠ " + (d.error || "failed")); }
        return;
      }
      const ab = e.target.closest("[data-ack]");
      if (ab) {
        ab.disabled = true;
        const d = await post({ action: "ack_device", dev: ab.dataset.ack, name: ab.dataset.name, ip: ab.dataset.ip });
        if (d.ok) { ab.textContent = "✓"; X.toast(`${ab.dataset.name || ab.dataset.ip} added to baseline`); } else { ab.disabled = false; X.toast("⚠ " + (d.error || "failed")); }
      }
    });
    $("#sh-run", el).addEventListener("click", async () => {
      $("#sh-run", el).disabled = true; X.bleep(990, 0.05);
      const d = await post({ action: "scan" });
      if (!d.ok) { X.toast("⚠ " + (d.error || "scan refused")); $("#sh-run", el).disabled = false; }
      else X.toast("Scan started");
      setTimeout(load, 400);
    });
    $("#sh-muted", el).addEventListener("click", (e) => { showMuted = !showMuted; e.currentTarget.textContent = showMuted ? "HIDE MUTED" : "SHOW MUTED"; e.currentTarget.classList.toggle("on", showMuted); if (snap) render(); });
    const onResize = () => { if (snap) drawHist(); };
    G.addEventListener("resize", onResize);
    load();
    return { destroy() { dead = true; clearTimeout(timer); G.removeEventListener("resize", onResize); } };
  }

  G.HelixPages = G.HelixPages || {};
  G.HelixPages.shield = shieldPage;
})(window);
