const fs = require('fs');
const path = require('path');
const { getEnabledLinks } = require('../store/links');
const { BACKUP_DIR } = require('../store/paths');
const { acquireContext, ensureLiveContext } = require('../playwright/chrome-manager');
const { downloadFigmaFileWithContext } = require('../figma/download');
const { uploadToDriveFolderWithContext } = require('../drive/upload');
const logger = require('../logger');

function makeTimestampDir() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('-') + '_' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('-');

  const dir = path.join(BACKUP_DIR, stamp);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function runBackup() {
  const enabledLinks = getEnabledLinks();
  if (enabledLinks.length === 0) {
    logger.info('Нет включённых ссылок для бэкапа');
    return { success: 0, errors: 0 };
  }

  const backupDir = makeTimestampDir();
  logger.info(`Создана папка бэкапа: ${backupDir}`);
  logger.info(`Начинаю бэкап ${enabledLinks.length} файл(ов)...`);

  const chrome = await acquireContext();

  let success = 0;
  let errors = 0;

  try {
    for (const link of enabledLinks) {
      try {
        logger.info(`Скачиваю «${link.name}» из Figma...`);
        const { destPath, fileName } = await downloadFigmaFileWithContext(
          chrome.context,
          link.figmaUrl,
          backupDir,
        );
        logger.info(`Сохранено локально: ${destPath}`);

        logger.info(`Загружаю «${fileName}» в Google Drive...`);
        const liveContext = await ensureLiveContext();
        await uploadToDriveFolderWithContext(liveContext, link.driveFolderUrl, destPath);

        logger.success(`«${link.name}» — готово`);
        success++;
      } catch (err) {
        logger.error(`«${link.name}» — ${err.message}`);
        errors++;
      }
    }
  } finally {
    await chrome.release();
  }

  logger.info(`Бэкап завершён: ${success} успешно, ${errors} ошибок`);
  return { success, errors };
}

module.exports = { runBackup };
