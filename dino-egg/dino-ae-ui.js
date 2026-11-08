/* =====================================================================================================
   dino-egg/dino-ae-ui.js   —   Andrew's Earth <-> Dino Tracker glue (panel UI, hotkey, host adapter, visible-region logic)
   Optional file. Loaded by the EGG-HOOK loader in index.html AFTER dino-sprites.js and dino-egg.js.
   It does nothing unless window.AE_EGG_HOST (published by index.html), window.DinoEgg and window.DINO_EGG_SPRITES exist.

   WHAT THIS FILE DOES
     - injects the Dino Tracker panel (#egg-panel, styled with Andrew's Earth's own .editor-panel classes) into .map-area
     - Alt+Shift+D, the X button, Esc or the command palette ("Dino Tracker") open and close it; it shares the docked
       properties-panel slot, so opening one closes the other
     - host adapter for DinoEgg.init(): map size/zoom/centre, zoom-animation tracking, and the VISIBLE RECT of the map
       (the map minus overlay panels listed in AE_EGG_HOST.overlayPanelIds + the egg panel) so dinosaurs spawn and
       walk where the user can see them
     - follow camera, dinosaur list, settings (saved in localStorage under "ae.dino.*"), terrain check (no walking in water)
   WHAT IT NEEDS FROM index.html (window.AE_EGG_HOST, apiVersion 1):
     map, mapAreaEl, editorPanel, closeEditorPanel(), showToast(msg, icon), getElevation(lat,lng), syncDock(), overlayPanelIds[]
     plus the CSS classes/variables of Andrew's Earth (.editor-panel, .editor-tabs, .editor-tab, .toggle-row, --accent ...)
   If index.html changes one of those, update this file to match (or the AE_EGG_HOST object so it keeps its meaning).
   ===================================================================================================== */
(function () {
    'use strict';
    const AEH = window.AE_EGG_HOST;
    if (!AEH || !window.DinoEgg || !window.DINO_EGG_SPRITES) return;               // optional feature: stay silent if anything is missing
    if (AEH.apiVersion !== 1) { console.warn('Dino Tracker: host API version ' + AEH.apiVersion + ' not supported (needs 1)'); return; }
    const { map, mapAreaEl, editorPanel, closeEditorPanel, showToast, getElevation } = AEH;
    window.DinoEggFiles = { version: 1, needsHostApi: 1 };

    const style = document.createElement('style'); style.id = 'dino-ae-ui-css';
    style.textContent = "\n    /* ================= Dino Tracker (easter egg) panel \u2014 reuses .editor-panel chrome ================= */\n    .editor-panel.egg-panel { z-index: 1601; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), visibility 0s linear 0.3s; visibility: hidden; }\n    .editor-panel.egg-panel.open { visibility: visible; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), visibility 0s; }\n    .egg-panel .egg-pane { display: none; }\n    .egg-panel .egg-pane.active { display: block; }\n    .egg-status { margin-bottom: 12px; display: flex; flex-direction: column; gap: 6px; }\n    .egg-status-bar { height: 4px; border-radius: 2px; background: var(--surface-3); overflow: hidden; }\n    .egg-status-bar i { display: block; height: 100%; width: 0; background: var(--accent-fill); transition: width .2s linear; }\n    .egg-status.fire { border-color: var(--accent-border); background: var(--accent-soft); color: var(--accent); }\n    .egg-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }\n    .egg-empty { font-size: 0.72rem; color: var(--text-3); padding: 14px 12px; text-align: center; border: 1px dashed var(--border-hi); border-radius: 9px; }\n    .egg-row { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 6px 10px; border-radius: 9px; background: var(--surface); border: 1px solid var(--border); cursor: pointer; font-family: inherit; color: var(--text); }\n    .egg-row:hover { border-color: var(--border-hi); background: var(--surface-soft); }\n    .egg-row.active { background: var(--accent-soft); border-color: var(--accent-border); }\n    .egg-row .mini { width: 34px; height: 34px; flex: 0 0 34px; display: flex; align-items: center; justify-content: center; background: var(--surface-2); border-radius: 7px; }\n    .egg-row .mini img { max-width: 26px; max-height: 30px; object-fit: contain; }\n    .egg-row .meta { flex: 1; min-width: 0; }\n    .egg-row .meta b { display: block; font-size: 0.8rem; font-weight: 600; }\n    .egg-row .meta small { display: block; font-size: 0.64rem; color: var(--text-3); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n    .egg-row .role { font-size: 0.56rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 6px; border-radius: 100px; border: 1px solid var(--border-hi); color: var(--text-2); background: var(--surface-2); }\n    .egg-row .role.predator { color: var(--danger); background: var(--danger-soft); border-color: var(--danger-border); }\n    .egg-row .role.herbivore, .egg-row .role.prey { color: var(--accent); background: var(--accent-soft); border-color: var(--accent-border); }\n    .egg-row .where { font-family: 'IBM Plex Mono', monospace; font-size: 0.56rem; color: var(--accent); white-space: nowrap; }\n    .egg-row .where.off { color: var(--text-3); }\n    .egg-panel .style-subtabs { margin-bottom: 10px; }\n    .egg-panel .toggle-row { padding: 10px 12px; margin-bottom: 6px; font-size: 0.8rem; }\n    .egg-panel .toggle-row .tr-grow { flex: 1; min-width: 0; }\n    .egg-panel .toggle-row small { display: block; color: var(--text-3); font-size: 0.64rem; margin-top: 1px; }\n    .egg-panel .editor-field select { width: 100%; }\n    .egg-panel .editor-panel-footer .btn { padding: 8px 10px; font-size: 0.78rem; }\n";
    document.head.appendChild(style);
    const tpl = document.createElement('template');
    tpl.innerHTML = "            <!-- DINO TRACKER panel: the easter egg's UI. Same slot and styling as #editor-panel (properties panel). Only one of the two is open at a time. -->\n            <div class=\"editor-panel egg-panel\" id=\"egg-panel\" role=\"dialog\" aria-label=\"Dino Tracker\">\n                <div class=\"editor-panel-header\">\n                    <div class=\"editor-panel-title\">\n                        Dino Tracker\n                        <small id=\"egg-subtitle\">Easter egg \u00b7 Alt+Shift+D to close</small>\n                    </div>\n                    <button class=\"editor-panel-close\" id=\"egg-panel-close\" title=\"Close (Alt+Shift+D)\" aria-label=\"Close Dino Tracker\"><i class=\"fas fa-times\"></i></button>\n                </div>\n                <div class=\"editor-tabs\" id=\"egg-tabs\">\n                    <button class=\"editor-tab active\" data-pane=\"dinos\">Dinosaurs</button>\n                    <button class=\"editor-tab\" data-pane=\"scene\">Scene</button>\n                    <button class=\"editor-tab\" data-pane=\"settings\">Settings</button>\n                </div>\n                <div class=\"editor-panel-body\" id=\"egg-body\">\n                    <div class=\"egg-pane active\" data-pane=\"dinos\">\n                        <div class=\"editor-hint egg-status\" id=\"egg-status\"><span id=\"egg-status-txt\"></span><div class=\"egg-status-bar\"><i id=\"egg-status-fill\"></i></div></div>\n                        <div class=\"editor-section-label\">Dinosaurs here <span id=\"egg-count\"></span></div>\n                        <div class=\"egg-list\" id=\"egg-list\"></div>\n                        <div class=\"toggle-row\" id=\"egg-follow-row\" role=\"switch\" aria-checked=\"false\" tabindex=\"0\"><div class=\"tr-grow\">Follow camera<small id=\"egg-follow-sub\">Keep the action centred in the visible map</small></div><div class=\"toggle-switch\"></div></div>\n                    </div>\n                    <div class=\"egg-pane\" data-pane=\"scene\">\n                        <div class=\"editor-section-label\">Scene</div>\n                        <div class=\"style-subtabs\" id=\"egg-scenes\">\n                            <button class=\"style-subtab\" data-mode=\"hunt\">Predator hunt</button>\n                            <button class=\"style-subtab\" data-mode=\"random\">Random mix</button>\n                            <button class=\"style-subtab\" data-mode=\"solo\">Solo walker</button>\n                            <button class=\"style-subtab\" data-mode=\"herd\">Herd</button>\n                            <button class=\"style-subtab\" data-mode=\"pack\">Raptor pack</button>\n                        </div>\n                        <div class=\"editor-hint\" id=\"egg-note\"></div>\n                    </div>\n                    <div class=\"egg-pane\" data-pane=\"settings\">\n                        <div class=\"editor-section-label\">Behaviour</div>\n                        <div class=\"toggle-row\" data-pref=\"auto\" role=\"switch\" tabindex=\"0\"><div class=\"tr-grow\">Auto trigger<small>Zoom in and hold the map still to start a scene</small></div><div class=\"toggle-switch\"></div></div>\n                        <div class=\"editor-field\"><label for=\"egg-zoomtrig\">Trigger zoom</label><div class=\"editor-value-row\"><input type=\"range\" id=\"egg-zoomtrig\" min=\"8\" max=\"19\" step=\"0.5\"><span class=\"val\" id=\"egg-zoomtrig-val\"></span></div></div>\n                        <div class=\"toggle-row\" data-pref=\"sound\" role=\"switch\" tabindex=\"0\"><div class=\"tr-grow\">Sound<small>Press M to mute</small></div><div class=\"toggle-switch\"></div></div>\n                        <div class=\"toggle-row\" data-pref=\"remains\" role=\"switch\" tabindex=\"0\"><div class=\"tr-grow\">Leave bones &amp; blood behind</div><div class=\"toggle-switch\"></div></div>\n                        <div class=\"toggle-row\" data-pref=\"prints\" role=\"switch\" tabindex=\"0\"><div class=\"tr-grow\">Footprints</div><div class=\"toggle-switch\"></div></div>\n                        <div class=\"editor-section-label\" style=\"margin-top:14px\">Look &amp; speed</div>\n                        <div class=\"editor-field\"><label for=\"egg-gore\">Gore level</label><select id=\"egg-gore\"></select></div>\n                        <div class=\"editor-field\"><label for=\"egg-scale\">Dinosaur display size</label><div class=\"editor-value-row\"><input type=\"range\" id=\"egg-scale\" min=\"1\" max=\"10\" step=\"0.1\"><span class=\"val\" id=\"egg-scale-val\"></span></div></div>\n                        <div class=\"editor-field\"><label for=\"egg-time\">Walking time scale</label><div class=\"editor-value-row\"><input type=\"range\" id=\"egg-time\" min=\"0.5\" max=\"10\" step=\"0.5\"><span class=\"val\" id=\"egg-time-val\"></span></div></div>\n                    </div>\n                </div>\n                <div class=\"editor-panel-footer\" id=\"egg-footer\">\n                    <button class=\"btn btn-primary\" id=\"egg-trigger\"><i class=\"fas fa-play\"></i> Trigger scene</button>\n                    <button class=\"btn btn-secondary\" id=\"egg-pause\"><i class=\"fas fa-pause\"></i> Pause</button>\n                    <button class=\"btn btn-secondary\" id=\"egg-clear\" title=\"Remove bones, blood and footprints\"><i class=\"fas fa-broom\"></i> Clear</button>\n                </div>\n            </div>\n\n";
    mapAreaEl.appendChild(tpl.content);

            const eggPanel = document.getElementById('egg-panel');
            new MutationObserver(() => AEH.syncDock()).observe(eggPanel, { attributes: true, attributeFilter: ['class'] });   // dock: map shrinks like it does for the properties panel
            const eggMapEl = document.getElementById('map');
            const eggEnabled = !/[?&]egg=0\b/.test(location.search);
            const eggStore = {
                get(k, d) { try { const v = localStorage.getItem('ae.dino.' + k); return v === null ? d : v; } catch (e) { return d; } },
                set(k, v) { try { localStorage.setItem('ae.dino.' + k, v); } catch (e) {} }
            };
            const eggClamp = (v, a, b) => Math.max(a, Math.min(b, v));
            const EGG_MODES = {
                random: 'A random mix of scenes each time.',
                solo: 'One dinosaur crosses the view.',
                herd: 'A mixed herd of herbivores crosses the view.',
                pack: 'A raptor pack sprints across.',
                hunt: 'One predator and two prey: it stalks, sprints, strikes and feeds.'
            };
            let eggStarted = false, eggFollow = false, eggFollowTarget = null, eggCamDriven = false;
            let eggScene = eggStore.get('scene', 'hunt'); if (!EGG_MODES[eggScene]) eggScene = 'hunt';
            let eggZoomTrig = eggClamp(+eggStore.get('zoom', 17) || 17, 8, 19);
            let eggFlashUntil = 0, eggFlashMsg = '', eggPaused = false, eggLastList = 0, eggLastStatus = 0, eggLastMoveEnd = 0;
            const eggCamRem = { x: 0, y: 0 };

            // ---- visible region of the map (container px) not covered by overlay panels ----
            let eggRectAt = 0, eggRectVal = null;
            function eggVisibleRect() {
                const now = performance.now();
                if (eggRectVal && now - eggRectAt < 40) return eggRectVal;
                const mr = eggMapEl.getBoundingClientRect(), W = mr.width, H = mr.height;
                let x0 = 0, y0 = 0, x1 = W, y1 = H;
                for (const id of AEH.overlayPanelIds.concat(['egg-panel'])) {
                    const el = document.getElementById(id);
                    if (!el || !(el.classList.contains('open') || el.classList.contains('expanded'))) continue;
                    const r = el.getBoundingClientRect();
                    const a = Math.max(0, r.left - mr.left), b = Math.min(W, r.right - mr.left);
                    const c = Math.max(0, r.top - mr.top), d = Math.min(H, r.bottom - mr.top);
                    if (b - a < 4 || d - c < 4) continue;
                    if (b - a >= 0.8 * W) {                       // wide strip: covers the top or the bottom
                        if (c <= 2) y0 = Math.max(y0, d); else if (d >= H - 2) y1 = Math.min(y1, c);
                    } else {                                       // tall strip: covers the left or the right
                        if (b >= W - 2) x1 = Math.min(x1, a); else if (a <= 2) x0 = Math.max(x0, b);
                    }
                }
                eggRectAt = now;
                eggRectVal = { x0, y0, x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
                return eggRectVal;
            }

            // ---- host adapter (see the HEAVY GUIDE at the top of the egg block) ----
            let eggZAnim = null;
            const eggBez = p => { let lo = 0, hi = 1, t = p; for (let i = 0; i < 20; i++) { t = (lo + hi) / 2; const x = 3 * (1 - t) * t * t * .25 + t * t * t; if (x < p) lo = t; else hi = t; } return 3 * (1 - t) * t * t + t * t * t; };
            map.on('zoomanim', e => { if (e.zoom === map.getZoom()) return; eggZAnim = { t0: performance.now(), z1: e.zoom, c1: e.center, s1: Math.pow(2, e.zoom - map.getZoom()) }; });
            map.on('zoomend', () => { eggZAnim = null; });
            const eggMpp = (lat, z) => 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
            const eggHost = {
                el: eggMapEl,
                getSize: () => { const s = map.getSize(); return { x: s.x, y: s.y }; },
                getZoom: () => map.getZoom(),
                getCenter: () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; },
                makeView(now) {
                    const size = map.getSize(), z = map.getZoom(); let e = 0, s = 1;
                    if (eggZAnim) { e = eggBez(eggClamp((now - eggZAnim.t0) / 250, 0, 1)); s = 1 + (eggZAnim.s1 - 1) * e; }
                    const half = size.divideBy(2);
                    return {
                        size: { x: size.x, y: size.y }, z, anim: !!eggZAnim, rect: eggVisibleRect(),
                        mppOf: lat => eggMpp(lat, z) / s,
                        proj: ll => {
                            const g = L.latLng(ll.lat, ll.lng), p0 = map.latLngToContainerPoint(g);
                            if (!eggZAnim) return { x: p0.x, y: p0.y };
                            const p1 = map.project(g, eggZAnim.z1).subtract(map.project(eggZAnim.c1, eggZAnim.z1)).add(half);
                            return { x: p0.x + (p1.x - p0.x) * e, y: p0.y + (p1.y - p0.y) * e };
                        }
                    };
                },
                setDragging: on => { on ? map.dragging.enable() : map.dragging.disable(); },
                shake: t => { map.getPane('mapPane').style.translate = t; },
                ignoreTarget: t => !!(t.closest && t.closest('.leaflet-control, .map-zoom, .leaflet-popup, button')) || !!document.querySelector('.map-tool.active')
            };
            map.on('zoomstart movestart moveend zoomend', () => { if (!eggCamDriven && eggStarted) DinoEgg.touch(); });
            map.on('resize', () => { if (eggStarted) DinoEgg.resize(); });

            // ---- camera helpers: centre things in the VISIBLE part of the map ----
            function eggCentrePx() { const r = eggVisibleRect(); return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }; }
            function eggCenterFor(ll, z) {            // map centre that puts `ll` in the middle of the visible region
                const rc = eggCentrePx(), s = map.getSize(), p = map.project(ll, z);
                return map.unproject(p.subtract(L.point(rc.x - s.x / 2, rc.y - s.y / 2)), z);
            }
            function eggFlyTo(ll, z) {
                z = Math.min(map.getMaxZoom(), z);
                eggCamDriven = true; eggCamRem.x = eggCamRem.y = 0;
                map.flyTo(eggCenterFor(ll, z), z, { duration: 1.1 });
                setTimeout(() => { eggCamDriven = false; }, 1500);
            }
            function eggFollowCamera(dt, now) {
                if (!eggFollow || eggZAnim) return;
                const sc = DinoEgg.scenes()[0]; if (!sc) return;
                if (eggFollowTarget && (eggFollowTarget.gone || !DinoEgg.scenes().includes(eggFollowTarget.sc))) eggFollowTarget = null;
                const al = sc.actors.filter(a => !a.gone); if (!al.length) return;
                const pts = eggFollowTarget ? [DinoEgg.latLngOf(eggFollowTarget)] : al.map(DinoEgg.latLngOf);
                const ll = L.latLng(pts.reduce((s, p) => s + p.lat, 0) / pts.length, pts.reduce((s, p) => s + p.lng, 0) / pts.length);
                const p = map.latLngToContainerPoint(ll), rc = eggCentrePx(), k = 1 - Math.exp(-dt * 5);
                eggCamRem.x += (p.x - rc.x) * k; eggCamRem.y += (p.y - rc.y) * k;
                const ix = Math.trunc(eggCamRem.x), iy = Math.trunc(eggCamRem.y);
                if (ix || iy) {
                    eggCamRem.x -= ix; eggCamRem.y -= iy; eggCamDriven = true;
                    if (typeof map._rawPanBy === 'function') { map._rawPanBy(L.point(ix, iy)); map.fire('move'); if (now - eggLastMoveEnd > 250) { map.fire('moveend'); eggLastMoveEnd = now; } }
                    else map.panBy([ix, iy], { animate: false });
                    eggCamDriven = false;
                }
            }
            map.on('dragstart', () => { if (eggFollow && !eggCamDriven) eggSetFollow(false); });
            function eggSetFollow(on, target) {
                eggFollow = !!on; eggFollowTarget = on ? (target || null) : null; eggCamRem.x = eggCamRem.y = 0;
                const row = document.getElementById('egg-follow-row');
                row.classList.toggle('active', eggFollow); row.setAttribute('aria-checked', eggFollow ? 'true' : 'false');
                document.getElementById('egg-follow-sub').textContent = eggFollow ? (eggFollowTarget ? 'Following ' + eggFollowTarget.sp.short : 'Following the whole scene') : 'Keep the action centred in the visible map';
            }

            // ---- panel: open / close ----
            function eggPanelOpen() { return eggPanel.classList.contains('open'); }
            function openEggPanel() {
                if (!eggEnabled) { showToast('The Dino Tracker is switched off (?egg=0)', 'fa-dragon'); return; }
                startEgg();
                if (editorPanel.classList.contains('open')) closeEditorPanel();
                eggPanel.classList.add('open');
                document.querySelector('.map-area').scrollLeft = 0;   // focus inside an off-screen panel can scroll the clipped map area
                eggLastList = 0; eggUpdateUI(performance.now(), true);
            }
            function closeEggPanel() { eggPanel.classList.remove('open'); if (eggFollow) eggSetFollow(false); }
            function toggleEggPanel() { eggPanelOpen() ? closeEggPanel() : openEggPanel(); }
            window.DinoTracker = { version: 1, toggle: toggleEggPanel, open: openEggPanel, close: closeEggPanel, isOpen: eggPanelOpen };
            window.DinoTracker.debug = { rect: eggVisibleRect, proj: (ll) => map.latLngToContainerPoint(ll), zoom: () => map.getZoom(), setZoom: (z) => map.setZoom(z, { animate: false }) };   // small debug/test hooks
            document.getElementById('egg-panel-close').addEventListener('click', closeEggPanel);
            new MutationObserver(() => { if (editorPanel.classList.contains('open') && eggPanelOpen()) closeEggPanel(); })
                .observe(editorPanel, { attributes: true, attributeFilter: ['class'] });
            document.addEventListener('keydown', (e) => {
                if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyD') { e.preventDefault(); toggleEggPanel(); return; }
                const typing = e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
                if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
                if (e.key === 'Escape' && eggPanelOpen()) closeEggPanel();
                else if ((e.key === 'm' || e.key === 'M') && eggStarted) setEggPref('sound', !eggPrefs.sound);
            });

            // ---- panel: tabs ----
            document.getElementById('egg-tabs').addEventListener('click', (e) => {
                const b = e.target.closest('.editor-tab'); if (!b) return;
                document.querySelectorAll('#egg-tabs .editor-tab').forEach(t => t.classList.toggle('active', t === b));
                document.querySelectorAll('#egg-body .egg-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === b.dataset.pane));
            });

            // ---- panel: preferences (toggle rows) ----
            const eggPrefs = { auto: true, sound: true, remains: true, prints: true };
            const EGG_PREF_APPLY = { auto: v => DinoEgg.set({ autoTrigger: v }), sound: v => DinoEgg.set({ sound: v }), remains: v => DinoEgg.set({ remains: v }), prints: v => DinoEgg.set({ footprints: v }) };
            function setEggPref(k, v, silent) {
                eggPrefs[k] = !!v; eggStore.set(k, v ? '1' : '0');
                const row = eggPanel.querySelector('.toggle-row[data-pref="' + k + '"]');
                if (row) { row.classList.toggle('active', !!v); row.setAttribute('aria-checked', v ? 'true' : 'false'); }
                if (eggStarted) EGG_PREF_APPLY[k](!!v);
                if (k === 'sound' && !silent && eggStarted) showToast(v ? 'Dino sounds on' : 'Dino sounds muted', v ? 'fa-volume-high' : 'fa-volume-xmark');
            }
            for (const k of Object.keys(eggPrefs)) { const s = eggStore.get(k, null); setEggPref(k, s === null ? true : s === '1', true); }
            eggPanel.querySelectorAll('.toggle-row[data-pref]').forEach(row => {
                const f = () => setEggPref(row.dataset.pref, !eggPrefs[row.dataset.pref]);
                row.addEventListener('click', f);
                row.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); f(); } });
            });
            { const row = document.getElementById('egg-follow-row');
              const f = () => { eggSetFollow(!eggFollow); if (eggFollow) { const a = DinoEgg.actors()[0]; if (a) eggFlyTo(DinoEgg.latLngOf(a), 19); } };
              row.addEventListener('click', f);
              row.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); f(); } }); }

            // ---- panel: scene buttons, footer buttons, sliders ----
            function setEggScene(m, spawn) {
                eggScene = m; eggStore.set('scene', m);
                document.querySelectorAll('#egg-scenes .style-subtab').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
                document.getElementById('egg-note').textContent = EGG_MODES[m] + ' Hover for names and a roar, press and hold to freeze one animal.';
                if (eggStarted) { DinoEgg.set({ sceneType: m }); if (spawn) DinoEgg.spawn(m); }
            }
            document.getElementById('egg-scenes').addEventListener('click', (e) => { const b = e.target.closest('.style-subtab'); if (b) { setEggScene(b.dataset.mode, true); b.blur(); } });
            document.getElementById('egg-trigger').addEventListener('click', () => { if (eggStarted) DinoEgg.spawn(eggScene); });
            document.getElementById('egg-clear').addEventListener('click', () => { if (eggStarted) DinoEgg.clearRemains(); });
            document.getElementById('egg-pause').addEventListener('click', () => {
                eggPaused = !eggPaused; if (eggStarted) DinoEgg.set({ paused: eggPaused });
                document.getElementById('egg-pause').innerHTML = eggPaused ? '<i class="fas fa-play"></i> Resume' : '<i class="fas fa-pause"></i> Pause';
            });
            const eggZt = document.getElementById('egg-zoomtrig'), eggSc = document.getElementById('egg-scale'), eggTm = document.getElementById('egg-time'), eggGoreSel = document.getElementById('egg-gore');
            eggZt.value = eggZoomTrig; document.getElementById('egg-zoomtrig-val').textContent = eggZoomTrig.toFixed(1);
            eggZt.addEventListener('input', () => { eggZoomTrig = +eggZt.value; eggStore.set('zoom', eggZoomTrig); document.getElementById('egg-zoomtrig-val').textContent = eggZoomTrig.toFixed(1); if (eggStarted) DinoEgg.set({ zoomTrigger: eggZoomTrig }); });
            eggSc.addEventListener('input', () => { const v = +eggSc.value; eggStore.set('scale', v); document.getElementById('egg-scale-val').textContent = v.toFixed(1) + '×'; if (eggStarted) DinoEgg.set({ displayScale: v }); });
            eggTm.addEventListener('input', () => { const v = +eggTm.value; eggStore.set('time', v); document.getElementById('egg-time-val').textContent = v + '×'; if (eggStarted) DinoEgg.set({ timeScale: v }); });
            eggGoreSel.addEventListener('change', () => { eggStore.set('gore', eggGoreSel.value); if (eggStarted) DinoEgg.set({ gore: +eggGoreSel.value }); });
            setEggScene(eggScene, false);

            // ---- panel: live status + dinosaur list ----
            const eggRows = new Map();
            function eggGoTo(a) {
                eggSetFollow(true, a); eggFlyTo(DinoEgg.latLngOf(a), Math.max(map.getZoom(), 19)); DinoEgg.notice(a);
            }
            function eggUpdateList() {
                const rows = DinoEgg.actors(), list = document.getElementById('egg-list');
                document.getElementById('egg-count').textContent = rows.length ? '(' + rows.length + ')' : '';
                let empty = list.querySelector('.egg-empty');
                if (!rows.length) {
                    for (const [id, r] of eggRows) { r.remove(); eggRows.delete(id); }
                    if (!empty) { empty = document.createElement('div'); empty.className = 'egg-empty'; empty.textContent = 'None yet. Zoom in and hold the map still, or pick a scene and press Trigger.'; list.appendChild(empty); }
                    return;
                }
                if (empty) empty.remove();
                const live = new Set(rows.map(a => a.id));
                for (const [id, r] of eggRows) if (!live.has(id)) { r.remove(); eggRows.delete(id); }
                for (const a of rows) {
                    let r = eggRows.get(a.id);
                    if (!r) {
                        r = document.createElement('button'); r.className = 'egg-row'; r.type = 'button';
                        r.innerHTML = '<span class="mini"><img draggable="false" alt="" src="' + DinoEgg.spriteSrc(a.sp.id) + '"></span><span class="meta"><b></b><small></small></span><span class="role"></span><span class="where"></span>';
                        r.querySelector('b').textContent = a.sp.short;
                        r.addEventListener('click', () => { eggGoTo(a); r.blur(); });
                        r.addEventListener('mouseenter', () => DinoEgg.highlight(a)); r.addEventListener('mouseleave', () => DinoEgg.highlight(null));
                        list.appendChild(r); eggRows.set(a.id, r);
                    }
                    const txt = DinoEgg.describe(a), where = a.vis ? 'on screen' : 'off screen', ro = DinoEgg.roleOf(a);
                    const small = r.querySelector('small'); if (small.textContent !== txt) small.textContent = txt;
                    const rl = r.querySelector('.role'); if (rl.textContent !== ro.label) { rl.textContent = ro.label; rl.className = 'role ' + ro.key; }
                    const w = r.querySelector('.where'); if (w.textContent !== where) { w.textContent = where; w.classList.toggle('off', !a.vis); }
                    r.classList.toggle('active', eggFollowTarget === a && eggFollow);
                }
            }
            function eggUpdateStatus(now) {
                const z = map.getZoom(), st = DinoEgg.state(); let cls = '', txt, bar = 0;
                if (now < eggFlashUntil) { cls = 'fire'; txt = eggFlashMsg; bar = 1; }
                else if (!st.autoTrigger) txt = 'Auto trigger off · zoom ' + z.toFixed(1);
                else if (st.sceneRunning) txt = 'Scene running · zoom ' + z.toFixed(1);
                else if (z < st.zoomTrigger) { txt = 'Zoom ' + z.toFixed(1) + ' · zoom in to ' + st.zoomTrigger.toFixed(1) + ' or closer'; bar = eggClamp(1 - (st.zoomTrigger - z) / 3, 0, 1) * .9; }
                else { txt = st.idleMs < st.idleNeedMs ? 'Zoom ' + z.toFixed(1) + ' ✓ · hold the map still…' : 'Incoming…'; bar = eggClamp(st.idleMs / st.idleNeedMs, 0, 1); }
                const el = document.getElementById('egg-status'); el.classList.toggle('fire', cls === 'fire');
                const t = document.getElementById('egg-status-txt'); if (t.textContent !== txt) t.textContent = txt;
                document.getElementById('egg-status-fill').style.width = (bar * 100).toFixed(1) + '%';
            }
            function eggUpdateUI(now, force) {
                if (!eggPanelOpen()) return;
                if (force || now - eggLastStatus > 120) { eggLastStatus = now; eggUpdateStatus(now); }
                if (force || now - eggLastList > 250) { eggLastList = now; eggUpdateList(); }
            }

            // ---- start the egg (lazy: after load, or on first open) ----
            function startEgg() {
                if (eggStarted || !eggEnabled) return;
                eggStarted = true;
                DinoEgg.init(eggHost, {
                    onAnnounce: (msg) => { eggFlashUntil = performance.now() + 4500; eggFlashMsg = msg; if (!eggPanelOpen()) showToast(msg, 'fa-dragon'); },
                    onSceneStart: () => { if (eggFollow) { const a = DinoEgg.actors()[0]; if (a) eggFlyTo(DinoEgg.latLngOf(a), 19); } },
                    onFrame: (now, dt) => { eggFollowCamera(dt || 0.016, now); eggUpdateUI(now, false); }
                });
                DinoEgg.set({ zoomTrigger: eggZoomTrig, sceneType: eggScene });
                for (const k of Object.keys(eggPrefs)) EGG_PREF_APPLY[k](eggPrefs[k]);
                eggGoreSel.innerHTML = '';
                DinoEgg.GORE.forEach((g, i) => { const o = document.createElement('option'); o.value = i; o.textContent = g.name; eggGoreSel.appendChild(o); });
                const g = eggClamp(+eggStore.get('gore', DinoEgg.goreLevel), 0, Math.max(0, DinoEgg.GORE.length - 1)); eggGoreSel.value = g; DinoEgg.set({ gore: g });
                const sc = +eggStore.get('scale', DinoEgg.displayScale), tm = +eggStore.get('time', DinoEgg.timeScale);
                eggSc.value = sc; eggTm.value = tm; DinoEgg.set({ displayScale: sc, timeScale: tm });
                document.getElementById('egg-scale-val').textContent = sc.toFixed(1) + '×'; document.getElementById('egg-time-val').textContent = tm + '×';
                // keep dinosaurs out of water: terrain from loaded HGT tiles (no terrain loaded = no restriction)
                DinoEgg.setWalkable((lat, lng) => { let e = null; try { e = getElevation(lat, lng); } catch (err) {} return e === null || e === undefined || isNaN(e) || e > 0.5; });
            }
            setTimeout(startEgg, 1500);


})();
