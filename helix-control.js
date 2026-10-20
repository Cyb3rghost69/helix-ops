/* global HelixControl */
(function () {
  const p = () => (typeof OPS === "string" ? OPS : (location.pathname === "/ops" || location.pathname.startsWith("/ops/") ? "/ops" : ""));
  let data = { rooms: [], telemetry: {}, home: "OFFLINE" };
  let err = "";
  let timer = 0;

  function api(path, body) {
    const opt = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {};
    return fetch(p() + path, opt).then((r) => r.json());
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function opts(pairs) {
    return pairs.map((x) => "<option value=\"" + esc(x[0]) + "\">" + esc(x[1]) + "</option>").join("");
  }
  function drawPrefs(list) {
    const box = document.getElementById("hx-prefs");
    if (!box) return;
    const rows = list || [];
    if (!rows.length) {
      box.innerHTML = "<div class=\"dim\">NO STORED PREFERENCES</div>";
      return;
    }
    box.innerHTML = rows.map((r) => {
      const keyLabel = r.key === "colour" ? "COLOUR" : String(r.key || "").toUpperCase();
      const extra = r.when && r.when !== "always" ? "  " + esc(String(r.when).toUpperCase()) : "";
      let extraOpts = "";
      if (r.key === "colour") extraOpts = opts([["purple","PURPLE"],["blue","BLUE"],["red","RED"],["green","GREEN"],["pink","PINK"]]);
      if (r.key === "brightness") extraOpts = opts([["20","20%"],["30","30%"],["50","50%"],["80","80%"],["100","100%"]]);
      if (r.key === "policy") extraOpts = opts([["FAST","FAST"],["BALANCED","BALANCED"],["LOCAL-FIRST","LOCAL-FIRST"]]);
      return "<article class=\"hx-card\" data-pref=\"" + esc(r.id) + "\">"
        + "<div class=\"ident\">" + esc(r.target_label || r.target) + "</div>"
        + "<div>" + esc(keyLabel) + "  " + esc(String(r.value).toUpperCase()) + extra + "</div>"
        + "<div class=\"hx-bar\"><select data-edit=\"" + esc(r.id) + "\" data-key=\"" + esc(r.key) + "\" aria-label=\"edit\">"
        + "<option value=\"\">EDIT</option>" + extraOpts + "</select>"
        + "<button type=\"button\" data-forget=\"" + esc(r.id) + "\">FORGET</button></div></article>";
    }).join("");
    box.querySelectorAll("button[data-forget]").forEach((b) => {
      b.addEventListener("click", () => {
        api("/api/prefs", { action: "delete", id: b.getAttribute("data-forget") }).then(load);
      });
    });
    box.querySelectorAll("select[data-edit]").forEach((s) => {
      s.addEventListener("change", () => {
        const v = s.value;
        if (!v) return;
        const id = s.getAttribute("data-edit");
        const key = s.getAttribute("data-key");
        const row = (list || []).find((x) => x.id === id) || {};
        api("/api/prefs", { action: "set", class: row.class, target: row.target, key: key, value: v, when: row.when, explicit: true }).then(load);
        s.selectedIndex = 0;
      });
    });
  }
  function load() {
    api("/api/home").then((d) => {
      data = d || {};
      err = d && d.error ? d.error : "";
      draw();
    }).catch(() => {
      err = "HOME CONTROL UNAVAILABLE";
      draw();
    });
    api("/api/prefs").then((d) => {
      drawPrefs((d && d.preferences) || []);
    }).catch(() => drawPrefs([]));
  }
  function act(body) {
    return api("/api/home", body).then((d) => {
      err = (d && (d.speak || d.error || d.status)) || "";
      return load();
    }).catch(() => {
      err = "HOME CONTROL UNAVAILABLE";
      draw();
    });
  }
  function draw() {
    const st = document.getElementById("hx-state");
    const grid = document.getElementById("hx-grid");
    const note = document.getElementById("hx-err");
    const ha = document.getElementById("hx-ha");
    if (st) st.textContent = "HOME  " + (data.home || (data.ok ? "ONLINE" : "OFFLINE"));
    if (ha) ha.textContent = "HOME ASSISTANT  " + (data.home_assistant || "not configured") + "  ·  PLATFORM  WIZ";
    if (note) note.textContent = err || "";
    const rooms = data.rooms || [];
    if (grid) {
      grid.innerHTML = rooms.map((r) => {
        const id = esc(r.id);
        return `<article class="hx-card" data-room="${id}">
          <div class="ident">${esc(r.label || r.name)}</div>
          <div><b>${esc(r.state || (r.online ? "ONLINE" : "OFFLINE"))}</b></div>
          <div class="dim">LIGHTS ${r.lights ?? "—"} · ONLINE ${r.online ?? "—"} · ON ${r.power_on ?? "—"}</div>
          <div class="hx-bar">
            <button type="button" data-room="${id}" data-act="on">ON</button>
            <button type="button" data-act="off" data-room="${id}">OFF</button>
            <select data-room="${id}" data-act="brightness" aria-label="brightness">
              <option value="">BRIGHTNESS</option>
              ${[20,30,50,80,100].map((n) => `<option value="${n}"${Number(r.brightness)===n?" selected":""}>${n}%</option>`).join("")}
            </select>
            <select data-room="${id}" data-act="colour" aria-label="colour">
              <option value="">COLOUR</option>
              ${[["purple","PURPLE"],["blue","BLUE"],["red","RED"],["green","GREEN"],["pink","PINK"]].map(([v,l]) => `<option value="${v}"${String(r.colour||"").toLowerCase()===v?" selected":""}>${l}</option>`).join("")}
            </select>
          </div>
        </article>`;
      }).join("") || "<div class=\"dim\">NO ROOMS</div>";
      grid.querySelectorAll("button[data-act]").forEach((b) => {
        b.addEventListener("click", () => {
          const room = b.getAttribute("data-room");
          const a = b.getAttribute("data-act");
          act({ capability: a === "on" ? "home.room.lights.on" : "home.room.lights.off", room });
        });
      });
      grid.querySelectorAll("select[data-act]").forEach((s) => {
        s.addEventListener("change", () => {
          const room = s.getAttribute("data-room");
          const a = s.getAttribute("data-act");
          const v = s.value;
          if (!v) return;
          if (a === "brightness") act({ capability: "home.room.lights.brightness", room, brightness: Number(v) });
          if (a === "colour") act({ capability: "home.room.lights.colour", room, colour: v });
        });
      });
    }
  }
  function boot() {
    const pane = document.getElementById("pane-control");
    if (!pane) return;
    load();
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (!document.getElementById("pane-control")?.hidden) load();
    }, 8000);
    document.getElementById("hx-refresh")?.addEventListener("click", load);
    document.getElementById("hx-alloff")?.addEventListener("click", () => act({ capability: "home.scene.apply", scene: "all-lights-off" }));
    document.getElementById("hx-night")?.addEventListener("click", () => act({ capability: "home.scene.apply", scene: "good-night" }));
    document.getElementById("hx-movie")?.addEventListener("click", () => act({ capability: "home.scene.apply", scene: "movie" }));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  globalThis.HelixControl = { load, cli(text) {
    return api("/api/home", { text, dry_run: false }).then((d) => d.speak || d.error || d.status || "HOME");
  } };
})();
