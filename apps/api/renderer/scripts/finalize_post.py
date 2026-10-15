#!/usr/bin/env python3
"""Final render + technical QA + upload ZIP for a canvas post (Modern-Man format).

  python3 finalize_post.py --post /abs/post-dir --stem jona-weekend --zip weekend-upload.zip

Steps: render (with video) into <post>/render, ffprobe + full decode, one MP4 frame per slide
compared to its JPG (and to the neighbour slide), exact text check manifest -> render report,
video-QA contact sheet, ZIP (JPGs + caption.txt + MP4). Writes/updates <post>/qa.json (keeps
existing keys such as visual_checks). Technical QA only; creative review stays separate.
"""
import argparse, json, subprocess, sys, zipfile
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

HERE = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument('--post', required=True)
ap.add_argument('--stem', required=True)
ap.add_argument('--zip', required=True)
a = ap.parse_args()

post = Path(a.post)
R = post / 'render'
if R.exists():
    for f in R.iterdir():
        f.unlink()
r = subprocess.run([sys.executable, str(HERE / 'render_slideshow.py'), '--manifest', str(post / 'render-manifest.json'),
                    '--output-dir', str(R)], capture_output=True, text=True)
if r.returncode != 0 or 'ERROR' in r.stdout + r.stderr:
    print(r.stdout[-2000:], r.stderr[-2000:]); sys.exit(1)
mp4 = R / f'{a.stem}.mp4'
pr = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(mp4)],
                               capture_output=True, text=True).stdout)
v = [s for s in pr['streams'] if s['codec_type'] == 'video'][0]
dec = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(mp4), '-f', 'null', '-'], capture_output=True, text=True).stderr
rep = json.load(open(R / 'render-report.json'))
man = json.load(open(post / 'render-manifest.json'))
n = len(rep['slides']); t = 0
for i, s in enumerate(rep['slides'], 1):
    mid = t + s['duration'] / 2; t += s['duration']
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{mid:.2f}', '-i', str(mp4), '-frames:v', '1', str(R / f'qa-frame-{i:02d}.jpg')])
diffs, nb = [], []
for i in range(1, n + 1):
    fr = Image.open(R / f'qa-frame-{i:02d}.jpg').convert('L')
    diffs.append(round(ImageStat.Stat(ImageChops.difference(fr, Image.open(R / f'{a.stem}-{i:02d}.jpg').convert('L'))).mean[0], 2))
    nb.append(round(ImageStat.Stat(ImageChops.difference(fr, Image.open(R / f'{a.stem}-{i % n + 1:02d}.jpg').convert('L'))).mean[0], 1))
texts = [e['text'] for s in man['slides'] for e in s['elements'] if e['type'] == 'text']
rs = json.dumps(rep, ensure_ascii=False)
missing = [x for x in texts if json.dumps(x, ensure_ascii=False)[1:-1] not in rs]
W, H = 270, 480
sh = Image.new('RGB', (W * n + 10 * (n - 1), H * 2 + 10), 'white')
for i in range(1, n + 1):
    sh.paste(Image.open(R / f'{a.stem}-{i:02d}.jpg').convert('RGB').resize((W, H)), ((i - 1) * (W + 10), 0))
    sh.paste(Image.open(R / f'qa-frame-{i:02d}.jpg').convert('RGB').resize((W, H)), ((i - 1) * (W + 10), H + 10))
sh.save(R / 'video-qa-contact-sheet.jpg', quality=85)
sizes = [e['size'] for s in man['slides'] for e in s['elements'] if e['type'] == 'text'
         and not e['id'].startswith(('hdr', 'footer', 'source'))]
qa_path = post / 'qa.json'
q = json.load(open(qa_path)) if qa_path.exists() else {}
q.update({'mp4': {'w': v['width'], 'h': v['height'], 'codec': v['codec_name'], 'pix_fmt': v['pix_fmt'], 'fps': v['r_frame_rate'],
                  'audio_streams': sum(1 for s in pr['streams'] if s['codec_type'] == 'audio')},
          'duration': round(float(pr['format']['duration']), 2), 'decode_ok': dec == '',
          'slide_durations': [round(s['duration'], 2) for s in rep['slides']],
          'frame_vs_still_mean_diff': diffs, 'frame_vs_neighbour_mean_diff': nb,
          'text_elements': len(texts), 'text_elements_exact': not missing, 'missing': missing,
          'min_text_px_excl_header_footer_source': min(sizes)})
json.dump(q, open(qa_path, 'w'), indent=1, ensure_ascii=False)
cap = post / 'caption.txt'
zp = post / a.zip
with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
    for i in range(1, n + 1):
        z.write(R / f'{a.stem}-{i:02d}.jpg', f'{a.stem}-{i:02d}.jpg')
    if cap.exists():
        z.write(cap, 'caption.txt')
    z.write(mp4, mp4.name)
ok = q['decode_ok'] and not missing and v['pix_fmt'] == 'yuv420p' and max(diffs) < 8 and min(nb) > max(diffs) * 2
print(json.dumps({'post': post.name, 'ok': ok, 'slides': n, 'duration': q['duration'], 'durations': q['slide_durations'],
                  'diffs': diffs, 'neighbour': nb, 'texts': len(texts), 'missing': missing, 'min_px': min(sizes),
                  'pix_fmt': v['pix_fmt'], 'zip': str(zp), 'zip_files': len(zipfile.ZipFile(zp).namelist())}, ensure_ascii=False))
sys.exit(0 if ok else 2)
