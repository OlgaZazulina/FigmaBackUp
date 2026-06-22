const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { assertLoggedInToDrive, isLoggedInToDrive } = require('./session');

describe('assertLoggedInToDrive', () => {
  it('waits for page to become logged in', async () => {
    let checks = 0;
    const page = {
      url: () => 'https://drive.google.com/drive/my-drive',
      waitForTimeout: async () => {},
      getByRole: () => ({
        or: () => ({
          isVisible: async () => false,
        }),
        isVisible: async () => {
          checks += 1;
          return checks >= 2;
        },
      }),
      locator: () => ({
        isVisible: async () => false,
      }),
      getByText: () => ({
        first: () => ({
          isVisible: async () => false,
        }),
      }),
    };

    await assertLoggedInToDrive(page, { retryMs: 5000 });
    assert.ok(checks >= 2);
  });

  it('fails fast on login redirect', async () => {
    const page = {
      url: () => 'https://accounts.google.com/signin',
      waitForTimeout: async () => {},
      getByRole: () => ({
        or: () => ({ isVisible: async () => false }),
        isVisible: async () => false,
      }),
      locator: () => ({ isVisible: async () => false }),
      getByText: () => ({ first: () => ({ isVisible: async () => false }) }),
    };

    await assert.rejects(
      () => assertLoggedInToDrive(page, { retryMs: 3000 }),
      /сессия не найдена/i,
    );
  });
});

describe('isLoggedInToDrive', () => {
  it('returns false for login URLs', async () => {
    const page = { url: () => 'https://accounts.google.com/o/oauth2/auth' };
    assert.equal(await isLoggedInToDrive(page), false);
  });
});
