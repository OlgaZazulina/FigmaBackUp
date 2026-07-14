// Все распространённые формы русских месяцев в Google Drive и панели сведений:
// 3–4-буквенные сокращения (янв., февр., сент., нояб.), родительный падеж (мая, февраля),
// полные названия (сентябрь, октября).
const RU_MONTH_DEFINITIONS = [
  {
    month: 0,
    aliases: ['янв', 'январ', 'январь', 'января'],
  },
  {
    month: 1,
    aliases: ['фев', 'февр', 'феврал', 'февраль', 'февраля'],
  },
  {
    month: 2,
    aliases: ['мар', 'март', 'марта'],
  },
  {
    month: 3,
    aliases: ['апр', 'апрел', 'апрель', 'апреля'],
  },
  {
    month: 4,
    aliases: ['май', 'мая'],
  },
  {
    month: 5,
    aliases: ['июн', 'июнь', 'июня'],
  },
  {
    month: 6,
    aliases: ['июл', 'июль', 'июля'],
  },
  {
    month: 7,
    aliases: ['авг', 'август', 'августа'],
  },
  {
    month: 8,
    aliases: ['сен', 'сент', 'сентя', 'сентяб', 'сентябр', 'сентябрь', 'сентября'],
  },
  {
    month: 9,
    aliases: ['окт', 'октя', 'октяб', 'октябр', 'октябрь', 'октября'],
  },
  {
    month: 10,
    aliases: ['ноя', 'нояб', 'ноябр', 'ноябрь', 'ноября'],
  },
  {
    month: 11,
    aliases: ['дек', 'дека', 'декаб', 'декабр', 'декабрь', 'декабря'],
  },
];

const RU_MONTHS = Object.fromEntries(
  RU_MONTH_DEFINITIONS.flatMap(({ month, aliases }) => aliases.map((alias) => [alias, month])),
);

const RU_MONTH_PREFIXES = [...new Set(
  RU_MONTH_DEFINITIONS.flatMap(({ aliases }) => aliases.map((alias) => alias.slice(0, 3))),
)].sort((a, b) => b.length - a.length);

const DATE_PREFIX_PATTERN = new RegExp(
  '^('
  + '\\d{1,2}\\s+[а-яё]{3,12}\\.?\\s+\\d{4}\\s*г\\.?'
  + '|\\d{1,2}\\s+[а-яё]{3,12}\\.?'
  + '|(?:сегодня|today)(?:\\s*,?\\s*\\d{1,2}:\\d{2})?'
  + '|(?:вчера|yesterday)(?:\\s*,?\\s*\\d{1,2}:\\d{2})?'
  + '|\\d{1,2}:\\d{2}(?:\\s?[AP]M)?'
  + '|\\d{1,2}\\.\\d{1,2}\\.\\d{4}'
  + ')',
  'i',
);

function startOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function normalizeDriveDateText(text) {
  return (text || '')
    .trim()
    .replace(/\s+г\.?(?=\s|$)/gi, '')
    .replace(/,\s*$/, '')
    .trim();
}

function extractDatePrefix(text) {
  const trimmed = (text || '').trim();
  const match = trimmed.match(DATE_PREFIX_PATTERN);
  return match ? match[1].trim() : trimmed;
}

function resolveRussianMonth(token) {
  const normalized = (token || '').toLowerCase().replace(/\./g, '');
  if (!normalized) return null;
  if (RU_MONTHS[normalized] != null) return RU_MONTHS[normalized];

  for (let length = Math.min(normalized.length, 8); length >= 3; length -= 1) {
    const prefix = normalized.slice(0, length);
    if (RU_MONTHS[prefix] != null) return RU_MONTHS[prefix];
  }

  for (const prefix of RU_MONTH_PREFIXES) {
    if (normalized.startsWith(prefix) || prefix.startsWith(normalized)) {
      return RU_MONTHS[prefix];
    }
  }

  for (const { month, aliases } of RU_MONTH_DEFINITIONS) {
    for (const alias of aliases) {
      if (normalized.startsWith(alias) || alias.startsWith(normalized)) {
        return month;
      }
    }
  }

  return null;
}

function parseDriveModifiedText(text, now = new Date()) {
  const trimmed = normalizeDriveDateText(extractDatePrefix(text));
  if (!trimmed) return null;

  if (/^(сегодня|today)(?:\s|,|$)/i.test(trimmed)) {
    return startOfLocalDay(now);
  }
  if (/^(вчера|yesterday)(?:\s|,|$)/i.test(trimmed)) {
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

  match = trimmed.match(/^(\d{1,2})\s+([а-яё]{3,12})\.?\s+(\d{4})\s*г?\.?/i);
  if (match) {
    const month = resolveRussianMonth(match[2]);
    if (month != null) {
      return new Date(+match[3], month, +match[1]);
    }
  }

  match = trimmed.match(/^(\d{1,2})\s+([а-яё]{3,12})\.?$/i);
  if (match) {
    const month = resolveRussianMonth(match[2]);
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
    if (/^(shared|more actions|общий доступ|поделиться)/i.test(chunk)) continue;
    const parsed = parseDriveModifiedText(chunk, now);
    if (parsed) return parsed;
  }

  const inline = rowText.match(
    /(\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2}\s+[а-яё]{3,12}\.?\s+\d{4}(?:\s+г\.)?|\d{1,2}\s+[а-яё]{3,12}\.?|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}:\d{2}(\s?[AP]M)?|сегодня|вчера|today|yesterday)/i,
  );
  if (inline) {
    return parseDriveModifiedText(inline[0], now);
  }

  return null;
}

function extractModifiedDateFromDetailsText(text, now = new Date()) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i += 1) {
    if (/^(Last modified|Modified|Date modified|Изменен|Изменено|Дата изменения|Последнее изменение)$/i.test(lines[i])) {
      const inlineValue = lines[i].replace(/^[^:]+:\s*/, '').trim();
      const valueLine = inlineValue || lines[i + 1] || '';
      const datePart = valueLine.split(/\s+by\s+|\s+—\s+|\s+-\s+|\s+в\s+/i)[0].trim();
      const parsed = parseDriveModifiedText(datePart, now) || extractModifiedDateFromRowText(datePart, now);
      if (parsed) return parsed;
    }
  }

  const inline = text.match(
    /(?:Last modified|Modified|Date modified|Изменен[оа]?|Дата изменения|Последнее изменение)\s*[:\n]\s*([^\n]+)/i,
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
  resolveRussianMonth,
  extractDatePrefix,
  RU_MONTH_DEFINITIONS,
};
