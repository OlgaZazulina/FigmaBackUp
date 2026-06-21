#!/usr/bin/env node
const { ensureLiveContext } = require('../src/playwright/chrome-manager');
const { getDriveFileInfoWithContext } = require('../src/drive/file-info');

const FOLDER = 'https://drive.google.com/drive/folders/1si3PyrRdEDlQXGBVBB-E8BmC8sONKCWs';
const FILE = 'FakeApps 2 (AGG).fig';

async function main() {
  const context = await ensureLiveContext();
  const info = await getDriveFileInfoWithContext(context, FOLDER, FILE);
  console.log(JSON.stringify({
    ...info,
    modifiedAt: info.modifiedAt ? info.modifiedAt.toISOString() : null,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
