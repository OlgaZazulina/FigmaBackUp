const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

module.exports = {
  ROOT,
  LINKS_FILE: path.join(ROOT, 'links.json'),
  BACKUP_DIR: path.join(ROOT, 'backup'),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  DOWNLOADS_TMP: path.join(ROOT, '.downloads-tmp'),
};
