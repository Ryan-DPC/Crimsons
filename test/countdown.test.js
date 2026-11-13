import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCountdownStore } from '../lib/hoopslive-obs/countdown.js';

describe('countdown store', () => {
  it('set then snapshot', () => {
    const s = createCountdownStore(120);
    const snap = s.applyAction('set', { durationSec: 90 });
    assert.equal(snap.durationSec, 90);
    assert.equal(snap.remainingSec, 90);
    assert.equal(snap.running, false);
    assert.equal(snap.endsAt, null);
  });

  it('add while idle', () => {
    const s = createCountdownStore(60);
    s.applyAction('set', { durationSec: 60 });
    const snap = s.applyAction('add', { seconds: 15 });
    assert.equal(snap.remainingSec, 75);
    assert.equal(snap.running, false);
  });

  it('resume / pause / remaining decreases while running', async () => {
    const s = createCountdownStore(5);
    s.applyAction('set', { durationSec: 5 });
    let snap = s.applyAction('resume');
    assert.equal(snap.running, true);
    assert.ok(snap.endsAt != null);
    await new Promise((r) => setTimeout(r, 1100));
    snap = s.snapshot();
    assert.ok(snap.remainingSec <= 4);
    assert.ok(snap.remainingSec >= 3);
    snap = s.applyAction('pause');
    assert.equal(snap.running, false);
    const paused = snap.remainingSec;
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(s.snapshot().remainingSec, paused);
  });

  it('toggle starts and pauses', () => {
    const s = createCountdownStore(30);
    s.applyAction('set', { durationSec: 30 });
    assert.equal(s.applyAction('toggle').running, true);
    assert.equal(s.applyAction('toggle').running, false);
  });

  it('reset restores duration and stops', () => {
    const s = createCountdownStore(45);
    s.applyAction('set', { durationSec: 45 });
    s.applyAction('resume');
    s.applyAction('add', { seconds: -10 });
    const snap = s.applyAction('reset');
    assert.equal(snap.running, false);
    assert.equal(snap.remainingSec, 45);
    assert.equal(snap.durationSec, 45);
  });

  it('stop zeroes remaining', () => {
    const s = createCountdownStore(20);
    s.applyAction('set', { durationSec: 20 });
    s.applyAction('resume');
    const snap = s.applyAction('stop');
    assert.equal(snap.running, false);
    assert.equal(snap.remainingSec, 0);
  });

  it('resume with zero remaining is no-op', () => {
    const s = createCountdownStore(10);
    s.applyAction('stop');
    const snap = s.applyAction('resume');
    assert.equal(snap.running, false);
    assert.equal(snap.remainingSec, 0);
  });

  it('unknown action throws 400', () => {
    const s = createCountdownStore(10);
    assert.throws(() => s.applyAction(/** @type {any} */ ('explode')), (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    });
  });
});
