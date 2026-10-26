/* HELIX/OPS — LIGHTS page: WiZ bulbs grouped by room.
   Drag a bulb onto another room to move it, or onto another bulb to swap the two.
   Touch: press-and-hold a bulb, then drag. Tap a bulb for its controls. */
(function (G) {
  "use strict";
  const X = G.Helix;
  const { esc, $, $$ } = X;
  const SWATCH = [["WARM", null, 2700], ["DAY", null, 4500], ["COOL", null, 6200], ["PINK", [255, 79, 163]], ["CYAN", [34, 211, 238]], ["GREEN", [57, 229, 140]], ["PURPLE", [140, 90, 240]], ["RED", [255, 40, 40]], ["AMBER", [255, 150, 20]]];

  function kelvinRGB(k) {               // rough black-body colour for the bulb glow
    const t = Math.max(1000, Math.min(40000, k || 2700)) / 100;
    const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
    const g = t <= 66 ? 99.47 * Math.log(t) - 161.1 : 288.1 * Math.pow(t - 60, -0.0755);
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5 * Math.log(t - 10) - 305;
    return [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))));
  }
  const glowOf = (d) => (d.rgb ? d.rgb : kelvinRGB(d.temp || 2700));
  const nameOf = (d) => d.label || d.name || d.ip || d.id;
  const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  function bulbSVG(d, size) {
    const on = d.online && d.power, c = on ? glowOf(d) : null, dim = on ? 0.35 + 0.65 * ((d.brightness || 100) / 100) : 1;
    const fill = on ? css(c) : d.online ? "#2a2338" : "#1a1622", edge = on ? "#ffffff" : d.online ? "#6f6880" : "#3a3346";
    return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">
      <path d="M5 1h6v1h1v1h1v5h-1v1h-1v2H5V9H4V8H3V3h1V2h1z" fill="${edge}"/>
      <path d="M5 2h6v1h1v5h-1v1h-1v1H6V9H5V8H4V3h1z" fill="${fill}" opacity="${dim}"/>
      ${on ? `<path d="M6 3h2v1H6zM5 4h1v2H5z" fill="#ffffff" opacity=".8"/>` : ""}
      <path d="M5 11h6v1H5zM6 12h4v1H6zM5 13h6v1H5zM7 14h2v1H7z" fill="${d.online ? "#a7a1b6" : "#4a4458"}"/>
      ${!d.online ? `<path d="M6 4h1v1H6zM9 4h1v1H9zM7 5h2v1H7zM6 6h1v1H6zM9 6h1v1H9z" fill="#ff4d6d"/>` : ""}
    </svg>`;
  }

  function lightsPage(el) {
    el.classList.add("lt-page");
    let snap = null, busy = false, drag = null, timer = null, dead = false;

    async function load() {
      try { snap = await X.fetchJSON("/api/lights", 20000); if (!drag) render(); }
      catch (e) { if (!snap) $("#lt-rooms", el).innerHTML = `<div class="empty">LIGHTS API UNREACHABLE — ${esc(e.message)}</div>`; }
    }
    async function act(body, msg) {
      busy = true; X.bleep(990, 0.03);
      try {
        const r = await fetch(X.api("/api/lights"), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (r.status === 401) { location.href = X.api("/login"); return null; }
        const d = await r.json();
        snap = d; if (!drag) render();
        if (d.ok === false) X.toast("⚠ " + String(d.error || "failed").replace(/_/g, " ")); else if (msg) X.toast(msg);
        return d;
      } catch (e) { X.toast("⚠ " + e.message); return null; }
      finally { busy = false; }
    }

    el.innerHTML = `
      <div class="pagehd"><div><div class="crumbs"><a href="#/">FLOOR</a> › LIGHTS</div><h1>LIG<span>HTS</span></h1><p>WiZ bulbs on your LAN, by room. Drag a bulb to another room to move it, or drop it on another bulb to swap them.</p></div>
        <div class="row lt-acts"><button class="btn sm" id="lt-disc">⟳ DISCOVER</button><button class="btn sm" id="lt-add">+ BY IP</button><button class="btn sm" id="lt-room">+ ROOM</button><button class="btn sm pri" id="lt-off">ALL OFF</button></div></div>
      <div class="lt-stats" id="lt-stats"></div>
      <section class="pn lt-scenes"><div class="hd"><h2><span class="dot"></span>SCENES · ALL ROOMS</h2><small>tap to apply</small></div><div class="bd" id="lt-sc"></div></section>
      <div class="lt-rooms" id="lt-rooms"><div class="loader"><div class="blocks"><i></i><i></i><i></i><i></i></div>SCANNING_</div></div>`;

    function render() {
      if (!snap) return;
      const t = snap.telemetry || {};
      $("#lt-stats", el).innerHTML = [["BULBS", t.devices ?? 0, ""], ["ONLINE", t.online ?? 0, "ok"], ["ON NOW", t.active ?? 0, "pink"], ["OFFLINE", t.offline ?? 0, t.offline ? "bad" : ""], ["LAST SCAN", snap.last_discovery ? String(snap.last_discovery).slice(11, 16) : "—", ""]]
        .map(([k, v, c]) => `<div class="lt-stat"><span class="k">${k}</span><b class="${c}">${esc(v)}</b></div>`).join("") + (snap.enabled === false ? `<div class="lt-stat warn">WIZ_ENABLED is off in ops.env</div>` : "");
      $("#lt-sc", el).innerHTML = (snap.scenes || []).map((s) => {
        const c = s.power === false ? "#3a3346" : css(s.rgb || kelvinRGB(s.temp || 3000));
        return `<button class="lt-scene" data-scene="${esc(s.id)}" style="--sc:${c}"><i></i>${esc(s.name)}</button>`;
      }).join("");
      const devs = {}; (snap.devices || []).forEach((d) => (devs[d.id] = d));
      $("#lt-rooms", el).innerHTML = (snap.groups || []).map((g) => {
        const members = (g.lights || []).map((id) => devs[id]).filter(Boolean);
        const on = members.filter((d) => d.online && d.power);
        const glow = on.length ? css(glowOf(on[0])) : "transparent";
        const una = g.id === "unassigned";
        return `<section class="pn lt-room${una ? " una" : ""}${on.length ? " lit" : ""}" data-group="${esc(g.id)}" style="--glow:${glow}">
          <div class="hd"><h2><span class="dot"></span>${esc(g.name)}</h2>
            <small>${members.length} bulb${members.length === 1 ? "" : "s"}${members.length ? ` · ${on.length} on` : ""}</small>
            ${una ? "" : `<button class="lt-sw${g.power ? " on" : ""}" data-pw="${esc(g.id)}" aria-label="${g.power ? "Turn off" : "Turn on"} ${esc(g.name)}"><i></i></button>`}
            <button class="lt-menu" data-menu="${esc(g.id)}" aria-label="${esc(g.name)} options">⋯</button></div>
          <div class="lt-bulbs">${members.map((d) => `<button class="lt-bulb${d.online ? "" : " off"}${d.online && d.power ? " on" : ""}" data-id="${esc(d.id)}" style="--bc:${d.online && d.power ? css(glowOf(d)) : "transparent"}">
              ${bulbSVG(d, 40)}<span class="nm">${esc(nameOf(d))}</span><span class="st">${!d.online ? "OFFLINE" : d.power ? (d.brightness ?? "—") + "%" : "OFF"}</span></button>`).join("")
            || `<div class="lt-drop">${una ? "New bulbs land here" : "Drop bulbs here"}</div>`}</div>
          ${una || !members.length ? "" : `<div class="lt-ctl"><input type="range" min="10" max="100" step="5" value="${g.brightness || 60}" data-bri="${esc(g.id)}" aria-label="${esc(g.name)} brightness"><span class="v">${g.brightness ?? "—"}%</span>
            <div class="lt-sws">${SWATCH.map(([n, rgb, k]) => `<button title="${n}" data-sw="${esc(g.id)}" data-rgb="${rgb ? rgb.join(",") : ""}" data-k="${k || ""}" style="background:${css(rgb || kelvinRGB(k))}"></button>`).join("")}</div></div>`}
        </section>`;
      }).join("") + `<button class="lt-new" id="lt-new2">+ NEW ROOM</button>`;
      if (!(snap.devices || []).length) $("#lt-rooms", el).insertAdjacentHTML("afterbegin", `<div class="pn lt-empty"><b>NO BULBS FOUND YET</b><p>Turn on <b>Local communication</b> in the WiZ app, keep the bulbs on the same network as this computer, then press DISCOVER, or add one by IP.</p></div>`);
    }

    /* ── sheets ── */
    function bulbSheet(id) {
      const d = (snap.devices || []).find((x) => x.id === id); if (!d) return;
      const groups = snap.groups || [];
      X.openSheet("insp", `<div class="lt-sheet">
        <div class="row" style="gap:12px;align-items:center">${bulbSVG(d, 56)}<div style="min-width:0"><div class="lt-sname">${esc(nameOf(d))}</div><div class="muted" style="font-size:12px">${esc(d.ip || "")} · ${esc(d.model || "WiZ")}${d.rssi != null ? ` · signal ${esc(d.rssi)} dBm` : ""}${d.fw ? ` · fw ${esc(d.fw)}` : ""}</div>
          <div style="font:10px var(--px);margin-top:4px">${d.online ? '<span class="ok">● ONLINE</span>' : '<span class="bad">● OFFLINE</span>'}</div></div></div>
        <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm pri" data-b="toggle">${d.power ? "TURN OFF" : "TURN ON"}</button><button class="btn sm" data-b="identify">✦ BLINK IT</button></div>
        <label class="k">BRIGHTNESS <span class="v" id="lb-bv">${d.brightness ?? "—"}%</span></label><input type="range" min="10" max="100" step="5" value="${d.brightness || 60}" data-b="bri">
        <label class="k">WHITE TEMPERATURE</label><input type="range" class="lt-temp" min="2200" max="6500" step="100" value="${d.temp || 3000}" data-b="temp">
        <label class="k">COLOUR</label><div class="lt-sws big">${SWATCH.filter((s) => s[1]).map(([n, rgb]) => `<button title="${n}" data-b="rgb" data-rgb="${rgb.join(",")}" style="background:${css(rgb)}"></button>`).join("")}<input type="color" data-b="pick" value="#${(d.rgb || [255, 79, 163]).map((v) => v.toString(16).padStart(2, "0")).join("")}" aria-label="Pick colour"></div>
        <label class="k">WIZ SCENE</label><select class="input" data-b="wiz"><option value="">—</option>${(snap.wiz_scenes || []).map((s) => `<option value="${s.id}"${d.scene_id === s.id ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
        <label class="k">NAME</label><form class="row" data-b="name" style="gap:8px"><input class="input" name="n" value="${esc(d.label || "")}" placeholder="${esc(d.name || "e.g. Bedside lamp")}" maxlength="40"><button class="btn sm">SAVE</button></form>
        <label class="k">MOVE TO ROOM</label><div class="row" style="gap:6px;flex-wrap:wrap">${groups.map((g) => `<button class="btn sm${g.id === d.group ? " pri" : ""}" data-b="move" data-g="${esc(g.id)}">${esc(g.name)}</button>`).join("")}</div>
      </div>`);
      const box = $("#inspbody");
      box.onclick = (e) => {
        const b = e.target.closest("[data-b]"); if (!b) return;
        const k = b.dataset.b;
        if (k === "toggle") act({ action: "toggle", id }).then(() => bulbSheet(id));
        if (k === "identify") act({ action: "identify", id }, "Blinking " + nameOf(d));
        if (k === "rgb") act({ action: "color", id, rgb: b.dataset.rgb.split(",").map(Number) });
        if (k === "move") act({ action: "assign", id, group: b.dataset.g }, "Moved to " + b.textContent).then(() => bulbSheet(id));
      };
      box.onchange = (e) => {
        const b = e.target.closest("[data-b]"); if (!b) return;
        const k = b.dataset.b;
        if (k === "bri") act({ action: "brightness", id, value: +b.value });
        if (k === "temp") act({ action: "temperature", id, value: +b.value });
        if (k === "pick") { const h = b.value; act({ action: "color", id, rgb: [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) }); }
        if (k === "wiz" && b.value) act({ action: "wiz_scene", id, value: +b.value });
      };
      box.oninput = (e) => { if (e.target.dataset.b === "bri") { const v = $("#lb-bv"); if (v) v.textContent = e.target.value + "%"; } };
      box.onsubmit = (e) => { e.preventDefault(); const f = e.target; act({ action: "rename", id, name: f.n.value }, "Renamed").then(() => bulbSheet(id)); };
    }
    function roomSheet(gid) {
      const g = (snap.groups || []).find((x) => x.id === gid); if (!g) return;
      const una = gid === "unassigned";
      X.openSheet("insp", `<div class="lt-sheet"><div class="lt-sname">${esc(g.name)}</div>
        ${una ? `<p class="muted">Bulbs that aren't in a room yet. Drag them into a room.</p>` : `
        <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm pri" data-r="on">ALL ON</button><button class="btn sm" data-r="off">ALL OFF</button></div>
        <label class="k">SCENE FOR THIS ROOM</label><div class="row" style="gap:6px;flex-wrap:wrap">${(snap.scenes || []).map((s) => `<button class="btn sm" data-r="scene" data-s="${esc(s.id)}">${esc(s.name)}</button>`).join("")}</div>
        <label class="k">RENAME</label><form class="row" data-r="name" style="gap:8px"><input class="input" name="n" value="${esc(g.name)}" maxlength="40"><button class="btn sm">SAVE</button></form>
        <label class="k">ORDER</label><div class="row" style="gap:6px"><button class="btn sm" data-r="up">▲ MOVE UP</button><button class="btn sm" data-r="down">▼ MOVE DOWN</button></div>
        <label class="k">DELETE</label><button class="btn sm" data-r="del" style="border-color:var(--red);color:var(--red)">DELETE ROOM (bulbs go to Unassigned)</button>`}</div>`);
      const box = $("#inspbody");
      box.onclick = (e) => {
        const b = e.target.closest("[data-r]"); if (!b) return;
        const k = b.dataset.r;
        if (k === "on" || k === "off") act({ action: k, group: gid });
        if (k === "scene") act({ action: "activate_scene", scene: b.dataset.s, group: gid }, b.textContent + " → " + g.name);
        if (k === "up" || k === "down") {
          const ids = (snap.groups || []).map((x) => x.id).filter((x) => x !== "unassigned"), i = ids.indexOf(gid), j = i + (k === "up" ? -1 : 1);
          if (j < 0 || j >= ids.length) return;
          [ids[i], ids[j]] = [ids[j], ids[i]]; act({ action: "order_groups", order: ids });
        }
        if (k === "del") {
          if (b.dataset.sure) { act({ action: "delete_group", group: gid }, "Deleted " + g.name); X.closeSheet(); }
          else { b.dataset.sure = "1"; b.textContent = "TAP AGAIN TO DELETE " + g.name.toUpperCase(); }
        }
      };
      box.onsubmit = (e) => { e.preventDefault(); act({ action: "rename_group", group: gid, name: e.target.n.value }, "Renamed").then(() => X.closeSheet()); };
    }
    function formSheet(title, ph, onok) {
      X.openSheet("insp", `<div class="lt-sheet"><div class="lt-sname">${esc(title)}</div><form class="row" style="gap:8px"><input class="input" name="n" placeholder="${esc(ph)}" maxlength="40" autofocus><button class="btn sm pri">OK</button></form></div>`);
      const box = $("#inspbody"); box.onclick = null; box.onchange = null;
      box.onsubmit = (e) => { e.preventDefault(); const v = e.target.n.value.trim(); if (v) { onok(v); X.closeSheet(); } };
      setTimeout(() => { const i = $("input", box); if (i) i.focus(); }, 60);
    }

    /* ── clicks ── */
    $("#lt-disc", el).onclick = () => { X.toast("Scanning the LAN for WiZ bulbs…"); act({ action: "discover" }, "Scan done"); };
    $("#lt-off", el).onclick = () => act({ action: "all_off" }, "All lights off");
    const newRoom = () => formSheet("NEW ROOM", "e.g. Lounge", (n) => act({ action: "add_group", name: n }, "Added " + n));
    $("#lt-room", el).onclick = newRoom;
    $("#lt-add", el).onclick = () => formSheet("ADD BULB BY IP", "192.168.1.40", (ip) => act({ action: "add", ip }, "Added " + ip));
    el.addEventListener("click", (e) => {
      if (drag && drag.moved) return;
      const sc = e.target.closest("[data-scene]"); if (sc) { act({ action: "activate_scene", scene: sc.dataset.scene }, sc.textContent.trim()); return; }
      const pw = e.target.closest("[data-pw]"); if (pw) { act({ action: pw.classList.contains("on") ? "off" : "on", group: pw.dataset.pw }); return; }
      const mn = e.target.closest("[data-menu]"); if (mn) { roomSheet(mn.dataset.menu); return; }
      const sw = e.target.closest("[data-sw]"); if (sw) { act(sw.dataset.rgb ? { action: "color", group: sw.dataset.sw, rgb: sw.dataset.rgb.split(",").map(Number) } : { action: "temperature", group: sw.dataset.sw, value: +sw.dataset.k }); return; }
      if (e.target.closest("#lt-new2")) { newRoom(); return; }
    });
    el.addEventListener("change", (e) => { const r = e.target.closest("[data-bri]"); if (r) act({ action: "brightness", group: r.dataset.bri, value: +r.value }); });
    el.addEventListener("input", (e) => { const r = e.target.closest("[data-bri]"); if (r && r.nextElementSibling) r.nextElementSibling.textContent = r.value + "%"; });

    /* ── drag & drop (mouse: drag; touch: hold then drag) ── */
    const noScroll = (e) => { if (drag && drag.active) e.preventDefault(); };
    document.addEventListener("touchmove", noScroll, { passive: false });
    el.addEventListener("pointerdown", (e) => {
      const b = e.target.closest(".lt-bulb"); if (!b || e.button > 0) return;
      drag = { id: b.dataset.id, src: b, x: e.clientX, y: e.clientY, active: false, moved: false, touch: e.pointerType !== "mouse", from: b.closest(".lt-room").dataset.group };
      if (drag.touch) drag.hold = setTimeout(() => { if (drag && !drag.moved) start(e.clientX, e.clientY); }, 260);
    });
    function start(x, y) {
      drag.active = true; drag.moved = true;
      const r = drag.src.getBoundingClientRect();
      drag.ox = x - r.left; drag.oy = y - r.top;
      drag.ghost = drag.src.cloneNode(true); drag.ghost.classList.add("lt-ghost");
      drag.ghost.style.width = r.width + "px"; document.body.appendChild(drag.ghost);
      drag.src.classList.add("lt-src"); el.classList.add("lt-dragging");
      if (navigator.vibrate) navigator.vibrate(12);
      X.bleep(520, 0.03); move(x, y);
    }
    function target(x, y) {
      drag.ghost.style.display = "none"; const t = document.elementFromPoint(x, y); drag.ghost.style.display = "";
      if (!t) return {};
      const bulb = t.closest(".lt-bulb"), room = t.closest(".lt-room");
      return { bulb: bulb && bulb !== drag.src && bulb.closest(".lt-room") && bulb.closest(".lt-room").dataset.group !== drag.from ? bulb : null, room };
    }
    function move(x, y) {
      drag.ghost.style.transform = `translate(${x - drag.ox}px, ${y - drag.oy}px) rotate(-4deg)`;
      const { bulb, room } = target(x, y);
      $$(".lt-over", el).forEach((n) => n.classList.remove("lt-over"));
      $$(".lt-swap", el).forEach((n) => n.classList.remove("lt-swap"));
      if (bulb) bulb.classList.add("lt-swap"); else if (room && room.dataset.group !== drag.from) room.classList.add("lt-over");
      drag.over = bulb ? { swap: bulb.dataset.id } : room ? { group: room.dataset.group } : null;
      // auto-scroll near the edges
      const edge = 70; if (y < edge) window.scrollBy(0, -12); else if (y > innerHeight - edge) window.scrollBy(0, 12);
    }
    window.addEventListener("pointermove", onMove);
    function onMove(e) {
      if (!drag) return;
      const dist = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      if (!drag.active) {
        if (dist > 8) { if (drag.touch) { clearTimeout(drag.hold); drag = null; return; } start(e.clientX, e.clientY); }
        return;
      }
      move(e.clientX, e.clientY);
    }
    window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp);
    function onUp(e) {
      if (!drag) return;
      clearTimeout(drag.hold);
      const d = drag;
      if (!d.active) { drag = null; if (e.type === "pointerup") bulbSheet(d.id); return; }
      d.ghost.remove(); el.classList.remove("lt-dragging"); d.src.classList.remove("lt-src");
      $$(".lt-over, .lt-swap", el).forEach((n) => n.classList.remove("lt-over", "lt-swap"));
      setTimeout(() => { drag = null; }, 0);
      if (e.type === "pointercancel" || !d.over) return;
      const nm = (id) => nameOf((snap.devices || []).find((x) => x.id === id) || {});
      if (d.over.swap) act({ action: "swap", id: d.id, with: d.over.swap }, `Swapped ${nm(d.id)} ⇄ ${nm(d.over.swap)}`);
      else if (d.over.group && d.over.group !== d.from) {
        const g = (snap.groups || []).find((x) => x.id === d.over.group);
        $(".lt-bulbs", el.querySelector(`.lt-room[data-group="${CSS.escape(d.over.group)}"]`)).appendChild(d.src);   // optimistic
        act({ action: "assign", id: d.id, group: d.over.group }, `${nm(d.id)} → ${g ? g.name : d.over.group}`);
      }
    }
    load(); timer = setInterval(() => { if (!busy && !drag && !document.hidden) load(); }, 8000);
    return { destroy() { dead = true; clearInterval(timer); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp); document.removeEventListener("touchmove", noScroll); } };
  }

  G.HelixPages = G.HelixPages || {};
  G.HelixPages.lights = lightsPage;
})(window);
