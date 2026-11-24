---
name: single-file-build-pipeline
description: Use whenever someone asks for a single-file HTML app, game or tool (especially one with embedded images, sprites, fonts or other base64 data), whenever an existing single HTML file has grown large or contains base64 assets, when an app is already split into a readable source file plus optional asset or plug-in files, or when they want to "build and open" with one click. The deliverable stays ONE self-contained HTML file, but it is produced by a build script from a source project, never edited by hand. Two layouts: A (src/ template with placeholders and a one-click run_build.bat) and B (a readable index.html edited directly, with heavy data in optional runtime-loaded files and a script that embeds them).
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
- `AGENTS.md` (about 10 lines): read order, build and test commands, "edit `src/` only, never `dist/`", how to publish, and the closing line to use after changes ("Build stamp set to ...").
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
