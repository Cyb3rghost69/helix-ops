/* global HelixVoice */
(function () {
  const p = () => (typeof OPS === "string" ? OPS : (location.pathname === "/ops" || location.pathname.startsWith("/ops/") ? "/ops" : ""));
  let cfg = {};
  let listening = false;
  let conv = false;
  let muted = false;
  let userT = "";
  let helixT = "";
  let last = {};
  let audioCtx = null;
  let analyser = null;
  let raf = 0;
  let pendingConfirm = null;
  let mediaRec = null;
  let chunks = [];

  function setState(s) {
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
  function unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        audioCtx = audioCtx || new Ctx();
        if (audioCtx.state === "suspended") audioCtx.resume();
      }
    } catch (e) {}
    try {
      if (!unlockAudio._done && window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        speechSynthesis.speak(u);
        unlockAudio._done = true;
      }
    } catch (e) {}
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
      if (conv && !muted) startListen();
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
        ["STT", cfg.stt_provider || "MAC"],
        ["TTS", cfg.tts_provider || "BROWSER"],
        ["LATENCY", (tel.total_ms != null ? tel.total_ms + "ms" : "—")],
      ];
      box.innerHTML = rows.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join("");
    }
    const err = document.getElementById("vx-err");
    if (err) err.textContent = last.error || "";
  }
  function post(body) {
    setState("THINKING");
    return fetch(p() + "/api/voice", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => {
      if (r.status === 401) throw new Error("login");
      return r.json();
    }).then((d) => {
      last = d;
      helixT = d.speak || "";
      if (body.text) userT = body.text;
      pendingConfirm = d.need_confirm ? (body.text || userT) : null;
      setState(d.need_confirm ? "READY" : "SPEAKING");
      show();
      speak(d.speak);
      loadHist();
      return d;
    }).catch((e) => {
      last = { error: e.message === "login" ? "login required" : "network" };
      helixT = e.message === "login" ? "Log in to Helix first." : "Voice network error.";
      setState("ERROR");
      show();
    });
  }
  function send(text, confirm) {
    userT = text;
    show();
    return post({ action: confirm ? "confirm" : "utter", text, confirm: !!confirm, provider: cfg.voice_agent_provider });
  }
  function recMime() {
    const types = ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm"];
    if (!window.MediaRecorder) return "";
    return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  }
  function blobB64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result || ""));
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  }
  function startListen() {
    if (muted) return;
    if (!window.isSecureContext) {
      setState("ERROR");
      helixT = "Voice needs HTTPS. Open the Tailscale /ops URL.";
      show();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setState("ERROR");
      helixT = "This browser cannot open the microphone. Type below.";
      show();
      return;
    }
    unlockAudio();
    try { speechSynthesis.cancel(); } catch (e) {}
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      chunks = [];
      const mime = recMime();
      try {
        mediaRec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch (e) {
        mediaRec = new MediaRecorder(stream);
      }
      mediaRec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mediaRec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: (mediaRec && mediaRec.mimeType) || "audio/mp4" });
        mediaRec = null;
        if (blob.size < 400) {
          setState("ERROR");
          helixT = "No speech captured. Tap PTT, speak, tap again.";
          show();
          return;
        }
        setState("PROCESSING");
        blobB64(blob).then((b64) => {
          post({ action: "utter", audio_b64: b64, mime: blob.type, provider: cfg.voice_agent_provider });
        });
      };
      mediaRec.start(200);
      listening = true;
      setState("LISTENING");
      micLevel(stream);
    }).catch(() => {
      setState("ERROR");
      helixT = "Microphone permission denied.";
      show();
    });
  }
  function stopListen() {
    listening = false;
    try { if (mediaRec && mediaRec.state !== "inactive") mediaRec.stop(); } catch (e) {}
    cancelAnimationFrame(raf);
  }
  function micLevel(stream) {
    if (!stream) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!listening) {
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
    } catch (e) { drawWave(0.08); }
  }
  function loadHist() {
    fetch(p() + "/api/voice", { credentials: "same-origin" }).then((r) => r.json()).then((d) => {
      cfg = d.config || cfg;
      const h = document.getElementById("vx-hist");
      if (h) {
        h.innerHTML = (d.history || []).slice().reverse().map((x) =>
          `<div>${x.t || ""} · ${x.tool || "—"} · ${x.user || ""} → ${x.speak || ""}</div>`
        ).join("");
      }
    }).catch(() => {});
  }
  function bind() {
    if (!document.getElementById("pane-voice")) return;
    document.getElementById("vx-ptt")?.addEventListener("pointerdown", unlockAudio);
    document.getElementById("vx-conv")?.addEventListener("pointerdown", unlockAudio);
    document.getElementById("vx-ptt")?.addEventListener("click", () => {
      if (muted) return;
      conv = false;
      if (listening) {
        setState("PROCESSING");
        stopListen();
      } else startListen();
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
      if (conv && !muted) startListen();
      else stopListen();
    });
    document.getElementById("vx-confirm")?.addEventListener("click", () => {
      if (pendingConfirm) send(pendingConfirm, true);
    });
    const typed = document.getElementById("vx-type");
    typed?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const t = typed.value.trim();
      if (!t) return;
      typed.value = "";
      send(t, false);
    });
  }
  globalThis.HelixVoice = {
    mount() {
      bind();
      loadHist();
      setState("MIC OFF");
      drawWave(0.05);
      if (!window.isSecureContext) {
        helixT = "Voice needs HTTPS. Use the Tailscale /ops URL.";
        show();
      }
    },
  };
})();
