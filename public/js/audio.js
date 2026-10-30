// Tiny synthesized sound engine — no audio files needed.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.ready = false;
    this.noise = null;
    this.wind = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    // shared noise buffer
    const len = Math.floor(this.ctx.sampleRate * 1.2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    // gentle wind bed
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.value = 0.045;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    lfo.start();
    this.wind = g;
    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  get t() { return this.ctx.currentTime; }

  noiseSrc(dur, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = rate;
    s.loop = true;
    s.start(this.t);
    s.stop(this.t + dur + 0.02);
    return s;
  }

  // Envelope generator. The gain node is wired straight into the master bus so
  // callers can simply chain their sources into it.
  env(dur, peak, attack = 0.004) {
    const g = this.ctx.createGain();
    const t = this.t;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    return g;
  }

  osc(type, f0, f1, dur, peak) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, this.t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), this.t + dur);
    const g = this.env(dur, peak, 0.003);
    o.connect(g);
    o.start(this.t);
    o.stop(this.t + dur + 0.02);
    return g;
  }

  // ---------------------------------------------------------------- weapons
  shot(weapon, dist = 0, isSelf = true) {
    if (!this.ready) return;
    this.resume();
    const atten = Math.max(0, 1 - dist / 85);
    const vol = atten * atten;
    if (!isSelf && vol < 0.01) return;
    const far = !isSelf ? Math.min(1, dist / 40) : 0;

    if (weapon === 'rifle') {
      const n = this.noiseSrc(0.16);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'lowpass';
      bp.frequency.setValueAtTime(5200 - far * 3500, this.t);
      bp.frequency.exponentialRampToValueAtTime(360, this.t + 0.14);
      n.connect(bp).connect(this.env(0.16, (isSelf ? 0.5 : 0.4) * vol));
      this.osc('triangle', 150, 52, 0.13, (isSelf ? 0.4 : 0.3) * vol);
    } else if (weapon === 'sniper') {
      const n = this.noiseSrc(0.5);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'lowpass';
      bp.frequency.setValueAtTime(4200 - far * 2600, this.t);
      bp.frequency.exponentialRampToValueAtTime(180, this.t + 0.45);
      const g = this.env(0.5, (isSelf ? 0.7 : 0.5) * vol, 0.002);
      n.connect(bp).connect(g);
      // big tail
      const n2 = this.noiseSrc(0.9);
      const bp2 = this.ctx.createBiquadFilter();
      bp2.type = 'bandpass';
      bp2.frequency.value = 700 - far * 400;
      bp2.Q.value = 0.6;
      n2.connect(bp2).connect(this.env(0.9, 0.14 * vol, 0.05));
      this.osc('triangle', 105, 34, 0.3, 0.55 * vol);
    } else if (weapon === 'smg') {
      const n = this.noiseSrc(0.07);
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 700 - far * 400;
      n.connect(hp).connect(this.env(0.07, (isSelf ? 0.34 : 0.26) * vol, 0.001));
      this.osc('square', 260, 90, 0.05, 0.14 * vol);
    } else if (weapon === 'knife') {
      const n = this.noiseSrc(0.22, 0.7);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(900, this.t);
      bp.frequency.exponentialRampToValueAtTime(3200, this.t + 0.2);
      bp.Q.value = 1.2;
      n.connect(bp).connect(this.env(0.22, 0.3 * (isSelf ? 1 : vol), 0.02));
    }
  }

  hit(kill = false) {
    if (!this.ready) return;
    if (kill) {
      this.osc('square', 880, 660, 0.07, 0.16);
      setTimeout(() => this.ready && this.osc('square', 1320, 990, 0.1, 0.16), 55);
    } else {
      this.osc('square', 1500, 1150, 0.045, 0.13);
    }
  }

  damage() {
    if (!this.ready) return;
    const n = this.noiseSrc(0.22);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    n.connect(lp).connect(this.env(0.22, 0.4, 0.002));
    this.osc('sine', 120, 46, 0.24, 0.32);
  }

  death() {
    if (!this.ready) return;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(320, this.t);
    o.frequency.exponentialRampToValueAtTime(42, this.t + 0.9);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const g = this.env(0.95, 0.24, 0.01);
    o.connect(lp).connect(g);
    o.start(this.t);
    o.stop(this.t + 1);
  }

  reload(dur = 2) {
    if (!this.ready) return;
    const click = (delay, f = 1800, p = 0.1) => setTimeout(() => {
      if (!this.ready) return;
      const n = this.noiseSrc(0.05);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 2;
      n.connect(bp).connect(this.env(0.05, p, 0.001));
    }, delay * 1000);
    click(dur * 0.12);
    click(dur * 0.55, 1200, 0.08);
    click(dur * 0.9, 2400, 0.09);
  }

  empty() {
    if (!this.ready) return;
    const n = this.noiseSrc(0.05);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 3;
    n.connect(bp).connect(this.env(0.05, 0.09, 0.001));
  }

  swap() {
    if (!this.ready) return;
    const n = this.noiseSrc(0.08);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1800;
    n.connect(hp).connect(this.env(0.08, 0.09, 0.001));
    this.osc('sine', 420, 300, 0.06, 0.05);
  }

  step(vol = 1) {
    if (!this.ready) return;
    const n = this.noiseSrc(0.09, 0.55);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 480 + Math.random() * 160;
    n.connect(lp).connect(this.env(0.09, 0.075 * vol, 0.003));
  }

  land() {
    if (!this.ready) return;
    const n = this.noiseSrc(0.14, 0.5);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 380;
    n.connect(lp).connect(this.env(0.14, 0.18, 0.002));
  }

  spawn() {
    if (!this.ready) return;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(180, this.t);
    o.frequency.exponentialRampToValueAtTime(760, this.t + 0.35);
    const g = this.env(0.4, 0.12, 0.02);
    o.connect(g);
    o.start(this.t);
    o.stop(this.t + 0.45);
    const n = this.noiseSrc(0.3);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.8;
    n.connect(bp).connect(this.env(0.3, 0.07, 0.05));
  }

  // ---------------------------------------------------------------- movement
  jump() {
    if (!this.ready) return;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(320, this.t);
    o.frequency.exponentialRampToValueAtTime(520, this.t + 0.09);
    const g = this.env(0.1, 0.07, 0.004);
    o.connect(g);
    o.start(this.t);
    o.stop(this.t + 0.12);
  }

  doubleJump() {
    if (!this.ready) return;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(460, this.t);
    o.frequency.exponentialRampToValueAtTime(880, this.t + 0.14);
    const g = this.env(0.16, 0.09, 0.004);
    o.connect(g);
    o.start(this.t);
    o.stop(this.t + 0.18);
    const n = this.noiseSrc(0.18, 0.8);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 1.1;
    n.connect(bp).connect(this.env(0.18, 0.05, 0.01));
  }

  // timed landing jump: a short, bright "kept it" chime
  perfect() {
    if (!this.ready) return;
    for (const [i, freq] of [660, 990].entries()) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(freq, this.t + i * 0.045);
      const g = this.env(0.1, 0.05, 0.003);
      g.gain.setValueAtTime(0.0001, this.t);
      o.connect(g);
      o.start(this.t + i * 0.045);
      o.stop(this.t + i * 0.045 + 0.12);
    }
  }

  wallRun() {
    if (!this.ready) return;
    const n = this.noiseSrc(0.5, 0.45);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(700, this.t);
    bp.frequency.exponentialRampToValueAtTime(1500, this.t + 0.45);
    bp.Q.value = 1.4;
    n.connect(bp).connect(this.env(0.5, 0.11, 0.04));
  }

  wallJump() {
    if (!this.ready) return;
    const n = this.noiseSrc(0.22, 0.9);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2200 - 600; bp.Q.value = 0.9;
    n.connect(bp).connect(this.env(0.22, 0.13, 0.005));
    this.osc('triangle', 260, 620, 0.2, 0.09);
  }

  slide() {
    if (!this.ready) return;
    const n = this.noiseSrc(0.55, 0.35);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, this.t);
    lp.frequency.exponentialRampToValueAtTime(320, this.t + 0.5);
    n.connect(lp).connect(this.env(0.55, 0.12, 0.01));
  }

  // ---------------------------------------------------------------- menus
  objective() {
    if (!this.ready) return;
    this.osc('sine', 520, 780, 0.16, 0.09);
    setTimeout(() => { if (this.ready) this.osc('sine', 780, 1040, 0.14, 0.07); }, 90);
  }

  objectiveDone() {
    if (!this.ready) return;
    this.osc('triangle', 660, 990, 0.18, 0.1);
    setTimeout(() => { if (this.ready) this.osc('triangle', 990, 1320, 0.2, 0.09); }, 110);
  }

  join() {
    if (!this.ready) return;
    this.osc('sine', 620, 900, 0.12, 0.1);
  }

  kill() {
    if (!this.ready) return;
    this.osc('triangle', 520, 980, 0.16, 0.14);
  }
}

export const sfx = new Sfx();
