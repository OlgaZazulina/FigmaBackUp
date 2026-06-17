const logger = require('../logger');

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function isLoginUrl(url) {
  return url.includes('accounts.google.com')
    || url.includes('/signin')
    || url.includes('ServiceLogin');
}

async function isLoggedInToDrive(page) {
  const url = page.url();
  if (isLoginUrl(url)) return false;

  if (!url.includes('drive.google.com')) return false;

  const signIn = page.getByRole('link', { name: /Sign in|Войти|Sign in to Google/i })
    .or(page.getByRole('button', { name: /Sign in|Войти/i }));
  if (await signIn.isVisible({ timeout: 500 }).catch(() => false)) {
    return false;
  }

  const newButton = page.getByRole('button', { name: /Создать|New/i });
  const driveRoot = page.locator('[data-target="drive"]');
  const myDrive = page.getByText(/My Drive|Мой диск/i).first();

  if (await newButton.isVisible({ timeout: 1500 }).catch(() => false)) return true;
  if (await driveRoot.isVisible({ timeout: 1500 }).catch(() => false)) return true;
  if (await myDrive.isVisible({ timeout: 1500 }).catch(() => false)) return true;

  return false;
}

async function waitForGoogleDriveLogin(page, timeoutMs = LOGIN_TIMEOUT_MS) {
  logger.info('Ожидание входа в Google Drive (завершите вход в открывшемся Chrome)...');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLoggedInToDrive(page)) {
      return;
    }
    await page.waitForTimeout(1000);
  }

  throw new Error('Время ожидания входа в Google Drive истекло');
}

async function assertLoggedInToDrive(page) {
  if (!(await isLoggedInToDrive(page))) {
    throw new Error(
      'Google Drive: сессия не найдена. Сначала нажмите «Войти в Google Drive» и не закрывайте окно Chrome.',
    );
  }
}

module.exports = {
  waitForGoogleDriveLogin,
  assertLoggedInToDrive,
  isLoggedInToDrive,
};
