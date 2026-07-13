const fs = require('fs');
const path = require('path');
const { getEnabledLinks, getEnabledLinksByIds, getLinksByIds } = require('../store/links');
const { BACKUP_DIR } = require('../store/paths');
const { acquireContext, ensureLiveContext } = require('../playwright/chrome-manager');
const { downloadFigmaFileWithContext } = require('../figma/download');
const { uploadToDriveFolderWithContext } = require('../drive/upload');
const { getDriveFileInfoWithContext } = require('../drive/file-info');
const {
  expectedFigFileName,
  shouldSkipUpload,
  formatSkipDateLabel,
  formatSkipReason,
} = require('./fig-filename');
const logger = require('../logger');
const {
  BackupCancelledError,
  resetBackupCancel,
  isBackupCancelRequested,
  throwIfBackupCancelled,
} = require('./cancel');
const { startSleepGuard, stopSleepGuard } = require('../system/sleep-guard');

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return BACKUP_DIR;
}

function logBackupSummary(uploaded, skipped, errors) {
  logger.info('Итог бэкапа:');
  if (uploaded.length) {
    logger.info(`Загружены (${uploaded.length}): ${uploaded.map((x) => `«${x.name}»`).join(', ')}`);
  } else {
    logger.info('Загружены (0): нет');
  }
  if (skipped.length) {
    const list = skipped.map((x) => `«${x.name}» (${x.reason})`).join(', ');
    logger.info(`Пропущены (${skipped.length}): ${list}`);
  } else {
    logger.info('Пропущены (0): нет');
  }
  if (errors.length) {
    logger.info(`Ошибки (${errors.length}): ${errors.map((x) => `«${x.name}» — ${x.message}`).join('; ')}`);
  }
}

async function runBackup(linkIds = null, { force = false } = {}) {
  resetBackupCancel();

  const enabledLinks = linkIds && linkIds.length > 0
    ? (force ? getLinksByIds(linkIds) : getEnabledLinksByIds(linkIds))
    : getEnabledLinks();
  if (enabledLinks.length === 0) {
    logger.info(force ? 'Ссылки для бэкапа не найдены' : 'Нет включённых ссылок для бэкапа');
    return { uploaded: [], skipped: [], errors: [], cancelled: false };
  }

  const backupDir = ensureBackupDir();
  logger.info(`Локальная папка бэкапа: ${backupDir}`);
  logger.info(`Начинаю бэкап ${enabledLinks.length} файл(ов)...`);

  const chrome = await acquireContext();
  startSleepGuard();
  const uploaded = [];
  const skipped = [];
  const errors = [];

  let cancelled = false;

  try {
    for (const link of enabledLinks) {
      throwIfBackupCancelled();

      try {
        const driveFileName = expectedFigFileName(link.name);

        if (!force) {
          logger.info(`Проверяю дату «${driveFileName}» на Drive...`);
          const liveContext = await ensureLiveContext();
          const info = await getDriveFileInfoWithContext(
            liveContext,
            link.driveFolderUrl,
            driveFileName,
          );

          if (info.exists && info.modifiedAt && shouldSkipUpload(info.modifiedAt)) {
            const label = formatSkipDateLabel(info.modifiedAt);
            logger.info(`«${link.name}» — пропущен: на Drive обновлён ${label}`);
            skipped.push(formatSkipReason(link.name, info.modifiedAt));
            continue;
          }
          if (info.exists && !info.modifiedAt) {
            logger.info(`«${link.name}» — дата не распознана, выполняю загрузку`);
          }
          if (!info.exists) {
            logger.info(`«${link.name}» — файл не найден на Drive, выполняю загрузку`);
          }
        } else {
          logger.info(`«${link.name}» — принудительная загрузка (проверка даты пропущена)`);
        }

        logger.info(`Скачиваю «${link.name}» из Figma...`);
        const downloadContext = await ensureLiveContext();
        const { destPath } = await downloadFigmaFileWithContext(
          downloadContext,
          link.figmaUrl,
          backupDir,
          link.name,
        );
        if (path.basename(destPath) !== driveFileName) {
          throw new Error(`Имя файла «${path.basename(destPath)}» не совпадает с таблицей «${driveFileName}»`);
        }
        logger.info(`Сохранено локально: ${destPath}`);

        logger.info(`Загружаю «${driveFileName}» в Google Drive...`);
        const uploadContext = await ensureLiveContext();
        await uploadToDriveFolderWithContext(uploadContext, link.driveFolderUrl, destPath);

        logger.success(`«${link.name}» — готово`);
        uploaded.push({ name: link.name });
      } catch (err) {
        if (err instanceof BackupCancelledError) {
          cancelled = true;
          break;
        }
        logger.error(`«${link.name}» — ${err.message}`);
        errors.push({ name: link.name, message: err.message });
      }
    }
  } finally {
    stopSleepGuard();
    await chrome.release();
  }

  logBackupSummary(uploaded, skipped, errors);
  if (cancelled || isBackupCancelRequested()) {
    logger.info('Бэкап остановлен пользователем');
  }
  return {
    uploaded,
    skipped,
    errors,
    cancelled: cancelled || isBackupCancelRequested(),
  };
}

module.exports = { runBackup };
