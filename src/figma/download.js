const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const { waitForDownloadResult } = require('./download-wait');

const EXPORT_TIMEOUT_MS = 30 * 60 * 1000;
const NAV_TIMEOUT_MS = 90_000;

function normalizeFigmaUrl(url) {
  const match = url.match(/figma\.com\/(design|file|board|proto)\/([a-zA-Z0-9]+)/i);
  if (!match) {
    throw new Error('Некорректная ссылка Figma');
  }
  const [, type, key] = match;
  return `https://www.figma.com/${type}/${key}/`;
}

async function assertLoggedIn(page) {
  const url = page.url();
  if (url.includes('/login') || url.includes('accounts.google.com')) {
    throw new Error('Сессия Figma истекла. Нажмите «Авторизоваться в Figma» заново.');
  }
}

async function dismissOverlays(page) {
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);
  }
}

async function waitForEditorReady(page) {
  logger.info('Ожидание загрузки редактора Figma...');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-testid="Actions-tool"][aria-hidden="false"]', { timeout: 30_000 });
  await page.waitForSelector('canvas', { timeout: 15_000 }).catch(() => {});
  await assertLoggedIn(page);
  await dismissOverlays(page);
  await page.waitForTimeout(800);
  logger.info('Редактор загружен');
}

async function openActionsMenu(page) {
  await page.locator('canvas').first().click({ position: { x: 200, y: 200 }, force: true });
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(600);

  const input = page.locator('[role="combobox"] input, input[placeholder*="Search" i]').first();
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  return input;
}

async function waitForFigmaExport(page) {
  const exporting = page.getByText(/Downloading images/i);
  const visible = await exporting.isVisible({ timeout: 8000 }).catch(() => false);

  if (!visible) {
    return;
  }

  logger.info('Figma подготавливает файл (Downloading images)...');
  await exporting.waitFor({ state: 'hidden', timeout: EXPORT_TIMEOUT_MS });
  logger.info('Подготовка файла завершена');
  await page.waitForTimeout(1000);
}

async function clickSaveLocalCopy(page) {
  const input = await openActionsMenu(page);
  await input.fill('Save local copy');
  await page.waitForTimeout(600);

  logger.info('Кликаю [data-testid=save-as]...');
  await page.getByTestId('save-as').click({ force: true });

  await waitForFigmaExport(page);
}

async function triggerSaveLocalCopy(page) {
  logger.info('Запускаю: Actions menu → Save local copy');
  return waitForDownloadResult(page, clickSaveLocalCopy);
}

async function saveDownloadResult(result, destDir, page) {
  let baseName = path.basename(result.path, '.fig');

  if (!baseName) {
    const title = await page.title();
    baseName = title.replace(/\s*[–—-]\s*Figma.*$/i, '').trim();
  }
  if (!baseName) {
    throw new Error('Не удалось определить имя файла');
  }

  const safeName = baseName.replace(/[/\\?%*:|"<>]/g, '-');
  const destPath = path.join(destDir, `${safeName}.fig`);

  fs.copyFileSync(result.path, destPath);

  if (!fs.existsSync(destPath)) {
    throw new Error('Файл .fig не был сохранён');
  }

  return { fileName: safeName, destPath };
}

async function downloadFigmaFileWithContext(context, figmaUrl, destDir) {
  const page = await context.newPage();
  const cleanUrl = normalizeFigmaUrl(figmaUrl);

  try {
    logger.info(`Открываю: ${cleanUrl}`);
    await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await waitForEditorReady(page);

    const result = await triggerSaveLocalCopy(page);
    return await saveDownloadResult(result, destDir, page);
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { downloadFigmaFileWithContext, normalizeFigmaUrl };
