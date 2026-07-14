const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const { sanitizeLinkName } = require('../backup/fig-filename');
const { waitForDownloadResult } = require('./download-wait');
const { throwIfBackupCancelled } = require('../backup/cancel');
const { ensureLiveContext } = require('../playwright/chrome-manager');

const EXPORT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const NAV_TIMEOUT_MS = 180_000;
const LOAD_STATE_TIMEOUT_MS = 120_000;
const EDITOR_READY_TIMEOUT_MS = 120_000;
const NAV_ATTEMPTS = 3;
const EDITOR_READY_ATTEMPTS = 3;
const PALETTE_ATTEMPTS = 3;
const PALETTE_INPUT_TIMEOUT_MS = 20_000;
const SAVE_AS_QUERY_TIMEOUT_MS = 8_000;
const BETWEEN_FILES_PAUSE_MS = 2_000;

const EDITOR_READY_SELECTORS = [
  '[data-testid="Actions-tool"][aria-hidden="false"]',
  '[data-testid="Actions-tool"]',
  '[data-testid="tool-bar"]',
  '[data-testid="editor"]',
];

function isContextClosedError(err) {
  return /closed|detached|destroyed|crashed/i.test(err?.message || '');
}

async function withContextReconnect(context, operation) {
  try {
    return await operation(context);
  } catch (err) {
    if (!isContextClosedError(err)) throw err;
    logger.info('Соединение с Chrome потеряно — восстанавливаю...');
    const liveContext = await ensureLiveContext();
    logger.info('Соединение с Chrome восстановлено');
    return operation(liveContext);
  }
}

function normalizeFigmaUrl(url) {
  const match = url.match(/figma\.com\/(design|file|board|proto)\/([a-zA-Z0-9]+)/i);
  if (!match) {
    throw new Error('Некорректная ссылка Figma');
  }
  const [, type, key] = match;
  return `https://www.figma.com/${type}/${key}/`;
}

async function describePage(page) {
  const url = page.url();
  const title = await page.title().catch(() => '');
  return `${url}${title ? ` — ${title}` : ''}`;
}

async function waitForDomReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: LOAD_STATE_TIMEOUT_MS }).catch(async () => {
    logger.info(`domcontentloaded не сработал за ${LOAD_STATE_TIMEOUT_MS / 1000}с — продолжаю (${page.url()})`);
  });
}

async function waitForEditorToolbar(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    throwIfBackupCancelled();
    for (const selector of EDITOR_READY_SELECTORS) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        return selector;
      }
    }
    await page.waitForTimeout(1500);
  }

  throw new Error(`панель инструментов не появилась (${await describePage(page)})`);
}

async function openFigmaPage(page, cleanUrl) {
  let lastError = null;

  for (let attempt = 1; attempt <= NAV_ATTEMPTS; attempt += 1) {
    try {
      const waitUntil = attempt === NAV_ATTEMPTS ? 'commit' : 'domcontentloaded';
      logger.info(`Открываю Figma (попытка ${attempt}/${NAV_ATTEMPTS}, waitUntil=${waitUntil})...`);
      await page.goto(cleanUrl, { waitUntil, timeout: NAV_TIMEOUT_MS });
      await waitForDomReady(page);
      await assertLoggedIn(page);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < NAV_ATTEMPTS) {
        logger.info(`Figma не открылась (попытка ${attempt}/${NAV_ATTEMPTS}) — повторяю...`);
        await page.waitForTimeout(2000);
        if (attempt === NAV_ATTEMPTS - 1) {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => {});
        }
      }
    }
  }

  throw lastError || new Error(`Не удалось открыть Figma: ${cleanUrl}`);
}

async function assertLoggedIn(page) {
  const url = page.url();
  if (url.includes('/login') || url.includes('accounts.google.com')) {
    throw new Error('Сессия Figma истекла. Нажмите «Авторизоваться в Figma» заново.');
  }

  const loginPrompt = page.getByRole('button', { name: /log in|sign in|войти/i }).first();
  if (await loginPrompt.isVisible({ timeout: 1000 }).catch(() => false)) {
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
  let lastError = null;

  for (let attempt = 1; attempt <= EDITOR_READY_ATTEMPTS; attempt += 1) {
    try {
      await dismissOverlays(page);
      await waitForDomReady(page);
      const selector = await waitForEditorToolbar(page, EDITOR_READY_TIMEOUT_MS);
      await page.waitForSelector('canvas', { timeout: 15_000 }).catch(() => {});
      await assertLoggedIn(page);
      await dismissOverlays(page);
      await page.waitForTimeout(800);
      logger.info(`Редактор загружен (${selector})`);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < EDITOR_READY_ATTEMPTS) {
        logger.info(`Редактор Figma не готов (попытка ${attempt}/${EDITOR_READY_ATTEMPTS}) — обновляю...`);
        await dismissOverlays(page);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => {});
        await page.waitForTimeout(3000);
      }
    }
  }

  const details = await describePage(page).catch(() => page.url());
  const message = lastError?.message || 'Редактор Figma не загрузился';
  throw new Error(`${message}. Страница: ${details}`);
}

async function openActionsMenu(page) {
  await page.bringToFront();
  await page.locator('canvas').first().click({ position: { x: 200, y: 200 }, force: true });
  await page.waitForTimeout(300);
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(800);

  const input = page.locator('[role="combobox"] input, input[placeholder*="Search" i]').first();
  await input.waitFor({ state: 'visible', timeout: PALETTE_INPUT_TIMEOUT_MS });
  return input;
}

async function openActionsMenuWithRetry(page) {
  let lastError = null;
  for (let attempt = 1; attempt <= PALETTE_ATTEMPTS; attempt += 1) {
    try {
      return await openActionsMenu(page);
    } catch (err) {
      lastError = err;
      if (attempt < PALETTE_ATTEMPTS) {
        logger.info(`Командная палитра Figma недоступна (попытка ${attempt}/${PALETTE_ATTEMPTS}) — повторяю...`);
        await dismissOverlays(page);
        await page.waitForTimeout(800);
      }
    }
  }
  throw lastError || new Error('Не удалось открыть командную палитру Figma (Cmd+K)');
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
  const input = await openActionsMenuWithRetry(page);

  const queries = ['Save local copy', 'Сохранить локальную копию'];
  let matched = false;
  for (const query of queries) {
    await input.fill(query);
    await page.waitForTimeout(600);
    if (await page.getByTestId('save-as').isVisible({ timeout: SAVE_AS_QUERY_TIMEOUT_MS }).catch(() => false)) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    throw new Error('Команда Save local copy не найдена в Figma');
  }

  logger.info('Кликаю [data-testid=save-as]...');
  await page.getByTestId('save-as').click({ force: true });

  await waitForFigmaExport(page);
}

async function triggerSaveLocalCopy(page) {
  logger.info('Запускаю: Actions menu → Save local copy');
  return waitForDownloadResult(page, clickSaveLocalCopy);
}

async function saveDownloadResult(result, destDir, page, linkName) {
  let baseName = linkName ? sanitizeLinkName(linkName) : '';

  if (!baseName) {
    baseName = path.basename(result.path, '.fig');
    if (!baseName) {
      const title = await page.title();
      baseName = title.replace(/\s*[–—-]\s*Figma.*$/i, '').trim();
    }
  } else {
    const figmaName = path.basename(result.path, '.fig');
    if (figmaName && figmaName !== baseName) {
      logger.info(`Имя файла: «${baseName}.fig» (из таблицы, Figma: «${figmaName}.fig»)`);
    }
  }

  if (!baseName) {
    throw new Error('Не удалось определить имя файла');
  }

  const destPath = path.join(destDir, `${baseName}.fig`);

  fs.copyFileSync(result.path, destPath);

  if (!fs.existsSync(destPath)) {
    throw new Error('Файл .fig не был сохранён');
  }

  return { fileName: baseName, destPath };
}

async function downloadFigmaFileWithContext(context, figmaUrl, destDir, linkName = null) {
  const cleanUrl = normalizeFigmaUrl(figmaUrl);

  return withContextReconnect(context, async (liveContext) => {
    const page = await liveContext.newPage();

    try {
      await page.bringToFront();
      logger.info(`Открываю: ${cleanUrl}`);
      await openFigmaPage(page, cleanUrl);

      throwIfBackupCancelled();
      await waitForEditorReady(page);
      throwIfBackupCancelled();

      const result = await triggerSaveLocalCopy(page);
      return await saveDownloadResult(result, destDir, page, linkName);
    } finally {
      await page.close().catch(() => {});
    }
  });
}

module.exports = {
  downloadFigmaFileWithContext,
  normalizeFigmaUrl,
  EDITOR_READY_SELECTORS,
  BETWEEN_FILES_PAUSE_MS,
};
