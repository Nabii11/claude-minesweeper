// Retro sound effects through Web Audio: overlapping voices, near-zero latency.
// iOS only lets audio start after the first touch, so unlock() is called from
// the first pointer event.

const NAMES = ["reveal", "cascade", "flag", "unflag", "button", "win", "lose", "firework", "boot"];
const MAX_VOICES = 12;

export class SoundPlayer {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.buffers = new Map();
    this.voices = [];
    this._loading = null;
  }

  /** Create the (suspended) context and decode the sounds early, so the first tap isn't silent. */
  init() {
    this._ensureContext();
  }

  _ensureContext() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      // "ambient": mixes with the user's music instead of stopping it, and respects the mute switch.
      if (navigator.audioSession) navigator.audioSession.type = "ambient";
    } catch (_) { /* older Safari */ }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    this._load();
    return this.ctx;
  }

  _load() {
    if (this._loading) return this._loading;
    this._loading = Promise.all(NAMES.map(async (name) => {
      try {
        const res = await fetch(`assets/sounds/${name}.wav`);
        const data = await res.arrayBuffer();
        const buf = await new Promise((ok, fail) => this.ctx.decodeAudioData(data, ok, fail));
        this.buffers.set(name, buf);
      } catch (_) { /* a missing sound just stays silent */ }
    }));
    return this._loading;
  }

  /** Call from a user gesture (touch/click) so iOS allows playback. */
  unlock() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    if (ctx.state === "running") return;
    ctx.resume().catch(() => {});
    // A silent one-sample buffer, played inside the gesture, fully unlocks iOS.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  }

  play(name) {
    // A context still resuming from the unlock tap queues the sound and plays it a moment later.
    if (!this.enabled || !this.ctx || this.ctx.state === "closed") return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    if (this.voices.length >= MAX_VOICES) {
      const oldest = this.voices.shift();
      try { oldest.src.stop(); } catch (_) { /* already stopped */ }
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.master);
    src.start(now);
    this.voices.push({ src, end: now + buf.duration });
  }
}
