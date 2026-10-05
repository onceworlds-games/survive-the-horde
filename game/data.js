// Numbers and tables of the game. Pure: no DOM, no SDK.

export const STEP = 1 / 60; // the fixed simulation step
export const ARENA_R = 88; // heroes stay inside this radius (a ring of fallen trees marks it)
export const SPAWN_R = 4; // monsters may stand this far outside the ring (the dark treeline)
export const MAX_MON = 400; // monsters alive at once
export const MAX_GEMS = 320;
export const ID_MASK = 0x7fff; // ids on the wire are 15 bits
export const MAX_HEROES = 8;

export const HERO = {
  hp: 100,
  speed: 4.2,
  pickup: 2.2,
  r: 0.4,
  hitCd: 0.5, // touching monsters hurt once per this many seconds
  reviveSecs: 3,
  reviveRange: 1.9,
  reviveInvuln: 2.5,
  ghostSpeed: 3.6,
};

// Monster types. Index = type id on the wire (3 bits).
export const T_SKEL = 0;
export const T_BAT = 1;
export const T_SLIME = 2;
export const T_GHOUL = 3;
export const T_KNIGHT = 4;
export const T_BOSS = 5;
export const T_DUMMY = 6;

export const MON = [
  { key: 'skeleton', hp: 6, speed: 1.55, dmg: 6, r: 0.42 },
  { key: 'bat', hp: 3, speed: 3.0, dmg: 4, r: 0.34 },
  { key: 'slime', hp: 16, speed: 1.0, dmg: 8, r: 0.56 },
  { key: 'ghoul', hp: 34, speed: 1.9, dmg: 11, r: 0.55 },
  { key: 'knight', hp: 95, speed: 1.35, dmg: 17, r: 0.68 },
  { key: 'boss', hp: 2200, speed: 1.25, dmg: 32, r: 2.1 },
  { key: 'dummy', hp: 1e6, speed: 0, dmg: 0, r: 0.6 },
];
export const MON_R = new Float32Array(MON.map((m) => m.r));
export const BOSS_ART = 1.95; // world units per art unit of the Night Warden's picture (about 7 units tall)
export const SMALL_R = 0.8; // every monster but the boss is at most this wide (the spatial hash relies on it)

// XP gems: tier 0 green, 1 blue, 2 purple.
export const GEM_XP = [1, 5, 20];

// The horde: unlock points as a share of the night, and weights of each type once unlocked.
export const SPAWN_TABLE = [
  { type: T_SKEL, from: 0, w0: 10, w1: 5 },
  { type: T_BAT, from: 0.07, w0: 3, w1: 5 },
  { type: T_SLIME, from: 0.15, w0: 3, w1: 4 },
  { type: T_GHOUL, from: 0.3, w0: 2, w1: 5 },
  { type: T_KNIGHT, from: 0.5, w0: 1, w1: 4 },
];

export const WAVE_SECS = 30; // the horde grows every 30 s
export const RING_EVERY = 60; // an elite ring closes in at every minute mark
export const BOSS_BEFORE_END = 60; // the Night Warden walks in for the last minute
export const PEAK_RATE = 25; // monsters per second at the end of the night

export const MODES = {
  normal: { hp: 1, dmg: 1, rate: 1 },
  hard: { hp: 1.45, dmg: 1.25, rate: 1.2 },
};

/** How much tougher monsters are `t` seconds into the night. */
export function hpScale(t) {
  const m = t / 60;
  return 1 + 0.3 * m + 0.022 * m * m;
}
export function dmgScale(t) {
  return 1 + 0.07 * (t / 60);
}
export function speedScale(t) {
  return Math.min(1.25, 1 + 0.02 * (t / 60));
}

/** Level L to L+1 needs this much XP: 5, 10, 15 ... then 8% more each level after 20. */
const XP_TABLE = [0, 5];
export function xpNeeded(level) {
  const L = Math.max(1, Math.min(300, Math.floor(level)));
  while (XP_TABLE.length <= L) {
    const k = XP_TABLE.length;
    XP_TABLE.push(k <= 20 ? 5 * k : Math.round(XP_TABLE[k - 1] * 1.08));
  }
  return XP_TABLE[L];
}

// ---------------------------------------------------------------- weapons and passives
export const W_BOLT = 0;
export const W_BLADES = 1;
export const W_RING = 2;
export const W_LIGHTNING = 3;
export const W_RAIN = 4;
export const W_NOVA = 5;
export const W_SHIELD = 6;
export const N_WEAPONS = 7;

export const P_HP = 0;
export const P_SPEED = 1;
export const P_PICKUP = 2;
export const P_COOLDOWN = 3;
export const P_DAMAGE = 4;
export const P_REGEN = 5;
export const N_PASSIVES = 6;

export const MAX_LEVEL = 5; // of every weapon and passive
export const MAX_WEAPONS = 5;
export const MAX_PASSIVES = 5;

// Upgrade ids: weapons 0..6, passives 10..15, 20 = recover (when nothing is left to pick).
export const U_PASSIVE_BASE = 10;
export const U_RECOVER = 20;

export const WEAPON_DEFS = [
  { id: W_BOLT, name: 'Magic Bolt', deltas: ['BOLT', '+1 BOLT', 'FASTER', '+1 BOLT', 'FASTER'] },
  { id: W_BLADES, name: 'Spinning Blades', deltas: ['2 BLADES', '+1 BLADE', 'FASTER', '+1 BLADE', '+1 BLADE'] },
  { id: W_RING, name: 'Fire Ring', deltas: ['PULSE', 'WIDER', 'FASTER', 'WIDER', 'INFERNO'] },
  { id: W_LIGHTNING, name: 'Lightning', deltas: ['STRIKE', '+1 STRIKE', 'FASTER', '+1 STRIKE', '+1 STRIKE'] },
  { id: W_RAIN, name: 'Arrow Rain', deltas: ['VOLLEY', 'WIDER', '+1 VOLLEY', 'FASTER', '+1 VOLLEY'] },
  { id: W_NOVA, name: 'Frost Nova', deltas: ['SLOWS', 'WIDER', 'FASTER', 'LONGER', 'DEEP FREEZE'] },
  { id: W_SHIELD, name: 'Holy Shield', deltas: ['BLOCKS A HIT', 'FASTER', 'FASTER', 'FASTER', 'SHOCKWAVE'] },
];

export const PASSIVE_DEFS = [
  { id: U_PASSIVE_BASE + P_HP, name: 'Max HP', delta: '+20 HP' },
  { id: U_PASSIVE_BASE + P_SPEED, name: 'Speed', delta: '+8% SPEED' },
  { id: U_PASSIVE_BASE + P_PICKUP, name: 'Pickup', delta: '+30% RANGE' },
  { id: U_PASSIVE_BASE + P_COOLDOWN, name: 'Cooldown', delta: '-8% COOLDOWN' },
  { id: U_PASSIVE_BASE + P_DAMAGE, name: 'Damage', delta: '+12% DAMAGE' },
  { id: U_PASSIVE_BASE + P_REGEN, name: 'Regen', delta: '+0.5 HP/S' },
];

// Per level (index 0 = level 1).
export const BOLT = {
  count: [1, 2, 2, 3, 4],
  cd: [0.9, 0.9, 0.75, 0.75, 0.6],
  dmg: [10, 10, 11, 12, 14],
  pierce: [0, 0, 1, 1, 2],
  speed: 15,
  life: 1.1,
  range: 11,
};
export const BLADES = {
  count: [2, 3, 3, 4, 5],
  radius: [2.2, 2.3, 2.5, 2.6, 2.9],
  speed: [3.2, 3.4, 4.0, 4.2, 4.8], // radians per second
  dmg: [8, 8, 10, 11, 13],
  hitR: 0.6,
  every: 0.45, // a blade hits the same monster at most this often
};
export const RING = {
  cd: [2.4, 2.2, 2.0, 1.8, 1.5],
  radius: [2.6, 3.0, 3.4, 3.8, 4.4],
  dmg: [12, 14, 18, 22, 28],
  dur: 0.4,
};
export const LIGHTNING = {
  count: [1, 2, 2, 3, 4],
  cd: [1.7, 1.6, 1.4, 1.3, 1.1],
  dmg: [26, 26, 32, 36, 42],
  splash: 1.0,
  range: 10.5,
  dur: 0.3,
};
export const RAIN = {
  zones: [1, 1, 2, 2, 3],
  cd: [3.0, 2.8, 2.8, 2.4, 2.2],
  radius: [1.9, 2.2, 2.2, 2.5, 2.8],
  dmg: [5, 6, 6, 7, 9], // per tick
  tick: 0.2,
  dur: 1.2,
  range: 9,
};
export const NOVA = {
  cd: [4.5, 4.0, 3.6, 3.2, 2.6],
  radius: [3.6, 4.0, 4.4, 4.8, 5.4],
  dmg: [8, 10, 12, 14, 18],
  slow: [1.8, 2.1, 2.4, 2.8, 3.2],
  dur: 0.5,
};
export const SHIELD = {
  cd: [8, 7, 6, 5, 4],
  waveR: 4,
  waveDmg: 25,
};

// Effects a hit can carry to the monster it lands on.
export const FX_NONE = 0;
export const FX_SLOW = 1;
export const FX_KNOCK = 2;

export const HERO_COLORS = ['#42b8ff', '#ff9a2e', '#78e04d', '#d57bff'];
export const HERO_COLORS_DARK = ['#1c6fb0', '#b45a10', '#3f9a22', '#8a3fb8'];

/** Night length options: the setting is seconds. */
export function nightLength(setting) {
  return setting === 600 ? 600 : 300;
}
export function modeOf(setting) {
  return setting === 'hard' ? MODES.hard : MODES.normal;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
