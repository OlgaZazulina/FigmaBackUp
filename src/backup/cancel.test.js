const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  BackupCancelledError,
  resetBackupCancel,
  requestBackupCancel,
  isBackupCancelRequested,
  throwIfBackupCancelled,
} = require('./cancel');

describe('backup cancel', () => {
  beforeEach(() => {
    resetBackupCancel();
  });

  it('resetBackupCancel clears flag', () => {
    requestBackupCancel();
    resetBackupCancel();
    assert.equal(isBackupCancelRequested(), false);
  });

  it('requestBackupCancel sets flag', () => {
    requestBackupCancel();
    assert.equal(isBackupCancelRequested(), true);
  });

  it('throwIfBackupCancelled throws BackupCancelledError when set', () => {
    requestBackupCancel();
    assert.throws(() => throwIfBackupCancelled(), BackupCancelledError);
  });

  it('throwIfBackupCancelled is no-op when not set', () => {
    assert.doesNotThrow(() => throwIfBackupCancelled());
  });
});
