const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBackupResult(fetchStatus, fetchResult, expectedRunId) {
  while (true) {
    const status = await fetchStatus();
    if (!status.backupRunning) break;
    await sleep(50);
  }
  for (let i = 0; i < 20; i++) {
    const status = await fetchStatus();
    if (status.backupResultRunId == expectedRunId) {
      return fetchResult();
    }
    await sleep(50);
  }
  return null;
}

async function oldWaitForBackupResult(fetchStatus, fetchResult, expectedRunId) {
  for (let i = 0; i < 120; i++) {
    const status = await fetchStatus();
    if (!status.backupRunning && status.backupResultRunId == expectedRunId) {
      return fetchResult();
    }
    await sleep(50);
  }
  return null;
}

function createTestBackupServer(completeAfterMs) {
  let backupRunning = false;
  let backupRunId = 0;
  let lastBackupResult = null;

  const app = express();
  app.use(express.json());

  app.get('/api/auth/status', (_req, res) => {
    res.json({
      backupRunning,
      backupResultRunId: lastBackupResult?.runId ?? null,
    });
  });

  app.post('/api/backup', (_req, res) => {
    const runId = ++backupRunId;
    backupRunning = true;
    lastBackupResult = null;
    res.json({ ok: true, runId });

    setTimeout(() => {
      lastBackupResult = {
        uploaded: [],
        skipped: [{ name: 'ANTIFROG', reason: 'на Drive обновлён 12.07.2026 (сегодня)' }],
        errors: [],
        cancelled: true,
        runId,
      };
      backupRunning = false;
    }, completeAfterMs);
  });

  app.get('/api/backup/result', (_req, res) => {
    res.json(lastBackupResult);
  });

  app.delete('/api/backup/result', (req, res) => {
    const { runId } = req.body || {};
    if (runId == null || lastBackupResult?.runId === runId) {
      lastBackupResult = null;
    }
    res.status(204).end();
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}`;
      resolve({
        server,
        fetchStatus: async () => {
          const res = await fetch(`${base}/api/auth/status`);
          return res.json();
        },
        fetchResult: async () => {
          const res = await fetch(`${base}/api/backup/result`);
          return res.json();
        },
        startBackup: async () => {
          const res = await fetch(`${base}/api/backup`, { method: 'POST' });
          return res.json();
        },
      });
    });
    server.on('error', reject);
  });
}

function hasBackupResultContent(result) {
  if (!result) return false;
  if (result.cancelled) return true;
  return (result.uploaded?.length > 0)
    || (result.skipped?.length > 0)
    || (result.errors?.length > 0);
}

describe('backup result wait flow', () => {
  /** @type {{ server: import('http').Server } | null} */
  let ctx = null;

  after(async () => {
    if (ctx?.server) {
      await new Promise((resolve, reject) => {
        ctx.server.close((err) => (err ? reject(err) : resolve()));
      });
      ctx = null;
    }
  });

  it('old wait times out while backup still runs (simulates >60s backup)', async () => {
    let polls = 0;
    const fetchStatus = async () => {
      polls++;
      if (polls <= 130) {
        return { backupRunning: true, backupResultRunId: null };
      }
      return { backupRunning: false, backupResultRunId: 1 };
    };
    const fetchResult = async () => ({ runId: 1, cancelled: true, uploaded: [], skipped: [], errors: [] });

    const result = await oldWaitForBackupResult(fetchStatus, fetchResult, 1);
    assert.equal(result, null);
    assert.ok(polls <= 120);
  });

  it('new wait keeps polling while backup runs and then returns result', async () => {
    let polls = 0;
    const fetchStatus = async () => {
      polls++;
      if (polls <= 130) {
        return { backupRunning: true, backupResultRunId: null };
      }
      return { backupRunning: false, backupResultRunId: 1 };
    };
    const fetchResult = async () => ({
      runId: 1,
      cancelled: true,
      uploaded: [],
      skipped: [{ name: 'ANTIFROG', reason: 'test' }],
      errors: [],
    });

    const result = await waitForBackupResult(fetchStatus, fetchResult, 1);
    assert.equal(result.runId, 1);
    assert.equal(result.cancelled, true);
    assert.ok(polls > 120);
  });

  it('returns cancelled result for backup that takes 7 seconds', async () => {
    ctx = await createTestBackupServer(7000);
    const { runId } = await ctx.startBackup();

    const result = await waitForBackupResult(ctx.fetchStatus, ctx.fetchResult, runId);

    assert.equal(result.runId, runId);
    assert.equal(result.cancelled, true);
    assert.equal(result.skipped.length, 1);
    assert.equal(hasBackupResultContent(result), true);
  }, { timeout: 15_000 });

  it('returns result for two sequential backups', async () => {
    if (ctx?.server) {
      await new Promise((resolve) => ctx.server.close(() => resolve()));
    }
    ctx = await createTestBackupServer(300);

    const first = await ctx.startBackup();
    const result1 = await waitForBackupResult(ctx.fetchStatus, ctx.fetchResult, first.runId);
    assert.equal(result1.runId, first.runId);
    assert.equal(result1.cancelled, true);

    const second = await ctx.startBackup();
    const result2 = await waitForBackupResult(ctx.fetchStatus, ctx.fetchResult, second.runId);
    assert.equal(result2.runId, second.runId);
    assert.notEqual(result2.runId, first.runId);
    assert.equal(hasBackupResultContent(result2), true);
  });
});
