const { spawn } = require('child_process');
const logger = require('../logger');

let guardProcess = null;

function startSleepGuard() {
  if (process.platform !== 'darwin') return;
  if (guardProcess) return;

  guardProcess = spawn('caffeinate', ['-dims'], {
    stdio: 'ignore',
    detached: false,
  });
  guardProcess.on('exit', () => {
    guardProcess = null;
  });

  logger.info('Mac не будет засыпать, пока идёт бэкап');
}

function stopSleepGuard() {
  if (!guardProcess) return;

  guardProcess.kill();
  guardProcess = null;
}

function isSleepGuardActive() {
  return guardProcess !== null;
}

module.exports = {
  startSleepGuard,
  stopSleepGuard,
  isSleepGuardActive,
};
