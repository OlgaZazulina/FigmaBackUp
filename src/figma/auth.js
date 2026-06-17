const { acquireContext } = require('../playwright/chrome-manager');
const { setFigmaAuth } = require('../store/auth-state');
const logger = require('../logger');

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

async function authenticateFigma() {
  const { context, release } = await acquireContext();
  const page = await context.newPage();

  try {
    await page.goto('https://www.figma.com/login');
    await page.waitForURL(
      (url) => !url.href.includes('/login'),
      { timeout: LOGIN_TIMEOUT_MS },
    );
    setFigmaAuth(true);
    logger.success('Figma: вход выполнен');
  } catch (err) {
    await release();
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { authenticateFigma };
