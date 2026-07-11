# Force Backup & Timeout Increases — Design Spec

**Date:** 2026-07-11  
**Status:** Approved

## Problem

1. Кнопка «Принудительная загрузка» (force-backup) не работает для строк с снятым чекбоксом — бэкенд отклоняет запрос и `runBackup` фильтрует отключённые ссылки.
2. Большие Figma-файлы не успевают обработаться: таймауты срабатывают на этапе подготовки файла в Figma (A) и загрузки в Google Drive (C).

## Goals

- Принудительная загрузка одной ссылки работает **независимо от чекбокса** `enabled`.
- Массовый бэкап по-прежнему обрабатывает только включённые ссылки.
- Увеличить таймауты для узких мест: подготовка Figma → **2 ч**, загрузка Drive → **6 ч**.

## Non-Goals

- Изменение таймаутов скачивания `.fig` (`MAX_DOWNLOAD_MS`, `STALL_TIMEOUT_MS`).
- Изменение `UPLOAD_START_TIMEOUT_MS`.
- Вынос таймаутов в env-переменные или отдельный конфиг-файл.
- Изменение UI (кнопка force уже доступна на отключённых строках).

## Current Behavior

| Компонент | Поведение |
|-----------|-----------|
| `POST /api/links/:id/backup` | Возвращает 400, если `link.enabled === false` |
| `getEnabledLinksByIds()` | Фильтрует ссылки с `enabled: false` |
| `runBackup(..., { force: true })` | Пропускает проверку даты на Drive, но всё равно требует `enabled` |
| `EXPORT_TIMEOUT_MS` | 30 мин (`src/figma/download.js`) |
| `UPLOAD_TIMEOUT_MS` | 2 ч (`src/drive/upload.js`) |

## Proposed Changes

### 1. Force backup без чекбокса

**Поведение:**

- `POST /api/links/:id/backup` с `force: true` — разрешён для любой существующей ссылки, независимо от `enabled`.
- `POST /api/links/:id/backup` без `force` — по-прежнему требует `enabled: true`.
- `POST /api/backup` (массовый) — по-прежнему требует `enabled: true` для каждой ссылки.
- `runBackup(linkIds, { force: true })` — берёт ссылки по ID без фильтра `enabled`.
- `runBackup(linkIds, { force: false })` — без изменений, только включённые ссылки.

**Файлы:**

| Файл | Изменение |
|------|-----------|
| `src/store/links.js` | Добавить `getLinksByIds(ids)` — возвращает ссылки по ID, без фильтра `enabled`; экспортировать в module.exports |
| `src/backup/orchestrator.js` | При `force: true` вызывать `getLinksByIds(linkIds)`, иначе — `getEnabledLinksByIds` / `getEnabledLinks` |
| `src/server.js` | Убрать проверку `!link.enabled` для эндпоинта backup, когда `req.body.force === true` |

### 2. Увеличение таймаутов

| Константа | Файл | Было | Станет |
|-----------|------|------|--------|
| `EXPORT_TIMEOUT_MS` | `src/figma/download.js` | 30 мин (`30 * 60 * 1000`) | 2 ч (`2 * 60 * 60 * 1000`) |
| `UPLOAD_TIMEOUT_MS` | `src/drive/upload.js` | 2 ч (`2 * 60 * 60 * 1000`) | 6 ч (`6 * 60 * 60 * 1000`) |

Константы остаются локальными в соответствующих модулях (подход «точечные правки», без нового конфиг-файла).

### 3. Error handling

- Таймаут подготовки Figma: Playwright `waitFor({ timeout: EXPORT_TIMEOUT_MS })` — сообщение об ошибке должно отражать лимит 2 ч.
- Таймаут загрузки Drive: существующее сообщение `Таймаут загрузки в Drive` — лимит станет 6 ч, текст не меняется.
- Отключённая ссылка + `force: true`: обрабатывается как обычная ссылка, без ошибки «Ссылка отключена».

## Data Flow (force backup, disabled link)

```
UI: кнопка ↑ (force-backup)
  → POST /api/links/:id/backup { force: true }
  → server: link exists, force=true → skip enabled check
  → runBackup([id], { force: true })
  → getLinksByIds([id]) → link с enabled=false попадает в очередь
  → skip date check (force)
  → download from Figma → upload to Drive
```

## Testing

| Тип | Что проверить |
|-----|---------------|
| Unit | `getLinksByIds` возвращает ссылку с `enabled: false` |
| Unit | `getEnabledLinksByIds` по-прежнему фильтрует `enabled: false` |
| Integration / manual | Снять чекбокс → force-backup → бэкап выполняется |
| Integration / manual | Снять чекбокс → массовый бэкап → ссылка не участвует |
| Manual | Большой файл: подготовка Figma не обрывается раньше 2 ч |
| Manual | Большой файл: загрузка Drive не обрывается раньше 6 ч |

## Risks

- Очень долгий зависший процесс будет ждать до 2/6 ч вместо 30 мин / 2 ч — приемлемо для редких больших файлов.
- `docs/` в `.gitignore` — spec хранится локально; коммит через `git add -f` при необходимости.
