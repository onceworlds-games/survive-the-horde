import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');
const config = JSON.parse(read('onceworlds.json'));

test('onceworlds.json says what the game page needs', () => {
  assert.equal(config.slug, 'survive-the-horde');
  assert.equal(config.name, 'Survive the Horde');
  assert.equal(config.dir, 'game');
  assert.equal(config.genre, 'Survival');
  assert.ok(existsSync(join(root, config.dir, 'index.html')));
  assert.equal(config.icon, 'store/icon.png');
  assert.deepEqual(config.thumbnails, ['store/thumb-1.png', 'store/thumb-2.png', 'store/thumb-3.png']);
  assert.ok(config.controls.length <= 12);
  for (const c of config.controls) {
    assert.ok(c.keys.length >= 1 && c.keys.length <= 4);
    assert.ok(c.action.length <= 40);
  }
  assert.deepEqual(config.badges.map((b) => b.id), ['dawn', 'boss-slayer', 'level-30', 'thousand']);
  for (const b of config.badges) assert.equal(b.icon, `store/badge-${b.id}.png`);
});

test('every badge the game awards exists in onceworlds.json, and the posters cover them', () => {
  const ids = new Set(config.badges.map((b) => b.id));
  const code = readdirSync(join(root, 'game')).filter((f) => f.endsWith('.js')).map((f) => read(`game/${f}`)).join('\n');
  for (const m of code.matchAll(/badge\('([a-z0-9-]+)'\)/g)) assert.ok(ids.has(m[1]), `badge ${m[1]} is declared`);
  for (const id of ids) assert.ok(code.includes(`'${id}'`), `badge ${id} is awarded somewhere`);
  const poster = read('game/poster.js');
  for (const id of ids) assert.ok(poster.includes(`'${id}'`) || poster.includes(`id === '${id}'`), `poster for ${id}`);
});

test('the page follows the platform rules: viewport, one canvas, a module script, one display font, no banned calls', () => {
  const html = read('game/index.html');
  assert.ok(html.includes('width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no'));
  assert.equal((html.match(/<canvas/g) || []).length, 1);
  assert.ok(html.includes('<script type="module" src="main.js">'));
  assert.ok(html.includes('fonts.googleapis.com'));
  assert.ok(html.includes('Barlow+Condensed'));
  assert.ok(!/<script(?![^>]*src=)/.test(html), 'no inline scripts');
  const code = readdirSync(join(root, 'game')).filter((f) => f.endsWith('.js')).map((f) => read(`game/${f}`)).join('\n');
  for (const banned of ['Lilita', 'Luckiest', 'Chewy', 'Baloo', 'Fredoka', 'Bangers']) assert.ok(!code.includes(banned) && !html.includes(banned), banned);
  for (const call of ['alert(', 'confirm(', 'prompt(', 'localStorage.', 'sessionStorage', 'window.open', 'innerHTML', 'eval(']) {
    const hits = code.split('\n').filter((l) => l.includes(call) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    // the stand-in SDK may use localStorage when the page is opened on its own
    const allowed = call === 'localStorage.' ? hits.filter((l) => !l.includes('globalThis.localStorage')) : hits;
    assert.equal(allowed.length, 0, `${call} used: ${allowed.join(' | ')}`);
  }
});

test('package.json matches the brief and the repo keeps its deploy files', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.name, 'survive-the-horde');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.test, 'node --test "test/*.test.mjs"');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.scripts.build, undefined);
  assert.ok(existsSync(join(root, 'LICENSE')));
  assert.ok(existsSync(join(root, '.gitignore')));
  assert.ok(existsSync(join(root, '.github/workflows/onceworlds.yml')));
});

test('nothing a player can see mentions AI or other platforms', () => {
  const code = readdirSync(join(root, 'game')).filter((f) => f.endsWith('.js') || f.endsWith('.html')).map((f) => read(`game/${f}`)).join('\n');
  const shown = [...code.matchAll(/'([A-Z][A-Z0-9 .+!'-]{3,})'/g)].map((m) => m[1]);
  for (const t of shown) assert.ok(!/\bAI\b|ROBLOX|ROBUX|CLAUDE/.test(t), t);
  const lower = (JSON.stringify(config) + read('README.md')).toLowerCase();
  for (const word of ['roblox', 'robux', 'claude', 'anthropic', 'artificial']) assert.ok(!lower.includes(word), word);
});
