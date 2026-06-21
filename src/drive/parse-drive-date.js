const RU_MONTHS = {
  янв: 0,
  фев: 1,
  мар: 2,
  апр: 3,
  май: 4,
  июн: 5,
  июл: 6,
  авг: 7,
  сен: 8,
  окт: 9,
  ноя: 10,
  дек: 11,
};

function startOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDriveModifiedText(text, now = new Date()) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  if (/^(сегодня|today)$/i.test(trimmed)) {
    return startOfLocalDay(now);
  }
  if (/^(вчера|yesterday)$/i.test(trimmed)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return startOfLocalDay(d);
  }

  if (/^\d{1,2}:\d{2}(\s?[AP]M)?$/i.test(trimmed)) {
    return startOfLocalDay(now);
  }

  let match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) {
    return new Date(+match[3], +match[2] - 1, +match[1]);
  }

  match = trimmed.match(/^(\d{1,2})\s+([а-яё]{3,4})\.?\s+(\d{4})/i);
  if (match) {
    const month = RU_MONTHS[match[2].slice(0, 3).toLowerCase()];
    if (month != null) {
      return new Date(+match[3], month, +match[1]);
    }
  }

  match = trimmed.match(/^(\d{1,2})\s+([а-яё]{3,4})\.?$/i);
  if (match) {
    const month = RU_MONTHS[match[2].slice(0, 3).toLowerCase()];
    if (month != null) {
      return new Date(now.getFullYear(), month, +match[1]);
    }
  }

  match = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (match) {
    const parsed = new Date(`${match[1]} ${match[2]}, ${match[3]}`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  match = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{1,2})$/);
  if (match) {
    const parsed = new Date(`${match[1]} ${match[2]}, ${now.getFullYear()}`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const iso = Date.parse(trimmed);
  if (!Number.isNaN(iso)) {
    return new Date(iso);
  }

  return null;
}

function extractModifiedDateFromRowText(rowText, now = new Date()) {
  const chunks = rowText
    .split(/\s{2,}|\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    if (/^(shared|more actions|общий доступ)/i.test(chunk)) continue;
    const parsed = parseDriveModifiedText(chunk, now);
    if (parsed) return parsed;
  }

  const inline = rowText.match(
    /(\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2}\s+[а-яё]{3,4}\.?\s+\d{4}|\d{1,2}\s+[а-яё]{3,4}\.?|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}:\d{2}(\s?[AP]M)?|сегодня|вчера|today|yesterday)/i,
  );
  if (inline) {
    return parseDriveModifiedText(inline[0], now);
  }

  return null;
}

function extractModifiedDateFromDetailsText(text, now = new Date()) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i += 1) {
    if (/^(Last modified|Modified|Изменен|Изменено|Последнее изменение)$/i.test(lines[i])) {
      const inlineValue = lines[i].replace(/^[^:]+:\s*/, '').trim();
      const valueLine = inlineValue || lines[i + 1] || '';
      const datePart = valueLine.split(/\s+by\s+|\s+—\s+|\s+-\s+|\s+в\s+/i)[0].trim();
      const parsed = parseDriveModifiedText(datePart, now) || extractModifiedDateFromRowText(datePart, now);
      if (parsed) return parsed;
    }
  }

  const inline = text.match(
    /(?:Last modified|Modified|Изменен[оа]?|Последнее изменение)\s*[:\n]\s*([^\n]+)/i,
  );
  if (inline) {
    const datePart = inline[1].split(/\s+by\s+|\s+—\s+|\s+-\s+|\s+в\s+/i)[0].trim();
    const parsed = parseDriveModifiedText(datePart, now) || extractModifiedDateFromRowText(datePart, now);
    if (parsed) return parsed;
  }

  return extractModifiedDateFromRowText(text, now);
}

module.exports = {
  parseDriveModifiedText,
  extractModifiedDateFromRowText,
  extractModifiedDateFromDetailsText,
};
