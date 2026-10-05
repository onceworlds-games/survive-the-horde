import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './fakedom.mjs';

const POSTERS = [
  ['cover', 1280, 720],
  ['action', 1280, 720],
  ['win', 1280, 720],
  ['icon', 512, 512],
  ['badge-dawn', 256, 256],
  ['badge-boss-slayer', 256, 256],
  ['badge-level-30', 256, 256],
  ['badge-thousand', 256, 256],
];

for (const [name, w, h] of POSTERS) {
  test(`poster ${name}: drawn at exactly ${w}x${h}, ready, no SDK, no errors`, async () => {
    const realRandom = Math.random;
    const dom = installDom({ width: w, height: h, search: `?poster=${name}` });
    try {
      assert.equal(globalThis.onceworlds, undefined);
      await import(`../game/main.js?poster-${name}`);
      assert.equal(dom.errors.length, 0, dom.errors.join(' | '));
      assert.equal(dom.canvas.width, w);
      assert.equal(dom.canvas.height, h);
      assert.equal(globalThis.document.body.dataset.ready, '1');
      const c = dom.canvas.getContext();
      assert.ok(c.calls.n > 50, 'something was drawn');
      assert.equal(c.calls.stack, 0, 'balanced save/restore');
      const info = JSON.parse(globalThis.document.body.dataset.info);
      if (name === 'cover') assert.ok(info.monsters > 250 && info.bolts >= 3 && info.areas >= 2 && info.particles > 40, `cover staging ${JSON.stringify(info)}`);
      if (name === 'action') assert.ok(info.boss === 1 && info.bolts >= 5, `action staging ${JSON.stringify(info)}`);
      if (name === 'win') assert.ok(info.dawn === 1 && info.monsters > 40 && info.heroes === 3, `win staging ${JSON.stringify(info)}`);
      if (name === 'cover') assert.ok(c.calls.texts.has('SURVIVE') && c.calls.texts.has('THE HORDE'), 'the title is the only text');
      if (name === 'action' || name === 'win' || name === 'icon') assert.equal(c.calls.texts.size, 0, 'no text');
    } finally {
      dom.restoreConsole();
      Math.random = realRandom;
    }
  });
}
