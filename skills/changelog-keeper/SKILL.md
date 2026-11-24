---
name: changelog-keeper
description: Use whenever an AI creates or modifies an application's code (new feature, bug fix, refactor, UI tweak, dependency change). Requires a succinct change log entry for every change, preserved history, and a dedicated in-app changelog page, linked from a single row in Settings/About, without cluttering the existing UI.
---

# Changelog Keeper

Every change to an application ends with a changelog entry. No entry, no finished task.

## 1. When to write an entry
Write one for every delivered change that alters behaviour, UI, data format, or dependencies. Skip only for pure whitespace or comment edits. Several edits in one request = one entry with several lines.

## 2. Entry format
Newest first. Each entry:

```
{ v: "1.4.2", date: "2026-11-17", changes: [
    { t: "fixed", text: "CSV import keeps quoted commas", cause: "Row split used naive split(',')" },
    { t: "added", text: "Dark mode toggle in Settings" }
]}
```

- `v`: semver. Fix or tweak = patch, new feature = minor, breaking change or data-format change = major.
- `date`: ISO date of the change.
- `t`: one of `added`, `changed`, `fixed`, `removed`.
- `text`: one line, 12 words or fewer, plain language, says what the user will notice. No file names, no jargon.
- `cause`: required for `fixed` (root cause, one line). Optional otherwise (`why`).
- Never write "various improvements" or "misc fixes".

## 3. Where it lives (source of truth)
- **Single-file HTML app:** one block, kept between markers, edited in place:
  ```
  /* CHANGELOG:START */
  const APP_VERSION = "1.4.2";
  const CHANGELOG = [ ...entries... ];
  /* CHANGELOG:END */
  ```
- **Multi-file project:** `changelog.json` (same schema) loaded by the app, plus a generated `CHANGELOG.md` for humans and repos.
- `APP_VERSION` must equal `CHANGELOG[0].v`. Show it in the About section.

## 4. History rules
- Append new entries at the top. Never edit, reorder, merge or delete past entries (except fixing a typo the user asks about).
- If a change reverts an earlier one, add a new `changed`/`removed` entry referencing the old version.
- Do not trim history. If the block exceeds ~200 entries, move older ones to `changelog-archive.json` and keep a "View older" link.

## 5. In-app display
Goal: a dedicated changelog page that is easy to reach and never in the way.
- **Entry point:** one row in Settings → About, labelled `Changelog`, showing the version (`v1.4.2`) and a "What’s new" link. This is the only thing added to existing screens. If the app has no settings, reuse an existing version label or menu item. No new toolbar buttons, banners, popups or toasts.
- **The page:** its own view with its own route (`#changelog` in single-file apps, `/changelog` in routed apps) and a Back button. Never embed the entry list inside Settings or About; they only link to it.
- **Unread marker:** when the version differs from the last one the user opened, show a small dot on the Settings entry and the Changelog row only. Clear it when the page opens. Store last-seen version in `localStorage` (wrapped in try/catch).
- **Page contents:** entries grouped by version and date, newest expanded, older collapsed; coloured type tags; `cause` shown as a muted second line; filter chips (All / Added / Changed / Fixed / Removed); text search; "Copy as Markdown" and "Download CHANGELOG.md".
- Respect the app’s existing theme, fonts and spacing. Support light and dark.
- Render with `textContent`, never inject entry text as HTML.

## 6. Procedure for every task
1. Make the requested change.
2. Decide the version bump and write the entry (section 2).
3. Update the changelog block and `APP_VERSION` together.
4. If the app has no changelog page yet, add the page and the single About row following section 5 as part of the same change (entry: `added` "Changelog page in Settings > About").
5. Verify: the About row opens the page, Back works, newest entry matches the work done, older entries are untouched.
6. In your reply, state the new version and the entry lines in one short list.

## 7. Do not
- Do not put the full entry list inside About or Settings, add a changelog panel that is always visible, a modal on startup, or a toast per update.
- Do not log internal refactors that have no user-visible effect, unless they changed data formats.
- Do not rebuild the changelog from scratch; always edit the existing block.
