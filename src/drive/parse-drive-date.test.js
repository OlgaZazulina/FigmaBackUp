const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseDriveModifiedText, extractModifiedDateFromDetailsText } = require('./parse-drive-date');

describe('parseDriveModifiedText', () => {
  const now = new Date('2026-06-08T12:00:00');

  it('parses DD.MM.YYYY', () => {
    const date = parseDriveModifiedText('07.06.2026', now);
    assert.equal(date.getDate(), 7);
    assert.equal(date.getMonth(), 5);
    assert.equal(date.getFullYear(), 2026);
  });

  it('parses Russian month with year', () => {
    const date = parseDriveModifiedText('8 июн. 2026 г.', now);
    assert.equal(date.getDate(), 8);
    assert.equal(date.getMonth(), 5);
  });

  it('parses today', () => {
    const date = parseDriveModifiedText('сегодня', now);
    assert.equal(date.getDate(), 8);
    assert.equal(date.getMonth(), 5);
  });

  it('parses yesterday', () => {
    const date = parseDriveModifiedText('вчера', now);
    assert.equal(date.getDate(), 7);
  });

  it('parses time-only as today', () => {
    const date = parseDriveModifiedText('18:47', now);
    assert.equal(date.getDate(), 8);
    assert.equal(date.getMonth(), 5);
  });

  it('parses month and day without year', () => {
    const date = parseDriveModifiedText('Jun 17', now);
    assert.equal(date.getMonth(), 5);
    assert.equal(date.getDate(), 17);
  });
});

describe('extractModifiedDateFromDetailsText', () => {
  const now = new Date('2026-06-08T12:00:00');

  it('parses label on next line', () => {
    const text = 'Details\nModified\nJun 8, 2026\nme';
    const date = extractModifiedDateFromDetailsText(text, now);
    assert.equal(date.getMonth(), 5);
    assert.equal(date.getDate(), 8);
  });

  it('parses inline Russian label', () => {
    const text = 'Изменено\n8 июн. 2026 г.\nOlga';
    const date = extractModifiedDateFromDetailsText(text, now);
    assert.equal(date.getDate(), 8);
    assert.equal(date.getMonth(), 5);
  });
});
