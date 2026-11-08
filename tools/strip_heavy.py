#!/usr/bin/env python3
"""
strip_heavy.py  —  move "HEAVY" blocks (the dinosaur easter egg, embedded base64 images, ...) out of a
single-file HTML app, leaving a small stub so the app still runs and can be tested.

    python strip_heavy.py app.html                 # strip every HEAVY block, in place
    python strip_heavy.py app.html --only dino-egg # strip just that block
    python strip_heavy.py app.html --dry-run       # show what would happen, change nothing
    python strip_heavy.py app.html --no-check      # skip the JavaScript syntax check

Undo with:  python restore_heavy.py app.html

Block format (markers must be at the start of their own line):

    /* HEAVY:BEGIN name */
    /* HEAVY:STUB
    const THING={};                 <- tiny replacement; same names/shape as the real thing; must not contain  */
    HEAVY:STUB-END */
    ...the big code or data...
    /* HEAVY:END name */

(For HTML-level blocks use  <!-- HEAVY:BEGIN name -->  <!-- HEAVY:STUB ... HEAVY:STUB-END -->  <!-- HEAVY:END name --> .)

The original block is saved byte-for-byte in  <file>.heavy/<name>.block  with a SHA-256 recorded in the file's
STRIPPED marker. Nothing is written unless the result passes a syntax check of the file's inline <script>s
(needs node on PATH; skipped with a note if node is missing).
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile

BEGIN = re.compile(r'^\s*(/\*|<!--)\s*HEAVY:BEGIN\s+([A-Za-z0-9_.-]+)')
END   = re.compile(r'^\s*(/\*|<!--)\s*HEAVY:END\s+([A-Za-z0-9_.-]+)')
STUB  = re.compile(r'^\s*(/\*|<!--)\s*HEAVY:STUB(?![-\w])')
STUBE = re.compile(r'HEAVY:STUB-END')
STRIPPED = re.compile(r'^\s*(/\*|<!--)\s*HEAVY:STRIPPED\s+([A-Za-z0-9_.-]+)')

def die(msg):
    print('ERROR: ' + msg, file=sys.stderr); sys.exit(1)

def syntax_check(text, label):
    """node --check every inline <script> (no src, not JSON). Returns None if ok / unavailable, else an error string."""
    node = shutil.which('node')
    if not node:
        return None
    for i, m in enumerate(re.finditer(r'<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>', text, re.S | re.I)):
        attrs, code = m.group(1), m.group(2)
        if re.search(r'type\s*=\s*["\'](?!text/javascript|module)', attrs, re.I):
            continue
        with tempfile.NamedTemporaryFile('w', suffix='.mjs' if 'module' in attrs else '.js', delete=False, encoding='utf-8') as f:
            f.write(code); path = f.name
        try:
            r = subprocess.run([node, '--check', path], capture_output=True, text=True)
        finally:
            os.unlink(path)
        if r.returncode:
            return f'{label}: inline <script> #{i+1} has a syntax error:\n{r.stderr.strip()[:600]}'
    return None

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('file'); ap.add_argument('--only', action='append', help='block name to strip (repeatable)')
    ap.add_argument('--dry-run', action='store_true'); ap.add_argument('--no-check', action='store_true')
    a = ap.parse_args()
    path = a.file
    if not os.path.isfile(path): die('file not found: ' + path)
    raw = open(path, 'rb').read()
    text = raw.decode('utf-8')
    lines = text.splitlines(keepends=True)
    stash = path + '.heavy'

    out, i, stripped = [], 0, []
    while i < len(lines):
        ln = lines[i]
        m = BEGIN.match(ln)
        if not m:
            e = END.match(ln)
            if e: die(f'line {i+1}: HEAVY:END {e.group(2)} without a matching BEGIN')
            out.append(ln); i += 1; continue
        style, name = m.group(1), m.group(2)
        if a.only and name not in a.only:
            # copy through untouched (still validate it closes)
            j = i
            while j < len(lines) and not (END.match(lines[j]) and END.match(lines[j]).group(2) == name): j += 1
            if j >= len(lines): die(f'HEAVY:BEGIN {name} (line {i+1}) has no HEAVY:END')
            out.extend(lines[i:j+1]); i = j + 1; continue
        j = i + 1
        while j < len(lines):
            e = END.match(lines[j])
            if e and e.group(2) == name: break
            if BEGIN.match(lines[j]): die(f'line {j+1}: HEAVY blocks cannot be nested (inside {name})')
            j += 1
        if j >= len(lines): die(f'HEAVY:BEGIN {name} (line {i+1}) has no HEAVY:END')
        block = lines[i:j+1]
        # find the stub
        s = next((k for k, b in enumerate(block) if STUB.match(b)), None)
        if s is None: die(f'block {name}: missing the /* HEAVY:STUB ... HEAVY:STUB-END */ section (needed so the app still runs when stripped)')
        e2 = next((k for k in range(s, len(block)) if STUBE.search(block[k])), None)
        if e2 is None: die(f'block {name}: HEAVY:STUB has no HEAVY:STUB-END')
        stub = block[s+1:e2]
        if not ''.join(stub).strip(): die(f'block {name}: the stub is empty')
        blob = ''.join(block).encode('utf-8')
        sha = hashlib.sha256(blob).hexdigest()
        close = ' */' if style == '/*' else ' -->'
        nl = '\r\n' if lines[i].endswith('\r\n') else '\n'
        head = (f'{style} HEAVY:STRIPPED {name} sha256={sha} bytes={len(blob)} lines={len(block)} — '
                f'STUB ONLY. Run restore_heavy.py to bring the real code back. Do not edit this line or the stub.{close}{nl}')
        tail = f'{style} HEAVY:STRIPPED-END {name}{close}{nl}'
        out.append(head); out.extend(stub); out.append(tail)
        stripped.append((name, blob, sha, len(block)))
        i = j + 1

    if not stripped:
        already = [STRIPPED.match(l).group(2) for l in lines if STRIPPED.match(l)]
        print('Nothing to strip.' + (f' Already stripped: {", ".join(already)}.' if already else ' No HEAVY blocks found.'))
        return
    new = ''.join(out)
    saved = len(raw) - len(new.encode('utf-8'))
    for name, blob, sha, n in stripped:
        print(f'  {name}: {len(blob)/1024:.0f} KB, {n} lines -> stub')
    print(f'File shrinks by {saved/1024:.0f} KB ({len(raw)/1024:.0f} KB -> {(len(raw)-saved)/1024:.0f} KB).')
    if not a.no_check:
        err = syntax_check(new, 'after stripping')
        if err: die(err + '\nNothing was written. Fix the stub (it must be valid JavaScript) or use --no-check.')
        if not shutil.which('node'): print('Note: node not found, syntax check skipped.')
    if a.dry_run:
        print('Dry run: nothing written.'); return
    os.makedirs(stash, exist_ok=True)
    manifest_path = os.path.join(stash, 'manifest.json')
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    for name, blob, sha, n in stripped:
        bp = os.path.join(stash, name + '.block')
        if os.path.exists(bp) and open(bp, 'rb').read() != blob:
            shutil.copyfile(bp, bp + '.prev')       # keep the one before, just in case
        open(bp, 'wb').write(blob)
        manifest[name] = {'sha256': sha, 'bytes': len(blob), 'lines': n}
    json.dump(manifest, open(manifest_path, 'w'), indent=1)
    open(path, 'wb').write(new.encode('utf-8'))
    print(f'Done. Blocks saved in {stash}{os.sep} — keep that folder next to the file.')

if __name__ == '__main__':
    main()
