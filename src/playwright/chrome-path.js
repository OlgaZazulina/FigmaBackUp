const fs = require('fs');
const path = require('path');

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(process.env.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
];

function getChromeExecutable() {
  for (const chromePath of CHROME_PATHS) {
    if (chromePath && fs.existsSync(chromePath)) {
      return chromePath;
    }
  }
  return null;
}

function requireChromeExecutable() {
  const chromePath = getChromeExecutable();
  if (!chromePath) {
    throw new Error(
      'Google Chrome не найден. Установите: https://www.google.com/chrome/',
    );
  }
  return chromePath;
}

module.exports = { getChromeExecutable, requireChromeExecutable };
