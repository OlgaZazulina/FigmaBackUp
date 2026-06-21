const express = require('express');
const links = require('./store/links');
const { DESIGNERS, validateDesignerPair } = require('./store/designers');
const { getAuthStatus, resetAuthState } = require('./store/auth-state');
const { resetBrowserProfiles } = require('./playwright/chrome-manager');
const logger = require('./logger');
const { PUBLIC_DIR } = require('./store/paths');
const { authenticateFigma } = require('./figma/auth');
const { authenticateGoogle } = require('./drive/auth');
const { runBackup } = require('./backup/orchestrator');

let backupRunning = false;

function createServer(port) {
  resetBrowserProfiles();
  resetAuthState();
  logger.info('Перед бэкапом авторизуйтесь в Figma и Google Drive');

  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  app.get('/api/links', (_req, res) => {
    res.json({ links: links.getLinks() });
  });

  app.get('/api/designers', (_req, res) => {
    res.json({ designers: DESIGNERS });
  });

  app.post('/api/links', (req, res) => {
    const { name, figmaUrl, driveFolderUrl, responsible, backup } = req.body;
    if (!name || !figmaUrl || !driveFolderUrl) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }
    const designerError = validateDesignerPair(responsible, backup);
    if (designerError) {
      return res.status(400).json({ error: designerError });
    }
    const link = links.addLink({ name, figmaUrl, driveFolderUrl, responsible, backup });
    if (!link) return res.status(400).json({ error: 'Не удалось добавить ссылку' });
    res.status(201).json(link);
  });

  app.put('/api/links/reorder', (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'Некорректный список id' });
    }
    const reordered = links.reorderLinks(ids);
    if (!reordered) {
      return res.status(400).json({ error: 'Некорректный порядок ссылок' });
    }
    res.json({ links: reordered });
  });

  app.put('/api/links/:id', (req, res) => {
    const existing = links.getLinkById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Ссылка не найдена' });

    const next = { ...existing, ...req.body };
    const designerError = validateDesignerPair(next.responsible, next.backup);
    if (designerError) {
      return res.status(400).json({ error: designerError });
    }

    const updated = links.updateLink(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Ссылка не найдена' });
    res.json(updated);
  });

  app.delete('/api/links/:id', (req, res) => {
    const ok = links.deleteLink(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Ссылка не найдена' });
    res.status(204).end();
  });

  app.get('/api/auth/status', (_req, res) => {
    res.json({ ...getAuthStatus(), backupRunning });
  });

  app.post('/api/auth/figma', async (_req, res) => {
    try {
      logger.info('Открываю вход в Figma...');
      await authenticateFigma();
      res.json({ ok: true });
    } catch (err) {
      logger.error(`Ошибка авторизации Figma: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/auth/google', async (_req, res) => {
    try {
      logger.info('Открываю вход в Google Drive...');
      const driveFolderUrl = links.getEnabledLinks()[0]?.driveFolderUrl;
      await authenticateGoogle(driveFolderUrl);
      res.json({ ok: true });
    } catch (err) {
      logger.error(`Ошибка авторизации Google: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/backup', async (req, res) => {
    if (backupRunning) {
      return res.status(409).json({ error: 'Бэкап уже выполняется' });
    }
    const status = getAuthStatus();
    if (!status.ready) {
      return res.status(401).json({ error: 'Сначала авторизуйтесь в Figma и Google Drive' });
    }

    const { ids } = req.body || {};
    let linkIds = null;
    if (ids !== undefined && ids !== null) {
      if (!Array.isArray(ids)) {
        return res.status(400).json({ error: 'Некорректный список id' });
      }
      if (ids.length === 0) {
        return res.status(400).json({ error: 'Не выбрано ни одной ссылки для бэкапа' });
      }
      for (const id of ids) {
        const link = links.getLinkById(id);
        if (!link) {
          return res.status(400).json({ error: 'Ссылка не найдена' });
        }
        if (!link.enabled) {
          return res.status(400).json({ error: `Ссылка «${link.name}» отключена` });
        }
      }
      linkIds = ids;
    }

    backupRunning = true;
    res.json({ ok: true, message: 'Бэкап запущен' });

    runBackup(linkIds, { force: false })
      .catch((err) => logger.error(`Критическая ошибка бэкапа: ${err.message}`))
      .finally(() => { backupRunning = false; });
  });

  app.post('/api/links/:id/backup', async (req, res) => {
    if (backupRunning) {
      return res.status(409).json({ error: 'Бэкап уже выполняется' });
    }
    const status = getAuthStatus();
    if (!status.ready) {
      return res.status(401).json({ error: 'Сначала авторизуйтесь в Figma и Google Drive' });
    }

    const link = links.getLinkById(req.params.id);
    if (!link) return res.status(404).json({ error: 'Ссылка не найдена' });
    if (!link.enabled) {
      return res.status(400).json({ error: 'Ссылка отключена' });
    }

    const force = !!req.body?.force;
    backupRunning = true;
    res.json({
      ok: true,
      message: force ? 'Принудительная загрузка запущена' : 'Бэкап запущен',
    });

    runBackup([link.id], { force })
      .catch((err) => logger.error(`Критическая ошибка бэкапа: ${err.message}`))
      .finally(() => { backupRunning = false; });
  });

  app.get('/api/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const onLog = (entry) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    };
    logger.on('log', onLog);

    req.on('close', () => {
      logger.off('log', onLog);
    });
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve(server));
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        err.message = `Порт ${port} уже занят. Закройте предыдущее окно Terminal или выполните: kill $(lsof -t -i:${port})`;
      }
      reject(err);
    });
  });
}

module.exports = { createServer };

const PORT = 3847;

function isServerRunning(port) {
  return new Promise((resolve) => {
    const req = require('http').get(`http://localhost:${port}/api/auth/status`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function openBrowser(port) {
  require('child_process').exec(`open http://localhost:${port}`);
}

async function main() {
  const { getChromeExecutable } = require('./playwright/chrome-path');
  const chromePath = getChromeExecutable();
  if (!chromePath) {
    console.error('Google Chrome не найден. Установите: https://www.google.com/chrome/');
    process.exit(1);
  }
  console.log(`Браузер для бэкапа: ${chromePath}`);

  try {
    await createServer(PORT);
    console.log(`Сервер запущен: http://localhost:${PORT}`);
    console.log('Не закрывайте это окно. Ctrl+C — остановка.');
    openBrowser(PORT);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      const running = await isServerRunning(PORT);
      if (running) {
        console.log(`Сервер уже запущен: http://localhost:${PORT}`);
        openBrowser(PORT);
        return;
      }
    }
    throw err;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Ошибка запуска:', err.message);
    process.exit(1);
  });
}

module.exports = { createServer, main };
