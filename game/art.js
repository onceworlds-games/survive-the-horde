// Vector art for the monsters, the hero, the dummy and the badges. Every function draws into a context already moved so
// that its origin is the middle of the figure and 1 unit is about the figure's radius. Monsters face right (the caller
// flips them). `setWhite(true)` makes everything a flat white silhouette (the hit flash).
//
// Look: dark outlines, two-tone shading, one accent colour per monster; crisp, not cute.

let WHITE = false;
export function setWhite(on) {
  WHITE = on;
}
const C = (c) => (WHITE ? '#ffffff' : c);

const INK = '#0a0d14';
const TAU = Math.PI * 2;

function lin(g, x0, y0, x1, y1, c0, c1) {
  if (WHITE) return '#ffffff';
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, c0);
  gr.addColorStop(1, c1);
  return gr;
}

function rad(g, x, y, r0, r1, c0, c1) {
  if (WHITE) return '#ffffff';
  const gr = g.createRadialGradient(x, y, r0, x, y, r1);
  gr.addColorStop(0, c0);
  gr.addColorStop(1, c1);
  return gr;
}

function ell(g, x, y, rx, ry, fill, lw = 0.08, stroke = INK) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.001, rx), Math.max(0.001, ry), 0, 0, TAU);
  g.fillStyle = fill;
  g.fill();
  if (lw > 0) {
    g.lineWidth = lw;
    g.strokeStyle = C(stroke);
    g.stroke();
  }
}

/** A closed polygon from [x, y, x, y, ...]. */
function poly(g, pts, fill, lw = 0.08, stroke = INK) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (lw > 0) {
    g.lineWidth = lw;
    g.lineJoin = 'round';
    g.strokeStyle = C(stroke);
    g.stroke();
  }
}

/** A limb: a thick line with round ends and an outline. */
function limb(g, x0, y0, x1, y1, w, fill) {
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.strokeStyle = C(INK);
  g.lineWidth = w + 0.14;
  g.stroke();
  g.strokeStyle = fill;
  g.lineWidth = w;
  g.stroke();
}

function glowDot(g, x, y, r, col) {
  // a bright dot with a soft ring: the accent colour of each monster (flat white in a flash)
  g.beginPath();
  g.arc(x, y, r * 1.9, 0, TAU);
  g.fillStyle = WHITE ? '#ffffff' : col + '55';
  g.fill();
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = C(col);
  g.fill();
}

export function drawShadow(g, x, y, rx, ry, alpha = 0.38) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, TAU);
  g.fillStyle = `rgba(0,0,0,${alpha})`;
  g.fill();
}

// ---------------------------------------------------------------- monsters
const BONE = '#e9e3cf';
const BONE_D = '#b9b196';

function skeleton(g, f) {
  const sw = f ? 1 : -1;
  limb(g, -0.5, -0.3, -0.85, 0.12 + 0.16 * sw, 0.14, C(BONE_D));
  limb(g, -0.2, 0.65, -0.22 - 0.2 * sw, 1.12, 0.17, C(BONE_D));
  limb(g, 0.2, 0.65, 0.22 + 0.2 * sw, 1.12, 0.17, C(BONE));
  // ribcage
  ell(g, 0, 0.02, 0.62, 0.78, lin(g, -0.6, -0.7, 0.6, 0.8, '#f6f0dc', '#b4ac90'));
  g.strokeStyle = C('#3a362a');
  g.lineWidth = 0.07;
  g.lineCap = 'round';
  for (const yy of [-0.3, 0, 0.3]) {
    g.beginPath();
    g.moveTo(-0.42, yy);
    g.quadraticCurveTo(0, yy + 0.14, 0.42, yy);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, -0.62);
    g.lineTo(0, 0.62);
  g.stroke();
  ell(g, 0, 0.66, 0.42, 0.2, lin(g, -0.4, 0.5, 0.4, 0.9, BONE, BONE_D), 0.07);
  // the arm with the rusty blade
  const ax = 1.05;
  const ay = -0.05 - 0.16 * sw;
  limb(g, 0.5, -0.3, ax, ay, 0.15, C(BONE));
  poly(g, [ax - 0.05, ay + 0.05, ax + 0.55, ay - 0.75, ax + 0.7, ay - 0.68, ax + 0.12, ay + 0.14], lin(g, ax, ay, ax + 0.7, ay - 0.7, '#c8cfd8', '#7c8795'), 0.07);
  limb(g, ax - 0.12, ay + 0.1, ax + 0.14, ay - 0.1, 0.1, C('#6b4a2a'));
  // skull
  ell(g, 0.1, -1.0, 0.52, 0.5, lin(g, -0.3, -1.5, 0.5, -0.5, '#fbf6e6', '#c4bc9f'));
  ell(g, 0.16, -0.62, 0.34, 0.2, lin(g, -0.2, -0.8, 0.4, -0.45, BONE, BONE_D), 0.07);
  ell(g, -0.06, -1.04, 0.14, 0.18, C('#0b0d12'), 0);
  ell(g, 0.3, -1.04, 0.14, 0.18, C('#0b0d12'), 0);
  glowDot(g, -0.06, -1.04, 0.07, '#9fe8ff');
  glowDot(g, 0.3, -1.04, 0.07, '#9fe8ff');
  g.beginPath();
  g.moveTo(0.1, -0.88);
  g.lineTo(0.04, -0.76);
  g.lineTo(0.16, -0.76);
  g.closePath();
  g.fillStyle = C('#1a1c22');
  g.fill();
  g.strokeStyle = C('#3a362a');
  g.lineWidth = 0.05;
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.moveTo(0.02 + i * 0.12, -0.7);
    g.lineTo(0.02 + i * 0.12, -0.54);
    g.stroke();
  }
}

function bat(g, f) {
  const up = f === 0;
  // wings behind the body
  for (const s of [-1, 1]) {
    const tipY = up ? -1.25 : 0.55;
    const midY = up ? -0.7 : 0.45;
    g.beginPath();
    g.moveTo(s * 0.3, -0.1);
    g.quadraticCurveTo(s * 1.0, midY - 0.3, s * 1.95, tipY);
    g.quadraticCurveTo(s * 1.65, tipY + (up ? 0.55 : -0.2), s * 1.5, tipY + (up ? 0.65 : -0.05));
    g.quadraticCurveTo(s * 1.3, tipY + (up ? 0.9 : 0.15), s * 1.05, tipY + (up ? 1.0 : 0.3));
    g.quadraticCurveTo(s * 0.75, tipY + (up ? 1.25 : 0.55), s * 0.4, 0.55);
    g.closePath();
    g.fillStyle = lin(g, 0, -1, s * 2, 0.8, '#5a2a86', '#25103d');
    g.fill();
    g.lineWidth = 0.08;
    g.lineJoin = 'round';
    g.strokeStyle = C(INK);
    g.stroke();
    g.strokeStyle = C('#ff4fd8');
    g.lineWidth = 0.05;
    g.beginPath();
    g.moveTo(s * 0.3, -0.1);
    g.quadraticCurveTo(s * 1.0, midY - 0.3, s * 1.95, tipY);
    g.stroke();
  }
  ell(g, 0, 0.15, 0.4, 0.55, lin(g, -0.4, -0.4, 0.4, 0.7, '#4b2370', '#1e0f30'));
  ell(g, 0, -0.42, 0.34, 0.31, lin(g, -0.3, -0.7, 0.3, -0.1, '#5b2c85', '#27123d'));
  poly(g, [-0.28, -0.6, -0.4, -1.05, -0.08, -0.7], C('#3d1b5c'), 0.07);
  poly(g, [0.28, -0.6, 0.4, -1.05, 0.08, -0.7], C('#3d1b5c'), 0.07);
  glowDot(g, -0.12, -0.45, 0.065, '#ff4fd8');
  glowDot(g, 0.12, -0.45, 0.065, '#ff4fd8');
  poly(g, [-0.08, -0.22, -0.04, -0.08, 0.0, -0.22], C('#ffffff'), 0.03);
  poly(g, [0.0, -0.22, 0.04, -0.08, 0.08, -0.22], C('#ffffff'), 0.03);
}

function slime(g, f) {
  const wide = f === 0;
  const top = wide ? -0.8 : -1.0;
  const hw = wide ? 1.15 : 1.0;
  g.beginPath();
  g.moveTo(-hw, 0.95);
  g.bezierCurveTo(-hw - 0.1, 0.1, -0.7, top, 0, top);
  g.bezierCurveTo(0.7, top, hw + 0.1, 0.1, hw, 0.95);
  g.quadraticCurveTo(hw * 0.7, 1.12, hw * 0.45, 0.98);
  g.quadraticCurveTo(hw * 0.2, 1.2, 0, 1.0);
  g.quadraticCurveTo(-hw * 0.3, 1.14, -hw * 0.5, 0.98);
  g.quadraticCurveTo(-hw * 0.8, 1.1, -hw, 0.95);
  g.closePath();
  g.fillStyle = rad(g, -0.3, -0.3, 0.1, 1.5, '#a6ff6b', '#1f7a2a');
  g.fill();
  g.lineWidth = 0.09;
  g.lineJoin = 'round';
  g.strokeStyle = C(INK);
  g.stroke();
  // what it dissolves: a half-eaten skull
  g.globalAlpha = WHITE ? 1 : 0.45;
  ell(g, 0.1, 0.1, 0.36, 0.32, C('#d6ffc4'), 0);
  ell(g, 0.0, 0.05, 0.08, 0.1, C('#1c5a1c'), 0);
  ell(g, 0.22, 0.05, 0.08, 0.1, C('#1c5a1c'), 0);
  g.globalAlpha = 1;
  // shine and bubbles
  g.beginPath();
  g.ellipse(-0.45, -0.35, 0.22, 0.12, -0.6, 0, TAU);
  g.fillStyle = C('rgba(255,255,255,0.55)');
  g.fill();
  for (const [bx, by, br] of [[0.5, -0.25, 0.1], [-0.15, 0.4, 0.08], [0.62, 0.35, 0.06]]) {
    g.beginPath();
    g.arc(bx, by, br, 0, TAU);
    g.strokeStyle = C('rgba(220,255,200,0.7)');
    g.lineWidth = 0.04;
    g.stroke();
  }
}

function ghoul(g, f) {
  const sw = f ? 1 : -1;
  // legs
  limb(g, -0.25, 0.55, -0.3 - 0.2 * sw, 1.1, 0.2, C('#4a5a3a'));
  limb(g, 0.25, 0.55, 0.3 + 0.2 * sw, 1.1, 0.2, C('#58694a'));
  // hunched torso
  poly(g, [-0.6, -0.4, -0.3, -0.85, 0.35, -0.8, 0.75, -0.1, 0.55, 0.7, -0.5, 0.7], lin(g, -0.6, -0.8, 0.7, 0.7, '#8a9c70', '#4f5e3f'));
  // spine spikes
  for (let i = 0; i < 4; i++) poly(g, [-0.55 + i * 0.12, -0.45 + i * 0.22, -0.8 + i * 0.12, -0.7 + i * 0.22, -0.45 + i * 0.12, -0.28 + i * 0.22], C('#d7d3b8'), 0.05);
  // rags
  poly(g, [-0.5, 0.45, 0.5, 0.45, 0.6, 0.95, 0.2, 0.8, -0.1, 1.0, -0.6, 0.85], C('#4a3526'), 0.07);
  // long arms with claws
  limb(g, 0.4, -0.35, 1.05, 0.25 + 0.14 * sw, 0.17, C('#8a9c70'));
  limb(g, -0.3, -0.4, 0.55, 0.55 - 0.14 * sw, 0.17, C('#6f805a'));
  for (let i = -1; i <= 1; i++) {
    poly(g, [1.05, 0.25 + 0.14 * sw + i * 0.07, 1.4, 0.35 + 0.14 * sw + i * 0.12, 1.08, 0.33 + 0.14 * sw + i * 0.07], C('#e9e3cf'), 0.04);
  }
  // sunken head
  ell(g, 0.5, -0.78, 0.4, 0.38, lin(g, 0.2, -1.2, 0.8, -0.4, '#a7b88a', '#60704c'));
  ell(g, 0.62, -0.7, 0.2, 0.17, C('#1b2014'), 0);
  glowDot(g, 0.5, -0.86, 0.07, '#ff9a3a');
  glowDot(g, 0.72, -0.84, 0.07, '#ff9a3a');
  g.strokeStyle = C(INK);
  g.lineWidth = 0.05;
  g.beginPath();
  g.moveTo(0.52, -0.58);
  g.lineTo(0.78, -0.6);
  g.stroke();
}

function knight(g, f) {
  const sw = f ? 1 : -1;
  const steel = lin(g, -0.7, -1.0, 0.7, 0.9, '#cdd5e2', '#56607a');
  limb(g, -0.22, 0.6, -0.25 - 0.14 * sw, 1.12, 0.26, C('#59627a'));
  limb(g, 0.22, 0.6, 0.25 + 0.14 * sw, 1.12, 0.26, C('#6c7690'));
  // cape
  poly(g, [-0.6, -0.5, -1.0, 0.5, -0.8, 0.95, -0.3, 0.7], C('#2a2036'), 0.07);
  // body
  poly(g, [-0.62, -0.55, 0.62, -0.55, 0.7, 0.2, 0.45, 0.78, -0.45, 0.78, -0.7, 0.2], steel);
  g.strokeStyle = C('#ffd24a');
  g.lineWidth = 0.06;
  g.beginPath();
  g.moveTo(0, -0.5);
  g.lineTo(0, 0.7);
  g.moveTo(-0.5, 0.1);
  g.lineTo(0.5, 0.1);
  g.stroke();
  // pauldrons
  ell(g, -0.66, -0.5, 0.3, 0.26, lin(g, -0.9, -0.8, -0.4, -0.2, '#d6deeb', '#5c6680'));
  ell(g, 0.66, -0.5, 0.3, 0.26, lin(g, 0.4, -0.8, 0.9, -0.2, '#d6deeb', '#5c6680'));
  // shield on the near side and the sword
  poly(g, [0.45, -0.25, 1.15, -0.25, 1.15, 0.3, 0.8, 0.8, 0.45, 0.3], lin(g, 0.45, -0.3, 1.1, 0.8, '#7d889f', '#3f475b'), 0.08);
  poly(g, [0.8, -0.1, 0.95, 0.15, 0.8, 0.55, 0.65, 0.15], C('#ffd24a'), 0.04);
  limb(g, -0.7, -0.3, -1.05, 0.1 + 0.1 * sw, 0.17, C('#aab4c6'));
  poly(g, [-1.1, 0.05 + 0.1 * sw, -1.0, -0.05 + 0.1 * sw, -1.25, -1.0, -1.35, -0.92], lin(g, -1.1, 0, -1.3, -1, '#e8edf5', '#8d99ad'), 0.05);
  // helmet
  poly(g, [-0.42, -0.5, -0.4, -1.12, -0.1, -1.4, 0.1, -1.4, 0.4, -1.12, 0.42, -0.5], lin(g, -0.4, -1.4, 0.4, -0.5, '#dfe6f1', '#5a647e'));
  poly(g, [0.0, -1.4, 0.12, -1.6, 0.28, -1.38], C('#ffd24a'), 0.04);
  g.beginPath();
  g.rect(-0.3, -1.0, 0.7, 0.14);
  g.fillStyle = C('#0b0d12');
  g.fill();
  glowDot(g, 0.02, -0.93, 0.07, '#ffd24a');
  glowDot(g, 0.3, -0.93, 0.07, '#ffd24a');
}

function boss(g, f) {
  const sw = f ? 1 : -1;
  // cape tatters behind
  g.beginPath();
  g.moveTo(-0.5, -0.8);
  g.quadraticCurveTo(-1.6, 0.2, -1.5 - 0.1 * sw, 1.3);
  g.lineTo(-1.1, 1.0);
  g.lineTo(-0.85, 1.35);
  g.lineTo(-0.5, 1.0);
  g.lineTo(-0.2, 1.3);
  g.lineTo(0.2, 0.9);
  g.closePath();
  g.fillStyle = lin(g, -1.5, -0.8, 0, 1.3, '#3a1d4a', '#0d0713');
  g.fill();
  g.lineWidth = 0.05;
  g.strokeStyle = C(INK);
  g.stroke();
  // legs
  limb(g, -0.35, 0.7, -0.4 - 0.1 * sw, 1.35, 0.5, C('#1d1626'));
  limb(g, 0.35, 0.7, 0.4 + 0.1 * sw, 1.35, 0.5, C('#271c33'));
  // torso armour
  poly(g, [-0.75, -0.7, 0.75, -0.7, 0.9, 0.0, 0.55, 0.85, -0.55, 0.85, -0.9, 0.0], lin(g, -0.8, -0.8, 0.8, 0.9, '#41364f', '#120c1a'), 0.06);
  // glowing cracks
  g.strokeStyle = C('#ff2a3a');
  g.lineWidth = 0.05;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(0, -0.55);
  g.lineTo(-0.12, -0.2);
  g.lineTo(0.1, 0.1);
  g.lineTo(-0.08, 0.55);
  g.moveTo(-0.12, -0.2);
  g.lineTo(-0.45, 0.0);
  g.moveTo(0.1, 0.1);
  g.lineTo(0.42, 0.28);
  g.stroke();
  // spiked pauldrons
  for (const s of [-1, 1]) {
    ell(g, s * 0.92, -0.6, 0.42, 0.32, lin(g, s * 0.6, -1, s * 1.3, 0, '#4a3c5c', '#150e1f'), 0.06);
    poly(g, [s * 0.8, -0.85, s * 0.95, -1.5, s * 1.1, -0.78], C('#c9bfd8'), 0.05);
    poly(g, [s * 1.1, -0.7, s * 1.5, -1.05, s * 1.3, -0.5], C('#c9bfd8'), 0.05);
  }
  // the greataxe
  limb(g, 1.0, -0.2, 1.55, 0.4 - 0.12 * sw, 0.2, C('#3a2a1a'));
  poly(g, [1.35, -0.4 - 0.12 * sw, 2.0, -0.95 - 0.12 * sw, 2.05, 0.2 - 0.12 * sw, 1.4, 0.0 - 0.12 * sw], lin(g, 1.35, -0.8, 2.0, 0.2, '#b9bfd0', '#3b4256'), 0.06);
  g.strokeStyle = C('#ff2a3a');
  g.lineWidth = 0.05;
  g.beginPath();
  g.moveTo(1.65, -0.2 - 0.12 * sw);
  g.lineTo(1.95, -0.7 - 0.12 * sw);
  g.stroke();
  limb(g, -0.95, -0.2, -1.2, 0.5 + 0.1 * sw, 0.26, C('#2b2038'));
  // the horned helm
  ell(g, 0.05, -1.1, 0.55, 0.52, lin(g, -0.4, -1.6, 0.5, -0.6, '#4d4060', '#150e1f'), 0.06);
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(s * 0.35, -1.35);
    g.quadraticCurveTo(s * 1.0, -1.5, s * 0.85, -2.2);
    g.quadraticCurveTo(s * 0.62, -1.7, s * 0.2, -1.55);
    g.closePath();
    g.fillStyle = lin(g, s * 0.3, -1.4, s * 0.9, -2.2, '#e9e1d2', '#8d8272');
    g.fill();
    g.lineWidth = 0.06;
    g.strokeStyle = C(INK);
    g.stroke();
  }
  g.beginPath();
  g.ellipse(0.12, -1.05, 0.4, 0.2, 0, 0, TAU);
  g.fillStyle = C('#05060a');
  g.fill();
  glowDot(g, -0.08, -1.06, 0.1, '#ff2a3a');
  glowDot(g, 0.32, -1.06, 0.1, '#ff2a3a');
}

function dummy(g) {
  // a training post: a pole, a crossbar, a straw body and a target
  limb(g, 0, -1.0, 0, 1.1, 0.34, C('#6b4a2a'));
  limb(g, -0.85, -0.45, 0.85, -0.45, 0.22, C('#7b5632'));
  ell(g, 0, -0.05, 0.62, 0.62, rad(g, -0.15, -0.2, 0.1, 0.8, '#e9d28a', '#a88a3c'), 0.08);
  g.strokeStyle = C('#8a6a2a');
  g.lineWidth = 0.04;
  for (let i = -2; i <= 2; i++) {
    g.beginPath();
    g.moveTo(i * 0.2, -0.45);
    g.lineTo(i * 0.2 + 0.05, 0.35);
    g.stroke();
  }
  ell(g, 0.05, -0.05, 0.4, 0.4, C('#f2efe6'), 0.05);
  ell(g, 0.05, -0.05, 0.29, 0.29, C('#d8322d'), 0);
  ell(g, 0.05, -0.05, 0.18, 0.18, C('#f2efe6'), 0);
  ell(g, 0.05, -0.05, 0.08, 0.08, C('#d8322d'), 0);
  ell(g, 0, -1.15, 0.28, 0.26, rad(g, -0.1, -1.2, 0.05, 0.4, '#e9d28a', '#a88a3c'), 0.07);
}

const MONSTER_DRAW = [skeleton, bat, slime, ghoul, knight, boss, dummy];

/** Draws monster `type` (frame 0 or 1) facing right, origin at its middle. Shadow is the caller's. */
export function drawMonster(g, type, frame) {
  const fn = MONSTER_DRAW[type] ?? skeleton;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  fn(g, frame & 1);
}

/** The accent colour of each monster (UI, glows and the boss bar). */
export const ACCENT = ['#9fe8ff', '#ff4fd8', '#7dff3a', '#ff9a3a', '#ffd24a', '#ff2a3a', '#ffd24a'];

// ---------------------------------------------------------------- heroes
/**
 * A hooded ranger in the player's colour. o: { color, dark, dx, dy (facing), walk (phase), side (+1 staff on the right),
 * moving, ghost, glow (0..1 pulse) }. Origin: the middle of the body; ~3.2 units tall.
 */
export function drawHero(g, o) {
  const { color, dark, dx, dy } = o;
  const side = o.side >= 0 ? 1 : -1;
  const bob = o.moving ? Math.sin(o.walk * 2) * 0.07 : Math.sin((o.t || 0) * 2.2) * 0.03;
  const lean = o.moving ? dx * 0.12 : 0;
  const ghost = o.ghost === true;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.save();
  g.translate(0, bob);
  if (ghost) g.globalAlpha = 0.55;
  const cloak = ghost ? lin(g, 0, -1, 0, 1.2, '#dff6ff', '#6fa8d8') : lin(g, 0, -1.2, 0, 1.2, color, dark);
  const cloakD = ghost ? '#9cc8ea' : dark;
  const outline = ghost ? 0.05 : 0.09;
  // boots
  if (!ghost) {
    const st = o.moving ? Math.sin(o.walk * 2) * 0.22 : 0;
    ell(g, -0.35 + st * 0.5, 1.05 - Math.abs(st) * 0.2, 0.26, 0.17, C('#1b1e27'), 0.06);
    ell(g, 0.35 - st * 0.5, 1.05 - Math.abs(-st) * 0.2, 0.26, 0.17, C('#242833'), 0.06);
  }
  // the staff behind the near hand
  const sx = side * 1.0 + lean;
  limb(g, sx, -1.15, sx - side * 0.05, 1.0, 0.1, C(ghost ? '#c8e6fa' : '#6b4a2a'));
  // cloak: a bell with a ragged hem
  g.beginPath();
  g.moveTo(-0.62 + lean, -0.75);
  g.bezierCurveTo(-0.8 + lean, -0.1, -1.05 + lean * 0.5, 0.55, -0.95, 1.0);
  const sway = o.moving ? Math.sin(o.walk * 2 + 1) * 0.08 : 0;
  g.lineTo(-0.6, 0.92 + sway);
  g.lineTo(-0.3, 1.05 - sway);
  g.lineTo(0.05, 0.93 + sway);
  g.lineTo(0.4, 1.06 - sway);
  g.lineTo(0.7, 0.92 + sway);
  g.lineTo(0.95, 1.0);
  g.bezierCurveTo(1.05 + lean * 0.5, 0.55, 0.8 + lean, -0.1, 0.62 + lean, -0.75);
  g.closePath();
  g.fillStyle = cloak;
  g.fill();
  g.lineWidth = outline;
  g.strokeStyle = C(ghost ? '#6fa8d8' : INK);
  g.stroke();
  // cloak folds and a leather strap
  g.strokeStyle = C(cloakD);
  g.lineWidth = 0.06;
  g.beginPath();
  g.moveTo(-0.3, 0.1);
  g.lineTo(-0.38, 0.9);
  g.moveTo(0.25, 0.15);
  g.lineTo(0.32, 0.92);
  g.stroke();
  if (!ghost) {
    g.strokeStyle = C('#5a3b22');
    g.lineWidth = 0.13;
    g.beginPath();
    g.moveTo(-0.55 + lean, -0.55);
    g.lineTo(0.5 + lean, 0.55);
    g.stroke();
    ell(g, 0.0 + lean, 0.0, 0.1, 0.1, C('#e0b24a'), 0.04);
  }
  // the hand and the arm toward the staff
  limb(g, side * 0.55 + lean, -0.35, sx, -0.2, 0.2, C(ghost ? '#9cc8ea' : color));
  ell(g, sx, -0.2, 0.13, 0.13, C(ghost ? '#e9f8ff' : '#d9b08c'), 0.05);
  // the hood
  const hx = lean * 1.3;
  g.beginPath();
  g.moveTo(hx - 0.7, -0.75);
  g.bezierCurveTo(hx - 0.85, -1.45, hx - 0.4, -2.0, hx + 0.02, -2.15);
  g.bezierCurveTo(hx + 0.45, -2.0, hx + 0.85, -1.45, hx + 0.7, -0.75);
  g.bezierCurveTo(hx + 0.4, -0.6, hx - 0.4, -0.6, hx - 0.7, -0.75);
  g.closePath();
  g.fillStyle = ghost ? lin(g, 0, -2, 0, -0.7, '#f4fcff', '#8fbde0') : lin(g, hx - 0.7, -2.1, hx + 0.7, -0.7, lighten(color, 0.06), darken(dark, 0.15));
  g.fill();
  g.lineWidth = outline;
  g.strokeStyle = C(ghost ? '#6fa8d8' : INK);
  g.stroke();
  // face void and eyes: looking where the hero goes (a back view when walking away)
  const faceOn = dy > -0.45;
  if (faceOn) {
    const fx = hx + dx * 0.2;
    const fy = -1.3 + dy * 0.12;
    g.beginPath();
    g.ellipse(fx, fy, 0.42, 0.48, 0, 0, TAU);
    g.fillStyle = C(ghost ? '#274a66' : '#06080d');
    g.fill();
    const ex = 0.16;
    glowDot(g, fx - ex + dx * 0.09, fy - 0.05, 0.065, ghost ? '#ffffff' : '#bff6ff');
    glowDot(g, fx + ex + dx * 0.09, fy - 0.05, 0.065, ghost ? '#ffffff' : '#bff6ff');
  } else if (!WHITE) {
    g.strokeStyle = C(darken(dark, 0.2));
    g.lineWidth = 0.07;
    g.beginPath();
    g.moveTo(hx, -2.0);
    g.lineTo(hx, -0.85);
    g.stroke();
  }
  // rim light on the hood
  if (!WHITE && !ghost) {
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 0.07;
    g.beginPath();
    g.moveTo(hx - 0.62, -1.25);
    g.bezierCurveTo(hx - 0.6, -1.7, hx - 0.3, -1.98, hx - 0.05, -2.07);
    g.stroke();
  }
  // the glowing crystal on the staff
  const pulse = 0.85 + 0.15 * Math.sin((o.t || 0) * 5);
  const cy = -1.35;
  if (!WHITE) {
    const gr = g.createRadialGradient(sx, cy, 0, sx, cy, 0.75 * pulse);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.35, ghost ? 'rgba(180,230,255,0.5)' : hexA(color, 0.55));
    gr.addColorStop(1, hexA(color, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(sx, cy, 0.75 * pulse, 0, TAU);
    g.fill();
  }
  poly(g, [sx, cy - 0.26, sx + 0.17, cy, sx, cy + 0.26, sx - 0.17, cy], C('#ffffff'), 0.05);
  g.restore();
}

function parseHex(c) {
  const h = c.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function hexA(c, a) {
  const [r, g, b] = parseHex(c);
  return `rgba(${r},${g},${b},${a})`;
}
export function lighten(c, k) {
  const [r, g, b] = parseHex(c);
  const f = (v) => Math.round(v + (255 - v) * k);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
export function darken(c, k) {
  const [r, g, b] = parseHex(c);
  const f = (v) => Math.round(v * (1 - k));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// ---------------------------------------------------------------- gems
const GEM_COLORS = [
  ['#c9ffd8', '#5dff9a', '#1f9a52'],
  ['#d3ecff', '#4aa8ff', '#1f5fb8'],
  ['#ecd0ff', '#c06bff', '#6a2aa8'],
];
/** An XP gem of tier 0..2: a faceted diamond, ~2 units tall. */
export function drawGem(g, tier) {
  const [hi, mid, lo] = GEM_COLORS[tier] ?? GEM_COLORS[0];
  const w = 0.72;
  const h = 1.0;
  g.lineJoin = 'round';
  poly(g, [0, -h, w, -0.1, 0, h, -w, -0.1], lin(g, -w, -h, w, h, hi, lo), 0.12);
  poly(g, [0, -h, w, -0.1, 0, 0.1], C(mid), 0);
  poly(g, [0, -h, -w, -0.1, 0, 0.1], C(hi), 0);
  poly(g, [0, 0.1, w, -0.1, 0, h], C(lo), 0);
  g.beginPath();
  g.moveTo(0, -h);
  g.lineTo(w, -0.1);
  g.lineTo(0, h);
  g.lineTo(-w, -0.1);
  g.closePath();
  g.lineWidth = 0.1;
  g.strokeStyle = C(INK);
  g.stroke();
  g.beginPath();
  g.moveTo(-0.28, -0.35);
  g.lineTo(-0.05, -0.62);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 0.09;
  g.stroke();
}

export const GEM_GLOW = ['#5dff9a', '#4aa8ff', '#c06bff'];
export { INK, TAU, lin, rad, poly, ell, limb, glowDot };
