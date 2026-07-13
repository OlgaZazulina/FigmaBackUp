const { assertLoggedInToDrive } = require('./session');
const { ensureLiveContext, forceReconnectContext } = require('../playwright/chrome-manager');
const logger = require('../logger');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isContextClosedError(err) {
  return /closed|detached|destroyed|crashed/i.test(err?.message || '');
}

function findDriveFolderPage(pages, folderId) {
  const open = pages.filter((p) => p && !p.isClosed());

  const folderMatch = open.filter((p) => p.url().includes(folderId));
  if (folderMatch.length > 0) return folderMatch[folderMatch.length - 1];

  return open.find((p) => p.url().includes('drive.google.com')) || null;
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

async function openOnFolderPage(page, folderId, folderUrl) {
  await page.goto(folderUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForDriveFolder(page, folderId);
  logger.info(`Папка открыта: ${page.url()}`);
  await sleep(1000);
  return page;
}

async function openTargetFolder(page, folderId, folderUrl) {
  logger.info(`Открываю папку Drive: ${folderUrl}`);

  try {
    return await openOnFolderPage(page, folderId, folderUrl);
  } catch (err) {
    logger.info('Соединение с Chrome потеряно — восстанавливаю...');
    const liveContext = await forceReconnectContext();

    let recoveredPage = findDriveFolderPage(liveContext.pages(), folderId);
    if (!recoveredPage) {
      const drivePage = liveContext.pages().find(
        (p) => !p.isClosed() && p.url().includes('drive.google.com'),
      );
      recoveredPage = drivePage || await liveContext.newPage();
    }

    const result = await openOnFolderPage(recoveredPage, folderId, folderUrl);
    logger.info('Соединение с Chrome восстановлено');
    return result;
  }
}

async function recoverUploadPage(_context, folderId, folderUrl, { force = true } = {}) {
  const liveContext = force
    ? await forceReconnectContext()
    : await getLiveContext(_context);

  let page = findDriveFolderPage(liveContext.pages(), folderId);
  if (page && page.url().includes(folderId)) {
    page = await openTargetFolder(page, folderId, folderUrl);
    logger.info('Соединение с Chrome восстановлено');
    return { page, context: liveContext };
  }

  if (page) {
    page = await openTargetFolder(page, folderId, folderUrl);
    logger.info('Соединение с Chrome восстановлено');
    return { page, context: liveContext };
  }

  page = await liveContext.newPage();
  page = await openTargetFolder(page, folderId, folderUrl);
  logger.info('Соединение с Chrome восстановлено');
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
    page = await openTargetFolder(page, folderId, folderUrl);
  } else {
    logger.info(`Уже в нужной папке: ${page.url()}`);
    await waitForDriveFolder(page, folderId);
  }

  return { page, context: liveContext };
}

module.exports = {
  sleep,
  getLiveContext,
  findDriveFolderPage,
  waitForDriveFolder,
  openTargetFolder,
  recoverUploadPage,
  resolveUploadPage,
};
