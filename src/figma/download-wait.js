const fs = require('fs');
const path = require('path');
const os = require('os');
const { DOWNLOADS_TMP } = require('../store/paths');
const logger = require('../logger');
const { throwIfBackupCancelled } = require('../backup/cancel');

const STALL_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_MS = 2 * 60 * 60 * 1000;
const MAX_TOTAL_MS = MAX_DOWNLOAD_MS + 30 * 60 * 1000;
const POLL_MS = 2000;
const LOG_INTERVAL_MS = 15_000;

function watchDirs() {
  return [DOWNLOADS_TMP, path.join(os.homedir(), 'Downloads')];
}

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

function listFigFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.fig'));
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enableCdpDownloads(page) {
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOADS_TMP,
    });
  } catch {
    // CDP may be unavailable in some environments
  }
}

function snapshotWatchDirs() {
  const snapshot = new Map();
  for (const dir of watchDirs()) {
    snapshot.set(dir, new Set(listFigFiles(dir)));
  }
  return snapshot;
}

function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return -1;
  }
}

function candidateFromPath(figPath) {
  const partialPath = `${figPath}.crdownload`;
  const size = Math.max(getFileSize(figPath), getFileSize(partialPath));
  if (size < 0) return null;
  return { figPath, size };
}

function findDownloadCandidate(snapshot, preferredName) {
  if (preferredName) {
    for (const dir of watchDirs()) {
      const figPath = path.join(dir, preferredName);
      const partialPath = `${figPath}.crdownload`;
      if (fs.existsSync(figPath) || fs.existsSync(partialPath)) {
        const candidate = candidateFromPath(figPath);
        if (candidate) return candidate;
      }
    }
  }

  for (const dir of watchDirs()) {
    if (!fs.existsSync(dir)) continue;

    for (const name of fs.readdirSync(dir)) {
      const isFig = name.endsWith('.fig');
      const isPartial = name.endsWith('.crdownload');
      if (!isFig && !isPartial) continue;

      const figName = isPartial ? name.replace(/\.crdownload$/, '') : name;
      if (!figName.endsWith('.fig')) continue;

      const figPath = path.join(dir, figName);
      const wasKnown = snapshot.get(dir)?.has(figName);
      const isActive = isPartial || fs.existsSync(`${figPath}.crdownload`);

      if (!wasKnown || isActive) {
        const candidate = candidateFromPath(figPath);
        if (candidate) return candidate;
      }
    }
  }
  return null;
}

async function waitForFileComplete(figPath, deadlineMs, stallMs) {
  let lastSize = -1;
  let lastProgressAt = Date.now();
  let lastLogAt = 0;
  let seenGrowth = false;

  logger.info(`Скачивание: ${path.basename(figPath)}`);

  while (Date.now() < deadlineMs) {
    throwIfBackupCancelled();
    const partialPath = `${figPath}.crdownload`;
    const partialSize = getFileSize(partialPath);
    const figSize = getFileSize(figPath);
    const size = Math.max(figSize, partialSize);
    const partialGone = partialSize < 0;

    if (size < 0) {
      await sleep(POLL_MS);
      continue;
    }

    if (!seenGrowth && partialGone && figSize > 100) {
      logger.success(`Скачивание завершено: ${formatSize(figSize)}`);
      return figPath;
    }

    if (size > lastSize) {
      seenGrowth = true;
      lastProgressAt = Date.now();
      if (Date.now() - lastLogAt >= LOG_INTERVAL_MS) {
        logger.info(`Скачивание: ${formatSize(size)}...`);
        lastLogAt = Date.now();
      }
      lastSize = size;
      await sleep(POLL_MS);
      continue;
    }

    if (seenGrowth && size > 0 && partialGone && Date.now() - lastProgressAt >= stallMs) {
      logger.success(`Скачивание завершено: ${formatSize(size)}`);
      return figPath;
    }

    await sleep(POLL_MS);
  }

  throw new Error(
    `Скачивание не завершилось (последний размер: ${formatSize(Math.max(lastSize, 0))})`,
  );
}

async function waitForDownloadResult(page, triggerFn, options = {}) {
  const maxTotalMs = options.maxTotalMs ?? MAX_TOTAL_MS;
  const stallMs = options.stallMs ?? STALL_TIMEOUT_MS;

  fs.mkdirSync(DOWNLOADS_TMP, { recursive: true });
  await enableCdpDownloads(page);

  const snapshot = snapshotWatchDirs();
  let preferredName = null;
  let downloadStartedLogged = false;
  let triggerError = null;

  const onDownload = (download) => {
    preferredName = download.suggestedFilename();
  };
  page.on('download', onDownload);
  page.context().on('download', onDownload);

  const deadline = Date.now() + maxTotalMs;
  const triggerPromise = triggerFn(page).catch((err) => {
    triggerError = err;
  });

  try {
    while (Date.now() < deadline) {
      throwIfBackupCancelled();
      if (preferredName && !downloadStartedLogged) {
        logger.info(`Скачивание началось: ${preferredName}`);
        downloadStartedLogged = true;
      }

      const candidate = findDownloadCandidate(snapshot, preferredName);
      if (candidate) {
        logger.info(`Файл в загрузках: ${path.basename(candidate.figPath)} (${formatSize(candidate.size)})`);
        const finalPath = await waitForFileComplete(candidate.figPath, deadline, stallMs);
        return { kind: 'file', path: finalPath };
      }

      await sleep(POLL_MS);
    }

    await triggerPromise;
    if (triggerError) throw triggerError;
    throw new Error(`Файл .fig не появился за ${Math.round(maxTotalMs / 60_000)} мин`);
  } finally {
    page.off('download', onDownload);
    page.context().off('download', onDownload);
  }
}

module.exports = {
  waitForDownloadResult,
  enableCdpDownloads,
  formatSize,
  STALL_TIMEOUT_MS,
  MAX_DOWNLOAD_MS,
  MAX_TOTAL_MS,
};
