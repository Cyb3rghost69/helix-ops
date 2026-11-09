/* HELIX/OPS — TORRENTS page: Prowlarr search, Sonarr/Radarr grab, qBit live list. */
(function (G) {
  "use strict";
  const X = G.Helix;
  const { esc, $, $$, D } = X;

  const fmtSz = (b) => {
    if (b == null) return "—";
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
    return (b / 1073741824).toFixed(2) + " GB";
  };
  const fmtSpd = (bps) => {
    if (!bps) return "—";
    if (bps < 1024) return bps + " B/s";
    if (bps < 1048576) return (bps / 1024).toFixed(0) + " KB/s";
    return (bps / 1048576).toFixed(1) + " MB/s";
  };
  const fmtETA = (s) => {
    if (!s || s >= 8640000) return "—";
    if (s < 60) return s + "s";
    if (s < 3600) return Math.round(s / 60) + "m";
    return Math.round(s / 3600) + "h " + (Math.round((s % 3600) / 60)) + "m";
  };
  const stateClass = (st) => {
    if (!st) return "";
    if (/down|DL/.test(st)) return "tr-down";
    if (/upload|UP/.test(st)) return "tr-up";
    if (/paus|stopped/.test(st)) return "tr-paused";
    if (/error|missingFiles/.test(st)) return "tr-err";
    return "";
  };
  const stateTxt = (t) => {
    const s = t.state || "";
    if (!s) return "—";
    if (/down|DL/.test(s)) return "▼ " + fmtSpd(t.dlspeed) + (t.eta ? " ETA " + fmtETA(t.eta) : "");
    if (/upload|UP/.test(s)) return "▲ " + fmtSpd(t.upspeed) + " ratio " + t.ratio;
    if (/paus|stopped/.test(s)) return "PAUSED";
    if (/error|missing/.test(s)) return "ERROR";
    if (/check/i.test(s)) return "CHECKING…";
    if (/queue/i.test(s)) return "QUEUED";
    return s;
  };

  async function apiPost(body) {
    const r = await fetch(X.api("/api/torrents"), {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 401) { location.href = X.api("/login"); return {}; }
    let d = {};
    try { d = await r.json(); } catch (e) {}
    if (!r.ok && !d.error) d.error = "HTTP " + r.status;
    return d;
  }

  function torrentsPage(el, _arg) {
    el.classList.add("tr-page");
    let snap = null, busy = false, dead = false, timer = null;

    el.innerHTML = `
      <div class="pagehd">
        <div>
          <div class="crumbs"><a href="#/">FLOOR</a> › TORRENTS</div>
          <h1>TOR<span>RENTS</span></h1>
          <p>Prowlarr search · Sonarr/Radarr grab · qBit live queue.</p>
        </div>
        <div class="tr-stats" id="tr-stats"></div>
      </div>

      <section class="pn tr-search-pn">
        <div class="hd"><h2><span class="dot"></span>SEARCH PROWLARR</h2></div>
        <div class="bd">
          <form class="tr-searchbar" id="tr-searchform">
            <input class="input" id="tr-q" placeholder="Search title…" maxlength="200" autocomplete="off" spellcheck="false">
            <button class="btn pri" type="submit">SEARCH</button>
          </form>
          <div id="tr-results" class="tr-results"></div>
        </div>
      </section>

      <section class="pn tr-add-pn">
        <div class="hd"><h2><span class="dot"></span>ADD MAGNET / URL</h2></div>
        <div class="bd">
          <form class="tr-addbar" id="tr-addform">
            <input class="input" id="tr-url" placeholder="magnet:?xt=… or http torrent URL" maxlength="2000" autocomplete="off" spellcheck="false">
            <button class="btn pri" type="submit">ADD</button>
          </form>
        </div>
      </section>

      <section class="pn tr-list-pn">
        <div class="hd"><h2><span class="dot"></span>ACTIVE QUEUE</h2><small id="tr-upd"></small></div>
        <div class="bd" id="tr-list"><div class="loader"><div class="blocks"><i></i><i></i><i></i><i></i></div>LOADING_</div></div>
      </section>`;

    function renderStats(s) {
      if (!s) return;
      const c = s.counts || {};
      const arr = s.arr || {};
      const chips = [
        ["TOTAL", c.n ?? 0, ""],
        ["▼ DL", c.down ?? 0, c.down ? "ok" : ""],
        ["▲ UP", c.up ?? 0, c.up ? "ok" : ""],
        ["PAUSED", c.paused ?? 0, c.paused ? "warn" : ""],
      ];
      const svcs = [
        ["QBIT", s.qbit, s.qbit ? "ok" : "bad"],
        ["SONARR", arr.sonarr, arr.sonarr ? "ok" : "warn"],
        ["RADARR", arr.radarr, arr.radarr ? "ok" : "warn"],
        ["PROWLARR", arr.prowlarr, arr.prowlarr ? "ok" : "warn"],
      ];
      $("#tr-stats", el).innerHTML =
        chips.map(([k, v, c2]) => `<div class="tr-stat"><span class="k">${k}</span><b class="${c2}">${esc(v)}</b></div>`).join("") +
        svcs.map(([k, v, c2]) => `<div class="tr-stat sm"><span class="k">${k}</span><span class="dot ${c2}"></span></div>`).join("");
    }

    function renderList(s) {
      const list = $("#tr-list", el); if (!list) return;
      const items = (s && s.torrents) || [];
      if (!s) { list.innerHTML = `<div class="empty">NO DATA</div>`; return; }
      if (!s.qbit) { list.innerHTML = `<div class="empty">QBITTORRENT UNREACHABLE${s.error ? " — " + esc(s.error) : ""}</div>`; return; }
      if (!items.length) { list.innerHTML = `<div class="empty">QUEUE EMPTY</div>`; return; }
      list.innerHTML = `<div class="tr-tbl">
        ${items.map((t) => `<div class="tr-row ${stateClass(t.state)}" data-hash="${esc(t.hash)}">
          <div class="tr-name ell">${esc(t.name)}</div>
          <div class="tr-meta">
            <span class="tr-pct">${t.progress}%</span>
            <span class="tr-sz">${fmtSz(t.size)}</span>
            ${t.category ? `<span class="tr-cat">${esc(t.category)}</span>` : ""}
            <span class="tr-st">${esc(stateTxt(t))}</span>
          </div>
          <div class="tr-bar"><div class="tr-fill" style="width:${Math.min(100, t.progress)}%"></div></div>
          <div class="tr-acts">
            ${/paus|stopped/.test(t.state || "") ? `<button class="btn sm tr-btn" data-act="resume" data-hash="${esc(t.hash)}">▶ RESUME</button>` : `<button class="btn sm tr-btn" data-act="pause" data-hash="${esc(t.hash)}">‖ PAUSE</button>`}
            <button class="btn sm tr-btn tr-del" data-act="delete" data-hash="${esc(t.hash)}">✕ REMOVE</button>
          </div>
        </div>`).join("")}
      </div>`;
      const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const upd = $("#tr-upd", el); if (upd) upd.textContent = "updated " + now;
    }

    async function load() {
      const cached = D("torrents");
      if (cached) { snap = cached; renderStats(snap); renderList(snap); }
      try {
        const d = await X.fetchJSON("/api/torrents", 15000);
        snap = d; renderStats(snap); renderList(snap);
      } catch (e) {
        if (!snap) { const list = $("#tr-list", el); if (list) list.innerHTML = `<div class="empty">TORRENTS API UNREACHABLE — ${esc(e.message)}</div>`; }
      }
    }

    async function torrentAct(action, hash) {
      if (busy) return;
      busy = true;
      X.bleep && X.bleep(880, 0.025);
      try {
        const d = await apiPost({ action, hashes: hash });
        if (d.error) X.toast("⚠ " + String(d.error).replace(/_/g, " "));
        else X.toast(action.toUpperCase() + " OK");
        await load();
      } catch (e) { X.toast("⚠ " + e.message); }
      finally { busy = false; }
    }

    function renderSearchResults(res) {
      const box = $("#tr-results", el); if (!box) return;
      if (!res) { box.innerHTML = ""; return; }
      if (res.error) { box.innerHTML = `<div class="empty">SEARCH ERROR — ${esc(res.error)}</div>`; return; }
      const hits = (res.results || []);
      if (!hits.length) { box.innerHTML = `<div class="empty">NO RESULTS</div>`; return; }
      box.innerHTML = `<div class="tr-hits">
        ${hits.map((h, i) => `<div class="tr-hit" data-i="${i}">
          <div class="tr-hit-title ell">${esc(h.title)}</div>
          <div class="tr-hit-meta">
            <span class="tr-kind ${esc(h.kind)}">${esc((h.kind || "?").toUpperCase())}</span>
            <span class="tr-idx muted">${esc(h.indexer || "")}</span>
            ${h.seeders != null ? `<span class="tr-seed ok">${esc(h.seeders)} seed</span>` : ""}
            <span class="tr-hsz">${fmtSz(h.size)}</span>
          </div>
          <div class="tr-grab-row">
            ${h.kind === "tv" || h.kind === "movie" ? `<button class="btn sm pri tr-grab" data-i="${i}">⇩ GRAB via ${esc((h.kind === "tv" ? "SONARR" : "RADARR"))}</button>` : `<button class="btn sm tr-grab" data-i="${i}" data-kind="movie">⇩ RADARR</button><button class="btn sm tr-grab" data-i="${i}" data-kind="tv" style="margin-left:4px">⇩ SONARR</button>`}
            ${h.downloadUrl || h.magnetUrl ? `<button class="btn sm tr-addurl" data-i="${i}">+ QBIT DIRECT</button>` : ""}
          </div>
        </div>`).join("")}
      </div>`;

      box.onclick = async (e) => {
        const btn = e.target.closest(".tr-grab, .tr-addurl"); if (!btn) return;
        const i = parseInt(btn.dataset.i, 10);
        const hit = hits[i]; if (!hit) return;
        if (btn.classList.contains("tr-addurl")) {
          const url = hit.downloadUrl || hit.magnetUrl;
          if (!url) { X.toast("No download URL"); return; }
          btn.disabled = true; btn.textContent = "ADDING…";
          const d = await apiPost({ action: "add", urls: url });
          btn.disabled = false; btn.textContent = "+ QBIT DIRECT";
          if (d.error) X.toast("⚠ " + String(d.error).replace(/_/g, " "));
          else { X.toast("Added to qBit"); await load(); }
        } else {
          const kind = btn.dataset.kind || hit.kind;
          btn.disabled = true; btn.textContent = "SENDING…";
          const d = await apiPost({ action: "grab", guid: hit.guid, indexerId: hit.indexerId, title: hit.title, downloadUrl: hit.downloadUrl, magnetUrl: hit.magnetUrl, protocol: hit.protocol, publishDate: hit.publishDate, kind });
          btn.disabled = false; btn.textContent = "⇩ GRAB";
          if (d.error) X.toast("⚠ " + String(d.error).replace(/_/g, " "));
          else X.toast("Sent to " + (d.app || "arr").toUpperCase());
        }
      };
    }

    /* search form */
    $("#tr-searchform", el).onsubmit = async (e) => {
      e.preventDefault();
      const q = ($("#tr-q", el).value || "").trim();
      if (q.length < 2) { X.toast("Query too short"); return; }
      const btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "…";
      const box = $("#tr-results", el); if (box) box.innerHTML = `<div class="loader"><div class="blocks"><i></i><i></i><i></i><i></i></div>SEARCHING_</div>`;
      try {
        const d = await X.fetchJSON("/api/torrents/search?q=" + encodeURIComponent(q), 30000);
        renderSearchResults(d);
      } catch (err) { renderSearchResults({ error: err.message }); }
      finally { btn.disabled = false; btn.textContent = "SEARCH"; }
    };

    /* add form */
    $("#tr-addform", el).onsubmit = async (e) => {
      e.preventDefault();
      const inp = $("#tr-url", el);
      const url = (inp.value || "").trim();
      if (!url) { X.toast("Paste a magnet or torrent URL"); return; }
      const btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "ADDING…";
      try {
        const d = await apiPost({ action: "add", urls: url });
        if (d.error) X.toast("⚠ " + String(d.error).replace(/_/g, " "));
        else { X.toast("Added"); inp.value = ""; await load(); }
      } catch (err) { X.toast("⚠ " + err.message); }
      finally { btn.disabled = false; btn.textContent = "ADD"; }
    };

    /* queue controls */
    el.addEventListener("click", (e) => {
      const btn = e.target.closest(".tr-btn"); if (!btn) return;
      const { act, hash } = btn.dataset;
      if (!act || !hash) return;
      if (act === "delete") {
        if (btn.dataset.sure) { torrentAct("delete", hash); }
        else { btn.dataset.sure = "1"; btn.textContent = "SURE?"; setTimeout(() => { if (btn.isConnected) { delete btn.dataset.sure; btn.textContent = "✕ REMOVE"; } }, 3000); }
      } else {
        torrentAct(act, hash);
      }
    });

    load();
    timer = setInterval(() => { if (!dead && !busy && !document.hidden) load(); }, 7000);
    return { destroy() { dead = true; clearInterval(timer); } };
  }

  G.HelixPages = G.HelixPages || {};
  G.HelixPages.torrents = torrentsPage;
})(window);
