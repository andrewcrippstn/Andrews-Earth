# dino-egg/ — Dino Tracker (optional easter egg for Andrew's Earth)

**For an AI assistant working on `index.html`:** this folder is an *optional plug-in*. You may be given `index.html`
without it. That is fine — the app runs without the egg. **But you must keep the plug-in working when the folder is put back.**

## How it plugs in
`index.html` contains three small, marked **EGG-HOOK** sections (search for `EGG-HOOK`):

| Hook | Where | Purpose |
|---|---|---|
| `EGG-HOOK:BEGIN/END loader` | main script, after the inspector code | builds `window.AE_EGG_HOST` and loads `dino-egg/*.js` (silently skipped if missing) |
| `EGG-HOOK dock` | `syncInspectorClass()` | the egg panel `#egg-panel` shares the docked properties-panel slot (`.map-area.inspector-open`) |
| `EGG-HOOK palette` | `cmdkActions()` | adds the "Dino Tracker" command when `window.DinoTracker` exists |

## Contract (do not break; keep names and meaning)
`window.AE_EGG_HOST` (apiVersion 1) must provide: `map` (Leaflet map), `mapAreaEl`, `editorPanel`, `closeEditorPanel()`,
`showToast(msg, icon)`, `getElevation(lat,lng)` (metres or `null`), `syncDock()` (= `syncInspectorClass`), `overlayPanelIds` (array of element ids of panels that
can cover part of `#map`).
The egg panel reuses Andrew's Earth CSS (`.editor-panel`, `.editor-tabs`, `.editor-tab`, `.toggle-row`, `.toggle-switch`, `.style-subtab`, `.editor-field`, `.editor-value-row`, `.btn*`, CSS variables like `--accent`, `--surface`, `--border`).
If you rename or restyle those, check that the panel still looks right. If you add a new panel that overlays the map, add its id to `overlayPanelIds`.
Search `index.html` for `EGG-HOOK` to confirm the three hook sections are intact.

## Files
- `dino-sprites.js` — HEAVY base64 images (never read/edit; never needs to be sent to an AI).
- `dino-egg.js` — engine (`window.DinoEgg`). Header comment documents the host adapter API.
- `dino-ae-ui.js` — glue: injects the panel, hotkey **Alt+Shift+D**, host adapter, visible-region logic, follow camera, settings.

## Behaviour summary (so you can preserve it)
- Auto trigger: zoom >= trigger zoom (default 17) and hold the map still ~3.5 s -> a scene starts. Hunt = 1 predator + 2 prey; prey walk across, predator enters from another edge, eats both, then leaves.
- Dinosaurs spawn and walk inside the *visible* part of the map (panels excluded). The red edge flash frames the visible map.
- `?egg=0` in the URL disables the egg.
