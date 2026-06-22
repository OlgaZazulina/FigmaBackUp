class BackupCancelledError extends Error {
  constructor() {
    super('Бэкап остановлен пользователем');
    this.name = 'BackupCancelledError';
  }
}

let cancelRequested = false;

function resetBackupCancel() {
  cancelRequested = false;
}

function requestBackupCancel() {
  cancelRequested = true;
}

function isBackupCancelRequested() {
  return cancelRequested;
}

function throwIfBackupCancelled() {
  if (cancelRequested) throw new BackupCancelledError();
}

module.exports = {
  BackupCancelledError,
  resetBackupCancel,
  requestBackupCancel,
  isBackupCancelRequested,
  throwIfBackupCancelled,
};
