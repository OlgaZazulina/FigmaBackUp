# Background Browser Focus — Design Spec

**Date:** 2026-07-12  
**Status:** Approved

## Problem

Во время скачивания из Figma и загрузки в Google Drive Chrome перехватывает фокус — пользователь не может спокойно работать в других приложениях.

## Goals

- Убрать намеренное переключение фокуса на Chrome **во время скачивания и загрузки**.
- Открывать вкладку Figma в фоне.
- **Не менять** способ загрузки файлов в Drive (меню New → Upload, fileChooser, CDP для больших файлов — как сейчас).

## Non-Goals

- Изменение логики upload в Drive (клики по меню, fileChooser, `setFilesOnHiddenInput`).
- Блокировка фокуса при авторизации (Figma / Google Drive).
- Гарантия 100% отсутствия активации Chrome ОС-ом при CDP-кликах.

## Root Causes

| Место | Действие |
|-------|----------|
| `src/drive/upload.js` | `page.bringToFront()` в `startUpload`, `confirmReplaceDialog` |
| `src/drive/upload.js` | `osascript: tell Chrome to activate` в `confirmReplaceDialog` |
| `src/drive/folder-page.js` | `page.bringToFront()` в `resolveUploadPage`, `recoverUploadPage` |
| `src/figma/download.js` | `context.newPage()` + `goto` — новая вкладка на переднем плане |

## Proposed Changes

### 1. Удалить явный foreground в backup-потоке

Убрать `bringToFront()` и `osascript activate` из файлов выше. Способ загрузки в Drive не меняется — только удаление строк, выводящих окно на передний план.

### 2. Фоновая вкладка Figma

Добавить `newBackgroundPage(context)` в `chrome-manager.js`:

- CDP `Target.createTarget({ url: 'about:blank', background: true })`
- `download.js` использует вместо `context.newPage()`

### 3. Авторизация — без изменений

`src/figma/auth.js`, `src/drive/auth.js` — оставить как есть.

## Testing

| Тип | Проверка |
|-----|----------|
| Manual | Бэкап: работа в другом приложении, Chrome не прыгает на передний план |
| Manual | Авторизация: Chrome выходит вперёд (ожидаемо) |
| Manual | Замена файла на Drive: диалог подтверждается без `activate` |
| Manual | Upload flow: меню New → Upload работает как раньше |

## Risks

- Редкая активация Chrome ОС-ом при CDP-кликах — приемлемо.
- Фоновая вкладка Figma: fallback на обычный `newPage()` при ошибке CDP.
