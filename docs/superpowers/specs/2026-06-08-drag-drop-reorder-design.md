# Drag-and-Drop Reorder for Links Table

**Date:** 2026-06-08  
**Status:** Approved (brainstorming)

## Goal

Allow users to reorder projects in the links table via drag-and-drop. The table order becomes the backup execution order and persists to `links.json` immediately on drop.

## Decisions

| Topic | Decision |
|-------|----------|
| Drag initiator | Dedicated handle column (⋮⋮) left of checkbox |
| Backup order | Table order = backup order (`getEnabledLinks()` already follows array order) |
| Persistence | Save to `links.json` immediately on drop |
| Implementation | Native HTML5 Drag and Drop (no new dependencies) |
| Keyboard reorder | Out of scope |

## UI

### New column

- Position: leftmost column, before checkbox
- Width: narrow (~36px)
- Content: drag handle icon (6-dot grip or ⋮⋮)
- `cursor: grab` on handle; `cursor: grabbing` while dragging
- Handle is not a button — drag-only interaction
- `aria-label="Перетащить"` on handle

### Drag feedback

- Dragged row: reduced opacity (~0.5)
- Drop target: visual indicator line or highlight between rows
- Styles must work in light and dark themes (use existing CSS variables)

### Disabled state

- While backup is running (`backupRunning` on server / `btn-backup` disabled on client): disable drag handles (`pointer-events: none`, muted appearance)

### Edge cases

- Empty table: no rows, column header may remain but no handles
- Single row: handle visible, drag has no effect

## Backend

### New store function: `reorderLinks(ids)`

Location: `src/store/links.js`

```js
reorderLinks(ids) // ids: string[] — full ordered list of link UUIDs
```

Behavior:

1. Read current links
2. Validate: `ids.length === links.length` and every current link id appears exactly once in `ids`
3. Rebuild `data.links` array in the order given by `ids`
4. Write to `links.json`
5. Return reordered links array
6. Return `null` (or throw) on validation failure

### New API endpoint

```
PUT /api/links/reorder
Content-Type: application/json

{ "ids": ["uuid-1", "uuid-2", "..."] }
```

Responses:

- `200` — `{ "links": [...] }` full reordered list
- `400` — `{ "error": "..." }` invalid id set

No changes needed to `getEnabledLinks()` or `orchestrator.js` — they already respect array order.

## Frontend

### HTML (`public/index.html`)

Add `<th class="col-drag"></th>` before checkbox column in table header.

### Row template (`public/app.js`)

Each `<tr>` gets:

```html
<td class="col-drag">
  <span class="drag-handle" draggable="true" data-id="..." aria-label="Перетащить" title="Перетащить">...</span>
</td>
```

Set `draggable="true"` only on the handle, not the whole row.

### Event flow

1. `dragstart` on handle — set `dataTransfer` with link id; add dragging class to row
2. `dragover` on `tbody` / rows — `preventDefault()`; highlight drop position
3. `drop` on row — compute insert position; reorder DOM; call API
4. `dragend` — remove dragging/highlight classes

### API call on drop

```js
PUT /api/links/reorder
{ ids: [...orderedIdsFromDom] }
```

- On success: update `linksCache` from response
- On failure: revert DOM to previous order (from `linksCache`); append error to log panel

### New links

`POST /api/links` continues to append at end — no change.

## Error handling

| Case | Behavior |
|------|----------|
| Server returns 400 | Revert UI, log error message |
| Network failure | Revert UI, log error message |
| Invalid id set on server | 400 with descriptive error |
| Drag during backup | Prevented by disabled handles |

## Testing

Unit test for `reorderLinks()` in links store (if test infra exists):

- Reorders correctly
- Rejects missing ids
- Rejects extra ids
- Rejects unknown ids
- Preserves link fields (name, urls, enabled)

Manual test checklist:

- Drag row up/down, refresh page — order persists
- Backup runs in new table order
- Reorder fails gracefully (simulate by stopping server)
- Dark/light theme drag feedback
- Single row and empty table

## Files to change

| File | Change |
|------|--------|
| `src/store/links.js` | Add `reorderLinks()` |
| `src/server.js` | Add `PUT /api/links/reorder` |
| `public/index.html` | Add drag column header |
| `public/app.js` | Handle rendering, DnD events, API call |
| `public/style.css` | Handle, drag states, drop indicator |

## Out of scope

- SortableJS / external libraries
- Keyboard-accessible reorder
- Undo/redo
- Separate "save order" button
- Reorder via API without UI
