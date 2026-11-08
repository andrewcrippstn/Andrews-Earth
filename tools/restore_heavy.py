#!/usr/bin/env python3
"""
restore_heavy.py  —  put back the HEAVY blocks that strip_heavy.py removed.

    python restore_heavy.py app.html                    # restore every stripped block, in place
    python restore_heavy.py app.html --only dino-egg    # restore just that block
    python restore_heavy.py app.html --status           # list what is stripped / present
    python restore_heavy.py app.html --stash DIR        # use a different stash folder (default: app.html.heavy)
    python restore_heavy.py app.html --no-check         # skip the JavaScript syntax check

Each block is verified against the SHA-256 recorded in the file's STRIPPED marker before it is put back, and the
restored file's inline <script>s get a syntax check (needs node on PATH). Nothing is written if anything fails.
"""
import argparse, hashlib, os, re, shutil, subprocess, sys, tempfile

BEGIN = re.compile(r'^\s*(/\*|<!--)\s*HEAVY:BEGIN\s+([A-Za-z0-9_.-]+)')
STRIPPED = re.compile(r'^\s*(/\*|<!--)\s*HEAVY:STRIPPED\s+([A-Za-z0-9_.-]+)\s+sha256=([0-9a-f]{64})')
STRIPPED_END = re.compile(r'^\s*(/\*|<!--)\s*HEAVY:STRIPPED-END\s+([A-Za-z0-9_.-]+)')

def die(msg):
    print('ERROR: ' + msg, file=sys.stderr); sys.exit(1)

def syntax_check(text, label):
    node = shutil.which('node')
    if not node: return None
    for i, m in enumerate(re.finditer(r'<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>', text, re.S | re.I)):
        attrs, code = m.group(1), m.group(2)
        if re.search(r'type\s*=\s*["\'](?!text/javascript|module)', attrs, re.I): continue
        with tempfile.NamedTemporaryFile('w', suffix='.mjs' if 'module' in attrs else '.js', delete=False, encoding='utf-8') as f:
            f.write(code); p = f.name
        try: r = subprocess.run([node, '--check', p], capture_output=True, text=True)
        finally: os.unlink(p)
        if r.returncode:
            return f'{label}: inline <script> #{i+1} has a syntax error:\n{r.stderr.strip()[:600]}'
    return None

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('file'); ap.add_argument('--only', action='append'); ap.add_argument('--stash')
    ap.add_argument('--status', action='store_true'); ap.add_argument('--no-check', action='store_true')
    a = ap.parse_args()
    path = a.file
    if not os.path.isfile(path): die('file not found: ' + path)
    text = open(path, 'rb').read().decode('utf-8')
    lines = text.splitlines(keepends=True)
    stash = a.stash or path + '.heavy'

    present = [BEGIN.match(l).group(2) for l in lines if BEGIN.match(l)]
    stripped = [(STRIPPED.match(l).group(2), STRIPPED.match(l).group(3)) for l in lines if STRIPPED.match(l)]
    if a.status:
        print('Present (full code in file):', ', '.join(present) or '-')
        print('Stripped (stub in file):    ', ', '.join(n for n, _ in stripped) or '-')
        for n, _ in stripped:
            print(f'  stash for {n}: ' + ('found' if os.path.exists(os.path.join(stash, n + '.block')) else 'MISSING'))
        return
    if not stripped:
        print('Nothing to restore.' + (f' Already present: {", ".join(present)}.' if present else '')); return

    out, i, done = [], 0, []
    while i < len(lines):
        m = STRIPPED.match(lines[i])
        if not m:
            out.append(lines[i]); i += 1; continue
        name, sha = m.group(2), m.group(3)
        j = i + 1
        while j < len(lines):
            e = STRIPPED_END.match(lines[j])
            if e and e.group(2) == name: break
            j += 1
        if j >= len(lines): die(f'STRIPPED {name} (line {i+1}) has no STRIPPED-END marker. Was the marker line edited?')
        if a.only and name not in a.only:
            out.extend(lines[i:j+1]); i = j + 1; continue
        bp = os.path.join(stash, name + '.block')
        if not os.path.exists(bp): die(f'stash file missing: {bp}\nKeep the "{os.path.basename(stash)}" folder next to the HTML file (or pass --stash).')
        blob = open(bp, 'rb').read()
        if hashlib.sha256(blob).hexdigest() != sha:
            die(f'{bp} does not match the checksum recorded in the file for block {name}.\n'
                f'It was probably stripped again after a different version. A previous copy may exist as {bp}.prev.')
        out.append(blob.decode('utf-8')); done.append((name, len(blob)))
        i = j + 1
    new = ''.join(out)
    if not a.no_check:
        err = syntax_check(new, 'after restoring')
        if err: die(err + '\nNothing was written.')
        if not shutil.which('node'): print('Note: node not found, syntax check skipped.')
    open(path, 'wb').write(new.encode('utf-8'))
    for n, b in done: print(f'  restored {n}: {b/1024:.0f} KB')
    print('Done.')

if __name__ == '__main__':
    main()
