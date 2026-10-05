// Just enough of a browser for node: a canvas whose context accepts every call (and checks the arguments that would
// throw in a real one), an audio context that records nothing, events and animation frames the test drives by hand.

const NAMES2D = [
  'save', 'restore', 'scale', 'rotate', 'translate', 'transform', 'setTransform', 'resetTransform', 'beginPath', 'closePath', 'moveTo', 'lineTo',
  'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect',
  'fillText', 'strokeText', 'drawImage', 'setLineDash', 'putImageData',
];

const finite = (v, what) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`non-finite canvas argument (${what}): ${v}`);
};

export class FakeGradient {
  addColorStop(offset, color) {
    if (!(offset >= 0 && offset <= 1)) throw new Error(`gradient stop offset ${offset}`);
    if (typeof color !== 'string') throw new Error('gradient colour');
  }
}

export function makeContext(canvas) {
  const calls = { n: 0, byName: Object.create(null), stack: 0, texts: new Set() };
  const ctx = {
    canvas,
    calls,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
    letterSpacing: '0px',
    createLinearGradient(...a) {
      a.forEach((v, i) => finite(v, `linear ${i}`));
      return new FakeGradient();
    },
    createRadialGradient(...a) {
      a.forEach((v, i) => finite(v, `radial ${i}`));
      if (a[2] < 0 || a[5] < 0) throw new Error('negative gradient radius');
      return new FakeGradient();
    },
    createPattern() {
      return {};
    },
    measureText(t) {
      return { width: String(t).length * 9 };
    },
  };
  for (const n of NAMES2D) {
    ctx[n] = (...args) => {
      calls.n++;
      calls.byName[n] = (calls.byName[n] || 0) + 1;
      if (n === 'save') calls.stack++;
      if (n === 'restore') {
        calls.stack--;
        if (calls.stack < 0) throw new Error('restore without save');
      }
      if (n === 'drawImage') {
        const img = args[0];
        if (!img || (img.width === 0 && img.height === 0)) throw new Error('drawImage of an empty source');
        for (let i = 1; i < args.length; i++) finite(args[i], `drawImage arg ${i}`);
        if (args.length >= 5 && (args[3] < 0 || args[4] < 0) && false) throw new Error('negative size');
      } else if (n === 'fillRect' || n === 'strokeRect' || n === 'rect' || n === 'moveTo' || n === 'lineTo' || n === 'translate' || n === 'scale' || n === 'arc' || n === 'ellipse' || n === 'quadraticCurveTo' || n === 'bezierCurveTo' || n === 'transform' || n === 'setTransform' || n === 'rotate') {
        const count = n === 'arc' ? 5 : n === 'ellipse' ? 7 : args.length;
        args.slice(0, count).forEach((v, i) => finite(v, `${n} arg ${i}`));
        if ((n === 'arc' && args[2] < 0) || (n === 'ellipse' && (args[2] < 0 || args[3] < 0))) throw new Error(`${n} with a negative radius: ${args}`);
      } else if (n === 'fillText' || n === 'strokeText') {
        if (n === 'fillText') calls.texts.add(String(args[0]));
        finite(args[1], 'text x');
        finite(args[2], 'text y');
      }
    };
  }
  return ctx;
}

export class FakeCanvas {
  constructor(w = 300, h = 150) {
    this.width = w;
    this.height = h;
    this.style = {};
    this.ctx = null;
    this.listeners = new Map();
  }
  getContext() {
    if (!this.ctx) this.ctx = makeContext(this);
    return this.ctx;
  }
  addEventListener(type, fn) {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
  }
  dispatch(type, ev) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
}

class FakeParam {
  constructor(v = 0) {
    this.value = v;
  }
  setValueAtTime(v, t) {
    finite(v, 'param value');
    finite(t, 'param time');
  }
  exponentialRampToValueAtTime(v, t) {
    if (!(v > 0)) throw new Error(`exponential ramp to ${v} (must be positive)`);
    finite(t, 'ramp time');
  }
  setTargetAtTime(v, t, k) {
    finite(v, 'target');
    finite(t, 'target time');
    if (!(k > 0)) throw new Error('time constant must be positive');
  }
}

class FakeNode {
  constructor() {
    this.gain = new FakeParam(1);
    this.frequency = new FakeParam(440);
    this.Q = new FakeParam(1);
    this.threshold = new FakeParam();
    this.knee = new FakeParam();
    this.ratio = new FakeParam();
    this.attack = new FakeParam();
    this.release = new FakeParam();
  }
  connect() {}
  disconnect() {}
  start(t, off) {
    finite(t, 'start time');
    if (off !== undefined) finite(off, 'start offset');
  }
  stop(t) {
    finite(t, 'stop time');
  }
}

export class FakeAudioContext {
  static clock = () => 0;
  get currentTime() {
    return FakeAudioContext.clock();
  }
  constructor() {
    this.sampleRate = 8000;
    this.state = 'running';
    this.destination = new FakeNode();
    this.nodes = 0;
  }
  resume() {}
  createGain() {
    this.nodes++;
    return new FakeNode();
  }
  createDynamicsCompressor() {
    return new FakeNode();
  }
  createBiquadFilter() {
    return new FakeNode();
  }
  createOscillator() {
    this.nodes++;
    return new FakeNode();
  }
  createBufferSource() {
    this.nodes++;
    return new FakeNode();
  }
  createBuffer(ch, len) {
    return { getChannelData: () => new Float32Array(len) };
  }
}

/** Installs the globals the game's modules look for. Returns a controller to drive frames and events. */
export function installDom({ width = 1280, height = 720, search = '', touch = false } = {}) {
  const canvas = new FakeCanvas(width, height);
  const winListeners = new Map();
  const docListeners = new Map();
  let frameCb = null;
  const body = { dataset: {}, style: {} };
  const doc = {
    body,
    hidden: false,
    getElementById: () => canvas,
    createElement: (tag) => {
      if (tag === 'canvas') return new FakeCanvas(1, 1);
      return { style: {} };
    },
    addEventListener(type, fn) {
      let set = docListeners.get(type);
      if (!set) docListeners.set(type, (set = new Set()));
      set.add(fn);
    },
    fonts: { load: () => Promise.resolve([]), ready: Promise.resolve() },
  };
  const win = globalThis;
  const fake = {
    canvas,
    now: 0,
    errors: [],
    frames: 0,
  };
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.location = { search };
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', maxTouchPoints: touch ? 5 : 0 }, configurable: true });
  globalThis.innerWidth = width;
  globalThis.innerHeight = height;
  globalThis.devicePixelRatio = 1;
  globalThis.addEventListener = (type, fn) => {
    let set = winListeners.get(type);
    if (!set) winListeners.set(type, (set = new Set()));
    set.add(fn);
  };
  globalThis.requestAnimationFrame = (cb) => {
    frameCb = cb;
    return 1;
  };
  globalThis.matchMedia = () => ({ matches: touch });
  globalThis.performance = { now: () => fake.now };
  globalThis.AudioContext = FakeAudioContext;
  globalThis.Image = class {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      this.width = 0;
      this.height = 0;
    }
  };
  globalThis.localStorage = (() => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
  })();
  // timers and the date follow the test's clock
  const timers = [];
  const baseDate = 1.7e12;
  Date.now = () => baseDate + fake.now;
  globalThis.setTimeout = (fn, ms = 0) => {
    const t = { at: fake.now + ms, fn, every: 0 };
    timers.push(t);
    return t;
  };
  globalThis.setInterval = (fn, ms = 0) => {
    const t = { at: fake.now + ms, fn, every: Math.max(1, ms) };
    timers.push(t);
    return t;
  };
  globalThis.clearTimeout = globalThis.clearInterval = (t) => {
    const i = timers.indexOf(t);
    if (i >= 0) timers.splice(i, 1);
  };
  FakeAudioContext.clock = () => fake.now / 1000;
  const runTimers = () => {
    for (let guard = 0; guard < 1000; guard++) {
      const due = timers.filter((t) => t.at <= fake.now).sort((a, b) => a.at - b.at)[0];
      if (!due) return;
      if (due.every) due.at += due.every;
      else timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
  };
  const origError = console.error;
  console.error = (...a) => {
    fake.errors.push(a.map(String).join(' '));
  };
  fake.restoreConsole = () => {
    console.error = origError;
  };
  fake.frame = (ms = 1000 / 60) => {
    fake.now += ms;
    runTimers();
    const cb = frameCb;
    frameCb = null;
    if (cb) {
      cb(fake.now);
      fake.frames++;
    }
  };
  fake.frames_for = (seconds) => {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) fake.frame();
  };
  fake.key = (type, code, extra = {}) => {
    const ev = { code, key: code, repeat: false, metaKey: false, ctrlKey: false, altKey: false, preventDefault() {}, ...extra };
    for (const fn of winListeners.get(type) ?? []) fn(ev);
  };
  fake.pointer = (type, x, y) => {
    const ev = { clientX: x, clientY: y, preventDefault() {}, pointerType: 'mouse' };
    canvas.dispatch(type, ev);
  };
  fake.resize = (w, h) => {
    globalThis.innerWidth = w;
    globalThis.innerHeight = h;
    for (const fn of winListeners.get('resize') ?? []) fn({});
  };
  return fake;
}
