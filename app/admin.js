/* HELIX/OPS — ADMIN page: users, roles, sessions, audit log, security, my account. */
(function (G) {
  "use strict";
  const X = G.Helix;
  const { esc, $, $$ } = X;
  const ROLE_COL = { admin: "var(--pink)", operator: "var(--cyan, #22d3ee)", viewer: "var(--dim)" };
  const EV_COL = { login: "ok", setup: "ok", logout: "", login_failed: "bad", login_blocked: "bad", locked: "bad", password_change_failed: "bad", user_deleted: "warn", user_disabled: "warn", password_reset: "warn", sessions_revoked: "warn", session_revoked: "warn" };
  const ago = (iso) => { if (!iso) return "never"; const s = (Date.now() - new Date(iso.replace(" ", "T")).getTime()) / 1000; return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago"; };
  const dev = (ua) => { ua = ua || ""; const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : ua ? "device" : "—"; const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : /curl/.test(ua) ? "curl" : ""; return br ? br + " · " + os : os; };

  async function post(path, body) {
    const r = await fetch(X.api(path), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 401) { location.href = X.api("/login"); return {}; }
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (!r.ok && !d.error) d.error = "HTTP " + r.status;
    return d;
  }

  function adminPage(el, arg) {
    el.classList.add("ad-page");
    let me = null, data = null, tab = arg || "users", timer = null;
    el.innerHTML = `<div class="pagehd"><div><div class="crumbs"><a href="#/">FLOOR</a> › ADMIN</div><h1>AD<span>MIN</span></h1><p id="ad-sub">Accounts, sessions and the security log.</p></div>
      <div class="row" style="gap:8px"><span class="tag" id="ad-me">…</span><a class="btn sm" href="${X.api("/logout")}">⏻ SIGN OUT</a></div></div>
      <div id="ad-warn"></div>
      <div class="ad-tabs" id="ad-tabs" role="tablist"></div>
      <div id="ad-body"><div class="loader"><div class="blocks"><i></i><i></i><i></i><i></i></div>LOADING_</div></div>`;

    async function load() {
      try {
        me = await X.fetchJSON("/api/me", 10000);
        if (me.role === "admin") data = await X.fetchJSON("/api/admin", 10000);
        render();
      } catch (e) { $("#ad-body", el).innerHTML = `<div class="empty">ADMIN API UNREACHABLE — ${esc(e.message)}</div>`; }
    }
    function tabs() {
      const list = me.role === "admin" ? [["users", "USERS"], ["sessions", "SESSIONS"], ["audit", "SECURITY LOG"], ["security", "SECURITY"], ["account", "MY ACCOUNT"]] : [["account", "MY ACCOUNT"]];
      if (!list.some((t) => t[0] === tab)) tab = list[0][0];
      $("#ad-tabs", el).innerHTML = list.map(([k, l]) => `<button role="tab" class="${k === tab ? "on" : ""}" data-tab="${k}">${l}${k === "sessions" && data ? ` <b>${data.sessions.length}</b>` : k === "users" && data ? ` <b>${data.users.length}</b>` : k === "security" && data && data.lockouts.length ? ` <b class="bad">${data.lockouts.length}</b>` : ""}</button>`).join("");
    }
    function render() {
      $("#ad-me", el).innerHTML = `${esc(me.user || "—")} · <span style="color:${ROLE_COL[me.role] || "#fff"}">${esc((me.role || "").toUpperCase())}</span>`;
      const warns = [];
      if (me.auth_open) warns.push("Login is OFF (HELIX_OPS_AUTH=off in ops.env) — anyone who can reach this page is treated as admin. Remove that line to turn login back on.");
      if (data && !data.https && !/^(localhost|127\.)/.test(location.hostname)) warns.push("You're on plain HTTP. Use the Tailscale HTTPS address so passwords and cookies are encrypted in transit.");
      $("#ad-warn", el).innerHTML = warns.map((w) => `<div class="ad-warn">⚠ ${esc(w)}</div>`).join("");
      tabs();
      const body = $("#ad-body", el);
      if (tab === "users") body.innerHTML = users();
      if (tab === "sessions") body.innerHTML = sessions();
      if (tab === "audit") body.innerHTML = audit();
      if (tab === "security") body.innerHTML = security();
      if (tab === "account") body.innerHTML = account();
    }

    function users() {
      const u = data.users;
      return `<section class="pn"><div class="hd"><h2><span class="dot"></span>USERS</h2><small>${u.length} account${u.length === 1 ? "" : "s"}</small><button class="btn sm pri" data-a="add" style="margin-left:10px">+ ADD USER</button></div>
        <div class="ad-users">${u.map((x) => `<div class="ad-user${x.disabled ? " dis" : ""}">
          <div class="ad-av" style="--rc:${ROLE_COL[x.role]}">${esc(x.username.slice(0, 2).toUpperCase())}</div>
          <div class="ad-uinfo"><div class="ad-un">${esc(x.username)}${x.username === data.me ? ' <span class="ad-you">YOU</span>' : ""}</div>
            <div class="ad-meta">${x.disabled ? '<span class="bad">● DISABLED</span>' : x.sessions ? `<span class="ok">● ${x.sessions} SIGNED IN</span>` : '<span class="dim">● OFFLINE</span>'}${x.must_change ? ' · <span class="warn">MUST SET PASSWORD</span>' : ""}</div>
            <div class="ad-meta">last login ${esc(ago(x.last_login))}${x.last_ip ? " · " + esc(x.last_ip) : ""} · created ${esc((x.created || "").slice(0, 10))}</div></div>
          <select class="input ad-role" data-role="${esc(x.username)}" aria-label="Role for ${esc(x.username)}">${Object.keys(data.roles).map((r) => `<option value="${r}"${r === x.role ? " selected" : ""}>${r.toUpperCase()}</option>`).join("")}</select>
          <div class="ad-acts">
            <button class="btn sm" data-a="reset" data-u="${esc(x.username)}">RESET PW</button>
            <button class="btn sm" data-a="logout" data-u="${esc(x.username)}"${x.sessions ? "" : " disabled"}>SIGN OUT</button>
            <button class="btn sm" data-a="${x.disabled ? "enable" : "disable"}" data-u="${esc(x.username)}">${x.disabled ? "ENABLE" : "DISABLE"}</button>
            <button class="btn sm ad-del" data-a="delete" data-u="${esc(x.username)}">DELETE</button>
          </div></div>`).join("")}</div></section>
        <section class="pn" style="margin-top:14px"><div class="hd"><h2><span class="dot"></span>ROLES</h2></div><div class="bd stack">${Object.entries(data.roles).map(([r, d]) => `<div class="row" style="gap:10px"><span class="tag" style="color:${ROLE_COL[r]};border-color:${ROLE_COL[r]};min-width:92px;justify-content:center">${r.toUpperCase()}</span><span class="muted">${esc(d)}</span></div>`).join("")}</div></section>`;
    }
    function sessions() {
      return `<section class="pn"><div class="hd"><h2><span class="dot"></span>SIGNED-IN DEVICES</h2><small>idle ${data.policy.idle_hours} h or ${data.policy.max_days} days max, then sign-in again</small></div>
        <div class="ad-list">${data.sessions.map((s) => `<div class="ad-row"><div><b>${esc(s.user)}</b> <span class="tag" style="color:${ROLE_COL[s.role]};border-color:${ROLE_COL[s.role]}">${esc(s.role.toUpperCase())}</span>${s.sid === data.my_sid ? ' <span class="ad-you">THIS DEVICE</span>' : ""}</div>
          <div class="muted">${esc(dev(s.ua))} · ${esc(s.ip || "—")} · signed in ${esc(ago(new Date(s.created * 1000).toISOString()))} · active ${esc(s.idle_s < 60 ? "now" : ago(new Date((s.seen) * 1000).toISOString()))}</div>
          <button class="btn sm" data-a="revoke" data-sid="${esc(s.sid)}">${s.sid === data.my_sid ? "SIGN OUT" : "REVOKE"}</button></div>`).join("") || `<div class="empty">NO SESSIONS</div>`}</div></section>`;
    }
    function audit() {
      return `<section class="pn"><div class="hd"><h2><span class="dot"></span>SECURITY LOG</h2><small>last ${data.audit.length} events · helix-auth-audit.jsonl</small></div>
        <div class="ad-list ad-audit">${data.audit.map((a) => `<div class="ad-ev"><span class="t">${esc((a.t || "").replace("T", " ").slice(5, 16))}</span><span class="ev ${EV_COL[a.event] || ""}">${esc(a.event.replace(/_/g, " ").toUpperCase())}</span><span>${esc(a.user || "—")}${a.target ? " → " + esc(a.target) : ""}${a.role ? " (" + esc(a.role) + ")" : ""}</span><span class="muted">${esc(a.ip || "")}${a.reason ? " · " + esc(a.reason) : ""}${a.note ? " · " + esc(a.note) : ""}</span></div>`).join("") || `<div class="empty">NOTHING LOGGED YET</div>`}</div></section>`;
    }
    function security() {
      const p = data.policy;
      const rows = [["Password storage", `${p.hash} hash with a unique salt — the password itself is never stored`], ["Minimum password", `${p.min_password} characters, not common, not containing the username`],
        ["Guessing protection", `${p.lock_after} wrong tries locks that address (and 10 locks the username) for ${p.lock_minutes} min`], ["Sessions", `random 256-bit cookie, HttpOnly + SameSite${data.https ? " + Secure" : ""}; idle ${p.idle_hours} h, max ${p.max_days} days`],
        ["Cross-site requests", "POSTs from other sites are refused (Origin check)"], ["Clickjacking", "page can't be framed (X-Frame-Options / CSP)"], ["Transport", data.https ? '<span class="ok">HTTPS (Tailscale)</span>' : '<span class="warn">HTTP on this connection</span>']];
      return `<section class="pn"><div class="hd"><h2><span class="dot"></span>LOCKED OUT</h2><small>${data.lockouts.length || "none"}</small></div>
        <div class="ad-list">${data.lockouts.map((l) => `<div class="ad-row"><div><b>${esc(l.who)}</b> <span class="tag">${esc(l.scope.toUpperCase())}</span></div><div class="muted">${Math.ceil(l.seconds / 60)} min left</div><button class="btn sm" data-a="unlock" data-key="${esc(l.key)}">UNLOCK</button></div>`).join("") || `<div class="empty">NOBODY IS LOCKED OUT</div>`}</div></section>
        <section class="pn" style="margin-top:14px"><div class="hd"><h2><span class="dot"></span>PROTECTIONS</h2></div><div class="bd stack">${rows.map(([k, v]) => `<div class="ad-kv"><span class="k">${esc(k.toUpperCase())}</span><span>${v}</span></div>`).join("")}</div></section>`;
    }
    function account() {
      return `<section class="pn ad-acct"><div class="hd"><h2><span class="dot"></span>MY ACCOUNT</h2><small>${esc(me.user || "")}${me.pw_changed ? " · password changed " + esc(ago(me.pw_changed)) : ""}</small></div>
        <form class="bd stack" id="ad-pw" autocomplete="on"><input type="text" name="username" value="${esc(me.user || "")}" autocomplete="username" hidden>
          <label class="k">CURRENT PASSWORD<input class="input" type="password" name="cur" autocomplete="current-password" required></label>
          <label class="k">NEW PASSWORD<input class="input" type="password" name="n1" autocomplete="new-password" minlength="10" required></label>
          <label class="k">CONFIRM NEW PASSWORD<input class="input" type="password" name="n2" autocomplete="new-password" minlength="10" required></label>
          <div class="muted" style="font-size:12.5px">Changing it signs out your other devices.</div>
          <div class="row" style="gap:8px"><button class="btn pri">SAVE PASSWORD</button><a class="btn" href="${X.api("/logout")}">⏻ SIGN OUT</a></div></form></section>`;
    }

    function addSheet() {
      X.openSheet("insp", `<form class="lt-sheet" id="ad-add" autocomplete="off"><div class="lt-sname">ADD USER</div>
        <label class="k">USERNAME<input class="input" name="u" placeholder="e.g. blaine" maxlength="32" pattern="[a-z0-9][a-z0-9_.\\-]{1,31}" autocapitalize="none" required></label>
        <label class="k">ROLE<select class="input" name="r">${Object.entries(data.roles).map(([r, d]) => `<option value="${r}"${r === "operator" ? " selected" : ""}>${r.toUpperCase()} — ${esc(d)}</option>`).join("")}</select></label>
        <label class="k">PASSWORD <span class="muted" style="font:11px var(--mono)">(leave blank to generate a temporary one)</span><input class="input" type="text" name="p" autocomplete="new-password" maxlength="256"></label>
        <div class="muted" style="font-size:12.5px">They'll be asked to choose their own password the first time they sign in.</div>
        <button class="btn pri">CREATE USER</button></form>`);
      $("#ad-add").onsubmit = async (e) => {
        e.preventDefault(); const f = e.target;
        const d = await post("/api/admin", { action: "add", username: f.u.value.trim().toLowerCase(), role: f.r.value, password: f.p.value });
        if (!d.ok) { X.toast("⚠ " + d.error); return; }
        X.toast("Added " + f.u.value); if (d.temp_password) showTemp(f.u.value.trim().toLowerCase(), d.temp_password); else X.closeSheet();
        load();
      };
    }
    function showTemp(user, pw) {
      X.openSheet("insp", `<div class="lt-sheet"><div class="lt-sname">TEMPORARY PASSWORD</div>
        <p class="muted" style="margin:0">Give this to <b class="v">${esc(user)}</b> privately. It's shown only once; they'll set their own when they sign in.</p>
        <div class="ad-temp"><code id="ad-tp">${esc(pw)}</code><button class="btn sm" id="ad-copy">COPY</button></div>
        <button class="btn" onclick="Helix.closeSheet()">DONE</button></div>`);
      $("#ad-copy").onclick = () => { navigator.clipboard && navigator.clipboard.writeText(pw).then(() => X.toast("Copied")); };
    }

    el.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-tab]"); if (t) { tab = t.dataset.tab; history.replaceState(null, "", "#/admin/" + tab); render(); return; }
      const b = e.target.closest("[data-a]"); if (!b || b.disabled) return;
      const a = b.dataset.a, u = b.dataset.u;
      if (a === "add") { addSheet(); return; }
      if (a === "delete" || a === "reset" || a === "disable") {
        if (!b.dataset.sure) { b.dataset.sure = 1; const old = b.textContent; b.textContent = "SURE?"; b.classList.add("ad-sure"); setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = old; b.classList.remove("ad-sure"); } }, 3000); return; }
      }
      let d;
      if (a === "revoke") d = await post("/api/admin", { action: "revoke_session", sid: b.dataset.sid });
      else if (a === "unlock") d = await post("/api/admin", { action: "unlock", key: b.dataset.key });
      else d = await post("/api/admin", { action: a, username: u });
      if (!d.ok) { X.toast("⚠ " + (d.error || "failed")); load(); return; }
      if (d.temp_password) showTemp(u, d.temp_password);
      else X.toast({ reset: "Password reset", logout: "Signed out " + u, disable: "Disabled " + u, enable: "Enabled " + u, delete: "Deleted " + u, revoke: "Session ended", unlock: "Unlocked" }[a] || "Done");
      if (a === "revoke" && b.dataset.sid === (data || {}).my_sid) { location.href = X.api("/login"); return; }
      load();
    });
    el.addEventListener("change", async (e) => {
      const s = e.target.closest("[data-role]"); if (!s) return;
      const d = await post("/api/admin", { action: "role", username: s.dataset.role, role: s.value });
      X.toast(d.ok ? `${s.dataset.role} is now ${s.value.toUpperCase()}` : "⚠ " + d.error); load();
    });
    el.addEventListener("submit", async (e) => {
      if (e.target.id !== "ad-pw") return; e.preventDefault(); const f = e.target;
      if (f.n1.value !== f.n2.value) { X.toast("⚠ New passwords don't match"); return; }
      const d = await post("/api/me/password", { current: f.cur.value, new: f.n1.value });
      if (d.ok) { X.toast("Password saved"); f.reset(); load(); } else X.toast("⚠ " + d.error);
    });
    load(); timer = setInterval(() => { if (!document.hidden && !$(".sheet.open") && !el.querySelector("form:focus-within")) load(); }, 15000);
    return { destroy() { clearInterval(timer); } };
  }

  G.HelixPages = G.HelixPages || {};
  G.HelixPages.admin = adminPage;
})(window);
