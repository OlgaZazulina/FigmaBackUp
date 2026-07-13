const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parseDriveFolderId } = require('./parse-url');
const {
  sleep,
  getLiveContext,
  recoverUploadPage,
  resolveUploadPage,
} = require('./folder-page');
const { fileVisibleInFolder, getDriveFileInfo } = require('./file-info');
const { isModifiedOnOrAfter, formatSkipDateLabel } = require('../backup/fig-filename');
const { forceReconnectContext } = require('../playwright/chrome-manager');
const logger = require('../logger');
const { throwIfBackupCancelled, BackupCancelledError } = require('../backup/cancel');

const UPLOAD_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const UPLOAD_START_TIMEOUT_MS = 90_000;
const LARGE_FILE_BYTES = 45 * 1024 * 1024;
const UPLOAD_MENU_ATTEMPTS = 3;
const UPLOAD_MENU_ITEM_TIMEOUT_MS = 15_000;
const DRIVE_CONFIRM_POLL_MS = 3000;
const DRIVE_CONFIRM_GRACE_MS = 120_000;

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

function isContextClosedError(err) {
  return /closed|detached|destroyed|crashed/i.test(err?.message || '');
}

function isPageClosedError(err) {
  return isContextClosedError(err);
}

async function reconnectDuringUpload(context, folderId, folderUrl, lastPercent) {
  if (lastPercent >= 0) {
    logger.info(`Временно потеряна связь с вкладкой (${lastPercent}%) — восстанавливаю...`);
  } else {
    logger.info('Временно потеряна связь с вкладкой — восстанавливаю...');
  }
  return recoverUploadPage(context, folderId, folderUrl, { force: true });
}

async function tryFileVisibleAfterDisconnect(liveContext, fileName) {
  if (!liveContext || !fileName) return null;
  try {
    const pages = liveContext.pages().filter((p) => !p.isClosed());
    for (const p of pages) {
      if (await fileVisibleInFolder(p, fileName).catch(() => false)) {
        return p;
      }
    }
  } catch {
    // keep polling
  }
  return null;
}

function runOsascript(lines) {
  if (process.platform !== 'darwin') return false;
  try {
    execSync(`osascript ${lines.map((line) => `-e ${JSON.stringify(line)}`).join(' ')}`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function dismissNativeOpenPanelFallback() {
  if (process.platform !== 'darwin') return;
  runOsascript([
    `tell application "System Events"
      if exists process "Open and Save Panel Service" then
        tell process "Open and Save Panel Service"
          try
            if exists button "Cancel" of window 1 then
              click button "Cancel" of window 1
            else
              key code 53
            end if
          end try
        end tell
      end if
    end tell`,
  ]);
}

async function dismissOfflineBanner(page) {
  const offlineBanner = page.getByText(/offline|офлайн|нет подключения|no connection/i).first();
  if (!(await offlineBanner.isVisible({ timeout: 300 }).catch(() => false))) return;

  logger.info('Google Drive показывает offline — жду восстановления связи...');
  const retryBtn = page.getByRole('button', { name: /Try again|Retry|Повторить|Reload|Обновить/i }).first();
  if (await retryBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await retryBtn.click().catch(() => {});
  }
}

async function confirmReplaceDialog(page) {
  logger.info('Подтверждаю замену файла в Google Drive...');

  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    throwIfBackupCancelled();
    const modal = page.locator('[aria-modal="true"]').filter({
      hasText: /already exists|уже существует/i,
    }).first();

    if (!(await modal.isVisible({ timeout: 500 }).catch(() => false))) {
      await sleep(500);
      continue;
    }

    const replaceOption = modal.getByText(
      /^(Replace existing file|Заменить существующий файл)$/i,
      { exact: true },
    ).first();
    if (await replaceOption.isVisible({ timeout: 1000 }).catch(() => false)) {
      await replaceOption.click();
      await sleep(400);
    }

    const uploadBtn = modal.getByText(/^(Upload|Загрузить|Отправить)$/i, { exact: true }).first();
    if (await uploadBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await uploadBtn.click();
      logger.info('Замена подтверждена: Replace existing file → Upload');
      await sleep(1000);
      return true;
    }

    await sleep(500);
  }

  return false;
}

async function safeGetUploadStatus(page) {
  await dismissOfflineBanner(page);
  return getUploadStatus(page);
}

async function isUploadConfirmedOnDrive(page, fileName, uploadStartedAt, { replacing = false } = {}) {
  if (!(await fileVisibleInFolder(page, fileName).catch(() => false))) {
    return false;
  }
  if (!replacing) {
    return true;
  }
  const info = await getDriveFileInfo(page, fileName);
  return !!(info.modifiedAt && isModifiedOnOrAfter(info.modifiedAt, uploadStartedAt));
}

async function waitForDriveUploadConfirmation(
  page,
  context,
  folderId,
  folderUrl,
  fileName,
  {
    replacing = false,
    uploadStartedAt = new Date(),
    lastPercent = -1,
    maxWaitMs = DRIVE_CONFIRM_GRACE_MS,
  } = {},
) {
  const deadline = Date.now() + maxWaitMs;
  let activePage = page;
  let liveContext = context;

  while (Date.now() < deadline) {
    throwIfBackupCancelled();
    try {
      if (await isUploadConfirmedOnDrive(activePage, fileName, uploadStartedAt, { replacing })) {
        if (lastPercent >= 0 && lastPercent < 100) {
          logger.info(
            `Загрузка подтверждена на Drive (индикатор остановился на ${lastPercent}%)`,
          );
        }
        return activePage;
      }
    } catch (err) {
      if (!isPageClosedError(err)) throw err;
      ({ page: activePage, context: liveContext } = await reconnectDuringUpload(
        liveContext,
        folderId,
        folderUrl,
        lastPercent,
      ));
    }
    await sleep(DRIVE_CONFIRM_POLL_MS);
  }

  return null;
}

async function verifyReplacedFile(page, fileName, localSizeBytes, { replacing = false, uploadStartedAt = new Date() } = {}) {
  if (!(await fileVisibleInFolder(page, fileName))) {
    throw new Error(`«${fileName}» отсутствует в папке Drive после загрузки`);
  }

  if (replacing) {
    const confirmed = await isUploadConfirmedOnDrive(page, fileName, uploadStartedAt, { replacing: true });
    if (!confirmed) {
      const info = await getDriveFileInfo(page, fileName);
      const label = info.modifiedAt
        ? formatSkipDateLabel(info.modifiedAt, uploadStartedAt)
        : 'неизвестна';
      throw new Error(
        `«${fileName}» не обновлён на Drive — дата изменения ${label}, замена не подтверждена`,
      );
    }
  }

  logger.success(`«${fileName}» в папке Drive (${formatSize(localSizeBytes)})`);
}

async function getUploadStatus(page) {
  const bars = page.locator('[role="progressbar"][aria-valuenow]');
  const count = await bars.count();

  for (let i = 0; i < count; i += 1) {
    const bar = bars.nth(i);
    if (!(await bar.isVisible({ timeout: 200 }).catch(() => false))) continue;

    const valuenow = parseInt(await bar.getAttribute('aria-valuenow'), 10);
    const valuemax = parseInt(await bar.getAttribute('aria-valuemax') || '100', 10);
    if (Number.isNaN(valuenow) || Number.isNaN(valuemax) || valuemax <= 0) continue;

    const percent = Math.round((valuenow / valuemax) * 100);
    const label = (await bar.getAttribute('aria-label').catch(() => '')) || '';
    if (percent < 100) {
      return { active: true, percent, label: label.trim() };
    }
  }

  const workingToast = page.getByText(/^Working\.\.\.$|^Uploading \d/i).first();
  if (await workingToast.isVisible({ timeout: 200 }).catch(() => false)) {
    const label = ((await workingToast.textContent().catch(() => '')) || '').trim();
    return { active: true, percent: null, label };
  }

  return { active: false, percent: null, label: '' };
}

async function dismissDriveUi(page) {
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(120);
  }

  const closeButtons = page.getByRole('button', {
    name: /^(Close|Закрыть|Dismiss|Отмена|Cancel)$/i,
  });
  const closeCount = await closeButtons.count().catch(() => 0);
  for (let i = 0; i < closeCount; i += 1) {
    const btn = closeButtons.nth(i);
    if (await btn.isVisible({ timeout: 200 }).catch(() => false)) {
      await btn.click().catch(() => {});
    }
  }
}

async function waitForDriveUiIdle(page, maxWaitMs = 60_000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    throwIfBackupCancelled();
    const status = await getUploadStatus(page).catch(() => ({ active: false }));
    if (!status.active) return;
    await sleep(2000);
  }
  logger.info('Индикатор загрузки в Drive ещё активен — продолжаю');
}

function uploadMenuItemLocator(page) {
  const pattern = /File upload|Upload files|Загрузить файлы|Отправить файлы|Загрузка файлов/i;
  return page.locator('[role="menuitem"], [role="option"], [role="menuitemradio"]').filter({
    hasText: pattern,
  }).first();
}

async function clickNewButton(page) {
  const candidates = [
    page.getByRole('button', { name: /^(New|Создать|Новый)$/i }).first(),
    page.locator('button[aria-label*="New" i], button[aria-label*="Создать" i]').first(),
    page.locator('[guidedhelpid="new_menu_button"]').first(),
  ];

  for (const button of candidates) {
    if (await button.isVisible({ timeout: 1500 }).catch(() => false)) {
      await button.click({ timeout: 15_000 });
      return;
    }
  }

  throw new Error('Кнопка «Создать» не найдена в Google Drive');
}

async function clickFileUploadMenu(page) {
  let lastError = null;

  for (let attempt = 1; attempt <= UPLOAD_MENU_ATTEMPTS; attempt += 1) {
    throwIfBackupCancelled();
    try {
      await dismissDriveUi(page);
      await dismissOfflineBanner(page);
      await waitForDriveUiIdle(page, attempt === 1 ? 60_000 : 10_000);

      await clickNewButton(page);
      await page.locator('[role="menu"], [role="listbox"]').first()
        .waitFor({ state: 'visible', timeout: 5000 })
        .catch(() => {});

      const uploadItem = uploadMenuItemLocator(page);
      await uploadItem.waitFor({ state: 'visible', timeout: UPLOAD_MENU_ITEM_TIMEOUT_MS });
      await uploadItem.click({ timeout: UPLOAD_MENU_ITEM_TIMEOUT_MS });
      return;
    } catch (err) {
      lastError = err;
      if (attempt < UPLOAD_MENU_ATTEMPTS) {
        logger.info(`Меню загрузки Drive недоступно (попытка ${attempt}/${UPLOAD_MENU_ATTEMPTS}) — повторяю...`);
        await dismissDriveUi(page);
        await sleep(1000);
      }
    }
  }

  throw lastError || new Error('Не удалось открыть меню загрузки в Google Drive');
}

async function setFilesOnHiddenInput(page, absolutePath) {
  await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 10_000 });

  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
    nodeId: root.nodeId,
    selector: 'input[type="file"]',
  });

  const nodeId = nodeIds[nodeIds.length - 1];
  if (!nodeId) {
    throw new Error('Не найден input для загрузки');
  }

  await cdp.send('DOM.setFileInputFiles', {
    nodeId,
    files: [absolutePath],
  });

  for (const type of ['input', 'change']) {
    await cdp.send('DOM.dispatchEvent', { nodeId, type, bubbles: true }).catch(() => {});
  }
}

async function startUpload(page, context, folderId, folderUrl, absolutePath) {
  const sizeBytes = fs.statSync(absolutePath).size;
  const sizeGb = (sizeBytes / 1024 ** 3).toFixed(2);
  let activePage = page;
  let lastError = null;

  for (let attempt = 1; attempt <= UPLOAD_MENU_ATTEMPTS; attempt += 1) {
    throwIfBackupCancelled();
    try {
      if (attempt > 1) {
        const recovered = await recoverUploadPage(
          context,
          folderId,
          folderUrl,
          { force: attempt === UPLOAD_MENU_ATTEMPTS },
        );
        activePage = recovered.page;
      }

      if (sizeBytes > LARGE_FILE_BYTES) {
        await clickFileUploadMenu(activePage);
        logger.info(`Большой файл (${sizeGb} ГБ) — передаю через CDP`);
        await setFilesOnHiddenInput(activePage, absolutePath);
      } else {
        const [fileChooser] = await Promise.all([
          activePage.waitForEvent('filechooser', { timeout: 20_000 }),
          clickFileUploadMenu(activePage),
        ]);
        await fileChooser.setFiles(absolutePath);
      }

      logger.info(`Файл передан в Drive (${sizeGb} ГБ)`);
      return activePage;
    } catch (err) {
      lastError = err;
      if (attempt < UPLOAD_MENU_ATTEMPTS) {
        logger.info(`Не удалось начать загрузку в Drive (попытка ${attempt}/${UPLOAD_MENU_ATTEMPTS}) — повторяю...`);
        await sleep(1500);
      }
    }
  }

  throw lastError || new Error('Не удалось начать загрузку в Google Drive');
}

async function waitForUploadToStart(page, context, folderId, folderUrl) {
  logger.info('Жду индикатор загрузки в Google Drive...');
  const deadline = Date.now() + UPLOAD_START_TIMEOUT_MS;
  let activePage = page;
  let liveContext = context;

  while (Date.now() < deadline) {
    throwIfBackupCancelled();
    try {
      const status = await safeGetUploadStatus(activePage);
      if (status.active) {
        const progressText = status.percent != null ? `${status.percent}%` : 'идёт';
        logger.info(`Загрузка началась (${progressText})${status.label ? `: ${status.label}` : ''}`);
        return activePage;
      }
    } catch (err) {
      if (!isPageClosedError(err)) throw err;
      ({ page: activePage, context: liveContext } = await reconnectDuringUpload(
        liveContext,
        folderId,
        folderUrl,
        -1,
      ));
    }
    await sleep(1000);
  }

  throw new Error('Загрузка не началась — нет индикатора прогресса в Google Drive');
}

async function waitForUploadComplete(
  page,
  context,
  folderId,
  folderUrl,
  fileName,
  { replacing = false, uploadStartedAt = new Date() } = {},
) {
  logger.info('Ожидание завершения загрузки в Drive...');
  const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
  let lastLog = 0;
  let lastPercent = -1;
  let lastProgressAt = Date.now();
  let activePage = page;
  let liveContext = context;

  while (Date.now() < deadline) {
    throwIfBackupCancelled();
    let status = { active: false, percent: null, label: '' };

    try {
      status = await safeGetUploadStatus(activePage);
    } catch (err) {
      if (!isPageClosedError(err)) throw err;
      try {
        ({ page: activePage, context: liveContext } = await reconnectDuringUpload(
          liveContext,
          folderId,
          folderUrl,
          lastPercent,
        ));
        const confirmed = await waitForDriveUploadConfirmation(
          activePage,
          liveContext,
          folderId,
          folderUrl,
          fileName,
          { replacing, uploadStartedAt, lastPercent, maxWaitMs: 15_000 },
        );
        if (confirmed) {
          logger.success('Загрузка в Drive завершена');
          return confirmed;
        }
      } catch {
        const recoveredPage = await tryFileVisibleAfterDisconnect(liveContext, fileName);
        if (recoveredPage) {
          const confirmed = await waitForDriveUploadConfirmation(
            recoveredPage,
            liveContext,
            folderId,
            folderUrl,
            fileName,
            { replacing, uploadStartedAt, lastPercent, maxWaitMs: 15_000 },
          );
          if (confirmed) {
            logger.success('Загрузка в Drive завершена');
            return confirmed;
          }
        }
      }
      await sleep(3000);
      continue;
    }

    if (status.active) {
      lastProgressAt = Date.now();
      if (Date.now() - lastLog > 15_000 || (status.percent != null && status.percent !== lastPercent)) {
        const progressText = status.percent != null ? `${status.percent}%` : 'идёт';
        logger.info(`Загрузка в Drive: ${progressText}`);
        lastLog = Date.now();
        lastPercent = status.percent ?? lastPercent;
      }
    } else if (lastPercent >= 100) {
      logger.success('Загрузка в Drive завершена');
      await sleep(3000);
      return activePage;
    } else if (lastPercent > 0) {
      const confirmed = await waitForDriveUploadConfirmation(
        activePage,
        liveContext,
        folderId,
        folderUrl,
        fileName,
        { replacing, uploadStartedAt, lastPercent },
      );
      if (confirmed) {
        logger.success('Загрузка в Drive завершена');
        return confirmed;
      }
      if (Date.now() - lastProgressAt > 10 * 60 * 1000) {
        throw new Error(
          `«${fileName}» не обновлён на Drive — индикатор остановился на ${lastPercent}%`,
        );
      }
    } else if (!replacing) {
      const confirmed = await waitForDriveUploadConfirmation(
        activePage,
        liveContext,
        folderId,
        folderUrl,
        fileName,
        { replacing: false, uploadStartedAt, maxWaitMs: 30_000 },
      );
      if (confirmed) {
        logger.success('Загрузка в Drive завершена');
        return confirmed;
      }
      throw new Error(`«${fileName}» не появился в папке Drive после загрузки`);
    } else {
      const confirmed = await waitForDriveUploadConfirmation(
        activePage,
        liveContext,
        folderId,
        folderUrl,
        fileName,
        { replacing, uploadStartedAt, maxWaitMs: 60_000 },
      );
      if (confirmed) {
        logger.success('Загрузка в Drive завершена');
        return confirmed;
      }
      throw new Error(`«${fileName}» не обновлён на Drive — индикатор прогресса не появился`);
    }

    await sleep(2000);
  }

  throw new Error('Таймаут загрузки в Drive');
}

async function uploadFile(page, context, folderId, folderUrl, localFilePath) {
  const fileName = path.basename(localFilePath);
  const absolutePath = path.resolve(localFilePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Локальный файл не найден: ${absolutePath}`);
  }

  const localSizeBytes = fs.statSync(absolutePath).size;
  const uploadStartedAt = new Date();
  let liveContext = await getLiveContext(context);
  try {
    await liveContext.pages();
  } catch (err) {
    if (isContextClosedError(err)) {
      liveContext = await forceReconnectContext();
    } else {
      throw err;
    }
  }
  let { page: activePage } = await resolveUploadPage(liveContext, folderId, folderUrl);
  liveContext = await getLiveContext(liveContext);
  const replacing = await fileVisibleInFolder(activePage, fileName);

  if (replacing) {
    logger.info(`Заменяю «${fileName}» в Drive (${formatSize(localSizeBytes)})...`);
  } else {
    logger.info(`Загружаю новый файл: ${fileName} (${formatSize(localSizeBytes)})`);
  }

  try {
    await waitForDriveUiIdle(activePage, 60_000);
    activePage = await startUpload(activePage, liveContext, folderId, folderUrl, absolutePath);

    if (replacing) {
      const confirmed = await confirmReplaceDialog(activePage);
      if (!confirmed) {
        throw new Error('Не удалось подтвердить замену в Google Drive — старый файл остался на месте');
      }
    }

    for (let i = 0; i < 3; i += 1) {
      dismissNativeOpenPanelFallback();
      await sleep(200);
    }

    activePage = await waitForUploadToStart(activePage, liveContext, folderId, folderUrl);
    activePage = await waitForUploadComplete(activePage, liveContext, folderId, folderUrl, fileName, {
      replacing,
      uploadStartedAt,
    });
    await verifyReplacedFile(activePage, fileName, localSizeBytes, { replacing, uploadStartedAt });
  } catch (err) {
    if (err instanceof BackupCancelledError) {
      try {
        liveContext = await getLiveContext(liveContext);
        ({ page: activePage } = await recoverUploadPage(liveContext, folderId, folderUrl, { force: true }));
        await verifyReplacedFile(activePage, fileName, localSizeBytes, { replacing, uploadStartedAt });
        logger.success(`«${fileName}» загружен на Drive (бэкап остановлен после завершения загрузки)`);
        return;
      } catch {
        throw err;
      }
    }

    try {
      liveContext = await getLiveContext(liveContext);
      ({ page: activePage } = await recoverUploadPage(liveContext, folderId, folderUrl, { force: true }));
      const confirmed = await waitForDriveUploadConfirmation(
        activePage,
        liveContext,
        folderId,
        folderUrl,
        fileName,
        { replacing, uploadStartedAt },
      );
      if (confirmed) {
        await verifyReplacedFile(confirmed, fileName, localSizeBytes, { replacing, uploadStartedAt });
        logger.success(`«${fileName}» загружен на Drive — подтверждено после сбоя вкладки`);
        return;
      }
    } catch (verifyErr) {
      if (verifyErr.message.includes('не обновлён на Drive') || verifyErr.message.includes('отсутствует в папке')) {
        throw verifyErr;
      }
      // ignore recovery errors, fall through to original error
    }

    if (replacing && !(await fileVisibleInFolder(activePage, fileName).catch(() => false))) {
      throw new Error(
        `${err.message}. Старый файл «${fileName}» мог остаться без замены.`,
      );
    }
    throw err;
  }
}

async function uploadToDriveFolderWithContext(context, driveFolderUrl, localFilePath) {
  const folderId = parseDriveFolderId(driveFolderUrl);
  const fileName = path.basename(localFilePath);
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;

  let { page, context: liveContext } = await resolveUploadPage(context, folderId, folderUrl);
  await uploadFile(page, liveContext, folderId, folderUrl, localFilePath);
  logger.success(`Готово в Drive: ${fileName}`);
}

module.exports = { uploadToDriveFolderWithContext };
