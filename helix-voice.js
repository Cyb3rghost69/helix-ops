/* global HelixVoice */
(function () {
  const p = () => (typeof OPS === "string" ? OPS : (location.pathname === "/ops" || location.pathname.startsWith("/ops/") ? "/ops" : ""));
  let cfg = {};
  let rec = null;
  let listening = false;
  let conv = false;
  let wake = false;
  let muted = false;
  let state = "MIC OFF";
  let userT = "";
  let helixT = "";
  let last = {};
  let audioCtx = null;
  let analyser = null;
  let raf = 0;
  let pendingConfirm = null;

  function SR() {
    return window.SpeechRecognition || window.webkitSpeechRecognition;
  }
  function setState(s) {
    state = s;
    const el = document.getElementById("vx-state");
    if (el) {
      el.textContent = "◉ " + s;
      el.className = "vx-state" + (s === "LISTENING" || s === "READY" ? " listen" : s === "ERROR" ? " err" : "");
    }
  }
  function drawWave(level) {
    const cv = document.getElementById("vx-wave");
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width = cv.clientWidth || 320;
    const h = cv.height = 36;
    ctx.fillStyle = "#050805";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#7CFF7A";
    const n = 24;
    for (let i = 0; i < n; i++) {
      const amp = (0.2 + level * (0.3 + Math.abs(Math.sin(Date.now() / 180 + i)) * 0.7)) * h;
      const bw = w / n;
      ctx.fillRect(i * bw + 1, (h - amp) / 2, bw - 2, amp);
    }
  }
  function speak(text) {
    if (!cfg.auto_play || !cfg.tts_enabled || !text) return;
    try { speechSynthesis.cancel(); } catch (e) {}
    const u = new SpeechSynthesisUtterance(text);
    u.rate = cfg.tts_speed || 1;
    u.volume = cfg.volume || 0.85;
    u.lang = cfg.stt_language || "en-AU";
    setState("SPEAKING");
    u.onend = () => {
      setState(conv && !muted ? "READY" : "MIC OFF");
      if (conv && !muted) startListen(true);
    };
    speechSynthesis.speak(u);
  }
  function show() {
    const u = document.getElementById("vx-user");
    const h = document.getElementById("vx-helix");
    if (u) u.textContent = userT || "—";
    if (h) h.textContent = helixT || "—";
    const tel = last.telemetry || {};
    const box = document.getElementById("vx-tele");
    if (box) {
      const rows = [
        ["MODEL", (last.config && last.config.agent) || cfg.voice_agent_provider || "AUTO"],
        ["STT", cfg.stt_provider || "BROWSER"],
        ["TTS", cfg.tts_provider || "BROWSER"],
        ["LATENCY", (tel.total_ms != null ? tel.total_ms + "ms" : "—")],
      ];
      box.innerHTML = rows.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join("");
    }
    const err = document.getElementById("vx-err");
    if (err) err.textContent = last.error || "";
  }
  function send(text, confirm) {
    setState("THINKING");
    const t0 = Date.now();
    return fetch(p() + "/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: confirm ? "confirm" : "utter", text, confirm: !!confirm, stt_ms: last._stt, provider: cfg.voice_agent_provider }),
    }).then((r) => r.json()).then((d) => {
      last = d;
      helixT = d.speak || "";
      pendingConfirm = d.need_confirm ? text : null;
      setState(d.need_confirm ? "READY" : "SPEAKING");
      show();
      if (d.need_confirm) {
        speak(d.speak);
      } else {
        speak(d.speak);
      }
      loadHist();
      return d;
    }).catch(() => {
      last = { error: "network" };
      setState("ERROR");
      show();
    }).finally(() => { last._rtt = Date.now() - t0; });
  }
  function startListen(fromConv) {
    if (muted) return;
    const C = SR();
    if (!C) {
      setState("ERROR");
      helixT = "Speech recognition is not available in this browser.";
      show();
      return;
    }
    try { speechSynthesis.cancel(); } catch (e) {}
    rec = new C();
    rec.lang = cfg.stt_language || "en-AU";
    rec.interimResults = true;
    rec.continuous = !!(fromConv || wake);
    listening = true;
    setState(wake && !fromConv ? "READY" : "LISTENING");
    const t0 = Date.now();
    rec.onresult = (ev) => {
      let s = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) s += ev.results[i][0].transcript;
      userT = s;
      show();
      const final = ev.results[ev.results.length - 1].isFinal;
      if (final) {
        last._stt = Date.now() - t0;
        const ww = (cfg.wake_word || "helix").toLowerCase();
        let said = s.trim();
        if (wake) {
          const low = said.toLowerCase();
          if (!low.includes(ww)) return;
          said = said.replace(new RegExp(ww + "[, ]*", "i"), "").trim();
          if (!said) return;
        }
        stopListen();
        setState("PROCESSING");
        send(said, false);
      }
    };
    rec.onerror = (ev) => {
      listening = false;
      if (ev.error === "not-allowed") {
        setState("ERROR");
        helixT = "Microphone permission denied.";
      } else if (ev.error !== "aborted") setState("ERROR");
      show();
    };
    rec.onend = () => { listening = false; };
    rec.start();
    micLevel();
  }
  function stopListen() {
    listening = false;
    try { rec && rec.stop(); } catch (e) {}
    rec = null;
    cancelAnimationFrame(raf);
  }
  function micLevel() {
    if (!navigator.mediaDevices || !listening) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!listening) {
          stream.getTracks().forEach((t) => t.stop());
          drawWave(0.05);
          return;
        }
        analyser.getByteTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) s += Math.abs(buf[i] - 128);
        drawWave(Math.min(1, s / buf.length / 20));
        raf = requestAnimationFrame(tick);
      };
      tick();
    }).catch(() => drawWave(0.08));
  }
  function loadHist() {
    fetch(p() + "/api/voice").then((r) => r.json()).then((d) => {
      cfg = d.config || cfg;
      const h = document.getElementById("vx-hist");
      if (h) {
        h.innerHTML = (d.history || []).slice().reverse().map((x) =>
          `<div>${x.t || ""} · ${x.tool || "—"} · ${x.user || ""} → ${x.speak || ""}</div>`
        ).join("");
      }
      const wk = document.getElementById("vx-wake");
      if (wk) wk.classList.toggle("on", !!(cfg.wake_word_enabled));
    }).catch(() => {});
  }
  function bind() {
    const root = document.getElementById("pane-voice");
    if (!root) return;
    document.getElementById("vx-ptt")?.addEventListener("click", () => {
      if (muted) return;
      conv = false;
      if (listening) {
        stopListen();
        setState("PROCESSING");
        if (userT) send(userT, !!pendingConfirm);
      } else startListen(false);
    });
    document.getElementById("vx-mute")?.addEventListener("click", () => {
      muted = !muted;
      stopListen();
      try { speechSynthesis.cancel(); } catch (e) {}
      setState(muted ? "MIC OFF" : "READY");
      document.getElementById("vx-mute")?.classList.toggle("warn", muted);
    });
    document.getElementById("vx-conv")?.addEventListener("click", () => {
      conv = !conv;
      document.getElementById("vx-conv")?.classList.toggle("on", conv);
      if (conv && !muted) startListen(true);
      else stopListen();
    });
    document.getElementById("vx-wake")?.addEventListener("click", () => {
      wake = !wake;
      cfg.wake_word_enabled = wake;
      document.getElementById("vx-wake")?.classList.toggle("on", wake);
      if (wake && !muted) startListen(true);
      else if (!conv) stopListen();
    });
    document.getElementById("vx-confirm")?.addEventListener("click", () => {
      if (pendingConfirm) send(pendingConfirm, true);
    });
  }
  globalThis.HelixVoice = {
    mount() {
      bind();
      loadHist();
      setState("MIC OFF");
      drawWave(0.05);
    },
  };
})();
