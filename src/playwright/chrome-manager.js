const BROWSER_PROFILE = 'main';

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { requireChromeExecutable } = require('./chrome-path');
const { ROOT, DOWNLOADS_TMP } = require('../store/paths');
const logger = require('../logger');

delete process.env.PLAYWRIGHT_BROWSERS_PATH;

let session = null;

function getProfileDir() {
  return path.join(ROOT, '.chrome-profile', BROWSER_PROFILE);
}

function getPortFile(profileDir) {
  return path.join(profileDir, '.cdp-port');
}

function resetBrowserProfiles() {
  session = null;
  const profileRoot = path.join(ROOT, '.chrome-profile');
  if (fs.existsSync(profileRoot)) {
    fs.rmSync(profileRoot, { recursive: true, force: true });
  }
  const legacyCredentials = path.join(ROOT, '.credentials');
  if (fs.existsSync(legacyCredentials)) {
    fs.rmSync(legacyCredentials, { recursive: true, force: true });
  }
}

function waitForCdp(port, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error('Chrome не ответил на CDP-порт'));
        return;
      }
      setTimeout(check, 300);
    };

    check();
  });
}

function isPortAlive(port) {
  try {
    const { execSync } = require('child_process');
    const code = execSync(
      `curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://127.0.0.1:${port}/json/version`,
      { encoding: 'utf8' },
    );
    return code.trim() === '200';
  } catch {
    return false;
  }
}

function launchChromeApp(userDataDir, debugPort) {
  const chromePath = requireChromeExecutable();
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(DOWNLOADS_TMP, { recursive: true });

  logger.info('Открываю Google Chrome (одно окно для всех действий)');

  spawn(
    chromePath,
    [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${debugPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      'about:blank',
    ],
    { stdio: 'ignore', detached: true },
  ).unref();
}

class ChromeSession {
  constructor() {
    this.profileDir = getProfileDir();
    this.cdpBrowser = null;
    this.debugPort = null;
    this.refCount = 0;
  }

  isConnected() {
    return Boolean(this.cdpBrowser);
  }

  async connectToPort(port, timeoutMs = 20_000) {
    await waitForCdp(port, timeoutMs);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close();
      throw new Error('Chrome context не найден');
    }
    this.cdpBrowser = browser;
    this.debugPort = port;
    fs.writeFileSync(getPortFile(this.profileDir), String(port));
    return context;
  }

  async launchNew() {
    const portFile = getPortFile(this.profileDir);

    if (fs.existsSync(portFile)) {
      const port = parseInt(fs.readFileSync(portFile, 'utf8'), 10);
      if (isPortAlive(port)) {
        logger.info(`Подключение к Chrome :${port}...`);
        const context = await this.connectToPort(port);
        logger.info(`Подключено к открытому Chrome :${port}`);
        return context;
      }
      fs.unlinkSync(portFile);
    }

    const port = 9222 + Math.floor(Math.random() * 8000);
    launchChromeApp(this.profileDir, port);
    await waitForCdp(port);
    const context = await this.connectToPort(port);
    logger.info(`Chrome запущен на порту ${port}`);
    return context;
  }

  async getLiveContext() {
    if (!this.cdpBrowser) return null;
    try {
      const context = this.cdpBrowser.contexts()[0];
      if (!context) return null;
      await context.pages();
      return context;
    } catch {
      this.cdpBrowser = null;
      return null;
    }
  }

  async reconnect() {
    const portFile = getPortFile(this.profileDir);
    if (fs.existsSync(portFile)) {
      const port = parseInt(fs.readFileSync(portFile, 'utf8'), 10);
      if (isPortAlive(port)) {
        logger.info(`Переподключение к Chrome :${port}...`);
        return this.connectToPort(port);
      }
    }
    return this.launchNew();
  }

  async acquire() {
    this.refCount += 1;
    const live = await this.getLiveContext();
    if (live) return live;
    return this.reconnect();
  }

  async release() {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount > 0) return;

    if (this.cdpBrowser) {
      await this.cdpBrowser.close().catch(() => {});
      this.cdpBrowser = null;
      logger.info(`Chrome :${this.debugPort} остаётся открытым (вкладки сохранены)`);
    }
  }
}

function getSession() {
  if (!session) {
    session = new ChromeSession();
  }
  return session;
}

async function ensureLiveContext() {
  const chromeSession = getSession();
  const live = await chromeSession.getLiveContext();
  if (live) return live;
  return chromeSession.reconnect();
}

async function forceReconnectContext() {
  const chromeSession = getSession();
  if (chromeSession.cdpBrowser) {
    await chromeSession.cdpBrowser.close().catch(() => {});
    chromeSession.cdpBrowser = null;
  }
  return chromeSession.reconnect();
}

async function acquireContext() {
  const chromeSession = getSession();
  const context = await chromeSession.acquire();
  return {
    context,
    async refreshContext() {
      return ensureLiveContext();
    },
    async release() {
      await chromeSession.release();
    },
  };
}

function isChromeRunning() {
  const chromeSession = session;
  if (chromeSession?.isConnected()) return true;

  const portFile = getPortFile(getProfileDir());
  if (!fs.existsSync(portFile)) return false;

  try {
    const { execSync } = require('child_process');
    const port = parseInt(fs.readFileSync(portFile, 'utf8'), 10);
    const code = execSync(
      `curl -s -o /dev/null -w "%{http_code}" --max-time 1 http://127.0.0.1:${port}/json/version`,
      { encoding: 'utf8' },
    );
    return code.trim() === '200';
  } catch {
    return false;
  }
}

module.exports = {
  acquireContext,
  ensureLiveContext,
  forceReconnectContext,
  resetBrowserProfiles,
  getProfileDir,
  isChromeRunning,
  requireChromeExecutable,
  BROWSER_PROFILE,
};
