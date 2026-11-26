---
name: single-file-build-pipeline
description: Use whenever someone asks for a single-file HTML app, game or tool (especially one with embedded images, sprites, fonts or other base64 data), whenever an existing single HTML file has grown large or contains base64 assets, when an app is already split into a readable source file plus optional asset or plug-in files, when writing or updating an AGENTS.md for such a project, or when they want to "build and open" with one click. The deliverable stays ONE self-contained HTML file, but it is produced by a build script from a source project, never edited by hand. Two layouts: A (src/ template with placeholders and a one-click run_build.bat) and B (a readable index.html edited directly, with heavy data in optional runtime-loaded files and a script that embeds them).
---

# Source project + build script that produces the single file

## 1. Principle
- The **deliverable** is still one self-contained HTML file (easy to share, publish or open from disk).
- The **source of truth** is a small project. The single file is generated from it and is never edited by hand.
- Why: a single file with embedded base64 images is megabytes of noise. An AI that opens it wastes its context and edits blindly. The source files are small, readable and testable.
- If the user says "make me a single HTML file", do not hand-write one big file. Build the project below and give them the built single file. Say so in one sentence.

### Choosing a layout
| | **Layout A: template build** (sections 2-9) | **Layout B: live source + optional assets** (section 10) |
|---|---|---|
| Best for | New builds; anything that wants tests and a one-click `.bat` | An existing working app that is too big to split safely, or that an AI must keep editing as one file |
| Source of truth | `src/` template + `assets/` files, inlined at build time | `index.html` itself (readable, no big base64) + optional files it loads at run time |
| Run from source | No, you must build first | Yes, open `index.html` and it works (optional pieces simply load, or are skipped if missing) |
| Single file made by | `build.py` into `dist/` | `tools/build-single.py` into `<app>-single.html` |

If the project already looks like B, keep it as B. Do not restructure it into A unless the owner asks. B can be migrated to A later (section 8).

## 2. How the user should ask (copy and paste)
Short form:
> Build this as a source project plus a build script that outputs one self-contained HTML file. Include `run_build.bat` (one click: build, run tests, open the result), a headless smoke test, `AGENTS.md`, and skills describing the code. Never edit the built file.

Full form:
> Create the project with `src/` (index.html template, style.css, app.js), `assets/` (images as files), `build.py` (inlines CSS, JS and assets into `dist/<name>.html`), `run_build.bat`, `tests/smoke.js`, `AGENTS.md` and `skills/`. The built file must be fully self-contained (no external scripts, images or fonts). Stamp every build with the local time. Verify the build, run the tests, and tell me the stamp.

Converting an existing single file:
> Split my single HTML file into the project layout from the `single-file-build-pipeline` skill. Extract base64 images into `assets/`, keep one `src/` file per concern, and prove the rebuild is byte-identical to the original (same stamp) before changing anything else.

## 3. Layout
```
project/
  AGENTS.md              start-here notes for AI assistants
  README.md              short human instructions
  build.py               src + assets -> dist/<name>.html
  run_build.bat          double-click: build, test, open
  src/index.html         markup with {{CSS}}, {{BUILD}}, {{JS}} placeholders
  src/style.css
  src/app.js             contains __ASSET_NAME__ placeholders where images go
  src/build-stamp.html   the stamp script (BUILD_STAMP constant plus the code that displays it)
  assets/                png, jpg, fonts as real files
  tests/smoke.js         headless test
  dist/<name>.html       generated, never edited
  skills/                SKILL.md per topic (codebase guide plus any domain skills)
```
Split `app.js` into several files only when it passes about 150 KB. A single well-sectioned file with marker comments (`/* input */`, `/* simulation */`) is easier for an AI than many tiny files.

## 4. build.py requirements
- Standard library only (Python 3). Works on Windows, macOS and Linux.
- Reads the template and checks that every placeholder occurs exactly once. Fails loudly if not.
- Inlines `style.css`, `app.js`, and every asset as `data:image/png;base64,...` (replace `__ASSET_NAME__` tokens).
- Build stamp: written by the script from the system clock in the user's time zone (`YYYY-MM-DD HH:MM:SS`). Use `zoneinfo`; if the time zone database is missing (Windows without `tzdata`) fall back to the PC's local time. Never compute the stamp in the browser. Support `--stamp` to force a value and `--out` to choose the output file.
- Writes to a temporary file and renames it over the real one, so a failed write can never empty the output.
- Prints the output path, size and stamp. Exit code is non-zero on any error.

## 5. run_build.bat requirements (Windows, one click)
- `cd /d "%~dp0"` first, so it works from any folder and by double-click.
- Find Python: try `py -3`, then `python`, and confirm it really runs with `--version` (the Microsoft Store "python" alias exists even when Python is not installed). If missing, print where to install it (and to tick "Add python.exe to PATH") and `pause`.
- Run `build.py`. On failure print "BUILD FAILED", `pause` and stop.
- If Node.js is installed run `node tests\smoke.js`; if it fails print "TESTS FAILED", `pause`, but still open the page. If Node is missing, say tests were skipped.
- Open the built file with `start "" "%~dp0dist\<name>.html"`.
- Do not `pause` when everything succeeded (a true one-click flow).
- Write the file with CRLF line endings. Keep the output path in one `set "OUT=..."` line at the top. Avoid parentheses inside `echo` text within `( ... )` blocks (use labels and `goto` instead).
- For macOS or Linux add a matching `run_build.command` or `run_build.sh` that does the same with `python3` and `open` or `xdg-open`.

## 6. Tests
`tests/smoke.js` loads the built HTML in Node with a stub DOM, a proxy canvas context and fake input devices, drives the app through its main flows and asserts the key rules, printing `ALL PASSED` or the failures. Keep it fast and dependency-free. Add a test with every new behaviour.

**When there is no test harness yet** (typical for Layout B), still verify before handing over:
1. Extract every inline `<script>` from the built or source HTML and run `node --check` on each.
2. Put logic that has no DOM or map library in it between marker comments (`/* NAME-PURE:START */ ... /* NAME-PURE:END */`) and unit-test that slice in Node by extracting it from the real file, not a copy.
3. For code that needs a canvas, `fetch` or `createImageBitmap`, run the real extracted code in headless Chromium (Playwright). If the real library (Leaflet etc.) is not available offline, stand in for just the base class.
4. Serve test data from a real local HTTP server. Do not simulate CORS with Playwright `route.fulfill`: it adds permissive CORS headers itself, so a "no CORS" case silently passes as CORS-enabled. Also `await route.fulfill(...)`; an un-awaited handler leaves the request hanging. Launch Chromium with `--no-sandbox` in containers.
5. Say plainly what could not be tested (for example live third-party services).

## 7. AGENTS.md and skills
`AGENTS.md` is the first file any AI (or new person) reads. It exists so nobody has to open the big or heavy files to learn how the project works. Keep it short (about 40 to 70 lines), accurate and current: updating it is part of every change that moves something.

**Sections, in this order** (Andrew's Earth's `AGENTS.md` is the worked example):
1. **Read order**: this file, then the header comment of the main source file, then any plug-in `README-AI.md`, then the skills.
2. **Project layout (as it is today)**: one line per file or folder, and mark what is **generated** ("never hand-edit") and what is **heavy data** ("never read or edit"). Say what the build command is.
3. **Rules after ANY code change**: the build stamp (where, format), what must keep working (hooks), the rebuild command, and the closing line to use ("new build stamp, changelog lines, STATUS block").
4. **Where things are**: the search words for each feature (a banner comment, a function name, a `*-PURE:START` marker) with one sentence on what it does and where its state lives. This is what saves an AI from reading 10,000 lines.
5. **Checking your work**: the commands, and the marked slices that can be tested alone.
6. **Skills**: a table of skill name, when to use it, and any project-specific difference ("this project uses Layout B; where they differ this file wins").
7. **Handover naming**: file and chat names, so versions never collide.

Never put a secret in `AGENTS.md`, a skill, or the source. If a service needs a key, say so and point at the private config (section 10).
- `skills/<codebase>/SKILL.md`: layout, workflow, a map of the main code sections and global state, asset formats (for example sprite sheet frame sizes), conventions and gotchas, feature status (built and not built).
- Domain skills (for example input handling, difficulty rules) as separate SKILL.md files with frontmatter `name` and `description`. Update a skill whenever you change the behaviour it describes.

## 8. Converting an existing single file
1. Copy the original. Extract CSS, scripts, markup. Decode each `data:` URI into `assets/` and replace it in the source with a placeholder token.
2. Write `build.py`, rebuild with the original's stamp and compare bytes (`cmp`). Do not touch behaviour until the rebuild is byte-identical.
3. Add `run_build.bat`, `tests/`, `AGENTS.md`, skills. Then continue normal work in `src/`.

## 9. Publishing and handoff
Publish or share `dist/<name>.html` only. Give the user the project zip (source) and the built file. Tell them to double-click `run_build.bat` after editing anything in `src/`.

## 10. Layout B: live source + optional runtime-loaded assets
Use when `index.html` is already the working source and heavy data must stay out of the AI's way.
```
project/
  AGENTS.md              start-here notes (read order, "never read heavy files", build command, rules after a change)
  index.html             the app. Edited directly. No large base64 inside. Header comment holds the maintenance rules
  assets/<name>.js       heavy base64 as data (`window.NAME = {...}`), loaded by an optional loader
  <plugin>/              optional feature folder with its own README-AI.md, joined to index.html by marked hooks
  tools/build-single.py  embeds the assets and plug-ins to make ONE self-contained file
  <app>-single.html      generated, never edited by hand
  skills/                SKILL.md per topic
```
**Rules**
- **Optional loaders.** Heavy files load with a `<script src>` created at run time, with a timeout (about 8 s) so the app never waits forever, and `onerror` that logs one info line and carries on. The app must run, with reduced features, if the file is missing. Keep the loader.
- **Heavy files are off limits.** Put "heavy data, never read or edit, never needs sending to an AI" in the header comment of `index.html`, in `AGENTS.md` and at the top of the file itself.
- **Hooks for plug-ins.** `index.html` contains a few small sections with searchable names (for example `EGG-HOOK`). The plug-in's `README-AI.md` lists the hooks and the contract: the names and meanings that must not change (host object, element ids, CSS classes and variables the plug-in reuses). The header comment of `index.html` repeats this, because an AI may be given `index.html` alone. After any change, search for the hook name and confirm every section is still there.
- **Build script** (`tools/build-single.py`, standard library only): replace the loaders with embedded copies, embed plug-in sources as inert `<script type="text/plain" data-embedded="file.js">` blocks right after `<body>` so they exist before the loader runs, and make the loader run the embedded copy in order. Escape `</script` and `<!--` in embedded text. Find each place to change with `str.index()` on a unique marker so the build fails loudly if a marker was edited away. Write the output only after every step succeeded. Run it after every change to `index.html`.
- **Build stamp.** Without a clock-stamping `build.py`, keep one manual stamp (`YYYY-MM-DD HH:MM:SS`, local time) in the header comment and one in the page footer (`BUILD-FOOTER`), updated on every code change. Take the time from the system clock in the owner's time zone, never from memory.
- **"Self-contained" has limits.** CDN libraries, web fonts and live map or API services may stay external. Say so, and say what does not work offline.
- **Adding a feature to a large file.** Put it in one clearly commented block with its design notes. Reuse the app's existing helpers, caches, settings store and styles. Give new map layers their own pane or new elements their own ids. Persist state in the existing settings store. Keep pure logic between `PURE:START/END` markers so it can be tested (section 6). Record the change in the changelog block (`changelog-keeper`).
- **Skills still apply.** `AGENTS.md` lists them and says where this project differs from Layout A.

## 11. Lessons from Andrew's Earth (check these when changing a big single-file app)
- **Raising a global limit** (for example the maximum zoom): search for everything that assumed the old number. Here that was the minimap (it has its own tile limit), a settings range and its default, and saved user settings where the old maximum meant "no limit" (migrate it, otherwise the feature silently starts limiting).
- **A visual state that other CSS fights** (a cursor): do not set it inline on a parent. Rules on child elements (markers, vector lines) override inheritance. Use a class with `!important` on the container and its children, and check `getComputedStyle` in a real browser.
- **Windowed (virtual) lists**: "scroll to this item" must first move the window so the row exists, then scroll, and retry for a few frames because a render may be pending. Centre the row only if it is not comfortably in view.
- **Objects that are rebuilt** (a shape recreated after each edit) lose state such as z-order. Re-apply it at the rebuild, and prefer overriding the group method that re-orders everything over patching every call site.
- **Press-and-hold gestures**: disable map dragging for the gesture, listen for the release on `document` (the pointer may leave the map), cancel on Esc, clean every listener up, and ignore the click event that follows the release.
- **Dragging something that snaps**: exclude the dragged item from its own snap targets, show the snap ring while dragging, and report the snap only on drop.
- **Layers that need a sign-in or key** are a decision for the owner, not a default: ask, keep them out of the source; the owner adds them in the app (Layers panel, saved in the browser only).
- **"Revert to this list"**: when the owner supplies the list, load it as a test fixture and compare it with the code entry by entry (`deepStrictEqual`) before editing, and keep the test. It proves nothing else drifted and catches "extra" entries that were added earlier.
- **A form that edits settings in the page** (for example custom services, with a key field): validate with a pure function that returns a plain-language reason, build the DOM with `textContent` (never inject user text as HTML, and escape anything that reaches an attribution or label), clear an old error as soon as the user edits, make delete a two-step action with Undo, keep secrets in the browser's own storage rather than a file, and never show a saved key back on screen. Drive the real form code with clicks in headless Chromium: the first version of this form never opened because one element was missing, and only that test showed it.
- **"Place a new thing on an existing thing"** needs three checks: the click reaches the map (markers swallow clicks by default), the snap function is actually applied on that path, and the snap targets are shown while placing.
- **A limit that was clamped to protect something** (the minimap held at zoom 16) will look like a bug once the main limit rises. Prefer letting the dependent view stretch its content to following a clamp.
- **Say what could not be tested.** Third-party services and the full map could not be exercised offline; the tests above cover the logic, the tile loading and the UI pieces, and the summary should say so.

## Checklist
- [ ] Source of truth is `src/` and `assets/`; `dist/` is generated
- [ ] build.py: placeholders checked, assets inlined, stamp from the clock, atomic write
- [ ] run_build.bat: finds Python, builds, tests if Node exists, opens the page, pauses only on failure, CRLF
- [ ] tests/smoke.js passes
- [ ] AGENTS.md and a codebase skill describe the project
- [ ] Rebuild of a converted file is byte-identical to the original

Layout B additions:
- [ ] `index.html` runs from source; heavy files are optional and load with a timeout and silent failure
- [ ] Hooks are marked, documented in `README-AI.md` and repeated in the `index.html` header
- [ ] `tools/build-single.py` fails loudly on a missing marker and was run after the last change
- [ ] Build stamp (header and footer) updated from the real clock in the owner's time zone
- [ ] Inline scripts pass `node --check`; pure logic and canvas/fetch code were tested as in section 6
- [ ] `AGENTS.md` follows the section list in section 7 and was updated for this change
- [ ] No secret anywhere in the source, `AGENTS.md` or skills (a key lives only in the browser's own storage, entered in the app)
- **One mechanism for a setting that many menus share** (visible, label, lock): one `applyFlag`, one menu builder, one guard (`guardLocked`), one saved field per flag, and the pure part (targets, folder expansion, mixed state, menu wording) in a marked slice (`NODEFLAG-PURE`). Add the new fields to every place a node is copied or saved (persist, load, undo snapshot) or they silently vanish on reload.
- **Stacking order**: a saved number per item, re-applied wherever layers are built or rebuilt. The temporary raise for the selected item must remember what to put back. Keep tiers that the map itself enforces (polygons, then paths, then markers) instead of adding panes.
- **Drop-target checks**: test the real tree, not the happy path. A check that walks the dragged item's ancestors will refuse the most common drop (a parent folder). Refuse only the item itself and what is inside it.
- **Anything that rewrites the address bar**: do it with `replaceState` on a pure, tested string function; touch only the named parameters and keep the others and the `#` part byte for byte.
- **Exports that must re-import**: lift the importer's parser into a marked slice and round-trip through it in a test, so the exporter and importer cannot drift.
- **Overlapping labels**: place in screen space (greedy, nearest candidate first), cap the work and fall back to plain labels; keep the maths pure.
- **Handles over scrollbars**: reserve a gutter on the container, not on each scroller, and assert in a browser that the scrollbar's right edge is left of the handle's left edge.
