/* global HelixLights */
(function () {
  const p = () => (typeof OPS === "string" ? OPS : (location.pathname === "/ops" || location.pathname.startsWith("/ops/") ? "/ops" : ""));
  let data = { devices: [], groups: [], scenes: [], telemetry: {} };
  let err = "";
  let timer = 0;

  function api(path, body) {
    const opt = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {};
    return fetch(p() + path, opt).then((r) => r.json());
  }
  function send(body) {
    const prev = data;
    return api("/api/lights", body).then((d) => {
      data = d;
      err = d.error || "";
      draw();
      return d;
    }).catch(() => {
      data = prev;
      err = "network";
      draw();
    });
  }
  function rgbCss(rgb) {
    if (!rgb || rgb.length < 3) return "transparent";
    const a = 0.45;
    return `rgba(${rgb[0]|0},${rgb[1]|0},${rgb[2]|0},${a})`;
  }
  function hexOf(rgb) {
    if (!rgb || rgb.length < 3) return "#7cff7a";
    const h = (n) => ("0" + Math.max(0, Math.min(255, n|0)).toString(16)).slice(-2);
    return "#" + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
  }
  function card(d) {
    const online = !!d.online;
    const on = !!d.power;
    const dim = d.brightness == null ? "—" : d.brightness + "%";
    const scene = d.scene || (d.scene_id != null ? "S" + d.scene_id : "—");
    const groups = (data.groups || []).map((g) => `<option value="${g.id}" ${g.id === d.group ? "selected" : ""}>${g.name}</option>`).join("");
    const wiz = (data.wiz_scenes || []).map((s) => `<option value="${s.id}" ${s.id === d.scene_id ? "selected" : ""}>${s.name}</option>`).join("");
    return `<article class="lt-card ${online ? "" : "offline"}" data-id="${d.id}">
      <div><span class="lt-led ${online ? (on ? "on" : "off") : "off"}"></span><span class="nm">${d.name || d.ip || d.id}</span>
        <span class="lt-swatch" style="background:${rgbCss(d.rgb)}"></span></div>
      <div class="meta">${online ? "ONLINE" : "OFFLINE"} · ${d.ip || "—"} · ${dim} · ${d.temp ? d.temp + "K" : "—"} · ${scene}</div>
      <div class="lt-bar">
        <button type="button" data-act="on">ON</button>
        <button type="button" data-act="off">OFF</button>
        <button type="button" data-act="toggle">TOGGLE</button>
      </div>
      <label class="meta">BRIGHT ${dim}<input type="range" min="10" max="100" value="${d.brightness || 10}" data-act="brightness" ${online ? "" : "disabled"}></label>
      <div class="lt-bar">
        <input type="color" value="${hexOf(d.rgb)}" data-act="color" ${online ? "" : "disabled"} aria-label="colour">
        <input type="range" min="2200" max="6500" step="100" value="${d.temp || 2700}" data-act="temperature" ${online ? "" : "disabled"} aria-label="kelvin">
        <select data-act="wiz_scene">${wiz}</select>
      </div>
      <details>
        <summary class="meta">DEVICE INFO</summary>
        <div class="lt-kv">
          <b>ID</b><span>${d.id}</span>
          <b>MAC</b><span>${d.mac || "—"}</span>
          <b>MODEL</b><span>${d.model || "—"}</span>
          <b>RSSI</b><span>${d.rssi == null ? "—" : d.rssi + " dBm"}</span>
          <b>FW</b><span>${d.fw || "—"}</span>
          <b>SEEN</b><span>${d.last_seen || "—"}</span>
          <b>ROOM</b><span><select data-act="assign">${groups}</select></span>
        </div>
      </details>
    </article>`;
  }
  function draw() {
    const t = data.telemetry || {};
    const tele = document.getElementById("lt-tele");
    if (tele) {
      tele.innerHTML = [
        ["DEVICES", t.devices ?? "—"],
        ["ONLINE", t.online ?? "—"],
        ["OFFLINE", t.offline ?? "—"],
        ["ACTIVE", t.active ?? "—"],
        ["LAST SCAN", t.last_discovery || "—"],
      ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join("");
    }
    const cap = document.getElementById("lt-cap");
    if (cap) cap.textContent = `LIGHTING NETWORK · ${t.online || 0}/${t.devices || 0} ONLINE`;
    const sc = document.getElementById("lt-scenes");
    if (sc) {
      sc.innerHTML = (data.scenes || []).map((s) => `<button type="button" data-scene="${s.id}">${s.name}</button>`).join("");
    }
    const rooms = document.getElementById("lt-rooms");
    if (rooms) {
      rooms.innerHTML = (data.groups || []).map((g) => {
        const members = (data.devices || []).filter((d) => d.group === g.id);
        return `<details class="lt-room" open>
          <summary>${g.name} <span class="meta">${g.online || 0}/${g.count || 0} ONLINE · ${g.power ? "ON" : "OFF"} · ${g.brightness == null ? "—" : g.brightness + "%"}</span></summary>
          <div class="lt-bar">
            <button type="button" data-g="${g.id}" data-act="on">ALL ON</button>
            <button type="button" data-g="${g.id}" data-act="off">ALL OFF</button>
            <label class="meta">GROUP BRIGHT<input type="range" min="10" max="100" value="${g.brightness || 50}" data-g="${g.id}" data-act="brightness"></label>
          </div>
          <div class="lt-grid">${members.map(card).join("") || "<p class='empty'>no fixtures_</p>"}</div>
        </details>`;
      }).join("");
    }
    const e = document.getElementById("lt-err");
    if (e) e.textContent = err ? String(err) : "";
  }
  function bind() {
    const root = document.getElementById("pane-lights");
    if (!root) return;
    root.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.id === "lt-discover") { send({ action: "discover" }); return; }
      if (b.id === "lt-alloff") { send({ action: "all_off" }); return; }
      if (b.id === "lt-add") {
        const ip = (document.getElementById("lt-ip") || {}).value;
        send({ action: "add", ip });
        return;
      }
      if (b.dataset.scene) { send({ action: "activate_scene", scene: b.dataset.scene, group: b.dataset.g }); return; }
      const cardEl = b.closest("[data-id]");
      const g = b.dataset.g;
      const act = b.dataset.act;
      if (act && g && !cardEl) { send({ action: act, group: g }); return; }
      if (act && cardEl) { send({ action: act, id: cardEl.dataset.id }); }
    });
    root.addEventListener("change", (ev) => {
      const el = ev.target;
      if (!(el instanceof HTMLElement)) return;
      const act = el.dataset.act;
      if (!act) return;
      const cardEl = el.closest("[data-id]");
      const g = el.dataset.g;
      if (act === "assign" && cardEl) { send({ action: "assign", id: cardEl.dataset.id, group: el.value }); return; }
      if (act === "brightness") {
        const v = Number(el.value);
        if (g) send({ action: "brightness", group: g, value: v });
        else if (cardEl) send({ action: "brightness", id: cardEl.dataset.id, value: v });
        return;
      }
      if (act === "temperature" && cardEl) { send({ action: "temperature", id: cardEl.dataset.id, value: Number(el.value) }); return; }
      if (act === "wiz_scene" && cardEl) { send({ action: "wiz_scene", id: cardEl.dataset.id, value: Number(el.value) }); return; }
      if (act === "color" && cardEl) {
        const hex = el.value.replace("#", "");
        const rgb = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
        send({ action: "color", id: cardEl.dataset.id, rgb });
      }
    });
  }
  function poll() {
    api("/api/lights").then((d) => { data = d; err = ""; draw(); }).catch(() => {});
  }
  globalThis.HelixLights = {
    mount() {
      bind();
      poll();
      clearInterval(timer);
      timer = setInterval(poll, 8000);
    },
  };
})();
