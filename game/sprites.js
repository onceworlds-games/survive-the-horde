// Pre-drawn monster and gem sprites (so hundreds of monsters are one drawImage each), rebuilt when the zoom changes.
// The boss and the heroes are drawn live. A fake canvas can be injected for tests.
import { drawMonster, drawShadow, drawGem, setWhite, GEM_GLOW } from './art.js';
import { MON_R, T_BOSS } from './data.js';

let factory = (w, h) => {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
};
export function setCanvasFactory(fn) {
  factory = fn;
}
export function newCanvas(w, h) {
  return factory(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
}

const GEM_R = [0.3, 0.38, 0.5]; // world units

export class SpriteSet {
  constructor() {
    this.px = 0; // device pixels per world unit the set was built for
    this.mon = []; // mon[type][dir][frame] = canvas (dir 0 right, 1 left)
    this.white = [];
    this.info = []; // per type: { ox, oy } origin in canvas pixels, and the art unit k
    this.gem = [];
    this.gemInfo = [];
    this.glow = null;
  }

  /** Builds (or rebuilds when the zoom moved by more than ~12%) for `px` device pixels per world unit. */
  ensure(px) {
    if (this.px > 0 && Math.abs(px - this.px) / this.px < 0.12) return false;
    this.build(px);
    return true;
  }

  build(px) {
    this.px = px;
    this.mon = [];
    this.white = [];
    this.info = [];
    for (let type = 0; type < MON_R.length; type++) {
      if (type === T_BOSS) {
        this.mon.push(null);
        this.white.push(null);
        this.info.push(null);
        continue;
      }
      const k = Math.max(3, px * MON_R[type]);
      const w = Math.ceil(4 * k) + 2;
      const h = Math.ceil(4 * k) + 2;
      const ox = w / 2;
      const oy = Math.ceil(2.3 * k) + 1;
      const set = [[], []];
      const wset = [[], []];
      for (let dir = 0; dir < 2; dir++) {
        for (let frame = 0; frame < 2; frame++) {
          for (let white = 0; white < 2; white++) {
            const c = newCanvas(w, h);
            const g = c.getContext('2d');
            if (!g) continue;
            g.setTransform(dir === 0 ? k : -k, 0, 0, k, ox, oy);
            setWhite(white === 1);
            if (white === 0) {
              if (type === 1) drawShadow(g, 0, 1.55, 0.6, 0.2, 0.22);
              else drawShadow(g, 0, 1.05, 0.95, 0.36, 0.4);
            }
            drawMonster(g, type, frame);
            setWhite(false);
            (white === 0 ? set : wset)[dir][frame] = c;
          }
        }
      }
      this.mon.push(set);
      this.white.push(wset);
      this.info.push({ k, ox, oy, w, h });
    }
    this.gem = [];
    this.gemInfo = [];
    for (let t = 0; t < 3; t++) {
      const k = Math.max(3, px * GEM_R[t]);
      const s = Math.ceil(7 * k);
      const c = newCanvas(s, s);
      const g = c.getContext('2d');
      const o = s / 2;
      if (g) {
        // glow, then the stone
        const gr = g.createRadialGradient(o, o, 0, o, o, 3.4 * k);
        gr.addColorStop(0, GEM_GLOW[t] + 'aa');
        gr.addColorStop(1, GEM_GLOW[t] + '00');
        g.fillStyle = gr;
        g.fillRect(0, 0, s, s);
        g.setTransform(k, 0, 0, k, o, o);
        setWhite(false);
        drawGem(g, t);
      }
      this.gem.push(c);
      this.gemInfo.push({ s, o });
    }
    const gs = 64;
    this.glow = newCanvas(gs, gs);
    const gg = this.glow.getContext('2d');
    if (gg) {
      const gr = gg.createRadialGradient(gs / 2, gs / 2, 0, gs / 2, gs / 2, gs / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.3, 'rgba(255,255,255,0.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      gg.fillStyle = gr;
      gg.fillRect(0, 0, gs, gs);
    }
  }
}
