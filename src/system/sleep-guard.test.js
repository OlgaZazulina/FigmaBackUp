const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  startSleepGuard,
  stopSleepGuard,
  isSleepGuardActive,
} = require('./sleep-guard');

describe('sleep-guard', () => {
  afterEach(() => {
    stopSleepGuard();
  });

  it('stopSleepGuard is safe when guard was never started', () => {
    assert.doesNotThrow(() => stopSleepGuard());
    assert.equal(isSleepGuardActive(), false);
  });

  it('double stop is safe', () => {
    stopSleepGuard();
    stopSleepGuard();
    assert.equal(isSleepGuardActive(), false);
  });

  it('start and stop on darwin toggles active state', () => {
    if (process.platform !== 'darwin') {
      startSleepGuard();
      assert.equal(isSleepGuardActive(), false);
      return;
    }

    startSleepGuard();
    assert.equal(isSleepGuardActive(), true);
    stopSleepGuard();
    assert.equal(isSleepGuardActive(), false);
  });

  it('double start does not spawn duplicate guards', () => {
    if (process.platform !== 'darwin') return;

    startSleepGuard();
    const first = isSleepGuardActive();
    startSleepGuard();
    assert.equal(isSleepGuardActive(), first);
    stopSleepGuard();
  });
});
