const { acquireContext } = require('../playwright/chrome-manager');
const { setGoogleAuth } = require('../store/auth-state');
const { waitForGoogleDriveLogin } = require('./session');
const { parseDriveFolderId } = require('./parse-url');
const logger = require('../logger');

async function authenticateGoogle(driveFolderUrl) {
  const { context, release } = await acquireContext();
  const page = await context.newPage();

  try {
    const folderId = driveFolderUrl ? parseDriveFolderId(driveFolderUrl) : null;
    const startUrl = folderId
      ? `https://drive.google.com/drive/folders/${folderId}`
      : 'https://drive.google.com/drive/home';

    await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
    await waitForGoogleDriveLogin(page);
    setGoogleAuth(true);
    logger.success('Google Drive: вход выполнен');
  } catch (err) {
    await release();
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { authenticateGoogle };
