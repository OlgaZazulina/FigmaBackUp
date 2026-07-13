function sanitizeLinkName(linkName) {
  return linkName.replace(/[/\\?%*:|"<>]/g, '-');
}

function expectedFigFileName(linkName) {
  return `${sanitizeLinkName(linkName)}.fig`;
}

function startOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function calendarDaysSinceModified(modifiedAt, now = new Date()) {
  const mod = startOfLocalDay(modifiedAt);
  const today = startOfLocalDay(now);
  return Math.floor((today - mod) / 86_400_000);
}

function shouldSkipUpload(modifiedAt, now = new Date()) {
  return calendarDaysSinceModified(modifiedAt, now) < 2;
}

function isModifiedOnOrAfter(modifiedAt, reference = new Date()) {
  return startOfLocalDay(modifiedAt) >= startOfLocalDay(reference);
}

function pickNewestModifiedAt(dates) {
  return dates.reduce((newest, date) => {
    if (!date) return newest;
    if (!newest || date > newest) return date;
    return newest;
  }, null);
}

function formatSkipDateLabel(modifiedAt, now = new Date()) {
  const days = calendarDaysSinceModified(modifiedAt, now);
  const formatted = modifiedAt.toLocaleDateString('ru-RU');
  if (days === 0) return `${formatted} (сегодня)`;
  if (days === 1) return `${formatted} (вчера)`;
  return formatted;
}

function formatSkipReason(name, modifiedAt, now = new Date()) {
  return {
    name,
    reason: `на Drive обновлён ${formatSkipDateLabel(modifiedAt, now)}`,
  };
}

module.exports = {
  sanitizeLinkName,
  expectedFigFileName,
  calendarDaysSinceModified,
  shouldSkipUpload,
  isModifiedOnOrAfter,
  pickNewestModifiedAt,
  formatSkipDateLabel,
  formatSkipReason,
};
