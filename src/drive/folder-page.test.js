const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findDriveFolderPage } = require('./folder-page');

function mockPage(url, closed = false) {
  return {
    url: () => url,
    isClosed: () => closed,
  };
}

test('findDriveFolderPage prefers matching folderId', () => {
  const pages = [
    mockPage('https://drive.google.com/drive/home'),
    mockPage('https://drive.google.com/drive/folders/abc123'),
    mockPage('https://drive.google.com/drive/folders/xyz789'),
  ];
  const found = findDriveFolderPage(pages, 'xyz789');
  assert.equal(found.url(), pages[2].url());
});

test('findDriveFolderPage falls back to any drive tab', () => {
  const pages = [
    mockPage('https://figma.com/file/1'),
    mockPage('https://drive.google.com/drive/my-drive'),
  ];
  const found = findDriveFolderPage(pages, 'missing');
  assert.equal(found.url(), pages[1].url());
});

test('findDriveFolderPage returns null when no drive tab', () => {
  const pages = [mockPage('https://figma.com/file/1')];
  assert.equal(findDriveFolderPage(pages, 'abc'), null);
});

test('findDriveFolderPage skips closed pages', () => {
  const pages = [
    mockPage('https://drive.google.com/drive/folders/abc123', true),
    mockPage('https://drive.google.com/drive/folders/abc123'),
  ];
  const found = findDriveFolderPage(pages, 'abc123');
  assert.equal(found.url(), pages[1].url());
});
