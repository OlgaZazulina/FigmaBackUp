const { assertLoggedInToDrive } = require('./session');
const { ensureLiveContext } = require('../playwright/chrome-manager');
const logger = require('../logger');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isContextClosedError(err) {
  return /closed|detached|destroyed|crashed/i.test(err?.message || '');
}

async function getLiveContext(context) {
  try {
    await context.pages();
    return context;
  } catch (err) {
    if (!isContextClosedError(err)) throw err;
    logger.info('Соединение с Chrome потеряно — переподключаюсь...');
    return ensureLiveContext();
  }
}

async function waitForDriveFolder(page, folderId) {
  await page.waitForURL(new RegExp(`/folders/${folderId}|id=${folderId}`), { timeout: 30_000 });
  await page.waitForSelector('[data-target="drive"]', { timeout: 30_000 }).catch(() => {});
  await assertLoggedInToDrive(page);

  if (!page.url().includes(folderId)) {
    throw new Error(`Не удалось открыть папку Drive: ${folderId}`);
  }
}

async function openTargetFolder(page, folderId, folderUrl) {
  logger.info(`Открываю папку Drive: ${folderUrl}`);
  await page.goto(folderUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForDriveFolder(page, folderId);
  logger.info(`Папка открыта: ${page.url()}`);
  await sleep(1000);
}

async function recoverUploadPage(context, folderId, folderUrl) {
  const liveContext = await getLiveContext(context);
  const alive = (p) => !p.isClosed();

  let page = liveContext.pages().find((p) => alive(p) && p.url().includes(folderId));
  if (page) {
    await page.bringToFront().catch(() => {});
    return { page, context: liveContext };
  }

  page = liveContext.pages().find((p) => alive(p) && p.url().includes('drive.google.com'));
  if (page) {
    await openTargetFolder(page, folderId, folderUrl);
    return { page, context: liveContext };
  }

  page = await liveContext.newPage();
  await openTargetFolder(page, folderId, folderUrl);
  return { page, context: liveContext };
}

async function resolveUploadPage(context, folderId, folderUrl) {
  const liveContext = await getLiveContext(context);
  const folderPages = liveContext.pages().filter((p) => !p.isClosed() && p.url().includes(folderId));
  let page = folderPages[folderPages.length - 1];

  if (folderPages.length > 1) {
    logger.info(`Закрываю ${folderPages.length - 1} лишних вкладок Drive`);
    for (let i = 0; i < folderPages.length - 1; i += 1) {
      await folderPages[i].close().catch(() => {});
    }
  }

  if (!page) {
    const drivePage = liveContext.pages().find((p) => !p.isClosed() && p.url().includes('drive.google.com'));
    page = drivePage || await liveContext.newPage();
  }

  if (!page.url().includes(folderId)) {
    await openTargetFolder(page, folderId, folderUrl);
  } else {
    logger.info(`Уже в нужной папке: ${page.url()}`);
    await waitForDriveFolder(page, folderId);
  }

  await page.bringToFront();
  return { page, context: liveContext };
}

module.exports = {
  sleep,
  getLiveContext,
  waitForDriveFolder,
  openTargetFolder,
  recoverUploadPage,
  resolveUploadPage,
};
