const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDriveModifiedText,
  extractModifiedDateFromDetailsText,
  extractModifiedDateFromRowText,
  resolveRussianMonth,
  RU_MONTH_DEFINITIONS,
} = require('./parse-drive-date');

describe('parseDriveModifiedText', () => {
  const now = new Date('2026-06-08T12:00:00');

  it('parses DD.MM.YYYY', () => {
    const date = parseDriveModifiedText('07.06.2026', now);
    assert.equal(date.getDate(), 7);
    assert.equal(date.getMonth(), 5);
    assert.equal(date.getFullYear(), 2026);
  });

  it('parses Russian month with year', () => {
    const date = parseDriveModifiedText('8 июн. 2026 г.', now);
    assert.equal(date.getDate(), 8);
    assert.equal(date.getMonth(), 5);
  });

  it('parses Russian month without year from Drive list', () => {
    const date = parseDriveModifiedText('12 июл.', now);
    assert.equal(date.getDate(), 12);
    assert.equal(date.getMonth(), 6);
    assert.equal(date.getFullYear(), 2026);
  });

  it('parses today', () => {
    const date = parseDriveModifiedText('сегодня', now);
    assert.equal(date.getDate(), 8);
    assert.equal(date.getMonth(), 5);
  });

  it('parses yesterday', () => {
    const date = parseDriveModifiedText('вчера', now);
    assert.equal(date.getDate(), 7);
  });

  it('parses time-only as today', () => {
    const date = parseDriveModifiedText('18:47', now);
    assert.equal(date.getDate(), 8);
    assert.equal(date.getMonth(), 5);
  });

  it('parses month and day without year', () => {
    const date = parseDriveModifiedText('Jun 17', now);
    assert.equal(date.getMonth(), 5);
    assert.equal(date.getDate(), 17);
  });

  it('parses Russian genitive month without abbreviation', () => {
    const date = parseDriveModifiedText('27 мая', now);
    assert.equal(date.getDate(), 27);
    assert.equal(date.getMonth(), 4);
    assert.equal(date.getFullYear(), 2026);
  });

  it('parses Russian month with trailing year suffix', () => {
    const date = parseDriveModifiedText('19 июн. 2025 г.', now);
    assert.equal(date.getDate(), 19);
    assert.equal(date.getMonth(), 5);
    assert.equal(date.getFullYear(), 2025);
  });

  it('parses today with trailing author name', () => {
    const date = parseDriveModifiedText('сегодня Olga Zazulina', now);
    assert.equal(date.getDate(), 8);
    assert.equal(date.getMonth(), 5);
  });

  it('parses today with time comma', () => {
    const date = parseDriveModifiedText('сегодня, 14:20', now);
    assert.equal(date.getDate(), 8);
    assert.equal(date.getMonth(), 5);
  });

  it('parses yesterday with author', () => {
    const date = parseDriveModifiedText('вчера Olga', now);
    assert.equal(date.getDate(), 7);
  });
});

describe('Russian month aliases', () => {
  const now = new Date('2026-07-14T12:00:00');

  for (const { month, aliases } of RU_MONTH_DEFINITIONS) {
    for (const alias of aliases) {
      it(`resolves ${alias} as month ${month}`, () => {
        assert.equal(resolveRussianMonth(alias), month);
        assert.equal(resolveRussianMonth(`${alias}.`), month);
      });

      it(`parses date with ${alias}.`, () => {
        const date = parseDriveModifiedText(`5 ${alias}. 2024 г.`, now);
        assert.ok(date, `expected date for alias "${alias}"`);
        assert.equal(date.getDate(), 5);
        assert.equal(date.getMonth(), month);
        assert.equal(date.getFullYear(), 2024);
      });
    }
  }
});

describe('Russian Drive screenshot formats', () => {
  const now = new Date('2026-07-14T12:00:00');

  const cases = [
    ['22 окт. 2023 г. Sofia Chernikova', 22, 9, 2023],
    ['25 мар.', 25, 2, 2026],
    ['25 мар. Olga Zazulya', 25, 2, 2026],
    ['19 июл.', 19, 6, 2026],
    ['26 февр.', 26, 1, 2026],
    ['27 февр.', 27, 1, 2026],
    ['23 авг. 2024 г.', 23, 7, 2024],
    ['25 июл. 2023 г.', 25, 6, 2023],
    ['22 нояб. 2023 г.', 22, 10, 2023],
    ['15 янв.', 15, 0, 2026],
    ['3 дек. 2023 г.', 3, 11, 2023],
    ['10 апр. 2022 г. Ivan Petrov', 10, 3, 2022],
    ['1 сент. 2024 г.', 1, 8, 2024],
    ['Сегодня 14:30', 14, 6, 2026],
    ['вчера, 10:05', 13, 6, 2026],
  ];

  for (const [input, day, month, year] of cases) {
    it(`parses ${input}`, () => {
      const date = parseDriveModifiedText(input, now);
      assert.ok(date, `expected date for "${input}"`);
      assert.equal(date.getDate(), day, `day for "${input}"`);
      assert.equal(date.getMonth(), month, `month for "${input}"`);
      assert.equal(date.getFullYear(), year, `year for "${input}"`);
    });
  }
});

describe('extractModifiedDateFromRowText', () => {
  const now = new Date('2026-07-14T12:00:00');

  it('parses Russian Drive list row with author', () => {
    const date = extractModifiedDateFromRowText('12 июл. Olga Zazulina', now);
    assert.equal(date.getDate(), 12);
    assert.equal(date.getMonth(), 6);
  });

  it('parses Russian Drive list row with genitive month', () => {
    const date = extractModifiedDateFromRowText('27 мая Tatiana Santeva', now);
    assert.equal(date.getDate(), 27);
    assert.equal(date.getMonth(), 4);
  });

  it('parses today in Russian Drive list row', () => {
    const date = extractModifiedDateFromRowText('сегодня Olga Zazulina', now);
    assert.equal(date.getDate(), 14);
    assert.equal(date.getMonth(), 6);
  });
});

describe('extractModifiedDateFromDetailsText', () => {
  const now = new Date('2026-06-08T12:00:00');

  it('parses label on next line', () => {
    const text = 'Details\nModified\nJun 8, 2026\nme';
    const date = extractModifiedDateFromDetailsText(text, now);
    assert.equal(date.getMonth(), 5);
    assert.equal(date.getDate(), 8);
  });

  it('parses inline Russian label', () => {
    const text = 'Изменено\n8 июн. 2026 г.\nOlga';
    const date = extractModifiedDateFromDetailsText(text, now);
    assert.equal(date.getDate(), 8);
    assert.equal(date.getMonth(), 5);
  });
});
