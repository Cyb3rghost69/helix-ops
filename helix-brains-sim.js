/* Helix BRAINS simulation overlay. Display only. Never fetch mutate/restart/promote. */
(function () {
  const SCENARIOS = {
    "alpha-offline": {
      label: "Alpha host failure",
      primary: "alpha (SIM — not elected)",
      standby: "bravo",
      alphaDown: true,
      note: "SIM: host-down path. Promotion blocked — no witness, no fence.",
      block: "witness+fence missing",
    },
    "bravo-offline": {
      label: "Bravo host failure",
      bravoDown: true,
      honchoDown: true,
      note: "SIM: Honcho dies with Unraid. Backups ≠ live memory.",
      block: "memory SPOF",
    },
    "honcho-down": {
      label: "Honcho outage",
      honchoDown: true,
      note: "SIM: memory API down. Do not promote on this signal alone.",
      block: "memory unavailable",
    },
    "witness-none": {
      label: "Witness unavailable",
      witness: "NONE (SIM)",
      note: "SIM: current real architecture. Auto promote forbidden.",
      block: "no quorum",
    },
    "partition": {
      label: "Network partition",
      bravoDown: true,
      honchoDown: true,
      note: "SIM: Alpha view of Bravo/Honcho lost. Ping-only failover forbidden.",
      block: "partition — freeze lease",
    },
    "gateway-fail": {
      label: "Messaging gateway failure",
      gwDown: true,
      note: "SIM: Alpha API may still be up. Do not start Bravo tokens.",
      block: "exclusive poller",
    },
    "alpha-recovery": {
      label: "Alpha recovery",
      note: "SIM: recovered Alpha stays PASSIVE until handover.",
      primary: "bravo (SIM lease — not live)",
      block: "no auto failback",
    },
    "bravo-recovery": {
      label: "Bravo recovery",
      note: "SIM: Bravo worker returns. Primary stays Alpha.",
      block: "none if Alpha still owner",
    },
    "failback-controlled": {
      label: "Controlled failback",
      primary: "bravo (SIM)",
      note: "SIM: both up; failback waits for admin handover.",
      block: "await approval",
    },
    "dual-power": {
      label: "Simultaneous host failure",
      alphaDown: true,
      bravoDown: true,
      honchoDown: true,
      note: "SIM: all leases expire. No tokens until witness issues a lease.",
      block: "no quorum",
    },
    "quorum-loss": {
      label: "Loss of quorum",
      witness: "NONE (SIM)",
      note: "SIM: 2-of-3 cannot be formed. Freeze leadership.",
      block: "quorum",
    },
    "split-brain": {
      label: "Split-brain attempt",
      note: "SIM: dual pollers. Must fence — never run two Telegram consumers.",
      block: "fence required",
      split: true,
    },
  };

  function apply(live, id) {
    const s = SCENARIOS[id];
    if (!s || !live) return live;
    const d = JSON.parse(JSON.stringify(live));
    d.simulation = { on: true, id: id, label: s.label, block: s.block };
    d.policy = d.policy || {};
    d.policy.automatic_failover = false;
    d.policy.reason = "SIMULATION MODE — " + s.note;
    if (s.primary) d.primary = s.primary;
    if (s.standby) d.standby = s.standby;
    if (s.alphaDown && d.alpha && d.alpha.hermes_api) {
      d.alpha.hermes_api = { ok: false, http: 0, error: "SIM", version: null };
      d.alpha.owns_messaging = false;
    }
    if (s.bravoDown && d.bravo && d.bravo.hermes_api) {
      d.bravo.hermes_api = { ok: false, http: 0, error: "SIM", version: null };
    }
    if (s.honchoDown) d.honcho = { ok: false, http: 0, error: "SIM", version: null };
    if (s.witness) d.witness = { status: s.witness, ready: false };
    if (s.gwDown && d.gateway_ownership) {
      d.gateway_ownership.launchd = { loaded: false, pid: null, label: "ai.hermes.gateway", state: "SIM DOWN" };
    }
    if (s.split) d.spof = (d.spof || []).concat(["SIM dual-gateway"]);
    d.failover_readiness = Object.assign({}, d.failover_readiness, { ready: false });
    return d;
  }

  globalThis.HelixBrainsSim = { SCENARIOS, apply };
})();
