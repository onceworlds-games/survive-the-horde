import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './fakedom.mjs';

// The whole page, outside Onceworlds (the stub room): title, Play, the camp, Start, the countdown, a night, results, back.
test('main.js plays through title, camp, countdown, a night and the results without a single error', async () => {
  const dom = installDom({ width: 1280, height: 720 });
  try {
    await import('../game/main.js?smoke');
    assert.ok(dom.errors.length === 0, `errors at load: ${dom.errors.join(' | ')}`);
    // the title: a live night behind one big button
    dom.frames_for(2);
    const c = dom.canvas.getContext();
    assert.ok(c.calls.n > 500, 'something was drawn');
    assert.ok(c.calls.byName.fillText > 0, 'text was drawn');
    // Play with Space
    dom.key('keydown', 'Space');
    dom.key('keyup', 'Space');
    dom.frames_for(1);
    // walk around in the camp
    dom.key('keydown', 'KeyD');
    dom.frames_for(2);
    dom.key('keyup', 'KeyD');
    // Start (the stub has its own button, bottom centre)
    dom.pointer('pointerdown', 640, 664);
    dom.frames_for(1);
    dom.frames_for(3.5); // the countdown
    assert.equal(dom.errors.length, 0, dom.errors.join(' | '));
    // a night: walk in circles for two minutes, picking cards with the keys
    const keys = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
    let k = 0;
    for (let s = 0; s < 120; s++) {
      if (s % 3 === 0) {
        dom.key('keyup', keys[(k + 3) % 4]);
        dom.key('keydown', keys[k % 4]);
        k++;
      }
      dom.key('keydown', 'Digit1');
      dom.key('keyup', 'Digit1');
      dom.frames_for(1);
      assert.equal(dom.errors.length, 0, `error at ${s} s: ${dom.errors.join(' | ')}`);
    }
    for (const code of keys) dom.key('keyup', code);
    // let the night run its course (a hero standing still does not last): results show, the match ends by itself
    for (let s = 0; s < 400; s++) {
      dom.frames_for(1);
      if (dom.errors.length) break;
    }
    assert.equal(dom.errors.length, 0, dom.errors.join(' | '));
    assert.ok(dom.canvas.getContext().calls.byName.drawImage > 1000, 'sprites were drawn');
    assert.equal(dom.canvas.getContext().calls.stack, 0, 'every save has its restore');
    const texts = dom.canvas.getContext().calls.texts;
    for (const want of ['SURVIVE', 'THE HORDE', 'PLAY', 'START', 'NIGHT', 'MODE', 'LEVEL UP', 'GO']) assert.ok(texts.has(want), `"${want}" was shown (saw ${[...texts].slice(0, 30).join(', ')})`);
    assert.ok(texts.has('DEFEAT') || texts.has('DAWN'), 'the results were shown');
    // resize to a phone and back
    dom.resize(844, 390);
    dom.frames_for(2);
    dom.resize(390, 844);
    dom.frames_for(2);
    assert.equal(dom.errors.length, 0, dom.errors.join(' | '));
  } finally {
    dom.restoreConsole();
  }
});
