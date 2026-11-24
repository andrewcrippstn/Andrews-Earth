# AGENTS.md — start here (Andrew's Earth)

## Read order
1. This file.
2. The header comment at the top of `index.html` (maintenance rule, EGG-HOOK rules).
3. `dino-egg/README-AI.md` (only if touching the Dino Tracker easter egg).
4. The skills below, when their trigger applies.

## Project layout (as it is today)
- `index.html` — the app and the source of truth. Edit this.
- `assets/ae-images.js` — heavy base64 icons. **Never read or edit.**
- `dino-egg/` — optional plug-in. `dino-sprites.js` is heavy base64: **never read or edit.**
- `tools/build-single.py` — produces `andrews-earth-single.html` (everything embedded in ONE file).
  Run: `python3 tools/build-single.py`
- `andrews-earth-single.html` — generated. **Never hand-edit.**

## Rules after ANY code change
1. Update the `BUILD:` line in the `index.html` header AND the `BUILD-FOOTER` text, same format `YYYY-MM-DD HH:MM:SS`.
2. Keep all three `EGG-HOOK` sections working.
3. Rebuild the single file with `tools/build-single.py`.
4. Close your reply with the new build stamp, the changelog entry lines (see skills), and a STATUS block.

## Where things are (search `index.html` for these)
- `OVERLAY TILES` — the Layers tab Overlay mode: second tile layer with opacity, transparent colours and the map dropper. Own map pane `overlayTilePane` (z-index 250). State is `SETTINGS.overlay`. Pure pixel logic sits between `OVERLAY-PURE:START/END`.
- `renderLayersSection` — the Layers tab (Base | Overlay toggle).
- `CHANGELOG:START` — version and change history. `cl-view` is the changelog page.
- `EGG-HOOK` — the three dino-egg hooks (see `dino-egg/README-AI.md`).

## Checking your work
Extract each inline `<script>` and run `node --check`. Test pure logic by extracting the marked slice from the real file. Test canvas/fetch code in headless Chromium against a real local HTTP server (Playwright `route.fulfill` adds CORS headers itself, so it cannot test a no-CORS case). Details: `skills/single-file-build-pipeline/SKILL.md` section 6.

## Skills (in `skills/`)
| Skill | Use it when |
|---|---|
| `work-in-bulk` | Any multi-part task. Do as much as possible per reply; end with a STATUS block; supports "continue", "continue quiet", "show project". |
| `changelog-keeper` | Any code change. Add an entry at the TOP of `CHANGELOG` in `index.html` (search `CHANGELOG:START`), bump `APP_VERSION` (must equal `CHANGELOG[0].v`), never edit past entries. The page is the `#changelog` route, linked from Settings > About. |
| `single-file-build-pipeline` | Producing or changing the single-file build. Note: this project already follows its principle (small source + heavy assets kept out of the AI's way, generated single file, never edit the built file) but uses `index.html` + `tools/build-single.py` instead of the skill's `src/` + `build.py` + `run_build.bat` layout. Do not restructure to match unless the owner asks. Where the two differ, this file wins. |
| `chat-handover` | Chat is very long, a major feature just landed, or you are unsure about something settled earlier. |

## Handover naming
Name delivered builds with a version, e.g. `andrews-earth-v1.html`, increasing every handover, never reusing a number (see `chat-handover`).
