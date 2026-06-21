const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  expectedFigFileName,
  shouldSkipUpload,
  calendarDaysSinceModified,
} = require('./fig-filename');

describe('expectedFigFileName', () => {
  it('sanitizes invalid chars', () => {
    assert.equal(expectedFigFileName('A/B:C'), 'A-B-C.fig');
  });

  it('matches table name for FakeApps', () => {
    assert.equal(expectedFigFileName('FakeApps 2 (AGG)'), 'FakeApps 2 (AGG).fig');
  });
});

describe('shouldSkipUpload', () => {
  const now = new Date('2026-06-08T15:00:00');

  it('skips today', () => {
    assert.equal(shouldSkipUpload(new Date('2026-06-08T09:00:00'), now), true);
  });

  it('skips yesterday', () => {
    assert.equal(shouldSkipUpload(new Date('2026-06-07T23:00:00'), now), true);
  });

  it('uploads when 2+ days ago', () => {
    assert.equal(shouldSkipUpload(new Date('2026-06-06T12:00:00'), now), false);
  });
});

describe('calendarDaysSinceModified', () => {
  const now = new Date('2026-06-08T12:00:00');

  it('returns 0 for same calendar day', () => {
    assert.equal(calendarDaysSinceModified(new Date('2026-06-08T23:59:00'), now), 0);
  });

  it('returns 1 for previous calendar day', () => {
    assert.equal(calendarDaysSinceModified(new Date('2026-06-07T01:00:00'), now), 1);
  });
});
