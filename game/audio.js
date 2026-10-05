// Sound: synthesized with Web Audio (no files). Punchy effects, rate-limited so hundreds of kills don't turn to noise,
// and a small step sequencer for the music (A minor, 124 BPM) whose layers follow the intensity of the night.
// Nothing here throws: a missing or refused AudioContext just means silence.

const MAX_VOICES = 30;
const BPM = 124;
const STEP_LEN = 60 / BPM / 4; // a sixteenth

const A_MINOR = [0, 2, 3, 5, 7, 8, 10];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfx = null;
    this.musicBus = null;
    this.musicFilter = null;
    this.noiseBuf = null;
    this.ends = []; // when each playing voice ends (audio time): a leak-proof count of voices
    this.last = Object.create(null);
    this.gemStep = 0;
    this.gemAt = -10;
    this.reduced = false;
    // the music
    this.timer = null;
    this.nextTime = 0;
    this.step = 0;
    this.bar = 0;
    this.level = 0; // 0 quiet (title, lobby), 1 playing, 2 boss
    this.musicOn = false;
    this.targetGain = 0;
  }

  /** Call from a tap or key. Safe to call again and again. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        const c = this.ctx;
        this.master = c.createGain();
        this.master.gain.value = 0.9;
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 18;
        comp.ratio.value = 5;
        comp.attack.value = 0.004;
        comp.release.value = 0.18;
        this.master.connect(comp);
        comp.connect(c.destination);
        this.sfx = c.createGain();
        this.sfx.gain.value = 0.8;
        this.sfx.connect(this.master);
        this.musicBus = c.createGain();
        this.musicBus.gain.value = 0;
        this.musicFilter = c.createBiquadFilter();
        this.musicFilter.type = 'lowpass';
        this.musicFilter.frequency.value = 900;
        this.musicFilter.Q.value = 0.5;
        this.musicFilter.connect(this.musicBus);
        this.musicBus.connect(this.master);
        const len = Math.floor(c.sampleRate * 1.5);
        this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    } catch {
      this.ctx = null;
      return false;
    }
  }

  get ready() {
    return this.ctx !== null && this.ctx.state !== 'closed';
  }

  /** The room is quieter in menus and loud in play. */
  setMusicLevel(level, loud) {
    this.level = level;
    this.targetGain = loud ? 0.5 : 0.22;
    this.applyGain();
  }

  stopMusic() {
    this.targetGain = 0;
    this.applyGain();
  }

  applyGain() {
    if (!this.ready) return;
    try {
      const t = this.ctx.currentTime;
      this.musicBus.gain.setTargetAtTime(this.targetGain, t, 0.25);
      const f = this.level === 0 ? 1100 : this.level === 1 ? 3800 : 6500;
      this.musicFilter.frequency.setTargetAtTime(f, t, 0.4);
      if (this.targetGain > 0 && !this.timer) this.startMusic();
    } catch {
      /* silence */
    }
  }

  // ---------------------------------------------------------------- building blocks
  /** How many voices are still sounding. */
  active() {
    const now = this.ctx.currentTime;
    const e = this.ends;
    let w = 0;
    for (let i = 0; i < e.length; i++) if (e[i] > now) e[w++] = e[i];
    e.length = w;
    return w;
  }

  gate(name, gap) {
    const now = this.ctx.currentTime;
    if (now - (this.last[name] ?? -10) < gap) return false;
    this.last[name] = now;
    return this.active() < MAX_VOICES;
  }

  tone(freq, dur, type, vol, delay = 0, slideTo = 0, bus = this.sfx) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus);
    this.ends.push(t + dur + 0.05);
    o.onended = () => {
      try {
        g.disconnect();
      } catch {
        /* gone */
      }
    };
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  noise(dur, vol, filter, freq, q = 1, delay = 0, slideTo = 0, bus = this.sfx) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(Math.max(30, freq), t);
    if (slideTo > 0) f.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(bus);
    this.ends.push(t + dur + 0.05);
    s.onended = () => {
      try {
        g.disconnect();
      } catch {
        /* gone */
      }
    };
    s.start(t, Math.random() * 0.9);
    s.stop(t + dur + 0.03);
  }

  play(fn, name, gap) {
    if (!this.ready || this.ctx.state !== 'running' || !this.gate(name, gap)) return;
    try {
      fn.call(this);
    } catch {
      /* a sound never breaks the game */
    }
  }

  // ---------------------------------------------------------------- effects
  shoot() {
    this.play(() => this.tone(760 + Math.random() * 120, 0.09, 'sawtooth', 0.035, 0, 320), 'shoot', 0.07);
  }
  hit(big = false) {
    this.play(() => {
      this.noise(0.06, big ? 0.12 : 0.07, 'bandpass', 1500 + Math.random() * 500, 1.2);
      this.tone(big ? 210 : 260, 0.06, 'square', big ? 0.05 : 0.025, 0, 110);
    }, 'hit', 0.04);
  }
  kill() {
    this.play(() => {
      this.noise(0.09, 0.07, 'highpass', 2600, 0.8);
      this.tone(340 + Math.random() * 80, 0.1, 'triangle', 0.05, 0, 120);
    }, 'kill', 0.05);
  }
  bigKill() {
    this.play(() => {
      this.noise(0.25, 0.2, 'lowpass', 1800, 0.8, 0, 200);
      this.tone(150, 0.3, 'sawtooth', 0.12, 0, 45);
    }, 'bigkill', 0.1);
  }
  /** XP chime that climbs while you keep collecting (pentatonic, two octaves). */
  gem(tier = 0) {
    if (!this.ready || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.gemStep = now - this.gemAt < 0.45 ? Math.min(this.gemStep + 1, 14) : 0;
    this.gemAt = now;
    const penta = [0, 2, 4, 7, 9];
    const n = this.gemStep;
    const semis = penta[n % 5] + 12 * Math.floor(n / 5);
    this.play(() => {
      const f = 523.25 * Math.pow(2, semis / 12);
      this.tone(f, 0.12, 'sine', 0.07 + tier * 0.02);
      if (tier > 0) this.tone(f * 2, 0.16, 'triangle', 0.03, 0.02);
    }, 'gem', 0.035);
  }
  levelUp() {
    this.play(() => {
      [0, 4, 7, 12, 16].forEach((s, i) => this.tone(523.25 * Math.pow(2, s / 12), 0.28, 'triangle', 0.1, i * 0.065));
      this.noise(0.5, 0.05, 'highpass', 5000, 0.5, 0.05);
    }, 'levelup', 0.3);
  }
  hurt() {
    this.play(() => {
      this.noise(0.18, 0.2, 'lowpass', 900, 0.8);
      this.tone(130, 0.2, 'sawtooth', 0.14, 0, 55);
    }, 'hurt', 0.1);
  }
  down() {
    this.play(() => {
      this.tone(220, 0.9, 'sawtooth', 0.14, 0, 46);
      this.noise(0.8, 0.14, 'lowpass', 1200, 0.7, 0, 120);
    }, 'down', 0.5);
  }
  revive() {
    this.play(() => {
      this.tone(330, 0.5, 'triangle', 0.12, 0, 990);
      this.tone(660, 0.5, 'sine', 0.06, 0.08, 1320);
    }, 'revive', 0.4);
  }
  blade() {
    this.play(() => this.noise(0.14, 0.05, 'bandpass', 1400, 2, 0, 2600), 'blade', 0.16);
  }
  ring() {
    this.play(() => {
      this.noise(0.38, 0.14, 'lowpass', 900, 0.8, 0, 160);
      this.tone(110, 0.3, 'sine', 0.12, 0, 55);
    }, 'ring', 0.15);
  }
  zap() {
    this.play(() => {
      this.noise(0.16, 0.18, 'highpass', 3000, 0.6);
      this.tone(2000, 0.14, 'sawtooth', 0.07, 0, 180);
    }, 'zap', 0.08);
  }
  nova() {
    this.play(() => {
      this.tone(1320, 0.5, 'sine', 0.07, 0, 880);
      this.tone(1980, 0.4, 'triangle', 0.04, 0.02, 1500);
      this.noise(0.4, 0.06, 'highpass', 6000, 0.5);
    }, 'nova', 0.2);
  }
  rain() {
    this.play(() => {
      for (let i = 0; i < 5; i++) this.noise(0.05, 0.05, 'bandpass', 3500 + Math.random() * 2500, 3, i * 0.07);
    }, 'rain', 0.3);
  }
  shield() {
    this.play(() => {
      this.tone(880, 0.35, 'triangle', 0.12, 0, 1320);
      this.tone(1760, 0.3, 'sine', 0.05, 0.03);
    }, 'shield', 0.2);
  }
  boss() {
    this.play(() => {
      this.tone(78, 1.6, 'sawtooth', 0.2, 0, 38);
      this.tone(117, 1.4, 'square', 0.08, 0, 56);
      this.noise(1.4, 0.18, 'lowpass', 700, 0.8, 0, 90);
    }, 'boss', 1);
  }
  warn() {
    this.play(() => {
      this.tone(98, 0.7, 'sawtooth', 0.14, 0, 90);
      this.tone(147, 0.7, 'square', 0.06, 0.02, 130);
    }, 'warn', 0.5);
  }
  wave() {
    this.play(() => {
      this.tone(65, 0.5, 'sine', 0.14, 0, 40);
      this.noise(0.4, 0.06, 'lowpass', 400, 0.7);
    }, 'wave', 0.4);
  }
  tick() {
    this.play(() => this.tone(1200, 0.04, 'square', 0.04), 'tick', 0.03);
  }
  select() {
    this.play(() => {
      this.tone(660, 0.1, 'triangle', 0.1);
      this.tone(990, 0.14, 'triangle', 0.09, 0.07);
    }, 'select', 0.1);
  }
  count(n) {
    this.play(() => this.tone(n === 0 ? 1175 : 587, n === 0 ? 0.5 : 0.18, 'square', n === 0 ? 0.12 : 0.09), 'count', 0.2);
  }
  win() {
    this.play(() => {
      [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone(392 * Math.pow(2, s / 12), 0.9, 'triangle', 0.1, i * 0.11));
      this.tone(196, 2.4, 'sine', 0.12, 0, 196);
      this.noise(1.6, 0.05, 'highpass', 5000, 0.5, 0.4);
    }, 'win', 1);
  }
  lose() {
    this.play(() => {
      [0, -3, -7, -12].forEach((s, i) => this.tone(330 * Math.pow(2, s / 12), 0.7, 'sawtooth', 0.09, i * 0.2, 0, this.sfx));
      this.noise(1.2, 0.08, 'lowpass', 500, 0.6, 0.2);
    }, 'lose', 1);
  }

  // ---------------------------------------------------------------- music
  startMusic() {
    if (this.timer || !this.ready) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.bar = 0;
    this.timer = setInterval(() => this.pump(), 30);
  }

  pump() {
    if (!this.ready) return;
    try {
      if (this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      if (this.nextTime < now - 0.5) this.nextTime = now + 0.05; // the tab slept: don't play catch-up
      while (this.nextTime < now + 0.14) {
        this.schedule(this.step, this.bar, this.nextTime);
        this.nextTime += STEP_LEN;
        if (++this.step >= 16) {
          this.step = 0;
          this.bar = (this.bar + 1) % 4;
        }
      }
    } catch {
      /* silence */
    }
  }

  /** Plays one sixteenth of the pattern at audio time `t`. */
  schedule(step, bar, t) {
    if (this.targetGain <= 0.001) return;
    const level = this.level;
    const root = [33, 33, 29, 31][bar]; // A1 A1 F1 G1
    const chord = [[57, 60, 64], [57, 60, 64], [53, 57, 60], [55, 59, 62]][bar];
    const dt = t - this.ctx.currentTime;
    // pad on the first step of each bar
    if (step === 0) {
      for (const n of chord) this.voice(midi(n), STEP_LEN * 15, 'triangle', level === 0 ? 0.07 : 0.045, dt);
    }
    // kick
    if (level >= 1 && step % 4 === 0) {
      this.voice(120, 0.14, 'sine', 0.3, dt, 42);
    }
    // snare
    if (level >= 1 && (step === 4 || step === 12)) {
      this.noiseHit(0.14, 0.12, 'bandpass', 1900, dt);
    }
    // hats
    if (level >= 1 && step % 2 === 1) this.noiseHit(0.03, level === 2 ? 0.06 : 0.035, 'highpass', 7500, dt);
    // bass
    if (level >= 1 && (step % 4 === 0 || step % 8 === 6)) {
      this.voice(midi(root), STEP_LEN * 3, 'sawtooth', 0.14, dt);
    }
    // arpeggio
    const arpOn = level === 0 ? step % 4 === 0 : step % 2 === 0;
    if (arpOn) {
      const deg = [0, 2, 4, 2, 5, 4, 2, 1][(step >> 1) % 8];
      const note = 69 + A_MINOR[deg % 7] + (bar === 3 ? 2 : 0) + (level === 2 ? 12 : 0);
      this.voice(midi(note), STEP_LEN * 1.6, 'square', level === 0 ? 0.03 : 0.04, dt);
    }
  }

  voice(freq, dur, type, vol, delay, slideTo = 0) {
    this.tone(freq, dur, type, vol, delay, slideTo, this.musicFilter);
  }

  noiseHit(dur, vol, filter, freq, delay) {
    this.noise(dur, vol, filter, freq, 1, delay, 0, this.musicFilter);
  }
}
