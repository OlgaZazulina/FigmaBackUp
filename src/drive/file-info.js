const { parseDriveFolderId } = require('./parse-url');
const { resolveUploadPage, sleep } = require('./folder-page');
const {
  parseDriveModifiedText,
  extractModifiedDateFromRowText,
  extractModifiedDateFromDetailsText,
} = require('./parse-drive-date');
const { pickNewestModifiedAt } = require('../backup/fig-filename');
const logger = require('../logger');

async function isListViewActive(page) {
  const listRadio = page.getByRole('radio', { name: /^List$/i }).first();
  if (await listRadio.isVisible({ timeout: 800 }).catch(() => false)) {
    return listRadio.isChecked().catch(() => false);
  }
  return page.getByText(/^Date modified$/i).first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
}

async function ensureListView(page) {
  if (await isListViewActive(page)) return;

  const listRadio = page.getByRole('radio', { name: /^List$/i }).first();
  if (await listRadio.isVisible({ timeout: 2000 }).catch(() => false)) {
    await listRadio.click().catch(() => {});
    await sleep(1500);
    if (await isListViewActive(page)) return;
  }

  const listByAria = page.locator('[role="radio"][aria-label="List"], [role="radio"][aria-label*="List" i]').first();
  if (await listByAria.isVisible({ timeout: 1000 }).catch(() => false)) {
    await listByAria.click().catch(() => {});
    await sleep(1500);
  }
}

async function fileVisibleInFolder(page, fileName) {
  return page.getByText(fileName, { exact: true }).first()
    .isVisible({ timeout: 2000 })
    .catch(() => false);
}

function rowTextHasDate(rowText) {
  return /(?:[A-Za-z]{3,9}\s+\d{1,2}(?:,?\s+\d{4})?|\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2}\s+[а-яё]{3,4}|сегодня|вчера|today|yesterday|\d{1,2}:\d{2})/i.test(rowText);
}

async function findAllFileListRows(page, fileName) {
  if (!(await isListViewActive(page))) {
    return [];
  }

  const listRows = page.locator('tr[role="row"]').filter({
    has: page.getByText(fileName, { exact: true }),
  });

  const count = await listRows.count();
  const rows = [];

  for (let i = 0; i < count; i += 1) {
    const row = listRows.nth(i);
    if (!(await row.isVisible({ timeout: 500 }).catch(() => false))) continue;

    const rowText = ((await row.innerText().catch(() => '')) || '').trim();
    if (!rowTextHasDate(rowText)) continue;

    rows.push(row);
  }

  return rows;
}

async function findFileListRow(page, fileName) {
  const rows = await findAllFileListRows(page, fileName);
  return rows[0] || null;
}

async function readModifiedDateFromRow(page, row, fileName) {
  const rowText = ((await row.innerText().catch(() => '')) || '').trim();
  if (!rowText) return null;

  const withoutName = rowText.replace(fileName, '').trim();
  return extractModifiedDateFromRowText(withoutName || rowText);
}

async function readModifiedFromDetailsPanel(page, fileName) {
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);

  const listRow = page.locator('tr[role="row"]').filter({
    has: page.getByText(fileName, { exact: true }),
  }).first();

  if (await listRow.isVisible({ timeout: 2000 }).catch(() => false)) {
    await listRow.click({ timeout: 5000 });
  } else {
    const nameEl = page.getByText(fileName, { exact: true }).first();
    if (!(await nameEl.isVisible({ timeout: 2000 }).catch(() => false))) {
      return null;
    }
    await nameEl.click({ timeout: 5000 });
  }
  await sleep(1000);

  const viewDetails = page.getByRole('button', { name: /View details|Просмотр сведений|Сведения/i }).first();
  if (await viewDetails.isVisible({ timeout: 1500 }).catch(() => false)) {
    await viewDetails.click().catch(() => {});
    await sleep(800);
  }

  const detailsTab = page.getByRole('tab', { name: /^Details$|^Сведения$/i }).first();
  if (await detailsTab.isVisible({ timeout: 1000 }).catch(() => false)) {
    await detailsTab.click().catch(() => {});
    await sleep(800);
  }

  const modifiedLabel = page.getByText(/^(Last modified|Modified|Изменен|Изменено|Последнее изменение)$/i).first();
  let panelText = '';
  if (await modifiedLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
    const section = modifiedLabel.locator('xpath=ancestor::div[1]');
    panelText = ((await section.innerText().catch(() => '')) || '').trim();
  }

  if (!panelText) {
    const complementary = page.locator('[role="complementary"]').filter({
      hasText: /modified|изменен|последн/i,
    }).first();
    if (await complementary.isVisible({ timeout: 1000 }).catch(() => false)) {
      panelText = ((await complementary.innerText().catch(() => '')) || '').trim();
    }
  }

  await page.keyboard.press('Escape').catch(() => {});
  await sleep(200);

  if (!panelText) return null;

  const modifiedAt = extractModifiedDateFromDetailsText(panelText);
  if (!modifiedAt) {
    logger.info(`Панель сведений: «${panelText.slice(0, 160).replace(/\s+/g, ' ')}»`);
  }
  return modifiedAt;
}

async function getDriveFileInfo(page, fileName) {
  await ensureListView(page);

  if (!(await fileVisibleInFolder(page, fileName))) {
    return { exists: false, fileName };
  }

  let modifiedAt = null;
  const rows = await findAllFileListRows(page, fileName);
  if (rows.length > 0) {
    const rowDates = [];
    for (const row of rows) {
      const rowDate = await readModifiedDateFromRow(page, row, fileName);
      if (rowDate) rowDates.push(rowDate);
    }
    modifiedAt = pickNewestModifiedAt(rowDates);

    if (rows.length > 1) {
      logger.info(
        `На Drive ${rows.length} копий «${fileName}» — для проверки беру самую свежую дату`,
      );
    }
    if (modifiedAt) {
      logger.info(`Дата на Drive для «${fileName}»: ${modifiedAt.toLocaleDateString('ru-RU')}`);
    }
  }

  if (!modifiedAt) {
    logger.info(`Читаю дату «${fileName}» из панели сведений Drive...`);
    modifiedAt = await readModifiedFromDetailsPanel(page, fileName);
  }

  if (!modifiedAt) {
    logger.info(`Не удалось разобрать дату для ${fileName} — будет загрузка`);
    return { exists: true, modifiedAt: null, fileName };
  }

  return { exists: true, modifiedAt, fileName };
}

async function getDriveFileInfoWithContext(context, driveFolderUrl, fileName) {
  const folderId = parseDriveFolderId(driveFolderUrl);
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
  const { page } = await resolveUploadPage(context, folderId, folderUrl);
  return getDriveFileInfo(page, fileName);
}

module.exports = {
  getDriveFileInfo,
  getDriveFileInfoWithContext,
  fileVisibleInFolder,
  findAllFileListRows,
  findFileListRow,
  readModifiedDateFromRow,
  readModifiedFromDetailsPanel,
  isListViewActive,
  ensureListView,
};
