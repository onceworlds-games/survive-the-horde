// What the game runs on when its file is opened on its own (no Onceworlds around): a solo room that keeps the match
// lifecycle the way the platform does, and the few SDK calls the game uses. Nothing here is used on the platform.

function emitter() {
  const map = new Map();
  return {
    on(event, fn) {
      let set = map.get(event);
      if (!set) map.set(event, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(event, ...args) {
      for (const fn of map.get(event) ?? []) {
        try {
          fn(...args);
        } catch (err) {
          console.error(err);
        }
      }
    },
  };
}

export function createStubRoom(options = {}) {
  const em = emitter();
  const schema = Array.isArray(options.settings) ? options.settings : [];
  const chosen = {};
  const me = { id: 'you', name: 'You', presence: null, team: 0 };
  let match = { phase: 'lobby', n: 0, min: 1 };
  let timer = null;
  const room = {
    stub: true,
    kind: 'solo',
    id: 'solo',
    me,
    players: new Map([[me.id, me]]),
    host: me.id,
    closed: false,
    connected: true,
    state: {},
    private: {},
    get match() {
      return match;
    },
    get isHost() {
      return true;
    },
    get online() {
      return [me];
    },
    get participants() {
      return match.phase === 'lobby' ? [] : [me];
    },
    get spectators() {
      return [];
    },
    get spectating() {
      return false;
    },
    get running() {
      return match.phase === 'playing' && !match.paused;
    },
    get canStart() {
      return match.phase === 'lobby';
    },
    get allReady() {
      return true;
    },
    get notReady() {
      return [];
    },
    get settings() {
      const out = {};
      for (const s of schema) out[s.id] = chosen[s.id] ?? s.default ?? s.options[0]?.value ?? s.options[0];
      return out;
    },
    matchNow() {
      return match.phase === 'playing' ? Date.now() - match.startedAt : 0;
    },
    setSetting(id, value) {
      if (match.phase !== 'lobby') return;
      const s = schema.find((x) => x.id === id);
      if (!s) return;
      chosen[id] = value;
      em.emit('settings', room.settings);
    },
    setReady() {},
    clearReady() {},
    setOpen() {},
    hideLobby() {},
    setPresence(p) {
      me.presence = p;
    },
    presenceAt(id) {
      return id === me.id ? me.presence : null;
    },
    setState(k, v) {
      if (v === null || v === undefined) delete room.state[k];
      else room.state[k] = v;
    },
    setPrivate() {},
    privateOf() {
      return {};
    },
    send() {},
    startMatch() {
      if (match.phase !== 'lobby') return;
      const n = match.n + 1;
      const startsAt = Date.now() + 3000;
      match = { phase: 'starting', n, min: 1, id: `solo${n}`, seed: Math.floor(Math.random() * 2 ** 32), participants: [me.id], startsAt };
      em.emit('match', match);
      em.emit('starting', match);
      timer = setTimeout(() => {
        if (match.phase !== 'starting') return;
        const { startsAt: _s, ...rest } = match;
        match = { ...rest, phase: 'playing', startedAt: Date.now(), pausedMs: 0 };
        em.emit('match', match);
        em.emit('matchstart', match);
      }, 3000);
    },
    endMatch() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (match.phase === 'lobby') return;
      const previous = match;
      match = { phase: 'lobby', n: previous.n, min: 1 };
      em.emit('match', match, previous);
      em.emit('matchend', match, previous);
    },
    pauseMatch() {},
    admit() {},
    leave() {},
    on: em.on,
  };
  return room;
}

/** The SDK calls the game uses, for a page opened outside Onceworlds. */
export function createStubOw() {
  const store = (k, v) => {
    try {
      if (v === undefined) {
        const s = globalThis.localStorage?.getItem(`sth.${k}`);
        return s ? JSON.parse(s) : null;
      }
      globalThis.localStorage?.setItem(`sth.${k}`, JSON.stringify(v));
    } catch {
      /* private mode */
    }
    return null;
  };
  const listeners = [];
  return {
    mode: 'standalone',
    player: {
      get: async () => ({ id: 'you', name: 'You', guest: true }),
      avatarUrl: async () => null,
      rename: async () => null,
    },
    save: {
      get: async (k) => store(k),
      set: async (k, v) => void store(k, v),
      delete: async () => {},
      list: async () => [],
    },
    badges: { award: async () => false, list: async () => [], has: async () => false },
    leaderboards: { submit: async () => null, top: async () => ({ entries: [], me: null }) },
    rooms: { join: async (o) => createStubRoom(o), current: null },
    ui: { setOrientation() {}, setMenuPosition() {}, requestFullscreen() {}, showInvite() {} },
    controls: { set() {}, stick: { x: 0, y: 0 }, pressed: () => false, touch: false },
    settings: {
      quality: 'high',
      scale: 1,
      reducedMotion: false,
      pixelRatio: (max = 2) => Math.min(globalThis.devicePixelRatio || 1, max),
      on(event, fn) {
        listeners.push(fn);
        return () => {};
      },
    },
    now: () => Date.now(),
    on() {
      return () => {};
    },
    env: {},
  };
}
