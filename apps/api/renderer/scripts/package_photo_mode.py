#!/usr/bin/env python3
"""Upload ZIP for a photo-mode post (TikTok photo carousel).

  python3 package_photo_mode.py --post /abs/post-dir --zip jule-photo-mode.zip

Takes the rendered slide JPGs in the order of <post>/render/render-report.json and writes
<post>/<zip> with slides/01.jpg … slides/NN.jpg plus caption.txt and upload-readme.txt when
present. Overwrites an existing ZIP of the same name. Prints a JSON summary.
"""
import argparse, json, sys, zipfile
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('--post', required=True)
ap.add_argument('--zip', required=True)
a = ap.parse_args()

post = Path(a.post)
report = json.load(open(post / 'render' / 'render-report.json'))
slides = [Path(s['path']) for s in sorted(report['slides'], key=lambda s: s['index'])]
missing = [str(p) for p in slides if not p.exists()]
if not slides or missing:
    print(json.dumps({'ok': False, 'error': 'slides_missing', 'missing': missing}))
    sys.exit(1)
width = max(2, len(str(len(slides))))
target = post / a.zip
tmp = target.with_suffix('.zip.tmp')
with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
    for i, p in enumerate(slides, 1):
        z.write(p, f'slides/{i:0{width}d}.jpg')
    for extra in ('caption.txt', 'upload-readme.txt'):
        if (post / extra).exists():
            z.write(post / extra, extra)
tmp.replace(target)
names = zipfile.ZipFile(target).namelist()
print(json.dumps({'ok': True, 'zip': str(target), 'slides': len(slides),
                  'caption': 'caption.txt' in names, 'files': len(names)}, ensure_ascii=False))
