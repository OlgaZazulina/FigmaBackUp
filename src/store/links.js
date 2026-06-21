const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { LINKS_FILE } = require('./paths');
const { validateDesignerPair, defaultDesignerPair } = require('./designers');

let linksFile = LINKS_FILE;

function _setLinksFileForTest(file) {
  linksFile = file;
}

function readData() {
  if (!fs.existsSync(linksFile)) {
    return { links: [] };
  }
  const data = JSON.parse(fs.readFileSync(linksFile, 'utf8'));
  return ensureDesignerFields(data);
}

function writeData(data) {
  fs.writeFileSync(linksFile, JSON.stringify(data, null, 2));
}

function ensureDesignerFields(data) {
  let changed = false;
  const links = data.links.map((link, index) => {
    if (link.responsible && link.backup && !validateDesignerPair(link.responsible, link.backup)) {
      return link;
    }

    changed = true;
    const pair = defaultDesignerPair(index);
    return { ...link, ...pair };
  });

  if (changed) {
    writeData({ links });
    return { links };
  }
  return data;
}

function getLinks() {
  return readData().links;
}

function getEnabledLinks() {
  return getLinks().filter((l) => l.enabled);
}

function getEnabledLinksByIds(ids) {
  const byId = new Map(getLinks().map((l) => [l.id, l]));
  return ids.map((id) => byId.get(id)).filter((l) => l && l.enabled);
}

function getLinkById(id) {
  return getLinks().find((l) => l.id === id) || null;
}

function addLink({ name, figmaUrl, driveFolderUrl, responsible, backup }) {
  if (validateDesignerPair(responsible, backup)) return null;

  const data = readData();
  const link = {
    id: uuidv4(),
    name: name.trim(),
    figmaUrl: figmaUrl.trim(),
    driveFolderUrl: driveFolderUrl.trim(),
    responsible,
    backup,
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

  const next = { ...data.links[index], ...updates };
  if (validateDesignerPair(next.responsible, next.backup)) return null;

  data.links[index] = next;
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
  getEnabledLinksByIds,
  getLinkById,
  addLink,
  updateLink,
  deleteLink,
  reorderLinks,
  _setLinksFileForTest,
};
