function parseDriveFolderId(url) {
  const foldersMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (foldersMatch) return foldersMatch[1];

  const openMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return openMatch[1];

  throw new Error(`Не удалось извлечь ID папки из URL: ${url}`);
}

module.exports = { parseDriveFolderId };
