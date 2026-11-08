#!/usr/bin/env python3
"""check_egg_hooks.py - verify that index.html still contains everything the optional Dino Tracker needs.
    python tools/check_egg_hooks.py index.html
Exit code 0 = hooks intact. Works with or without the dino-egg/ folder (the folder is optional)."""
import os,re,sys
p=sys.argv[1] if len(sys.argv)>1 else 'index.html'
t=open(p,encoding='utf-8').read();bad=[]
def need(c,m):
    if not c:bad.append(m)
need('EGG-HOOK:BEGIN loader' in t and 'EGG-HOOK:END loader' in t,'loader markers (EGG-HOOK:BEGIN/END loader)')
need('EGG-HOOK dock' in t and "getElementById('egg-panel')" in t,'dock hook in syncInspectorClass')
need('EGG-HOOK palette' in t and 'window.DinoTracker' in t,'command-palette hook')
m=re.search(r'window\.AE_EGG_HOST\s*=\s*\{(.*?)\n            \};',t,re.S)
need(m,'window.AE_EGG_HOST object')
if m:
    for k in ['apiVersion: 1','map','mapAreaEl','editorPanel','closeEditorPanel','showToast','getElevation','syncDock','overlayPanelIds']:
        need(re.search(r'(^|[\s,{])'+re.escape(k),m.group(1)),'AE_EGG_HOST.'+k)
for f in ['dino-sprites.js','dino-egg.js','dino-ae-ui.js']:
    need("'"+f+"'" in t,'loader lists '+f)
need('id="map"' in t and 'class="map-area"' in t,'#map inside .map-area')
d=os.path.join(os.path.dirname(os.path.abspath(p)),'dino-egg')
print('dino-egg/ folder:',('present: '+', '.join(sorted(os.listdir(d)))) if os.path.isdir(d) else 'not present (optional - app runs without it)')
if bad:
    print('MISSING / BROKEN:');[print('  -',b) for b in bad];sys.exit(1)
print('OK: Dino Tracker hooks intact');
