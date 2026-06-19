const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { LINKS_FILE } = require('./paths');

let linksFile = LINKS_FILE;

function _setLinksFileForTest(file) {
  linksFile = file;
}

function readData() {
  if (!fs.existsSync(linksFile)) {
    return { links: [] };
  }
  return JSON.parse(fs.readFileSync(linksFile, 'utf8'));
}

function writeData(data) {
  fs.writeFileSync(linksFile, JSON.stringify(data, null, 2));
}

function getLinks() {
  return readData().links;
}

function getEnabledLinks() {
  return getLinks().filter((l) => l.enabled);
}

function getLinkById(id) {
  return getLinks().find((l) => l.id === id) || null;
}

function addLink({ name, figmaUrl, driveFolderUrl }) {
  const data = readData();
  const link = {
    id: uuidv4(),
    name: name.trim(),
    figmaUrl: figmaUrl.trim(),
    driveFolderUrl: driveFolderUrl.trim(),
    enabled: true,
  };
  data.links.push(link);
  writeData(data);
  return link;
}

function updateLink(id, updates) {
  const data = readData();
  const index = data.links.findIndex((l) => l.id === id);
  if (index === -1) return null;
  data.links[index] = { ...data.links[index], ...updates };
  writeData(data);
  return data.links[index];
}

function deleteLink(id) {
  const data = readData();
  const before = data.links.length;
  data.links = data.links.filter((l) => l.id !== id);
  if (data.links.length === before) return false;
  writeData(data);
  return true;
}

function reorderLinks(ids) {
  if (!Array.isArray(ids)) return null;

  const data = readData();
  const current = data.links;
  if (ids.length !== current.length) return null;

  const byId = new Map(current.map((l) => [l.id, l]));
  const seen = new Set();
  const reordered = [];

  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id) || !byId.has(id)) return null;
    seen.add(id);
    reordered.push(byId.get(id));
  }

  if (seen.size !== current.length) return null;

  data.links = reordered;
  writeData(data);
  return reordered;
}

module.exports = {
  getLinks,
  getEnabledLinks,
  getLinkById,
  addLink,
  updateLink,
  deleteLink,
  reorderLinks,
  _setLinksFileForTest,
};
