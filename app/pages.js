/* HELIX/OPS — ARCADE APP pages: HOME · MESH · AGENTS · TRACE · SYSTEMS · MEMORY · SETTINGS */
(function (G) {
  "use strict";
  const X = G.Helix;
  const { esc, $, $$, num, trunc, ago, fmtBytes, D, store, sprite, meta, agentList, needsList, talkItems, clockOf, NT } = X;

  /* ═════════ small builders ═════════ */
  const loader = (t) => `<div class="loader"><div class="blocks"><i></i><i></i><i></i><i></i></div>${esc(t || "LOADING")}_</div>`;
  const skel = (h) => `<div class="skel" style="height:${h || 80}px;margin:12px"></div>`;
  const panel = (id, title, small, cls, body) => `<section class="pn ${cls || ""}" ${id ? `id="${id}"` : ""}><div class="hd"><h2><span class="dot"></span>${title}</h2>${small ? `<small>${small}</small>` : ""}</div>${body == null ? loader() : body}</section>`;
  const slot = (id, cls, html) => `<div id="${id}" class="${cls || ""}">${html || ""}</div>`;
  function ring(pct, col, label) {
    const r = 26, c = 2 * Math.PI * r, p = num(pct);
    return `<div class="ring" role="img" aria-label="${esc(label)} ${p == null ? "unknown" : Math.round(p) + "%"}"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" fill="none" stroke="#241f2e" stroke-width="8"/><circle cx="32" cy="32" r="${r}" fill="none" stroke="${col}" stroke-width="8" stroke-dasharray="${p == null ? 0 : (c * Math.min(100, p) / 100).toFixed(1)} ${c.toFixed(1)}"/></svg><b>${p == null ? "—" : Math.round(p) + "%"}</b></div>`;
  }
  function spark(vals, w, h, col, label) {
    if (!vals || vals.length < 2) return `<div class="muted" style="height:${h}px;display:flex;align-items:center;font:10px var(--px)">SAMPLING_</div>`;
    const mx = Math.max(1, ...vals), st = w / (vals.length - 1);
    const d = vals.map((v, i) => `${i ? "L" : "M"}${(i * st).toFixed(1)} ${(h - 2 - (v / mx) * (h - 4)).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block" role="img" aria-label="${esc(label || "trend")}"><path d="${d} L${w} ${h} L0 ${h} Z" fill="${col}" fill-opacity=".15"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const lamp = (st) => `<span class="lamp ${st}" aria-label="${st}"></span>`;
  const sevTag = (s) => `<span class="tag ${s}">${esc(String(s).toUpperCase())}</span>`;
  function agentCard(a, talkCount) {
    const say = a.status === "busy" ? (a.doing || a.thinking) : (a.thinking || a.doing || (a.online ? "standing by" : "offline"));
    return `<button class="acard ${a.status}" style="--acc:${a.acc}" data-hash="#/agents/${esc(a.id)}" aria-label="${esc(a.name)} ${esc(a.status)}">
      <span class="st">${lamp(a.status)}</span>
      <span class="top">${sprite(a.id, a.online, 36)}<span style="min-width:0"><span class="nm">${esc(a.name)}</span><div class="rl ell">${esc(a.role)}</div></span></span>
      <span class="say">${esc(say)}</span>
      <span class="meta"><span>${esc(a.status.toUpperCase())}${a.age_s != null ? " · " + ago(a.age_s) + " ago" : ""}</span><span>${talkCount ? talkCount + " msgs" : ""}</span></span>
    </button>`;
  }
  function talkCounts() { const c = {}; G.HelixMesh.collectEvents().forEach((m) => { c[m.from] = (c[m.from] || 0) + 1; c[m.to] = (c[m.to] || 0) + 1; }); return c; }
  function msgRow(e, isNew) {
    const a = meta(e.from), b = meta(e.to);
    return `<div class="msg ${isNew ? "new" : ""}" data-from="${esc(e.from)}" data-to="${esc(e.to)}">
      <div>${sprite(e.from, true, 26)}</div>
      <div style="min-width:0"><div class="who"><span style="color:${a.acc}">${esc(a.name)}</span><span class="arr">→</span><span style="color:${b.acc}">${esc(b.name)}</span><span class="tag">${esc(e.kind.toUpperCase())}</span><span class="t" style="margin-left:auto">${esc(e.t ? clockOf(e.t).slice(0, 8) : "")}</span></div>
      <div class="txt">${esc(e.text)}</div></div></div>`;
  }
  function sub(fn) { store.subs.add(fn); return () => store.subs.delete(fn); }
  const hostColors = ["#39e58c", "#3b82f6", "#ff4fa3", "#f59e0b", "#22d3ee", "#a78bfa", "#facc15"];
  function fleetChart(H) {
    if (H.length < 2) return `<div class="empty">${loader("SAMPLING FLEET")}</div>`;
    const W = 900, Ht = 200, n = H.length, ids = [];
    H.forEach((p) => Object.keys(p.share).forEach((id) => { if (!ids.includes(id)) ids.push(id); }));
    const top = Math.max(10, Math.ceil(Math.max(...H.map((p) => p.used || 0)) / 10) * 10);
    const x = (i) => (i * W / (n - 1)).toFixed(1), y = (v) => (Ht - Math.min(1, v / top) * (Ht - 10)).toFixed(1);
    let lower = new Array(n).fill(0);
    const bands = ids.map((id, k) => {
      const upper = H.map((p, i) => lower[i] + (p.share[id] || 0));
      const d = upper.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join(" ") + " " + lower.map((v, i) => [i, v]).reverse().map(([i, v]) => `L${x(i)} ${y(v)}`).join(" ") + " Z";
      lower = upper; const c = hostColors[k % hostColors.length];
      return `<path d="${d}" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
    }).join("");
    const bw = Math.min(10, W / n - 2);
    const bars = H.map((p, i) => { const prev = i ? H[i - 1].used || 0 : p.used || 0; const h = 3 + (p.used || 0) / top * 30; return `<rect x="${(i * W / (n - 1) - bw / 2).toFixed(1)}" y="${(Ht - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${(p.used || 0) >= prev ? "#39e58c" : "#ff4fa3"}" opacity=".5"/>`; }).join("");
    const names = H[n - 1].names || {}, mins = Math.max(1, Math.round((H[n - 1].t - H[0].t) / 60000));
    return `<div class="row" style="flex-wrap:wrap;gap:12px;font-size:12px;margin-bottom:8px">${ids.map((id, k) => `<span><span style="color:${hostColors[k % hostColors.length]}">■</span> ${esc(String(names[id] || id).toUpperCase())} <b class="v">${(H[n - 1].share[id] || 0).toFixed(1)}%</b></span>`).join("")}<span style="margin-left:auto" class="muted">last ${mins} min · scale 0–${top}%</span></div>
      <svg viewBox="0 0 ${W} ${Ht}" preserveAspectRatio="none" style="width:100%;height:200px;display:block" role="img" aria-label="Fleet CPU share per host"><g>${[0.25, 0.5, 0.75].map((f) => `<rect x="0" y="${(Ht * f).toFixed(0)}" width="${W}" height="1" fill="#221d2b"/>`).join("")}</g>${bars}${bands}</svg>`;
  }

  /* ═════════ HOME ═════════ */
  function home(el) {
    el.innerHTML = `
      <div class="pagehd"><div><div class="crumbs">HOS://TKY-06 · COMMAND FLOOR</div><h1>COMMAND <span>FLOOR</span></h1><p id="h-now">${X.SET ? "Connecting to the floor…" : ""}</p></div>
        <div class="row" style="gap:12px"><div id="h-badge"></div><button class="btn pri" data-hash="#/mesh">▶ OPEN MESH</button></div></div>
      ${slot("h-agents", "agents", Array(8).fill(`<div class="skel" style="height:136px"></div>`).join(""))}
      <div class="grid">
        <section class="pn c8 glow"><div class="hd"><h2><span class="dot"></span>BOTMESH · LIVE</h2><small id="h-mode">connecting</small></div><div class="mesh-wrap"><canvas class="mesh-canvas" id="h-mesh" aria-label="Botmesh preview"></canvas></div></section>
        ${panel("h-needs", "NEEDS YOU", "要対応", "c4 alert")}
      </div>
      ${slot("h-tiles", "grid", Array(6).fill(`<div class="pn c2"><div class="skel" style="height:96px;margin:12px"></div></div>`).join(""))}
      <div class="grid">
        ${panel("h-fleet", "FLEET // COMPUTE", "since page load", "c8")}
        ${panel("h-comms", "LATEST COMMS", "bot ↔ bot", "c4")}
      </div>`;
    const mesh = G.HelixMesh.Mesh($("#h-mesh", el), { compact: true });
    const unBadge = G.HelixPages._homeBadge ? G.HelixPages._homeBadge($("#h-badge", el)) : () => {};
    mesh.on("mode", (m) => { const e = $("#h-mode", el); if (e) e.textContent = m === "replay" ? "replaying recent traffic" : m === "live" ? "live traffic" : "waiting for traffic"; });
    mesh.on("select", (id) => { if (id) X.go("#/agents/" + id); });
    function upd(keys) {
      const st = D("stats"), al = agentList(), tc = talkCounts();
      if (al.length) { $("#h-agents", el).innerHTML = al.filter((a) => !["user", "telegram"].includes(a.id)).slice(0, 8).map((a) => agentCard(a, tc[a.id])).join(""); mesh.setAgents(al, (st && st.bot_mesh || {}).edges); }
      mesh.ingest(G.HelixMesh.collectEvents());
      const tr = D("trace"), now = $("#h-now", el);
      if (now && (st || tr)) {
        const h = (st || {}).hermes || {};
        now.innerHTML = `${h.gateway_running ? '<span class="ok">● Helix is up</span>' : st ? '<span class="bad">● Gateway down</span>' : ""}${tr && tr.objective ? ` · ${tr.live ? "working on" : "last job"}: <b class="v">${esc(trunc(tr.objective, 80))}</b>` : ""}${st ? ` · <a href="#/systems/security">${needsList().length} need you</a>` : ""}`;
      }
      if (st) {
        const items = needsList();
        $("#h-needs", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>NEEDS YOU</h2><small>${items.length} open</small></div><div class="list" style="max-height:${$("#h-mesh", el).clientHeight || 360}px;overflow:auto">${items.length ? items.map((x) => `<div class="li">${sevTag(x.sev)}<div class="grow"><div class="t1">${esc(x.title)}</div><div class="t2 ell">${esc(x.src)}</div></div></div>`).join("") : `<div class="empty">${sprite("helix", true, 48)}<br>NOTHING NEEDS YOU</div>`}</div>`;
      }
      tiles();
      if (!keys || keys.has("compute")) $("#h-fleet", el).querySelector(".hd + *").outerHTML = `<div class="bd">${fleetChart(store.hist)}</div>`;
      const ev = G.HelixMesh.collectEvents().slice(-7).reverse();
      $("#h-comms", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>LATEST COMMS</h2><small><a href="#/mesh">all ▸</a></small></div><div class="comms" style="max-height:260px">${ev.length ? ev.map((e) => msgRow(e)).join("") : `<div class="empty">NO MESSAGES YET</div>`}</div>`;
    }
    function tiles() {
      const c = D("compute"), st = D("stats"), dk = D("docker"), al = agentList();
      if (!c && !st) return;
      const rates = store.net.rates, lr = rates[rates.length - 1];
      const mp = c && c.mem_total_gb ? 100 * c.mem_used_gb / c.mem_total_gb : null;
      const sec = (st || {}).security || {}, needs = st ? needsList() : [];
      const cs = (dk && dk.containers) || [], up = cs.filter((x) => x.running).length;
      const bots = al.filter((a) => !["user", "telegram", "web", "tools"].includes(a.id));
      const T = (k, body, sub2, cls, hash) => `<button class="pn c2 tile ${cls || ""}" ${hash ? `data-hash="${hash}"` : ""} style="text-align:left;cursor:${hash ? "pointer" : "default"};color:inherit"><span class="k">${k}</span>${body}<span class="muted" style="font-size:11px">${sub2}</span></button>`;
      $("#h-tiles", el).innerHTML = [
        T("FLEET CPU", `<div class="row">${ring(c && c.used_pct, "#39e58c", "Fleet CPU")}<div class="num">${c ? (c.hosts || []).filter((h) => h.online).length : "—"}<small>hosts</small></div></div>`, c ? `${c.total_cpus} cpu · peak ${store.peak != null ? Math.round(store.peak) + "%" : "—"}` : "", "", "#/systems/hosts"),
        T("MEMORY", `<div class="row">${ring(mp, "#22d3ee", "Memory")}<div class="num" style="font-size:24px">${c ? Math.round(c.mem_used_gb) : "—"}<small>/ ${c ? Math.round(c.mem_total_gb) : "—"} GB</small></div></div>`, c ? `hermes procs ${c.hermes_procs ?? "—"}` : "", "", "#/systems/hosts"),
        T("NETWORK", `<div class="num">${lr ? (lr.rx + lr.tx).toFixed(1) : "—"}<small>Mb/s</small></div>${spark(rates.map((r) => r.rx + r.tx), 200, 34, "#3b82f6", "Network")}`, lr ? `↓ ${lr.rx.toFixed(1)} · ↑ ${lr.tx.toFixed(1)}` : "measuring between scans", "", "#/systems/network"),
        T("AGENTS", `<div class="num">${bots.filter((a) => a.online).length}<small>/ ${bots.length} online</small></div><div class="segs">${bots.map((a) => `<i style="background:${a.online ? a.acc : "#3a3346"}"></i>`).join("")}</div>`, `${bots.filter((a) => a.status === "busy").length} busy right now`, "", "#/agents"),
        T("DOCKER", `<div class="num">${dk && dk.ok ? up : "—"}<small>/ ${dk && dk.ok ? cs.length : "—"} up</small></div><div class="bar"><i style="width:${cs.length ? 100 * up / cs.length : 0}%"></i></div>`, dk && dk.ok ? `${cs.length - up} stopped` : (dk ? esc(dk.error || "unavailable") : "scanning"), "", "#/systems/docker"),
        T("NEEDS YOU", `<div class="num">${st ? needs.length : "—"}<small>open</small></div><div class="segs">${["high", "med", "warn", "low"].map((s) => needs.filter((x) => x.sev === s).map(() => `<i style="background:${s === "high" ? "#ff4d6d" : s === "low" ? "#3a3346" : "#f59e0b"}"></i>`).join("")).join("") || '<i></i>'}</div>`, `hardening ${sec.score ?? "—"}/100`, "alert", "#/systems/security"),
      ].join("");
    }
    const un = sub(upd); upd();
    return { destroy() { un(); mesh.destroy(); unBadge(); } };
  }

  /* ═════════ MESH ═════════ */
  function meshPage(el) {
    let filter = "all", sel = null;
    el.innerHTML = `
      <div class="pagehd"><div><div class="crumbs"><a href="#/">FLOOR</a> › MESH</div><h1>BOT<span>MESH</span></h1><p>Every message between your agents, live. Packets fly sender → receiver; links glow with traffic; tap an agent to inspect.</p></div>
        <div class="row" style="flex-wrap:wrap"><div class="seg" role="group" aria-label="View"><button data-view="arena">ARENA</button><button data-view="floor">FLOOR</button></div><button class="btn" id="m-replay">↺ REPLAY</button></div></div>
      <div class="grid" style="align-items:start">
        <section class="pn c8 glow">
          <div class="mesh-wrap"><canvas class="mesh-canvas" id="m-canvas" aria-label="Botmesh arena"></canvas>
            <div class="mesh-hud"><span class="mode wait" id="m-mode">● CONNECTING</span><span class="mode" id="m-legend" style="color:var(--dim)">■ live link ┄ idle link</span></div></div>
          <div class="mesh-stats" id="m-stats">${Array(4).fill(`<div><div class="skel" style="height:40px"></div></div>`).join("")}</div>
        </section>
        <div class="c4 stack" style="gap:14px">
          <section class="pn" id="m-insp"><div class="hd"><h2><span class="dot"></span>INSPECT</h2><small>tap an agent</small></div><div class="empty">${sprite("helix", true, 40)}<br>SELECT AN AGENT ON THE ARENA</div></section>
          <section class="pn"><div class="hd"><h2><span class="dot"></span>COMMS LOG</h2><div class="seg" role="group" aria-label="Filter"><button data-f="all" class="on">ALL</button><button data-f="talk">AGENTS</button><button data-f="trace">TOOLS</button><button data-f="chat">CHAT</button></div></div><div class="comms" id="m-log">${loader("LISTENING")}</div></section>
        </div>
      </div>
      <div class="grid">
        ${panel("m-links", "BUSIEST LINKS", "messages per pair", "c6")}
        ${panel("m-roster", "AGENTS ON THE MESH", "status", "c6")}
      </div>`;
    let view = "arena"; try { view = localStorage.getItem("helix.meshView") || "arena"; } catch (e) {}
    const mesh = G.HelixMesh.Mesh($("#m-canvas", el), { view });
    const markView = () => $$("[data-view]", el).forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    markView();
    let lastKeys = new Set();
    mesh.on("mode", (m) => { const b = $("#m-mode", el); if (!b) return; b.className = "mode " + (m === "replay" ? "replay" : m === "live" ? "" : "wait"); b.textContent = m === "replay" ? "↺ REPLAY" : m === "live" ? "● LIVE" : "● LIVE · QUIET"; b.title = m === "replay" ? "Replaying recent real traffic" : m === "live" ? "Live traffic" : "Live — no messages in the last 25s"; });
    mesh.on("select", (id) => { sel = id; inspect(); renderLog(); if (id && matchMedia("(max-width: 900px)").matches) X.openSheet("insp", inspHTML()); });
    mesh.on("event", () => stats());
    $("#m-replay", el).addEventListener("click", () => mesh.replay(24));
    el.addEventListener("click", (e) => {
      const v = e.target.closest("[data-view]");
      if (v) { view = v.dataset.view; try { localStorage.setItem("helix.meshView", view); } catch (err) {} mesh.setView(view); markView(); const lg = $("#m-legend", el); if (lg) lg.textContent = view === "floor" ? "agents walk to whoever they message" : "■ live link ┄ idle link"; X.bleep(990, 0.05); }
      const f = e.target.closest("[data-f]"); if (f) { filter = f.dataset.f; $$("[data-f]", el).forEach((b) => b.classList.toggle("on", b === f)); renderLog(); }
      const m = e.target.closest(".msg"); if (m) { sel = m.dataset.from; mesh.select(sel); inspect(); }
    });
    function inspHTML() {
      if (!sel) return `<div class="empty">SELECT AN AGENT</div>`;
      const a = agentList().find((x) => x.id === sel) || { id: sel, name: meta(sel).name, acc: meta(sel).acc, role: meta(sel).role, online: true, status: "idle" };
      const ev = mesh.events().filter((e) => e.from === sel || e.to === sel);
      const out = ev.filter((e) => e.from === sel).length, inn = ev.length - out;
      const peers = {}; ev.forEach((e) => { const o = e.from === sel ? e.to : e.from; peers[o] = (peers[o] || 0) + 1; });
      const last = ev[ev.length - 1];
      return `<div class="bd stack">
        <div class="row">${sprite(a.id, a.online, 56)}<div style="min-width:0"><div style="font:700 20px var(--px);color:${a.acc}">${esc(a.name)}</div><div class="muted" style="font-size:12px">${esc(a.role)}</div><div class="row" style="gap:6px;margin-top:4px">${lamp(a.status)}<span class="k">${esc(a.status)}</span>${a.age_s != null ? `<span class="muted" style="font-size:11px">· active ${ago(a.age_s)} ago</span>` : ""}</div></div></div>
        ${a.thinking || a.doing ? `<div><div class="k">DOING NOW</div><div class="v" style="font-size:13px">${esc(a.doing || a.thinking)}</div></div>` : ""}
        <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:8px"><div><div class="k">SENT</div><div class="num" style="font-size:28px">${out}</div></div><div><div class="k">RECEIVED</div><div class="num" style="font-size:28px">${inn}</div></div><div><div class="k">PEERS</div><div class="num" style="font-size:28px">${Object.keys(peers).length}</div></div></div>
        ${Object.keys(peers).length ? `<div><div class="k" style="margin-bottom:6px">TALKS WITH</div>${Object.entries(peers).sort((x, y) => y[1] - x[1]).map(([p, n]) => `<div class="row between" style="font-size:12px;padding:3px 0"><span class="row" style="gap:6px">${sprite(p, true, 18)}<span style="color:${meta(p).acc};font:10px var(--px)">${esc(meta(p).name)}</span></span><b class="v">${n}</b></div>`).join("")}</div>` : ""}
        ${last ? `<div><div class="k">LAST MESSAGE</div><div style="font-size:12.5px">${esc(trunc(last.text, 220))}</div></div>` : ""}
        ${!["web", "tools", "user"].includes(a.id) ? `<button class="btn pri" data-hash="#/agents/${esc(a.id)}">OPEN AGENT ▸</button>` : ""}
      </div>`;
    }
    function inspect() { const p = $("#m-insp", el); if (p) p.innerHTML = `<div class="hd"><h2><span class="dot"></span>INSPECT</h2><small>${sel ? `<button class="btn sm" id="m-clear">CLEAR</button>` : "tap an agent"}</small></div>${sel ? inspHTML() : `<div class="empty">${sprite("helix", true, 40)}<br>SELECT AN AGENT ON THE ARENA</div>`}`; const c = $("#m-clear", el); if (c) c.onclick = () => { sel = null; mesh.select(null); inspect(); renderLog(); }; }
    function renderLog() {
      let ev = mesh.events();
      const AG = ["helix", "prefect", "foreman", "canon", "scribe", "adze", "worker"];
      if (filter === "talk") ev = ev.filter((e) => AG.includes(e.from) && AG.includes(e.to));
      else if (filter === "trace") ev = ev.filter((e) => e.kind === "tool" || e.kind === "result");
      else if (filter === "chat") ev = ev.filter((e) => e.kind === "request" || e.kind === "reply");
      if (sel) ev = ev.filter((e) => e.from === sel || e.to === sel);
      const keys = new Set(ev.map((e) => e.key));
      $("#m-log", el).innerHTML = ev.length ? ev.slice(-80).reverse().map((e) => msgRow(e, lastKeys.size && !lastKeys.has(e.key))).join("") : `<div class="empty">NO MESSAGES${sel ? " FOR " + esc(meta(sel).name) : ""} YET</div>`;
      lastKeys = keys;
    }
    function stats() {
      const s = mesh.stats(), al = agentList().filter((a) => !["user", "telegram", "web", "tools"].includes(a.id));
      const b = s.busiest;
      $("#m-stats", el).innerHTML = `<div><div class="k">MESSAGES · 1H</div><div class="num">${s.hour}</div></div><div><div class="k">ACTIVE LINKS</div><div class="num">${s.links}</div></div><div><div class="k">BUSIEST PAIR</div><div style="font:11px var(--px);margin-top:8px">${b ? `<span style="color:${meta(b.a).acc}">${esc(meta(b.a).name)}</span> ⇄ <span style="color:${meta(b.b).acc}">${esc(meta(b.b).name)}</span> · ${b.count}` : "—"}</div></div><div><div class="k">AGENTS ONLINE</div><div class="num">${al.filter((a) => a.online).length}<small>/ ${al.length}</small></div></div>`;
      const links = mesh.links().slice(0, 10);
      const mx = links.length ? links[0].count : 1;
      $("#m-links", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>BUSIEST LINKS</h2><small>messages per pair</small></div><div class="links">${links.length ? links.map((l) => `<div class="link"><div class="pair">${X.sprite(l.a, true, 18)}<span style="color:${meta(l.a).acc}">${esc(meta(l.a).name)}</span>⇄${X.sprite(l.b, true, 18)}<span style="color:${meta(l.b).acc}">${esc(meta(l.b).name)}</span></div><div class="bar"><i style="width:${100 * l.count / mx}%;background:${meta(l.a).acc}"></i></div><div class="n">${l.count}</div></div>`).join("") : `<div class="empty">NO TRAFFIC YET</div>`}</div>`;
    }
    function upd(keys) {
      const st = D("stats"), al = agentList();
      if (al.length) mesh.setAgents(al, (st && st.bot_mesh || {}).edges);
      if (!keys || keys.has("talk") || keys.has("trace") || keys.has("mesh")) { mesh.ingest(G.HelixMesh.collectEvents()); renderLog(); }
      stats(); if (sel) inspect();
      const tc = talkCounts();
      $("#m-roster", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>AGENTS ON THE MESH</h2><small>${al.filter((a) => a.online).length} online</small></div><div class="list">${al.filter((a) => !["web", "tools"].includes(a.id)).map((a) => `<button class="li" style="background:none;border:0;border-bottom:1px solid #1d1926;text-align:left;cursor:pointer;color:inherit;width:100%" data-sel="${esc(a.id)}">${sprite(a.id, a.online, 28)}<div class="grow"><div class="t1" style="color:${a.acc};font:11px var(--px)">${esc(a.name)}</div><div class="t2 ell">${esc(a.doing || a.thinking || a.role)}</div></div>${lamp(a.status)}<span class="muted" style="font:16px var(--vt);width:32px;text-align:right">${tc[a.id] || ""}</span></button>`).join("")}</div>`;
      $$("[data-sel]", el).forEach((b) => b.onclick = () => { sel = b.dataset.sel; mesh.select(sel); inspect(); renderLog(); if (matchMedia("(max-width: 900px)").matches) X.openSheet("insp", inspHTML()); });
    }
    const un = sub(upd); upd();
    return { destroy() { un(); mesh.destroy(); } };
  }

  /* ═════════ AGENTS ═════════ */
  function agents(el, arg) {
    if (arg) return agentDetail(el, arg);
    el.innerHTML = `<div class="pagehd"><div><div class="crumbs"><a href="#/">FLOOR</a> › AGENTS</div><h1>THE <span>CREW</span></h1><p>Who's on the floor, what they're doing, and who they talk to.</p></div></div>${slot("a-grid", "agents", loader("CALLING THE ROLL"))}
      <div class="grid">${panel("a-herdr", "HERDR · AGENT RUNNER", "", "c12")}</div>`;
    function upd() {
      const al = agentList().filter((a) => !["web", "tools"].includes(a.id)), tc = talkCounts();
      if (al.length) $("#a-grid", el).innerHTML = al.map((a) => agentCard(a, tc[a.id])).join("");
      const hd = D("herdr");
      if (hd) $("#a-herdr", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>HERDR · AGENT RUNNER</h2><small>${hd.installed ? (hd.running ? "running" : "installed · stopped") : "not installed"}</small></div><div class="list">${(hd.agents || []).length ? hd.agents.map((a) => `<div class="li"><div class="grow"><div class="t1">${esc(a.name || a.id || a.kind)}</div><div class="t2">${esc(a.kind || "")} ${esc(a.status || a.state || "")}</div></div></div>`).join("") : `<div class="empty">NO HERDR AGENTS</div>`}</div>`;
    }
    const un = sub(upd); upd(); return { destroy: un };
  }
  function agentDetail(el, id) {
    const m = meta(id);
    el.innerHTML = `<div class="pagehd"><div><div class="crumbs"><a href="#/">FLOOR</a> › <a href="#/agents">AGENTS</a> › ${esc(m.name)}</div>
      <div class="row" style="gap:14px">${sprite(id, true, 72)}<div><h1 style="color:${m.acc}">${esc(m.name)}</h1><p>${esc(m.role)}</p></div></div></div>
      <div class="row"><button class="btn" data-hash="#/mesh">◉ SEE ON MESH</button></div></div>
      <div class="grid">${panel("ad-status", "STATUS", "", "c4")}${panel("ad-talk", "CONVERSATION", "", "c8")}</div>
      ${id === "helix" ? `<div class="grid">${panel("ad-pipe", "PIPELINE · LAST REQUEST", "", "c6")}<section class="pn c6"><div class="hd"><h2><span class="dot"></span>THOUGHT STREAM</h2><small><a href="#/helix">talk to Helix ▸</a></small></div><div class="term" style="height:300px"><div class="out" id="ad-out">${loader()}</div></div></section></div>` : ""}
      ${id === "adze" ? `<div class="grid">${panel("ad-adze", "ANALYSIS CORE", "", "c12")}</div>` : ""}`;
    const form = $("#ad-form", el);
    if (form) form.addEventListener("submit", async (e) => {
      e.preventDefault(); const inp = $("#ad-in", el), text = inp.value.trim(); if (!text) return;
      inp.value = ""; inp.disabled = true;
      try { await fetch(X.api("/api/prompt"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }); X.toast("SENT TO HELIX"); X.load("thoughts", true); }
      catch (err) { X.toast("SEND FAILED"); } finally { inp.disabled = false; inp.focus(); }
    });
    function upd() {
      const a = agentList().find((x) => x.id === id), st = D("stats") || {}, h = st.hermes || {};
      if (a) {
        const tk = talkItems().filter((x) => x.from === id || x.to === id);
        const mev = G.HelixMesh.collectEvents().filter((x) => x.from === id || x.to === id || x.agent === id);
        $("#ad-status", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>STATUS</h2><small>${lamp(a.status)} ${esc(a.status.toUpperCase())}</small></div><div class="bd stack">
          ${row2("ONLINE", a.online ? '<span class="ok">YES</span>' : '<span class="bad">NO</span>')}${row2("HOST", esc(a.host || "—"))}${row2("KIND", esc(a.kind || "—"))}
          ${a.age_s != null ? row2("LAST ACTIVE", ago(a.age_s) + " ago") : ""}${a.source ? row2("SOURCE", esc(a.source)) : ""}
          ${id === "helix" ? row2("MODEL", esc(h.model || "—")) + row2("PROVIDER", esc(h.provider || "—")) + row2("GATEWAY", h.gateway_running ? `<span class="ok">RUNNING</span> pid ${esc(h.gateway_pid || "")}` : '<span class="bad">DOWN</span>') + row2("VERSION", esc((h.version || "—") + (h.commits_behind ? ` · ${h.commits_behind} behind` : ""))) + row2("CRON", esc(h.cron_jobs ?? "—")) : ""}
          ${row2("MESSAGES", mev.length || tk.length)}
          ${a.title ? `<div><div class="k">CURRENT SESSION</div><div class="v" style="font-size:13px">${esc(a.title)}</div></div>` : ""}
          ${a.thinking || a.doing ? `<div><div class="k">DOING</div><div class="v" style="font-size:13px">${esc(a.doing || a.thinking)}</div></div>` : ""}</div>`;
        const conv = mev.length ? mev.slice(-50).map((x) => ({ from: x.from, to: x.to, text: x.text, t: x.t, kind: x.kind })) : (id === "helix" ? talkItems().slice(-40) : tk.slice(-40));
        $("#ad-talk", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>CONVERSATION</h2><small>${conv.length} recent</small></div><div class="comms" style="max-height:440px">${conv.length ? conv.slice().reverse().map((x) => msgRow({ from: x.from, to: x.to, text: x.text, kind: x.kind || "talk", t: x.t })).join("") : `<div class="empty">NO MESSAGES WITH ${esc(m.name)} YET</div>`}</div>`;
      }
      if (id === "helix") {
        const tr = D("trace");
        if (tr) $("#ad-pipe", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>PIPELINE · LAST REQUEST</h2><small><a href="#/trace">trace ▸</a></small></div><div class="bd stack">${pipe(tr)}<div class="k">OBJECTIVE</div><div class="v">${esc(tr.objective || "—")}</div>${row2("STAGE", esc(tr.stage || "—"))}${row2("TOKENS/S", esc(tr.tokens_per_s ?? "—"))}</div>`;
        const th = D("thoughts");
        if (th) { const items = Array.isArray(th) ? th : (th.items || []); const out = $("#ad-out", el); if (out) { out.innerHTML = items.slice(-60).map((t) => `<div><span class="mute">${esc(clockOf(t.t).slice(0, 8))}</span> <span class="${t.kind === "user" ? "pink" : t.kind === "tool" ? "warn" : "ok"}">${esc((t.kind || "").toUpperCase())}</span> ${esc(t.text)}</div>`).join("") || `<div class="muted">idle_</div>`; out.scrollTop = 1e6; } }
      }
      if (id === "adze") {
        const ad = D("adze");
        if (ad) $("#ad-adze", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>ANALYSIS CORE</h2><small>${ad.online ? "online" : "offline"}</small></div><div class="bd stack">${row2("PROVIDER", ad.online ? '<span class="ok">OPENAI · ' + esc(ad.model || "") + "</span>" : '<span class="bad">OPENAI KEY MISSING</span>')}${row2("MODE", esc(String(ad.mode || "—").toUpperCase()))}${row2("MAX ROUNDS", esc(ad.max_rounds ?? "—"))}${row2("LAST", esc((ad.last || {}).state || "—"))}<div class="list">${(ad.events || []).slice().reverse().map((e) => `<div class="li"><span class="mute">${esc(e.t || "")}</span><div class="grow">${esc(e.kind || "")} ${esc(e.state || e.summary || "")}</div></div>`).join("")}</div></div>`;
      }
    }
    const un = sub(upd); upd(); return { destroy: un };
  }
  const row2 = (k, v) => `<div class="row between" style="font-size:13px"><span class="k">${k}</span><span class="v" style="text-align:right">${v}</span></div>`;
  function pipe(tr) {
    const st = tr.stages || {}, order = ["REQUEST", "INTERPRET", "PLAN", "TOOL", "OBSERVATION", "DECISION", "RESPONSE"];
    const last = order.slice().reverse().find((k) => st[k]);
    return `<div class="pipe" role="img" aria-label="Request pipeline">${order.map((k) => `<span class="${st[k] ? "lit" : ""}${k === last ? " cur" : ""}">${k}</span>`).join("")}</div>`;
  }

  /* ═════════ TRACE ═════════ */
  function trace(el) {
    el.innerHTML = `<div class="pagehd"><div><div class="crumbs"><a href="#/">FLOOR</a> › TRACE</div><h1>COGNITIVE <span>TRACE</span></h1><p>What Helix observably did for its latest request — requests, tool calls, results and replies. No hidden reasoning.</p></div></div>
      <div class="grid">${panel("t-sum", "LATEST REQUEST", "", "c12")}</div>
      <div class="grid">${panel("t-lanes", "SWIMLANES", "", "c7")}${panel("t-tl", "TIMELINE", "", "c5")}</div>`;
    function upd() {
      const tr = D("trace"); if (!tr) return;
      $("#t-sum", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>LATEST REQUEST</h2><small>${tr.live ? '<span class="warn">● LIVE</span>' : "idle"}</small></div><div class="bd stack">
        <div style="font-size:16px" class="v">${esc(tr.objective || "No request yet")}</div>${pipe(tr)}
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">${[["STAGE", tr.stage], ["SOURCE", tr.source || "—"], ["MODEL", tr.model || "—"], ["ELAPSED", tr.elapsed_s != null ? Math.round(tr.elapsed_s) + "s" : "—"], ["TOKENS", tr.tokens ?? "—"], ["TOKENS/S", tr.tokens_per_s ?? "—"]].map(([k, v]) => `<div><div class="k">${k}</div><div class="num" style="font-size:24px">${esc(v)}</div></div>`).join("")}</div>
        ${tr.next ? `<div class="muted" style="font-size:12px">NEXT: ${esc(tr.next)}</div>` : ""}</div>`;
      const tl = tr.timeline || []; let start = -1;
      for (let i = tl.length - 1; i >= 0; i--) if (tl[i].kind === "REQUEST") { start = i; break; }
      const run = start >= 0 ? tl.slice(start) : tl.slice(-12);
      const sec = (t) => { const m = String(t || "").match(/(\d+):(\d+):(\d+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };
      const s0 = run.length ? sec(run[0].t) : 0, s1 = run.length ? Math.max(...run.map((e) => sec(e.t) || 0)) : 0, span = Math.max(5, Math.ceil((s1 - s0 + 1) / 5) * 5);
      const lanes = { REQUEST: [], PLAN: [], TOOL: [], RESULT: [], RESPONSE: [] }, col = { REQUEST: "#8ff5c0", PLAN: "#e9e4f2", TOOL: "#f59e0b", RESULT: "#39e58c", RESPONSE: "#ff4fa3" };
      run.forEach((e) => { const s = sec(e.t); if (s == null) return; const k = e.kind === "DELEGATE" ? "TOOL" : e.kind; if (!lanes[k]) return; const dur = num((e.detail || {}).duration_s); const l = 100 * (s - s0) / span;
        if (k === "RESULT" && dur) lanes.TOOL.push({ l: 100 * (s - dur - s0) / span, w: Math.max(1, 100 * dur / span), label: (e.detail || {}).tool || "" });
        lanes[k].push({ l, w: 1.2, label: "" }); });
      $("#t-lanes", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>SWIMLANES</h2><small>${span}s window</small></div><div class="bd">${run.length ? Object.keys(lanes).map((k) => `<div class="lane"><span class="k">${k}</span><div class="tr">${lanes[k].map((b) => `<i style="left:${Math.max(0, b.l).toFixed(1)}%;width:${b.w.toFixed(1)}%;background:${col[k]}">${esc(b.label)}</i>`).join("")}</div></div>`).join("") + `<div class="row between muted" style="font:15px var(--vt);padding-left:94px">${[0, 1, 2, 3, 4].map((i) => `<span>${Math.round(span * i / 4)}s</span>`).join("")}</div>` : `<div class="empty">NO EVENTS YET</div>`}</div>`;
      $("#t-tl", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>TIMELINE</h2><small>${tl.length} events</small></div><div class="list" style="max-height:520px;overflow:auto">${tl.slice().reverse().map((e) => `<div class="li"><span class="tag" style="color:${col[e.kind] || "#c9c3d6"}">${esc(e.kind)}</span><div class="grow"><div class="t1 ell">${esc(e.summary || e.label)}</div><div class="t2">${esc(e.t)}${(e.detail || {}).duration_s ? " · " + e.detail.duration_s + "s" : ""}</div></div></div>`).join("") || `<div class="empty">NO EVENTS</div>`}</div>`;
    }
    const un = sub(upd); upd(); return { destroy: un };
  }

  /* ═════════ SYSTEMS ═════════ */
  const SYS = [["hosts", "HOSTS"], ["docker", "DOCKER"], ["network", "NETWORK"], ["remote", "REMOTE"], ["security", "SECURITY"]];
  function systems(el, arg) {
    const tab = SYS.some(([k]) => k === arg) ? arg : "hosts";
    let q = "", f = "all";
    el.innerHTML = `<div class="pagehd"><div><div class="crumbs"><a href="#/">FLOOR</a> › SYSTEMS › ${tab.toUpperCase()}</div><h1>SYS<span>TEMS</span></h1></div></div>
      <div class="subtabs">${SYS.map(([k, l]) => `<button class="btn ${k === tab ? "pri" : ""}" data-hash="#/systems/${k}">${l}</button>`).join("")}</div>
      <div id="s-body">${loader()}</div>`;
    const body = $("#s-body", el);
    if (tab === "docker") {
      body.innerHTML = `<section class="pn"><div class="toolbar"><input class="input" id="s-q" placeholder="search containers…" style="max-width:280px" aria-label="Search containers"><div class="seg" role="group"><button data-df="all" class="on">ALL</button><button data-df="up">RUNNING</button><button data-df="down">STOPPED</button></div><span class="muted" id="s-cnt" style="margin-left:auto;font-size:12px"></span></div><div class="ctrs" id="s-ctrs">${loader("SCANNING DOCKER")}</div></section>`;
      $("#s-q", el).addEventListener("input", (e) => { q = e.target.value.toLowerCase(); upd(); });
      el.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-df]"); if (b) { f = b.dataset.df; $$("[data-df]", el).forEach((x) => x.classList.toggle("on", x === b)); upd(); }
        const a = e.target.closest("[data-act]");
        if (a) { a.disabled = true; a.textContent = "…"; try { await fetch(X.api("/api/docker"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: a.dataset.name, action: a.dataset.act }) }); X.toast(a.dataset.act.toUpperCase() + " · " + a.dataset.name); } catch (err) { X.toast("FAILED"); } X.load("docker", true); }
      });
    }
    if (tab === "remote") el.addEventListener("click", async (e) => { const c = e.target.closest("[data-copy]"); if (c) { try { await navigator.clipboard.writeText(c.dataset.copy); X.toast("ID COPIED"); } catch (err) { X.toast(c.dataset.copy); } } });
    function upd() {
      const st = D("stats"), c = D("compute");
      if (tab === "hosts") {
        if (!st) return;
        const cpu = {}; ((c || {}).hosts || []).forEach((h) => { cpu[h.id] = h; });
        body.innerHTML = `<div class="grid">${panel(null, "FLEET // COMPUTE", "", "c12", `<div class="bd">${fleetChart(store.hist)}</div>`)}</div><div class="grid" style="margin-top:14px">${(st.hosts || []).map((h) => {
          const ch = cpu[h.id] || {}, mp = h.mem_total_gb ? 100 * (h.mem_used_gb || 0) / h.mem_total_gb : null;
          const disk = h.disk && h.disk.pct ? parseInt(h.disk.pct, 10) : (h.disk_pct ? parseInt(h.disk_pct, 10) : null);
          return `<section class="pn c4 ${h.online ? "" : "alert"}"><div class="hd"><h2><span class="dot" style="background:${h.online ? "#39e58c" : "#ff4d6d"}"></span>${esc(String(h.name || h.id).toUpperCase())}</h2><small>${esc(h.role || "")}</small></div><div class="bd stack">
            ${row2("STATUS", h.online ? '<span class="ok">ONLINE</span>' + (h.ping_ms != null ? ` · ${h.ping_ms}ms` : "") : '<span class="bad">OFFLINE</span>')}${h.host ? row2("ADDRESS", esc(h.host)) : ""}
            ${ch.pct != null || h.cpus ? `<div><div class="row between"><span class="k">CPU</span><span class="v">${ch.pct != null ? ch.pct + "%" : "—"} · ${esc(h.cpus || ch.cpus || "—")} cores</span></div><div class="bar"><i style="width:${ch.pct || 0}%"></i></div></div>` : ""}
            ${mp != null ? `<div><div class="row between"><span class="k">MEMORY</span><span class="v">${h.mem_used_gb} / ${h.mem_total_gb} GB</span></div><div class="bar"><i style="width:${mp}%;background:#22d3ee"></i></div></div>` : ""}
            ${disk != null ? `<div><div class="row between"><span class="k">DISK</span><span class="v">${disk}%</span></div><div class="bar"><i style="width:${disk}%;background:${disk > 85 ? "#ff4d6d" : "#a78bfa"}"></i></div></div>` : ""}
            ${h.uptime ? row2("UPTIME", esc(h.uptime)) : ""}
            ${Object.entries(h.services || {}).map(([k, v]) => row2(esc(k.toUpperCase()), (v && (v.ok || v.status === 200 || v.status === 401)) ? `<span class="ok">● ${esc(v.status)}</span>` : `<span class="bad">○ ${esc((v && v.status) || "down")}</span>`)).join("")}
          </div></section>`; }).join("")}</div>`;
      }
      if (tab === "docker") {
        const d = D("docker"); if (!d) return;
        if (!d.ok) { $("#s-ctrs", el).innerHTML = `<div class="empty bad">${esc(d.error || "docker unavailable")}</div>`; return; }
        let cs = (d.containers || []).slice().sort((a, b) => (a.running - b.running) || a.name.localeCompare(b.name));
        const up = cs.filter((x) => x.running).length;
        $("#s-cnt", el).textContent = `${up} running · ${cs.length - up} stopped · ${d.host || ""}`;
        if (f === "up") cs = cs.filter((x) => x.running); if (f === "down") cs = cs.filter((x) => !x.running);
        if (q) cs = cs.filter((x) => (x.name + " " + x.image).toLowerCase().includes(q));
        $("#s-ctrs", el).innerHTML = cs.map((x) => `<div class="ctr ${x.running ? "" : "down"}"><div class="row between"><span class="v ell" style="font-weight:600">${esc(x.name)}</span>${x.running ? '<span class="tag ok">RUN</span>' : `<span class="tag high">${esc(String(x.state || "stop").toUpperCase())}</span>`}</div><div class="muted ell" style="font-size:11px">${esc(x.status)}</div><div class="mute ell" style="font-size:11px">${esc(x.image)}</div><div class="row" style="justify-content:flex-end;gap:6px">${x.webui ? `<a class="btn sm" href="${esc(x.webui)}" target="_blank" rel="noopener">OPEN</a>` : ""}<button class="btn sm" data-act="${x.running ? "stop" : "start"}" data-name="${esc(x.name)}">${x.running ? "STOP" : "START"}</button></div></div>`).join("") || `<div class="empty">NO MATCHES</div>`;
      }
      if (tab === "network") {
        const cl = D("clients"), rates = store.net.rates, lr = rates[rates.length - 1], net = (st || {}).network || {};
        const groups = {}; ((cl || {}).clients || []).forEach((x) => { const o = x.owner || "unknown"; (groups[o] = groups[o] || []).push(x); });
        body.innerHTML = `<div class="grid"><section class="pn c4"><div class="hd"><h2><span class="dot"></span>THROUGHPUT</h2><small>${esc(net.egress_iface || "")} · gw ${esc(net.gateway || "—")}</small></div><div class="bd stack"><div class="num">${lr ? (lr.rx + lr.tx).toFixed(1) : "—"}<small>Mb/s</small></div>${spark(rates.map((r) => r.rx + r.tx), 300, 60, "#3b82f6", "Throughput")}<div class="muted" style="font-size:12px">${lr ? `↓ ${lr.rx.toFixed(1)} · ↑ ${lr.tx.toFixed(1)} Mb/s` : "measured between 10s scans"}</div>${(net.ifaces || []).map((i) => row2(esc(i.name + " · " + i.role), `↓${i.rx_gb} ↑${i.tx_gb} GB`)).join("")}</div></section>
          <section class="pn c8"><div class="hd"><h2><span class="dot"></span>LAN CLIENTS</h2><small>${cl ? `${cl.count} · ${cl.unifi ? "UniFi + DHCP" : cl.need_key ? "DHCP only · no UniFi key" : "DHCP"}` : "scanning"}</small></div>${cl ? `<div class="list" style="max-height:560px;overflow:auto">${Object.keys(groups).sort((a, b) => (a === "unknown") - (b === "unknown") || groups[b].length - groups[a].length).map((o) => `<div class="li" style="background:#100d16"><span class="k" style="color:var(--pink)">${esc(o)}</span><span class="muted" style="margin-left:auto">${groups[o].length}</span></div>${groups[o].map((x) => `<div class="li"><span class="tag">${x.wired === true ? "WIRE" : x.wired === false ? "WIFI" : "LAN"}</span><div class="grow"><div class="t1 ell">${esc(x.name || x.hostname || "—")}</div><div class="t2">${esc(x.ip || "")}${x.ssid ? " · " + esc(x.ssid) : ""}${x.rssi != null ? " · " + esc(x.rssi) + "dBm" : ""}</div></div><span class="muted" style="font:16px var(--vt)">${x.rx_mb != null ? Math.round((x.rx_mb || 0) + (x.tx_mb || 0)) + " MB" : ""}</span></div>`).join("")}`).join("")}</div>` : loader("SCANNING LAN")}</section></div>`;
      }
      if (tab === "remote") {
        const r = D("remote"); if (!r) return;
        if (!r.ok) { body.innerHTML = `<div class="empty bad">${esc(r.error || "remote unavailable")}</div>`; return; }
        const port = (k, p, dash) => `<div class="pn c4"><div class="bd"><div class="k">${k}</div><div class="num" style="color:${p && p.online ? "#39e58c" : dash ? "#a7a1b6" : "#ff4d6d"}">${p && p.online ? "●" : "○"} ${esc(p ? p.port : "—")}</div></div></div>`;
        body.innerHTML = `<div class="grid">${port("HBBS · ID SERVER", r.hbbs)}${port("HBBR · RELAY", r.hbbr)}${port("NAT TEST", r.nat, true)}</div>
          <div class="grid" style="margin-top:14px"><section class="pn c12"><div class="hd"><h2><span class="dot"></span>PEERS</h2><small>${esc((r.counts || {}).online ?? 0)} online · ${esc((r.counts || {}).devices ?? 0)} known · OSS: no session telemetry</small></div><div class="list">${(r.devices || []).map((d) => { const on = d.rustdesk_online === true || d.helix_online === true; return `<div class="li"><span class="lamp ${on ? "idle" : "dark"}"></span><div class="grow"><div class="t1">${esc(d.name || d.id)}</div><div class="t2">${esc(d.id)}${d.ip ? " · " + esc(d.ip) : ""}${d.platform ? " · " + esc(d.platform) : ""}</div></div><a class="btn sm" href="${esc(d.launch || "")}">CONNECT</a><button class="btn sm" data-copy="${esc(d.id)}">COPY ID</button></div>`; }).join("") || `<div class="empty">NO PEERS</div>`}</div></section></div>`;
      }
      if (tab === "security") {
        if (!st) return;
        const sec = st.security || {}, items = needsList();
        const snake = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
        body.innerHTML = `<div class="grid"><section class="pn c6"><div class="hd"><h2><span class="dot"></span>hardening.py</h2><small>every check the deck believes</small></div><div class="bd py" style="font:13px/1.5 var(--mono)"><div class="muted">score = <span class="num" style="font-size:30px">${esc(sec.score ?? "—")}</span> / 100</div><div class="muted">checks = {</div>${(sec.findings || []).map((x) => { const lv = String(x.level || "").toLowerCase(); const v = lv === "ok" ? '<span class="ok">PASS</span>' : lv === "high" ? '<span class="bad">HIGH ✗</span>' : lv === "low" ? '<span class="muted">LOW</span>' : '<span class="warn">MED ✗</span>'; return `<div class="r ${lv === "high" ? "high" : lv === "ok" || lv === "low" ? "" : "med"}" title="${esc(x.detail || "")}"><span>${esc(snake(x.title))}</span>${v}</div>`; }).join("")}<div class="muted">}</div></div></section>
          <section class="pn c6 alert"><div class="hd"><h2><span class="dot"></span>NEEDS YOU</h2><small>${items.length} open</small></div><div class="list">${items.map((x) => `<div class="li">${sevTag(x.sev)}<div class="grow"><div class="t1">${esc(x.title)}</div><div class="t2">${esc(x.src)}</div></div></div>`).join("") || `<div class="empty">ALL CLEAR</div>`}</div></section></div>`;
      }
    }
    const un = sub(upd); upd(); return { destroy: un };
  }

  /* ═════════ MEMORY ═════════ */
  function memory(el, arg) {
    const tabs = [["banks", "BANKS"], ["files", "FILES"], ["skills", "SKILLS"]];
    const tab = tabs.some(([k]) => k === (arg || "").split("/")[0]) ? arg.split("/")[0] : "banks";
    let file = "SOUL", q = "", skill = null;
    el.innerHTML = `<div class="pagehd"><div><div class="crumbs"><a href="#/">FLOOR</a> › MEMORY › ${tab.toUpperCase()}</div><h1>MEM<span>ORY</span></h1><p>What Hermes remembers — banks, soul/user/memory files and installed skills. Secrets are redacted server-side.</p></div></div>
      <div class="subtabs">${tabs.map(([k, l]) => `<button class="btn ${k === tab ? "pri" : ""}" data-hash="#/memory/${k}">${l}</button>`).join("")}</div><div id="mm-body">${loader()}</div>`;
    const body = $("#mm-body", el);
    if (tab === "files") el.addEventListener("click", (e) => { const b = e.target.closest("[data-file]"); if (b) { file = b.dataset.file; upd(); } });
    if (tab === "skills") {
      body.innerHTML = `<div class="grid"><section class="pn c5"><div class="toolbar"><input class="input" id="mm-q" placeholder="search skills…" aria-label="Search skills"></div><div class="list" id="mm-sk" style="max-height:620px;overflow:auto">${loader()}</div></section><section class="pn c7"><div class="hd"><h2><span class="dot"></span>SKILL</h2><small id="mm-skn">pick one</small></div><div class="code" id="mm-skb">Select a skill to read its SKILL.md</div></section></div>`;
      $("#mm-q", el).addEventListener("input", (e) => { q = e.target.value.toLowerCase(); upd(); });
      el.addEventListener("click", async (e) => { const b = e.target.closest("[data-skill]"); if (!b) return; skill = b.dataset.skill; $("#mm-skn", el).textContent = skill; $("#mm-skb", el).textContent = "loading…"; try { const d = await X.fetchJSON("/api/skills?name=" + encodeURIComponent(skill)); $("#mm-skb", el).textContent = d.text || d.body || JSON.stringify(d, null, 2); } catch (err) { $("#mm-skb", el).textContent = "failed to load"; } });
    }
    function upd() {
      if (tab === "banks") {
        const m = D("matrix"); if (!m) return;
        const banks = m.banks || [], mx = Math.max(1, ...banks.map((b) => Number(b.bytes) || 0));
        body.innerHTML = `<div class="grid">${banks.map((b) => { const u = num(b.utilization), p = u != null ? Math.min(100, u <= 1 ? u * 100 : u) : 100 * (Number(b.bytes) || 0) / mx; const hot = (u != null && p > 70) || /WARN|FULL|ADVISED|ELEVATED/.test(String(b.pressure || "")); const on = String(b.status || "").toUpperCase() === "ONLINE";
          return `<section class="pn c4"><div class="hd"><h2><span class="dot" style="background:${on ? "#39e58c" : "#ff4d6d"}"></span>${esc(b.name || b.id)}</h2><small>${esc(b.id)}</small></div><div class="bd stack"><div class="num">${u != null ? Math.round(p) + "%" : fmtBytes(b.bytes)}<small>${u != null ? "used" : ""}</small></div><div class="bar"><i style="width:${p.toFixed(1)}%;background:${hot ? "#f59e0b" : "#39e58c"}"></i></div>${row2("STATUS", esc(b.status || "—"))}${b.entries != null ? row2("ENTRIES", esc(b.entries)) : ""}${b.backend ? row2("BACKEND", esc(b.backend)) : ""}${b.pressure ? row2("PRESSURE", esc(b.pressure)) : ""}</div></section>`; }).join("") || `<div class="empty c12">NO MEMORY BANKS</div>`}</div>`;
      }
      if (tab === "files") {
        const m = D("memory"); if (!m) return;
        const files = m.files || [], f2 = files.find((x) => x.name === file) || files[0];
        body.innerHTML = `<section class="pn"><div class="toolbar"><div class="seg">${files.map((x) => `<button data-file="${esc(x.name)}" class="${f2 && x.name === f2.name ? "on" : ""}">${esc(x.name)}</button>`).join("")}</div><span class="muted" style="margin-left:auto;font-size:12px">${f2 ? (f2.missing ? "missing" : fmtBytes(f2.bytes)) : ""}</span></div><div class="code">${f2 ? esc(f2.text || "(empty)") : "no files"}</div></section>`;
      }
      if (tab === "skills") {
        const s = D("skills"); if (!s) return;
        const list = (s.skills || []).filter((x) => !q || (x.name + " " + x.description + " " + x.category).toLowerCase().includes(q));
        $("#mm-sk", el).innerHTML = list.map((x) => `<button class="li" data-skill="${esc(x.id)}" style="background:${skill === x.id ? "#1a1522" : "none"};border:0;border-bottom:1px solid #1d1926;text-align:left;cursor:pointer;color:inherit;width:100%"><div class="grow"><div class="t1">${esc(x.name)} <span class="tag">${esc(x.category || "core")}</span></div><div class="t2 ell">${esc(x.description || "")}</div></div></button>`).join("") || `<div class="empty">NO SKILLS</div>`;
      }
    }
    const un = sub(upd); upd(); return { destroy: un };
  }

  /* ═════════ SETTINGS ═════════ */
  function settings(el) {
    const S = X.SET;
    const seg = (key, opts) => `<div class="seg" role="group" aria-label="${key}">${opts.map(([v, l]) => `<button data-set="${key}" data-val="${v}" class="${S[key] === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
    el.innerHTML = `<div class="pagehd"><div><div class="crumbs"><a href="#/">FLOOR</a> › SETTINGS</div><h1>SET<span>TINGS</span></h1><p>Saved in this browser only.</p></div></div>
      <div class="grid">
        <section class="pn c6"><div class="hd"><h2><span class="dot"></span>DISPLAY</h2></div><div class="bd stack" style="gap:16px">
          <div class="row between" style="flex-wrap:wrap"><div><div class="k">ANIMATION</div><div class="muted" style="font-size:12px">LITE keeps packets but stops idle motion</div></div>${seg("anim", [["full", "FULL"], ["lite", "LITE"], ["off", "OFF"]])}</div>
          <div class="row between" style="flex-wrap:wrap"><div><div class="k">ARCADE SOUND</div><div class="muted" style="font-size:12px">bleeps when packets fly</div></div>${seg("sound", [["off", "OFF"], ["on", "ON"]])}</div>
          <div class="row between" style="flex-wrap:wrap"><div><div class="k">BOOT SCREEN</div><div class="muted" style="font-size:12px">FULL first visit per session, FAST after</div></div>${seg("boot", [["full", "FULL"], ["fast", "FAST"], ["off", "OFF"]])}</div>
          <div class="row" style="flex-wrap:wrap"><button class="btn" id="st-boot">▶ PLAY BOOT AGAIN</button><a class="btn" href="${X.api("/legacy")}">CLASSIC DASHBOARD</a><a class="btn" href="${X.api("/logout")}">LOG OUT</a></div>
        </div></section>
        ${panel("st-about", "ABOUT THIS DECK", "", "c6")}
      </div>`;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-set]"); if (b) { S[b.dataset.set] = b.dataset.val; X.saveSet(); $$(`[data-set="${b.dataset.set}"]`, el).forEach((x) => x.classList.toggle("on", x === b)); X.bleep(990, 0.05); X.toast(b.dataset.set.toUpperCase() + ": " + b.dataset.val.toUpperCase()); }
      if (e.target.closest("#st-boot")) { sessionStorage.removeItem("helix.booted"); location.reload(); }
    });
    function upd() {
      const g = D("git"), st = D("stats");
      $("#st-about", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>ABOUT THIS DECK</h2></div><div class="bd stack">${row2("NODE", "HOS://TKY-06")}${g && g.ok ? row2("BRANCH", esc(g.branch)) + row2("COMMIT", esc(g.head) + " · " + esc(trunc(g.subject || "", 40))) + row2("SYNC", esc(g.sync)) + row2("LOCAL CHANGES", g.dirty ? `<span class="warn">${g.dirty}</span>` : '<span class="ok">clean</span>') : ""}${st ? row2("SCAN TIME", esc(st.collect_ms) + " ms") + row2("SNAPSHOT AGE", esc(st.cache_age_s ?? 0) + " s") : ""}
        <div class="muted" style="font-size:12px;margin-top:6px">Keys: <b class="v">1–7</b> switch pages · <b class="v">Esc</b> closes panels. Every number comes from the live APIs; missing data shows “—” or ${NT}.</div></div>`;
    }
    const un = sub(upd); upd(); return { destroy: un };
  }

  G.HelixPages = { home, mesh: meshPage, agents, trace, systems, memory, settings };
})(window);

/* ═════════ HELIX — avatar + chat terminal ═════════ */
(function (G) {
  "use strict";
  const X = G.Helix;
  const { esc, $, $$, D, trunc, clockOf } = X;
  const KEY = "helix.chat";
  const loadHist = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } };
  const saveHist = (h) => { try { localStorage.setItem(KEY, JSON.stringify(h.slice(-80))); } catch (e) {} };
  const MOOD_LABEL = { calm: "CALM", listening: "LISTENING", thinking: "THINKING", talking: "TALKING", happy: "HAPPY", alert: "ALERT", sleeping: "ASLEEP" };
  const MOOD_COL = { calm: "#22d3ee", listening: "#a78bfa", thinking: "#f59e0b", talking: "#ff4fa3", happy: "#39e58c", alert: "#ff4d6d", sleeping: "#6f6880" };

  const BG_OPTS = [["auto", "AUTO"], ["calm", "SUNBURST"], ["thinking", "CIRCUIT"], ["talking", "PULSE"], ["listening", "EQ"], ["happy", "SPARKLE"], ["alert", "HAZARD"], ["sleeping", "NIGHT"]];
  const BG_KEY = "helix.avatarBg";
  const QUICK = ["status report", "any alerts?", "what are the bots doing?", "summarise today"];
  const hm = (t) => { const d = new Date((t || Date.now() / 1000) * 1000); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };

  function helixPage(el) {
    el.classList.add("hx-page");
    const chat = { hist: loadHist(), waiting: false, streaming: false, speaking: false, typing: false, happyUntil: 0, configured: false, lastDelta: 0, typingT: 0 };
    let bgPick = "auto"; try { bgPick = localStorage.getItem(BG_KEY) || "auto"; } catch (e) {}
    el.innerHTML = `
      <div class="pagehd"><div><div class="crumbs"><a href="#/">FLOOR</a> › HELIX</div><h1>HE<span>LIX</span></h1><p>Direct line to Helix. Her face follows what she's actually doing.</p></div>
        <div class="row"><span class="tag" id="hx-mood">…</span></div></div>
      <div class="grid" style="align-items:start">
        <section class="c8 pn glow mw">
          <div class="mw-bar"><span class="mw-led"></span><b>HELIX.MSG</b><small class="hide-m">// encrypted channel → hermes</small><span class="mw-linkst" id="hx-link">…</span><span class="mw-btns" aria-hidden="true"><i></i><i></i><i></i></span></div>
          <div class="mw-body">
            <aside class="mw-contact">
              <div class="mw-cam"><canvas id="hx-cv" aria-label="Helix avatar"></canvas><span class="mw-live"><i></i>LIVE</span><span class="mw-mtag" id="hx-mtag"></span></div>
              <div class="mw-id">
                <div class="mw-name">HELIX<span>ORCHESTRATOR · HERMES</span></div>
                <div class="mw-pres" id="hx-pres">● connecting…</div>
                <div class="mw-why" id="hx-why" aria-live="polite"></div>
              </div>
              <div class="mw-bgsel"><div class="k">BACKDROP</div><div class="mw-chips" id="hx-bg">${BG_OPTS.map(([k, l]) => `<button type="button" data-bg="${k}" class="${k === bgPick ? "on" : ""}">${l}</button>`).join("")}</div></div>
            </aside>
            <div class="mw-chat">
              <div class="mw-thread" id="hx-out" role="log" aria-live="polite"></div>
              <div class="mw-quick" id="hx-quick">${QUICK.map((q) => `<button type="button">${esc(q)}</button>`).join("")}</div>
              <form class="mw-compose" id="hx-form" autocomplete="off"><span class="ps">&gt;_</span><input class="input" id="hx-in" placeholder="message helix…" aria-label="Message Helix" enterkeyhint="send"><button class="btn pri" id="hx-send" aria-label="Send">SEND ▶</button></form>
            </div>
          </div>
        </section>
        <div class="c4 stack" style="gap:14px">
          <section class="pn" id="hx-status"><div class="hd"><h2><span class="dot"></span>STATUS</h2></div><div class="loader"><div class="blocks"><i></i><i></i><i></i><i></i></div>LOADING_</div></section>
          <section class="pn" id="hx-now"><div class="hd"><h2><span class="dot"></span>RIGHT NOW</h2></div><div class="loader"><div class="blocks"><i></i><i></i><i></i><i></i></div>LOADING_</div></section>
        </div>
      </div>`;
    const mood = () => G.HelixAvatar.moodOf(Object.assign({}, chat, { speaking: Date.now() - chat.lastDelta < 450, chatConfigured: chat.configured }));
    const av = G.HelixAvatar.mount($("#hx-cv", el), { getMood: mood });
    if (bgPick !== "auto") av.setBackground(bgPick);
    $("#hx-bg", el).addEventListener("click", (e) => {
      const b = e.target.closest("button[data-bg]"); if (!b) return;
      bgPick = b.dataset.bg; try { localStorage.setItem(BG_KEY, bgPick); } catch (er) {}
      av.setBackground(bgPick === "auto" ? null : bgPick); X.bleep(880, 0.03);
      $$("#hx-bg button", el).forEach((x) => x.classList.toggle("on", x === b));
    });
    const out = $("#hx-out", el), inp = $("#hx-in", el), form = $("#hx-form", el);

    function bubble(m) {
      if (m.err || m.role === "sys") return `<div class="bb-sys"><span>${esc(m.content)}</span></div>`;
      const mine = m.role === "user";
      const body = m.pending && !m.content ? `<span class="typing"><i></i><i></i><i></i></span>` : esc(m.content) + (m.pending ? '<i class="caret"></i>' : "");
      const face = mine ? "" : `<img class="bb-av" alt="" src="${G.HelixAvatar.face(m.pending ? mood().mood : m.mood || "calm")}">`;
      const meta = mine ? `${hm(m.t)} <b class="${m.read ? "rd" : ""}">✓✓</b>` : `HELIX · ${hm(m.t)}`;
      return `<div class="bb ${mine ? "out" : "in"}">${face}<div class="bb-col"><div class="bb-b">${body}</div><div class="bb-m">${meta}</div></div></div>`;
    }
    function render() {
      const items = chat.hist.length ? chat.hist : [{ role: "sys", content: "Channel open. Say hi to Helix. Messages go to Hermes through the dashboard's chat bridge." }];
      out.innerHTML = `<div class="bb-day"><span>TODAY</span></div>` + items.map(bubble).join("");
      out.scrollTop = out.scrollHeight;
    }
    function moodUI() {
      const m = mood(), col = MOOD_COL[m.mood], lab = MOOD_LABEL[m.mood] || m.mood.toUpperCase();
      const t = $("#hx-mood", el); if (t) { t.textContent = "MOOD · " + lab; t.style.color = col; t.style.borderColor = col; }
      const mt = $("#hx-mtag", el); if (mt) { mt.textContent = lab; mt.style.color = col; mt.style.borderColor = col; }
      const pres = $("#hx-pres", el);
      if (pres) pres.innerHTML = chat.streaming ? `<span class="pink">typing<span class="dots3"></span></span>` : chat.waiting ? `<span style="color:${MOOD_COL.thinking}">thinking<span class="dots3"></span></span>`
        : m.mood === "sleeping" ? `<span class="dim">● away</span>` : `<span class="ok">● online</span>`;
      const w = $("#hx-why", el); if (w) w.textContent = trunc(m.why || "", 90);
    }
    async function status() {
      try {
        const s = await X.fetchJSON("/api/chat", 10000);
        chat.configured = !!s.configured;
        $("#hx-link", el).innerHTML = s.configured ? `<span class="ok">● ${s.mode === "api" ? "API LINK" : "CLI LINK"}</span>` : `<span class="warn">● NO LINK</span>`;
        if (!s.configured && !chat.hist.some((m) => m.setup)) { chat.hist.push({ role: "assistant", err: true, setup: true, content: "Chat isn't connected yet. Give Helix the setup prompt so the dashboard can reach her (HELIX_CHAT_URL or HELIX_CHAT_CMD in ops.env).", t: Date.now() / 1000 }); render(); }
      } catch (e) { $("#hx-link", el).innerHTML = `<span class="bad">● OFFLINE</span>`; }
      moodUI();
    }
    async function send(text) {
      if (text === "/clear") { chat.hist = []; saveHist(chat.hist); render(); return; }
      if (text === "/help") { chat.hist.push({ role: "assistant", err: true, content: "Type a message and press Enter. /clear resets this chat (Helix keeps her own memory).", t: Date.now() / 1000 }); render(); return; }
      const mine = { role: "user", content: text, t: Date.now() / 1000 };
      chat.hist.push(mine);
      const reply = { role: "assistant", content: "", pending: true, t: Date.now() / 1000 };
      chat.hist.push(reply); render(); chat.waiting = true; moodUI(); X.bleep(660, 0.04);
      const msgs = chat.hist.filter((m) => !m.err && !m.pending && m.content).slice(-20).map((m) => ({ role: m.role, content: m.content }));
      $("#hx-send", el).disabled = true;
      let gotError = null;
      try {
        const r = await fetch(X.api("/api/chat"), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ messages: msgs }) });
        if (r.status === 401) { location.href = X.api("/login"); return; }
        if (!r.ok || !r.body) throw new Error(r.status === 429 ? "Helix is busy with another chat — try again in a moment" : "HTTP " + r.status);
        const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
        for (;;) {
          const { value, done } = await rd.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = (chunk.match(/^event: (.+)$/m) || [])[1], dat = (chunk.match(/^data: (.*)$/m) || [])[1];
            let d = {}; try { d = JSON.parse(dat || "{}"); } catch (e) {}
            if (ev === "delta" && d.text) { if (!chat.streaming) { mine.read = true; moodUI(); } chat.waiting = false; chat.streaming = true; chat.lastDelta = Date.now(); reply.content += d.text; render(); }
            else if (ev === "error") gotError = d.error + (d.detail ? " — " + d.detail : "");
          }
        }
      } catch (e) { gotError = e.message; }
      reply.pending = false; chat.waiting = false; chat.streaming = false;
      if (gotError) { reply.mood = "alert"; if (!reply.content) { reply.err = true; reply.content = "⚠ " + gotError; } else reply.content += "\n⚠ " + gotError; }
      else { reply.mood = "happy"; mine.read = true; chat.happyUntil = Date.now() + 6000; X.bleep(1320, 0.08); }
      if (!reply.content) reply.content = "(no reply)";
      saveHist(chat.hist); render(); moodUI(); $("#hx-send", el).disabled = false; inp.focus();
    }
    form.addEventListener("submit", (e) => { e.preventDefault(); const t = inp.value.trim(); if (!t || chat.waiting || chat.streaming) return; inp.value = ""; chat.typing = false; send(t); });
    inp.addEventListener("input", () => { chat.typing = !!inp.value; clearTimeout(chat.typingT); chat.typingT = setTimeout(() => { chat.typing = false; moodUI(); }, 2500); moodUI(); });
    $("#hx-quick", el).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b || chat.waiting || chat.streaming) return; send(b.textContent); });

    function upd() {
      const st = D("stats") || {}, h = st.hermes || {}, tr = D("trace");
      $("#hx-status", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>STATUS</h2><small>${h.gateway_running ? '<span class="ok">● gateway up</span>' : st.hermes ? '<span class="bad">● gateway down</span>' : ""}</small></div><div class="bd stack">
        ${[["MODEL", h.model], ["PROVIDER", h.provider], ["MEMORY", h.memory], ["VERSION", (h.version || "—") + (h.commits_behind ? " · " + h.commits_behind + " behind" : "")], ["CRON JOBS", h.cron_jobs]].map(([k, v]) => `<div class="row between" style="font-size:13px"><span class="k">${k}</span><span class="v">${esc(v ?? "—")}</span></div>`).join("")}
        ${tr ? `<div><div class="k" style="margin-bottom:6px">PIPELINE · LAST REQUEST</div><div class="pipe">${["REQUEST", "INTERPRET", "PLAN", "TOOL", "OBSERVATION", "DECISION", "RESPONSE"].map((k, i, a) => { const lit = (tr.stages || {})[k], last = a.slice().reverse().find((x) => (tr.stages || {})[x]); return `<span class="${lit ? "lit" : ""}${k === last ? " cur" : ""}">${k}</span>`; }).join("")}</div></div>` : ""}</div>`;
      const ev = G.HelixMesh.collectEvents().filter((e) => e.from === "helix" || e.to === "helix").slice(-8).reverse();
      $("#hx-now", el).innerHTML = `<div class="hd"><h2><span class="dot"></span>RIGHT NOW</h2><small>${tr && tr.live ? '<span class="warn">● working</span>' : "idle"}</small></div><div class="bd stack">
        <div><div class="k">${tr && tr.live ? "WORKING ON" : "LAST JOB"}</div><div class="v" style="font-size:15px">${esc((tr && tr.objective) || "—")}</div></div></div>
        <div class="comms" style="max-height:380px">${ev.map((e) => `<div class="msg"><div>${X.sprite(e.from, true, 22)}</div><div style="min-width:0"><div class="who"><span style="color:${X.meta(e.from).acc}">${esc(X.meta(e.from).name)}</span><span class="arr">→</span><span style="color:${X.meta(e.to).acc}">${esc(X.meta(e.to).name)}</span><span class="tag">${esc(String(e.kind).toUpperCase())}</span><span class="t" style="margin-left:auto">${esc(e.t ? clockOf(e.t).slice(0, 8) : "")}</span></div><div class="txt">${esc(e.text)}</div></div></div>`).join("") || `<div class="empty">NO TRAFFIC YET</div>`}</div>`;
      moodUI();
    }
    render(); status(); moodUI();
    const un = (() => { X.store.subs.add(upd); return () => X.store.subs.delete(upd); })(); upd();
    const mt = setInterval(moodUI, 800);
    return { destroy() { un(); clearInterval(mt); av.destroy(); } };
  }

  /* small avatar badge used on HOME */
  function homeBadge(host) {
    host.innerHTML = `<a class="hx-badge" href="#/helix" data-hash="#/helix" aria-label="Talk to Helix"><span class="hx-mini"><canvas></canvas></span><span><span class="k">HELIX</span><span class="v" id="hb-mood">…</span><span class="pink" style="font:10px var(--px)">TALK ▸</span></span></a>`;
    const ctxm = {};
    const av = G.HelixAvatar.mount($("canvas", host), { crop: [8, 2, 32, 32], getMood: () => G.HelixAvatar.moodOf(ctxm) });
    const tick = setInterval(() => { const m = G.HelixAvatar.moodOf(ctxm), e = $("#hb-mood", host); if (e) { e.textContent = (MOOD_LABEL[m.mood] || m.mood); e.style.color = MOOD_COL[m.mood]; } }, 1000);
    return () => { clearInterval(tick); av.destroy(); };
  }

  G.HelixPages.helix = helixPage;
  G.HelixPages._homeBadge = homeBadge;
})(window);
