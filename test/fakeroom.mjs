// A pretend Onceworlds server for tests: several pages (rooms) share one hub that keeps the match, the shared state, the
// presence and the messages, with the SDK's room surface the game uses. Time is the hub's clock, advanced by the test.

export class Hub {
  constructor(settings = { length: 300, hero: 'normal' }) {
    this.clock = 0; // ms
    this.settings = settings;
    this.rooms = new Map();
    this.hostId = null;
    this.match = { phase: 'lobby', n: 0, min: 1 };
    this.log = [];
    this.opened = 0;
  }

  join(id, name = id) {
    const room = new FakeRoom(this, id, name);
    this.rooms.set(id, room);
    if (!this.hostId) this.hostId = id;
    for (const other of this.rooms.values()) {
      if (other !== room) other.players.set(id, { id, name, presence: null, team: 0 });
    }
    for (const other of this.rooms.values()) {
      if (other !== room) room.players.set(other.me.id, { id: other.me.id, name: other.me.name, presence: other.me.presence, team: 0 });
    }
    return room;
  }

  leave(id) {
    const room = this.rooms.get(id);
    if (!room) return;
    room.connected = false;
    this.rooms.delete(id);
    for (const other of this.rooms.values()) other.players.delete(id);
    if (this.hostId === id) {
      this.hostId = [...this.rooms.keys()][0] ?? null;
      for (const other of this.rooms.values()) other.emit('host', this.hostId);
    }
  }

  setMatch(next) {
    const previous = this.match;
    this.match = next;
    for (const room of this.rooms.values()) {
      room.emit('match', next, previous);
      if (previous.phase !== 'playing' && next.phase === 'playing') room.emit('matchstart', next);
      if (previous.phase !== 'lobby' && next.phase === 'lobby') room.emit('matchend', next, previous);
    }
  }

  start(participants, seed = 12345) {
    const n = this.match.n + 1;
    this.setMatch({ phase: 'playing', n, min: 1, id: `m${n}`, seed, participants: [...participants], startedAt: this.clock, pausedMs: 0 });
  }

  /** The countdown: `starting` until `ms` have passed (the test calls start() then). */
  starting(participants, ms = 3000) {
    const n = this.match.n + 1;
    this.setMatch({ phase: 'starting', n, min: 1, id: `m${n}`, seed: 777, participants: [...participants], startsAt: this.clock + ms });
    for (const room of this.rooms.values()) room.emit('starting', this.match);
  }

  end() {
    this.setMatch({ phase: 'lobby', n: this.match.n, min: 1 });
  }

  advance(ms) {
    this.clock += ms;
  }
}

export class FakeRoom {
  constructor(hub, id, name) {
    this.hub = hub;
    this.me = { id, name, presence: null, team: 0 };
    this.players = new Map([[id, this.me]]);
    this.state = {};
    this.connected = true;
    this.closed = false;
    this.kind = 'private';
    this.listeners = new Map();
    this.sent = { messages: 0, states: 0 };
    this.bytes = 0;
    this.id = 'private:test';
  }

  get host() {
    return this.hub.hostId;
  }
  get isHost() {
    return this.connected && this.hub.hostId === this.me.id;
  }
  get match() {
    return this.hub.match;
  }
  get online() {
    return [...this.players.values()].filter((p) => p.connected !== false);
  }
  get participants() {
    const m = this.hub.match;
    return m.phase === 'lobby' ? [] : m.participants.map((id) => this.players.get(id)).filter(Boolean);
  }
  get spectating() {
    const m = this.hub.match;
    return m.phase !== 'lobby' && !m.participants.includes(this.me.id);
  }
  get running() {
    return this.hub.match.phase === 'playing' && !this.hub.match.paused;
  }
  get settings() {
    return this.hub.settings;
  }
  matchNow() {
    const m = this.hub.match;
    return m.phase === 'playing' ? this.hub.clock - m.startedAt : 0;
  }
  setReady() {}
  clearReady() {}
  setOpen() {
    this.hub.opened++;
  }
  hideLobby(hidden = true) {
    this.lobbyHidden = hidden;
    this.hideCalls = (this.hideCalls ?? 0) + 1;
  }
  setPrivate() {}
  privateOf() {
    return {};
  }
  setSetting() {}
  presenceAt(id) {
    return this.players.get(id)?.presence ?? null;
  }
  setPresence(p) {
    this.me.presence = p;
    this.bytes += JSON.stringify(p).length;
    for (const other of this.hub.rooms.values()) {
      if (other === this) continue;
      const pl = other.players.get(this.me.id);
      if (pl) pl.presence = p;
    }
  }
  setState(key, value) {
    if (value === null || value === undefined) delete this.state[key];
    else this.state[key] = value;
    this.sent.states++;
    this.bytes += JSON.stringify(value ?? null).length;
    const copy = JSON.parse(JSON.stringify(value ?? null));
    for (const other of this.hub.rooms.values()) {
      if (other === this) continue;
      if (copy === null) delete other.state[key];
      else other.state[key] = copy;
      other.emit('state', key, copy, this.me.id);
    }
  }
  send(data, opts = {}) {
    this.sent.messages++;
    const text = JSON.stringify(data);
    this.bytes += text.length;
    if (text.length > 16000) throw new Error('message over 16 KB');
    const copy = JSON.parse(text);
    for (const other of this.hub.rooms.values()) {
      if (other === this) continue;
      if (opts.to && other.me.id !== opts.to) continue;
      other.emit('message', copy, this.players.get(this.me.id) ?? this.me, this.hub.clock, other.matchNow());
    }
  }
  startMatch() {
    if (this.isHost) this.hub.start([...this.hub.rooms.keys()]);
  }
  endMatch() {
    if (this.isHost && this.hub.match.phase !== 'lobby') this.hub.end();
  }
  transferHost(id) {
    if (this.isHost && this.hub.rooms.has(id)) {
      this.hub.hostId = id;
      for (const room of this.hub.rooms.values()) room.emit('host', id);
    }
  }
  admit() {}
  on(event, fn) {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }
  emit(event, ...args) {
    for (const fn of this.listeners.get(event) ?? []) fn(...args);
  }
}
