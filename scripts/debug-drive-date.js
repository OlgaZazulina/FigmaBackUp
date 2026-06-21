#!/usr/bin/env node
/**
 * Debug script: inspect Google Drive DOM for file date extraction.
 * Usage: node scripts/debug-drive-date.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT } = require('../src/store/paths');

const FOLDER_URL = 'https://drive.google.com/drive/folders/1si3PyrRdEDlQXGBVBB-E8BmC8sONKCWs';
const FILE_NAME = 'FakeApps 2 (AGG).fig';

function getCdpPort() {
  const portFile = path.join(ROOT, '.chrome-profile', 'main', '.cdp-port');
  if (!fs.existsSync(portFile)) return null;
  return parseInt(fs.readFileSync(portFile, 'utf8'), 10);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const port = getCdpPort();
  if (!port) {
    console.error('Chrome CDP port not found. Start the app and auth first.');
    process.exit(1);
  }

  console.log(`Connecting to Chrome :${port}...`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) {
    console.error('No browser context');
    process.exit(1);
  }

  let page = context.pages().find((p) => p.url().includes('drive.google.com'));
  if (!page) {
    page = await context.newPage();
  }

  console.log(`Opening ${FOLDER_URL}`);
  await page.goto(FOLDER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);

  console.log('\n=== PAGE URL ===');
  console.log(page.url());

  console.log('\n=== COLUMN HEADERS ===');
  const headers = await page.getByRole('columnheader').allInnerTexts().catch(() => []);
  console.log(headers.length ? headers : '(none)');

  console.log('\n=== FILE VISIBLE ===');
  const nameEl = page.getByText(FILE_NAME, { exact: true }).first();
  console.log('visible:', await nameEl.isVisible().catch(() => false));

  console.log('\n=== CLICK FILE ===');
  const tile = nameEl.locator('xpath=ancestor::div[@data-id][1]').first();
  if (await tile.count()) {
    await tile.click();
  } else {
    await nameEl.click();
  }
  await sleep(2000);

  console.log('\n=== AFTER CLICK: role=complementary ===');
  const comp = page.locator('[role="complementary"]');
  const compCount = await comp.count();
  console.log('count:', compCount);
  for (let i = 0; i < compCount; i++) {
    const text = await comp.nth(i).innerText().catch(() => '');
    console.log(`--- complementary[${i}] (${text.length} chars) ---`);
    console.log(text.slice(0, 800));
  }

  console.log('\n=== data-target=details ===');
  const details = page.locator('[data-target="details"]');
  console.log('count:', await details.count());
  if (await details.count()) {
    console.log(await details.first().innerText().catch(() => ''));
  }

  console.log('\n=== Modified labels on page ===');
  const labels = page.getByText(/modified|изменен|последн/i);
  const labelCount = await labels.count();
  console.log('matches:', labelCount);
  for (let i = 0; i < Math.min(labelCount, 10); i++) {
    const el = labels.nth(i);
    const text = await el.innerText().catch(() => '');
    const tag = await el.evaluate((node) => node.tagName).catch(() => '?');
    const parent = await el.locator('xpath=ancestor::div[1]').innerText().catch(() => '');
    console.log(`[${i}] <${tag}> "${text}" | parent: ${parent.slice(0, 200).replace(/\n/g, ' | ')}`);
  }

  console.log('\n=== All [title] attrs near filename ===');
  const titles = await page.evaluate((fileName) => {
    const results = [];
    document.querySelectorAll('[title]').forEach((el) => {
      const title = el.getAttribute('title') || '';
      const text = (el.textContent || '').trim();
      if (title.includes('.fig') || text.includes(fileName) || /modified|измен|jun|июн|\d{1,2}[:./]/i.test(title)) {
        results.push({
          tag: el.tagName,
          title,
          text: text.slice(0, 80),
          role: el.getAttribute('role'),
          dataTarget: el.getAttribute('data-target'),
        });
      }
    });
    return results.slice(0, 30);
  }, FILE_NAME);
  console.log(JSON.stringify(titles, null, 2));

  console.log('\n=== Grid/list rows containing filename ===');
  const rowInfo = await page.evaluate((fileName) => {
    const rows = [];
    document.querySelectorAll('[role="row"], [data-id]').forEach((el) => {
      const text = (el.innerText || '').trim();
      if (!text.includes(fileName)) return;
      rows.push({
        tag: el.tagName,
        role: el.getAttribute('role'),
        dataId: el.getAttribute('data-id'),
        text: text.slice(0, 300),
      });
    });
    return rows.slice(0, 10);
  }, FILE_NAME);
  console.log(JSON.stringify(rowInfo, null, 2));

  console.log('\n=== Toolbar buttons (view/details) ===');
  const buttons = await page.evaluate(() => {
    return [...document.querySelectorAll('button,[role="button"],[role="tab"]')]
      .map((el) => ({
        aria: el.getAttribute('aria-label') || '',
        text: (el.textContent || '').trim().slice(0, 60),
        role: el.getAttribute('role'),
      }))
      .filter((b) => /detail|свед|list|списк|view|вид|info|modified|измен/i.test(`${b.aria} ${b.text}`))
      .slice(0, 20);
  });
  console.log(JSON.stringify(buttons, null, 2));

  await browser.close();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
