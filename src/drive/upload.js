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
const { fileVisibleInFolder } = require('./file-info');
const { forceReconnectContext } = require('../playwright/chrome-manager');
const logger = require('../logger');
const { throwIfBackupCancelled } = require('../backup/cancel');

const UPLOAD_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const UPLOAD_START_TIMEOUT_MS = 90_000;
const LARGE_FILE_BYTES = 45 * 1024 * 1024;

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

async function verifyReplacedFile(page, fileName, localSizeBytes) {
  if (!(await fileVisibleInFolder(page, fileName))) {
    throw new Error(`«${fileName}» отсутствует в папке Drive после загрузки`);
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

async function clickFileUploadMenu(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(150);

  const newButton = page.getByRole('button', { name: /^(New|Создать)$/i }).first();
  await newButton.click({ timeout: 15_000 });
  const uploadItem = page.getByRole('menuitem', {
    name: /File upload|Upload files|Загрузить файлы|Отправить файлы/i,
  }).first();
  await uploadItem.click({ timeout: 10_000 });
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

async function startUpload(page, absolutePath) {
  const sizeBytes = fs.statSync(absolutePath).size;
  const sizeGb = (sizeBytes / 1024 ** 3).toFixed(2);

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 20_000 }),
    clickFileUploadMenu(page),
  ]);

  if (sizeBytes > LARGE_FILE_BYTES) {
    logger.info(`Большой файл (${sizeGb} ГБ) — передаю через CDP`);
    await setFilesOnHiddenInput(page, absolutePath);
  } else {
    await fileChooser.setFiles(absolutePath);
  }

  logger.info(`Файл передан в Drive (${sizeGb} ГБ)`);
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

async function waitForUploadComplete(page, context, folderId, folderUrl, fileName) {
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
        if (lastPercent > 0 && (await fileVisibleInFolder(activePage, fileName).catch(() => false))) {
          logger.success('Загрузка в Drive завершена');
          return activePage;
        }
      } catch {
        const recoveredPage = await tryFileVisibleAfterDisconnect(liveContext, fileName);
        if (recoveredPage) {
          logger.success('Загрузка в Drive завершена');
          return recoveredPage;
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
      let visible = false;
      try {
        visible = await fileVisibleInFolder(activePage, fileName);
      } catch (err) {
        if (isPageClosedError(err)) {
          try {
            ({ page: activePage, context: liveContext } = await reconnectDuringUpload(
              liveContext,
              folderId,
              folderUrl,
              lastPercent,
            ));
            visible = await fileVisibleInFolder(activePage, fileName).catch(() => false);
          } catch {
            const recoveredPage = await tryFileVisibleAfterDisconnect(liveContext, fileName);
            if (recoveredPage) {
              logger.success('Загрузка в Drive завершена');
              return recoveredPage;
            }
            visible = false;
          }
        } else {
          throw err;
        }
      }
      if (visible) {
        logger.success('Загрузка в Drive завершена');
        return activePage;
      }
      if (Date.now() - lastProgressAt > 10 * 60 * 1000) {
        throw new Error(`Загрузка остановилась на ${lastPercent}%`);
      }
    } else {
      logger.success('Загрузка в Drive завершена');
      await sleep(3000);
      return activePage;
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
    await startUpload(activePage, absolutePath);

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
    activePage = await waitForUploadComplete(activePage, liveContext, folderId, folderUrl, fileName);
    await verifyReplacedFile(activePage, fileName, localSizeBytes);
  } catch (err) {
    try {
      liveContext = await getLiveContext(liveContext);
      ({ page: activePage } = await recoverUploadPage(liveContext, folderId, folderUrl, { force: true }));
      if (await fileVisibleInFolder(activePage, fileName)) {
        logger.success(`«${fileName}» уже в папке Drive — загрузка завершилась несмотря на сбой вкладки`);
        return;
      }
    } catch {
      // ignore recovery errors
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
