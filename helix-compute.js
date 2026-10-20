/* HELIX COMPUTE pane — /api/compute/status + /api/compute/route. No secrets. */
(function () {
  function p() {
    const path = location.pathname || "/";
    return path.startsWith("/ops") ? "/ops" : "";
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function card(title, rows) {
    return `<div class="hc-card"><div class="ident">${esc(title)}</div>${rows}</div>`;
  }
  function row(k, v) {
    return `<div><span class="dim">${esc(k)}</span> <b>${esc(v)}</b></div>`;
  }
  function onoff(x) {
    return x ? "ONLINE" : "OFFLINE";
  }
  function jobs(list) {
    if (!list || !list.length) return "<div class=\"dim\">—</div>";
    return list.map((j) =>
      `<div>${esc(j.t)} · ${esc(j.target)} · ${esc(j.kind)} · ${esc(j.status)} · ${esc(j.task)}</div>`
    ).join("");
  }
  function paintStatus(d) {
    const cap = document.getElementById("hc-cap");
    const act = document.getElementById("hc-active");
    const meta = document.getElementById("hc-meta");
    const grid = document.getElementById("hc-grid");
    const gpu = document.getElementById("hc-gpu");
    const err = document.getElementById("hc-err");
    if (err) err.textContent = "";
    const mode = (d.mode || "auto").toUpperCase();
    if (cap) cap.textContent = d.ok ? "ONLINE" : "FAULT";
    if (act) act.textContent = "MODE " + mode + " · POLICY " + (d.policy || "BALANCED") + " · v2";
    document.querySelectorAll(".hc-bar [data-pol]").forEach((b) => {
      b.classList.toggle("on", b.dataset.pol === (d.policy || "BALANCED"));
    });
    if (meta) {
      meta.textContent = "ACTIVE MODEL  " + (d.active_model || "—") +
        "  ·  TASK  " + (d.current_task || "—") +
        "  ·  DURATION  " + (d.duration != null ? d.duration + " ms" : "—");
    }
    document.querySelectorAll(".hc-bar [data-ov]").forEach((b) => {
      b.classList.toggle("on", b.dataset.ov === mode);
    });
    const mh = d.mac_hermes || {};
    const uh = d.unraid_hermes || {};
    const ol = d.ollama || {};
    const ho = d.honcho || {};
    const cl = d.cloud || {};
    const bb = d.bigboi || {};
    const nodes = d.nodes || {};
    function nst(k, fallback) {
      return nodes[k] || fallback;
    }
    if (grid) {
      grid.innerHTML =
        card("MAC", row("state", nst("MAC", onoff(mh.online))) + row("lat", (mh.latency != null ? mh.latency + " ms" : "—"))) +
        card("BIGBOI", row("state", nst("BIGBOI", onoff(bb.online))) + row("CPU", bb.cpu != null ? bb.cpu + "%" : "—") + row("RAM", (bb.ram_used != null ? bb.ram_used : "?") + " / " + (bb.ram_total != null ? bb.ram_total : "?") + " GB") + row("load", (bb.load || []).join(" ") || "—") + row("docker", bb.docker && bb.docker.ok ? "up" : "—")) +
        card("UNRAID HERMES", row("state", nst("UNRAID HERMES", onoff(uh.online))) + row("lat", (uh.latency != null ? uh.latency + " ms" : "—"))) +
        card("OLLAMA", row("state", nst("OLLAMA", onoff(ol.online))) + row("models", (ol.models || []).length)) +
        card("CLOUD", row("state", nst("CLOUD", onoff(cl.online))) + row("provider", cl.provider || "—") + row("model", cl.model || "—"));
    }
    if (gpu) {
      const gs = bb.gpus || [];
      gpu.innerHTML = [0, 1, 2, 3].map((i) => {
        const g = gs[i] || {};
        return card("GPU " + i, row("name", g.name || "—") + row("util", g.util || "—") + row("vram", (g.used || "—") + " / " + (g.vram || "—")));
      }).join("");
    }
  }
  async function load() {
    try {
      const r = await fetch(p() + "/api/compute/status", { credentials: "same-origin", cache: "no-store" });
      if (!r.ok) throw new Error("http " + r.status);
      paintStatus(await r.json());
      const h = await fetch(p() + "/api/hcompute", { credentials: "same-origin", cache: "no-store" });
      if (h.ok) {
        const d = await h.json();
        const a = document.getElementById("hc-active-jobs");
        const q = document.getElementById("hc-queued");
        const c = document.getElementById("hc-done");
        if (a) a.innerHTML = jobs(d.active);
        if (q) q.innerHTML = jobs(d.queued);
        if (c) c.innerHTML = jobs(d.completed);
      }
      const jr = await fetch(p() + "/api/compute/jobs", { credentials: "same-origin", cache: "no-store" });
      if (jr.ok) {
        const jd = await jr.json();
        const w = document.getElementById("hc-wait");
        const f = document.getElementById("hc-fail");
        const met = document.getElementById("hc-metrics");
        const pl = document.getElementById("hc-plan");
        const plans = (jd.jobs || []).filter((j) => j.kind === "plan").slice(-1);
        if (pl) {
          const job = plans[0];
          const steps = ((job && job.plan && job.plan.steps) || []);
          pl.innerHTML = job
            ? `<div>${esc(job.task)} · ${esc(job.status)}</div>` + steps.map((s) =>
                `<div>${esc(s.target)}  ${esc(s.action)}  ${esc(s.why || "")}</div>`
              ).join("")
            : "<div class=\"dim\">—</div>";
        }
        if (w) w.innerHTML = (jd.waiting_approval || []).map((j) =>
          `<div>${esc(j.task)} · ${esc(j.status)} · ${esc(j.policy)} <button type="button" data-jid="${esc(j.id)}" data-act="approve">APPROVE</button> <button type="button" data-jid="${esc(j.id)}" data-act="deny">DENY</button></div>`
        ).join("") || "<div class=\"dim\">—</div>";
        if (f) f.innerHTML = jobs(jd.failed);
        const run = document.getElementById("hc-active-jobs");
        if (run && (jd.running || []).length) run.innerHTML = (jd.running || []).map((j) =>
          `<div>TASK ${esc(j.task)} · TARGET ${esc(j.target)} · WORKER ${esc(j.worker)} · ${esc(j.status)} · ${esc(j.duration)} <button type="button" data-jid="${esc(j.id)}" data-act="stop">STOP</button></div>`
        ).join("");
      }
    } catch (e) {
      const err = document.getElementById("hc-err");
      if (err) err.textContent = "compute link down";
    }
  }
  async function postRoute(body) {
    const r = await fetch(p() + "/api/compute/route", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json();
  }
  async function postLegacy(body) {
    const r = await fetch(p() + "/api/hcompute", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json();
  }
  function bind() {
    document.querySelectorAll(".hc-bar [data-ov]").forEach((b) => {
      b.addEventListener("click", async () => {
        await postRoute({ target: String(b.dataset.ov || "auto").toLowerCase(), message: "" });
        load();
      });
    });
    document.querySelectorAll(".hc-bar [data-pol]").forEach((b) => {
      b.addEventListener("click", async () => {
        await fetch(p() + "/api/compute/policy", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ policy: b.dataset.pol }),
        });
        load();
      });
    });
    document.getElementById("hc-route")?.addEventListener("click", async () => {
      const t = document.getElementById("hc-task");
      const task = (t && t.value || "").trim();
      if (!task) return;
      const r = await fetch(p() + "/api/compute/plan", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, execute: true }),
      });
      const d = await r.json();
      const err = document.getElementById("hc-err");
      const job = d.job || d;
      if (err) err.textContent = (job.status || "") + " · " + ((job.explain || job.plan && job.plan.explain) || []).slice(0, 2).join(" / ");
      load();
    });
    document.getElementById("hc-cpu")?.addEventListener("click", () => postLegacy({ action: "run", kind: "identity", task: "cpu identity on bigboi" }).then(load));
    document.getElementById("hc-py")?.addEventListener("click", () => postLegacy({ action: "run", kind: "python", task: "python on bigboi" }).then(load));
    document.getElementById("hc-dk")?.addEventListener("click", () => postLegacy({ action: "run", kind: "docker", task: "Check all Docker containers" }).then(load));
    document.getElementById("pane-compute")?.addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-jid]");
      if (!b) return;
      const id = b.dataset.jid;
      const act = b.dataset.act;
      const url = act === "stop"
        ? p() + "/api/compute/jobs/" + id + "/stop"
        : p() + "/api/compute/jobs/" + id + "/approve";
      const body = act === "deny" ? { allow: false } : { allow: true };
      await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      load();
    });
  }
  globalThis.HelixCompute = { load };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
