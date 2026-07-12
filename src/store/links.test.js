const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  getEnabledLinksByIds,
  getLinksByIds,
  _setLinksFileForTest,
} = require('./links');

describe('getLinksByIds', () => {
  let tempFile;

  beforeEach(() => {
    tempFile = path.join(os.tmpdir(), `links-test-${Date.now()}.json`);
    fs.writeFileSync(tempFile, JSON.stringify({
      links: [
        {
          id: 'enabled-id',
          name: 'Enabled',
          figmaUrl: 'https://figma.com/file/1',
          driveFolderUrl: 'https://drive.google.com/drive/folders/1',
          responsible: 'Alice',
          backup: 'Bob',
          enabled: true,
        },
        {
          id: 'disabled-id',
          name: 'Disabled',
          figmaUrl: 'https://figma.com/file/2',
          driveFolderUrl: 'https://drive.google.com/drive/folders/2',
          responsible: 'Alice',
          backup: 'Bob',
          enabled: false,
        },
      ],
    }));
    _setLinksFileForTest(tempFile);
  });

  afterEach(() => {
    _setLinksFileForTest(require('./paths').LINKS_FILE);
    fs.rmSync(tempFile, { force: true });
  });

  it('returns disabled links', () => {
    const result = getLinksByIds(['disabled-id']);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'disabled-id');
    assert.equal(result[0].enabled, false);
  });

  it('getEnabledLinksByIds still filters disabled links', () => {
    const result = getEnabledLinksByIds(['enabled-id', 'disabled-id']);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'enabled-id');
  });
});
