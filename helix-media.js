/* global HelixMedia */
(function () {
  const p = () => (typeof OPS === "string" ? OPS : (location.pathname === "/ops" || location.pathname.startsWith("/ops/") ? "/ops" : ""));
  function set(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v == null || v === "" ? "—" : String(v);
  }
  function pie(id, data) {
    const c = document.getElementById(id);
    if (!c || !c.getContext) return;
    const ctx = c.getContext("2d");
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    const entries = Object.entries(data || {});
    const total = entries.reduce((s, [, n]) => s + Number(n || 0), 0);
    if (!total) {
      ctx.fillStyle = "#3a5a3a";
      ctx.fillText("NO FILE METADATA", 8, h / 2);
      return;
    }
    const cols = ["#39ff14", "#f0c040", "#40c0ff", "#ff6b3a", "#c040ff", "#888"];
    let a = -Math.PI / 2;
    entries.forEach(([k, n], i) => {
      const sl = (Number(n) / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 4, a, a + sl);
      ctx.closePath();
      ctx.fillStyle = cols[i % cols.length];
      ctx.fill();
      a += sl;
    });
  }
  function bars(id, data) {
    const el = document.getElementById(id);
    if (!el) return;
    const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!entries.length) { el.textContent = "NO LANGUAGE METADATA"; return; }
    const max = Math.max(...entries.map(([, n]) => Number(n)));
    el.innerHTML = entries.map(([k, n]) => {
      const pct = max ? Math.round((Number(n) / max) * 100) : 0;
      return `<div class="hxmd-bar"><span>${k}</span><i style="width:${pct}%"></i><b>${n}</b></div>`;
    }).join("");
  }
  function svc(name, s) {
    if (!s) return name + " DOWN";
    return name + (s.ok ? " UP " + s.ms + "ms" : " DOWN " + (s.status || s.error || ""));
  }
  async function load() {
    const cap = document.getElementById("hxmd-cap");
    if (cap) cap.textContent = "SCAN";
    try {
      const r = await fetch(p() + "/api/media", { cache: "no-store" });
      const d = await r.json();
      const c = d.counts || {};
      const sv = d.services || {};
      set("hxmd-peer", d.peer_api && d.peer_api.ok ? "UNRAID API UP" : "UNRAID API DOWN");
      set("hxmd-face", d.face || "helix_only");
      set("hxmd-discord", (d.discord && d.discord.gateway) || "—");
      set("hxmd-matrix", d.matrix_homeserver && d.matrix_homeserver.ok ? "HS UP" : "HS DOWN");
      set("hxmd-plex", svc("PLEX", sv.plex));
      set("hxmd-radarr", svc("RADARR", sv.radarr));
      set("hxmd-sonarr", svc("SONARR", sv.sonarr));
      set("hxmd-seerr", svc("SEERR", sv.seerr));
      set("hxmd-prowl", svc("PROWLARR", sv.prowlarr));
      set("hxmd-pm", c.plex_movies);
      set("hxmd-pt", c.plex_tv);
      set("hxmd-rm", c.radarr_movies);
      set("hxmd-rf", c.radarr_files);
      set("hxmd-ss", c.sonarr_series);
      set("hxmd-ef", c.sonarr_episode_files);
      set("hxmd-pend", c.seerr_pending);
      set("hxmd-idx", c.prowlarr_indexers);
      pie("hxmd-pie", d.resolution || {});
      bars("hxmd-lang", d.audio_language || {});
      set("hxmd-note", d.note || "");
      if (cap) cap.textContent = d.ok ? "LIVE" : "FAULT";
    } catch (e) {
      set("hxmd-note", "FETCH FAIL");
      if (cap) cap.textContent = "FAULT";
    }
  }
  globalThis.HelixMedia = { load };
  document.addEventListener("DOMContentLoaded", () => {
    const b = document.getElementById("hxmd-refresh");
    if (b) b.addEventListener("click", load);
  });
})();
