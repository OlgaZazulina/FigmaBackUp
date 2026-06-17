const { EventEmitter } = require('events');

class Logger extends EventEmitter {
  log(level, message) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    this.emit('log', entry);
    const prefix = level === 'error' ? '✗' : level === 'success' ? '✓' : '→';
    console.log(`[${entry.timestamp}] ${prefix} ${message}`);
    return entry;
  }

  info(message) {
    return this.log('info', message);
  }

  success(message) {
    return this.log('success', message);
  }

  error(message) {
    return this.log('error', message);
  }
}

const logger = new Logger();

module.exports = logger;
