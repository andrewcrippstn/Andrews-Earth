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
- `ARCGIS DYNAMIC LAYERS` — `EsriExportLayer`: an ArcGIS map service drawn on demand (providers with `esri: { layers: 'id' }`). No built-in provider uses it now; it serves custom services of type `arcgis-export`. Opacity only.
- Zoom: `mapMaxZoom()` / `clampMaxZoom` / `tileZoomOpts(p, top)`. The limit is `FLAGS.mapMaxZoom` (Settings > Map display, 10 to 25, default 25), read before the map is created; `applyMaxZoom` applies a change live. `MAP_ZOOM_CEILING` (25) is the hard ceiling. A provider that reached 19 is stretched to the limit; lower-capped ones keep their cap. The minimap follows main - 4 up to `MAP_ZOOM_CEILING - 4` (its tiles stretch past 16). The map-label zoom range (`mapLabelMaxZoom`) also assumes 25.
- `PROVIDERS` is the owner's list of 27 built-in providers. Do not add or remove built-in ones unless asked (a LIST cadastre set and a "No base layer" entry were added and then removed on request). Anything extra goes in as a custom service.
- Custom services have two sources, shown together in the Layers list: `custom/services.js` (git-ignored; copy `custom/services.example.js`; embedded by `tools/build-single.py`, `${ENV_NAME}` filled from the environment; read only, shown with a lock) and the ones added in the Layers panel (`SETTINGS.customServices`, saved in this browser only; `renderCustomServiceForm`, pencil on the row). Code: `CUSTOM-PURE:START` (`aeCustomProviders`, `customDefProblem`), `rebuildCustomProviders`, `registerCustomServices`, `reapplyCustomServices`. The built file contains build-time keys: never publish it.
- Services that need an API key or sign-in (e.g. the TasNetworks tiles) are deliberately NOT built in. Never put a token or key in `index.html`, this file or any skill.
- Editing: `openEditorPanel` opens paths and polygons on the Vertices tab. `renderVerticesTab` holds the vertex editor: `onPreviewDown` (press and hold to add a vertex), the midpoint drag handlers, `numberedVertexIcon`. `snapDraggedMarker` snaps a dragged marker. `raiseEditedNode` keeps the edited item on top (also called from `DrawnGroup.bringToFront`).
- Placing a placemark: `applySnapFromEvent` is used, snap zones show while placing, and a click on an existing marker is forwarded to the map (in `bindLayerFocus`) so a new marker can sit exactly on it.
- `focusNodeInTree` / `scrollPlacesTo` — selecting on the map scrolls the Places list (it moves the virtual-list window first). `setMapToolCursor` — the crosshair while a drawing tool is active (a CSS class with `!important`).
- `CHANGELOG:START` — version and change history. `cl-view` is the changelog page.
- `EGG-HOOK` — the three dino-egg hooks (see `dino-egg/README-AI.md`).

## Checking your work
Extract each inline `<script>` and run `node --check`. Test pure logic by extracting the marked slice from the real file. Test canvas/fetch code in headless Chromium against a real local HTTP server (Playwright `route.fulfill` adds CORS headers itself, so it cannot test a no-CORS case). Marked slices you can lift out and test: `OVERLAY-PURE`, `ZOOM-PURE`, `CUSTOM-PURE`, `SCROLL-PURE`, `VERTEX-PURE`. Details: `skills/single-file-build-pipeline/SKILL.md` section 6.

## Skills (in `skills/`)
| Skill | Use it when |
|---|---|
| `work-in-bulk` | Any multi-part task. Do as much as possible per reply; end with a STATUS block; supports "continue", "continue quiet", "show project". |
| `changelog-keeper` | Any code change. Add an entry at the TOP of `CHANGELOG` in `index.html` (search `CHANGELOG:START`), bump `APP_VERSION` (must equal `CHANGELOG[0].v`), never edit past entries. The page is the `#changelog` route, linked from Settings > About. |
| `single-file-build-pipeline` | Producing or changing the single-file build. Note: this project already follows its principle (small source + heavy assets kept out of the AI's way, generated single file, never edit the built file) but uses `index.html` + `tools/build-single.py` instead of the skill's `src/` + `build.py` + `run_build.bat` layout. Do not restructure to match unless the owner asks. Where the two differ, this file wins. |
| `chat-handover` | Chat is very long, a major feature just landed, or you are unsure about something settled earlier. |

## Handover naming
Name delivered builds with a version, e.g. `andrews-earth-v1.html`, increasing every handover, never reusing a number (see `chat-handover`).
