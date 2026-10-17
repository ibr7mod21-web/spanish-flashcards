// Sounds (Web Audio) and pronunciation (speechSynthesis).
// Everything fails silently. pickVoice is pure and tested in Node.
(function (root) {
  'use strict';

  // ---------- voice choice (pure) ----------
  const VOICE_PREFS = ['es-mx', 'es-us', 'es-419'];

  function langOf(v) { return String(v.lang || '').replace('_', '-').toLowerCase(); }

  // Apple's character voices (Grandma, Rocko…) exist in every language; rank them below the standard voice.
  const CHARACTER_VOICE = /\b(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/;
  const QUALITY_VOICE = /\((Enhanced|Premium|Mejorada)\)/i;

  // Latin American voice first: es-MX, then es-US, then es-419, then any es-*.
  // Within a region: standard voice before character voices, Enhanced/Premium first, on-device first.
  function pickVoice(voices) {
    const es = (voices || []).filter((v) => /^es(-|$)/.test(langOf(v)));
    if (!es.length) return null;
    const rank = (v) => {
      const i = VOICE_PREFS.indexOf(langOf(v));
      const name = String(v.name || '');
      return (i === -1 ? VOICE_PREFS.length : i) * 8 +
        (CHARACTER_VOICE.test(name) ? 4 : 0) +
        (QUALITY_VOICE.test(name) ? 0 : 2) +
        (v.localService === false ? 1 : 0);
    };
    return es.slice().sort((a, b) => rank(a) - rank(b))[0];
  }

  const api = { pickVoice };

  if (typeof window === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    return;
  }

  // ---------- sounds ----------
  let ctx = null;
  let master = null;

  // iOS only starts audio inside a user gesture, and only on touchEND / click / keydown
  // (touchstart and pointerdown don't count). Safe to call on every such event; it is
  // a no-op once the context is running.
  function unlockAudio() {
    try {
      // "ambient": mixes with the user's music and, like other app sounds, is muted by the silent switch.
      if (navigator.audioSession && navigator.audioSession.type !== 'ambient') navigator.audioSession.type = 'ambient';
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.35;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'running') return;
      ctx.resume();
      // Playing a silent buffer inside the gesture is what actually unlocks older iOS versions.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) { /* no audio */ }
  }

  function audioState() { return ctx ? ctx.state : 'none'; }

  // One enveloped oscillator note. f2: optional pitch glide target.
  function tone(t, freq, dur, { type = 'sine', gain = 1, attack = 0.005, f2 = null } = {}) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  const SOUNDS = {
    correct(t) { // bright ding
      tone(t, 1318.5, 0.45, { gain: 0.6 });
      tone(t, 2637, 0.25, { gain: 0.15 });
    },
    close(t) { // softer two-note
      tone(t, 659.3, 0.18, { type: 'triangle', gain: 0.35, attack: 0.01 });
      tone(t + 0.13, 784, 0.3, { type: 'triangle', gain: 0.3, attack: 0.01 });
    },
    wrong(t) { // low short thud
      tone(t, 150, 0.22, { gain: 0.9, f2: 55 });
      tone(t, 300, 0.08, { type: 'triangle', gain: 0.15, f2: 120 });
    },
    fanfare(t) { // C E G C arpeggio
      [523.3, 659.3, 784, 1046.5].forEach((f, i) => {
        const last = i === 3;
        tone(t + i * 0.11, f, last ? 0.7 : 0.18, { type: 'triangle', gain: last ? 0.45 : 0.35, attack: 0.01 });
      });
      tone(t + 0.33, 1568, 0.6, { gain: 0.12 });
    },
  };

  function play(kind) {
    try {
      if (!ctx) unlockAudio();
      if (!ctx || !SOUNDS[kind]) return;
      if (ctx.state !== 'running') ctx.resume();
      SOUNDS[kind](ctx.currentTime + 0.01);
    } catch (e) { /* ignore */ }
  }

  // ---------- pronunciation ----------
  const synth = window.speechSynthesis;
  let voice = null;

  function loadVoice() {
    try { voice = pickVoice(synth.getVoices()); } catch (e) { voice = null; }
  }
  if (synth) {
    loadVoice();
    try { synth.addEventListener('voiceschanged', loadVoice); } catch (e) { /* old Safari */ }
  }

  function speak(text) {
    try {
      if (!synth || !text) return;
      if (!voice) loadVoice();
      // Only cancel when something is playing: on iOS, cancel() right before speak() can drop the new utterance.
      if (synth.speaking || synth.pending) synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voice ? voice.lang : 'es-MX';
      if (voice) u.voice = voice;
      u.rate = 0.9;
      synth.speak(u);
    } catch (e) { /* ignore */ }
  }

  Object.assign(api, { unlockAudio, audioState, play, speak, canSpeak: !!synth });
  root.Feedback = api;
})(typeof self !== 'undefined' ? self : this);
