/* global HelixBrains, HelixBrainsSim */
(function () {
  const p = () => (typeof OPS === "string" ? OPS : (location.pathname === "/ops" || location.pathname.startsWith("/ops/") ? "/ops" : ""));
  function set(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v == null || v === "" ? "—" : String(v);
  }
  function probe(d) {
    if (!d) return "NO TELEMETRY";
    if (d.ok) return "UP " + (d.http || "") + (d.ms != null ? " " + d.ms + "ms" : "") + (d.version ? " v" + d.version : "");
    return "DOWN" + (d.error ? " " + d.error : "");
  }
  function paint(d) {
    const cap = document.getElementById("hxb-cap");
    const simOn = d.simulation && d.simulation.on;
    const bar = document.getElementById("hxb-simbar");
    if (bar) bar.hidden = !simOn;
    set("hxb-simlab", simOn ? d.simulation.label : "");
    if (cap) cap.textContent = simOn ? "SIM" : (d.ok ? "MONITOR" : "FAULT");
    set("hxb-primary", d.primary);
    set("hxb-standby", d.standby);
    set("hxb-auto", d.policy && d.policy.automatic_failover ? "ON" : "OFF");
    set("hxb-alpha", probe(d.alpha && d.alpha.hermes_api));
    set("hxb-bravo", probe(d.bravo && d.bravo.hermes_api));
    set("hxb-honcho", probe(d.honcho) + (d.honcho && d.honcho.host === "unraid" ? " UNRAID" : ""));
    set("hxb-hhost", (d.honcho && d.honcho.host) ? String(d.honcho.host).toUpperCase() : "UNRAID");
    set("hxb-umbrel", probe(d.umbrel_peer));
    set("hxb-witness", d.witness && d.witness.status);
    set("hxb-fence", d.fencing && d.fencing.status);
    set("hxb-ctrl", d.controller && d.controller.status);
    set("hxb-repl", d.replication && d.replication.status);
    set("hxb-note", (d.policy && d.policy.reason) || "");
    const load = d.alpha && d.alpha.load;
    set("hxb-load", load ? ("load1 " + load.load1 + " / " + load.cpus + "cpu") : "NO TELEMETRY");
    const up = d.alpha && d.alpha.uptime_days;
    set("hxb-uptime", up != null ? up + "d" : "NO TELEMETRY");
    const gw = d.gateway_ownership && d.gateway_ownership.launchd;
    set("hxb-gw", gw && gw.loaded ? ("ALPHA pid " + (gw.pid || "?")) : (gw && gw.state ? String(gw.state) : "LAUNCHD DOWN"));
    const ops = d.ops_persist && d.ops_persist.launchd;
    set("hxb-opsld", ops && ops.loaded ? ("LOADED " + (ops.state || "")) : "NOT LOADED");
    const cv = d.config_compatibility || {};
    set("hxb-ver", (cv.alpha || "?") + " / " + (cv.bravo || "?") + (cv.same ? " MATCH" : " MISMATCH"));
    const bak = d.backup || {};
    set("hxb-bak", bak.status === "PRESENT" ? (bak.age_hours + "h " + bak.path) : (bak.status || "NONE"));
    const rd = d.failover_readiness || {};
    set("hxb-ready", rd.ready ? "YES" : "NO");
    const inc = Array.isArray(d.incidents) ? d.incidents.length : 0;
    set("hxb-inc", String(inc));
    const hb = d.honcho_backup || {};
    set("hxb-hdump", hb.ok ? ((hb.age_hours != null ? hb.age_hours + "h " : "") + (hb.bytes || "") + "B") : "NO TELEMETRY");
    set("hxb-hnas", hb.nas_verified ? "VERIFIED" : (hb.nas_ok ? "PRESENT" : "NO"));
    set("hxb-hrest", hb.restore_test || "unknown");
    set("hxb-hwarn", (hb.warnings && hb.warnings.length) ? hb.warnings.join(",") : "none");
    const labels = {
      alpha_health: "Alpha operational",
      bravo_health: "Bravo operational",
      version_compatibility: "Hermes version compatibility",
      gateway_ownership: "Gateway ownership",
      honcho: "Honcho operational",
      honcho_backup_freshness: "Honcho backup",
      offhost_backup: "Off-host backup",
      isolated_restore: "Isolated restore",
      scheduled_backup: "Scheduled backup",
      memory_failover: "Memory failover",
      witness: "Independent witness",
      quorum: "Quorum",
      fencing: "Fencing",
      lease_controller: "Lease controller",
      standby_config: "Standby configuration",
      failover_testing: "Failover testing",
      failback_tested: "Controlled failback tested",
      automatic_failover: "Automatic failover",
    };
    const chk = document.getElementById("hxb-check");
    if (chk && d.readiness) {
      const ev = d.readiness_evidence || {};
      const rows = Object.keys(labels).map((k) => {
        const st = d.readiness[k] || "unknown";
        const tag = st === "partially_implemented" ? "PARTIAL" : String(st).toUpperCase();
        return "<div><span>" + labels[k] + "</span><span class=\"hxb-s-" + st + "\">" + tag + "</span></div>";
      });
      chk.innerHTML = rows.join("");
      set("hxb-overall", (ev.phase ? ev.phase + " · " : "") + (ev.overall || "NOT READY") + (ev.at ? " · " + ev.at : ""));
    }
  }
  async function load() {
    const cap = document.getElementById("hxb-cap");
    if (cap) cap.textContent = "SCAN";
    try {
      const r = await fetch(p() + "/api/brains", { cache: "no-store" });
      let d = await r.json();
      const sel = document.getElementById("hxb-sim");
      const id = sel && sel.value;
      if (id && globalThis.HelixBrainsSim) d = HelixBrainsSim.apply(d, id);
      paint(d);
    } catch (e) {
      set("hxb-note", "FETCH FAIL");
      if (cap) cap.textContent = "FAULT";
    }
  }
  globalThis.HelixBrains = { load };
  document.addEventListener("DOMContentLoaded", () => {
    const b = document.getElementById("hxb-refresh");
    if (b) b.addEventListener("click", load);
    const sel = document.getElementById("hxb-sim");
    if (sel) sel.addEventListener("change", load);
  });
})();
