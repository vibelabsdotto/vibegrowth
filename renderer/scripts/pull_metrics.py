#!/usr/bin/env python3
"""Fetch public TikTok stats for one account and match posts to local folders.

Called by `vibeshorts metrics pull`. Reads a JSON job from stdin, prints a JSON
result to stdout. Storage, locking and freshness live in the CLI.

Job:    {"handle": "jule.vegan", "account_dir": "/abs/amelie/jule",
         "known": {"<tiktok id>": {"post": "<folder>|null", "dist": 3, "checked": 1}},
         "tiktok_pull": "/abs/path/to/tiktok_pull.py"}
Result: {"items": [{id, url, created_at, plays, likes, comments, shares, saves, reposts,
                    desc, slides, age_h, post_dir, match_dist}], "known": {...}}

Logic ported from the content-autopilot pull_performance.py:
  1. /embed/@handle       -> newest post IDs (no browser, no signature)
  2. /@handle/video/<id>  -> stats, createTime, caption, first image (works for photo posts)
  3. dHash (16x16) of slide 1 against each local post folder's first slide, max distance 30
  4. three attempts per request (0 s, 6 s, 20 s), unmatched IDs are re-checked up to 3 times

The TikTok session (curl_cffi impersonation and the cookie jar) comes from the
tiktok_pull.py module passed in the job, so cookies never live in this repo.
"""
import glob
import importlib.util
import io
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

JOB = json.loads(os.environ.get('VIBESHORTS_JOB') or sys.stdin.read())

try:
    from PIL import Image
    _spec = importlib.util.spec_from_file_location('tp', JOB['tiktok_pull'])
    tp = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(tp)
except Exception:
    # The Homebrew yt-dlp Python ships curl_cffi; re-exec there once if this interpreter lacks it.
    brew = sorted(glob.glob('/opt/homebrew/Cellar/yt-dlp/*/libexec/bin/python'))
    if brew and not os.environ.get('VIBESHORTS_REEXEC'):
        os.environ['VIBESHORTS_REEXEC'] = '1'
        os.environ['VIBESHORTS_JOB'] = json.dumps(JOB)
        os.execv(brew[-1], [brew[-1], __file__])
    raise

SLEEP = 2.5
MATCH_MAX_DIST = 30
NOW = datetime.now(timezone.utc)
JAR = tp.load_jar()


def get(url):
    last = None
    for wait in (0, 6, 20):
        time.sleep(wait)
        try:
            r = tp.cr.get(url, timeout=25, impersonate=tp.TARGET, cookies=JAR, headers=tp.UA_LANG)
        except Exception as e:
            last = e
            continue
        time.sleep(SLEEP)
        if r.status_code < 500 and ('__FRONTITY_CONNECT_STATE__' in r.text or '__UNIVERSAL_DATA_FOR_REHYDRATION__' in r.text):
            return r
        last = r
    if isinstance(last, Exception):
        raise last
    return last


def embed_ids(handle):
    r = get(f'https://www.tiktok.com/embed/@{handle}')
    m = re.search(r'<script id="__FRONTITY_CONNECT_STATE__"[^>]*>(.*?)</script>', r.text, re.S)
    if not m:
        raise RuntimeError(f'Embed-Seite ohne Daten (HTTP {r.status_code})')
    data = json.loads(m.group(1))
    for key, val in data.get('source', {}).get('data', {}).items():
        if key.startswith('/embed/@') and isinstance(val, dict) and 'videoList' in val:
            return [v['id'] for v in val['videoList'] if not v.get('privateItem')]
    return []


def item(handle, vid):
    r = get(f'https://www.tiktok.com/@{handle}/video/{vid}')
    m = re.search(r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>', r.text, re.S)
    if not m:
        raise RuntimeError(f'{vid}: keine Seitendaten (HTTP {r.status_code})')
    scope = json.loads(m.group(1)).get('__DEFAULT_SCOPE__', {})
    it = scope.get('webapp.video-detail', {}).get('itemInfo', {}).get('itemStruct')
    if not it:
        raise RuntimeError(f'{vid}: video-detail fehlt')
    st = it.get('statsV2') or it.get('stats') or {}
    n = lambda k: int(st.get(k) or 0)
    images = (it.get('imagePost') or {}).get('images') or []
    cover = None
    if images:
        urls = images[0].get('imageURL', {}).get('urlList') or []
        cover = urls[0] if urls else None
    if not cover:
        cover = (it.get('video') or {}).get('cover') or (it.get('video') or {}).get('originCover')
    created = datetime.fromtimestamp(int(it.get('createTime', 0)), timezone.utc)
    return {
        'id': vid,
        'url': f'https://www.tiktok.com/@{handle}/{"photo" if images else "video"}/{vid}',
        'created_at': created.isoformat(),
        'plays': n('playCount'), 'likes': n('diggCount'), 'comments': n('commentCount'),
        'shares': n('shareCount'), 'saves': n('collectCount'), 'reposts': n('repostCount'),
        'desc': (it.get('desc') or '').strip(), 'slides': len(images) or None, 'cover': cover,
        'age_h': round((NOW - created).total_seconds() / 3600, 1),
    }


def dhash(img, size=16):
    g = img.convert('L').resize((size + 1, size), Image.LANCZOS)
    px = list(g.get_flattened_data() if hasattr(g, 'get_flattened_data') else g.getdata())
    bits = []
    for y in range(size):
        row = px[y * (size + 1):(y + 1) * (size + 1)]
        bits += [1 if row[x] > row[x + 1] else 0 for x in range(size)]
    return bits


def first_slide(post):
    for pat in ('render/slides/01.jpg', 'render/01.jpg', 'slides/01.jpg', 'render/*01*.jpg', 'render/*.jpg'):
        hits = sorted(p for p in post.glob(pat) if 'contact' not in p.name)
        if hits:
            return hits[0]
    return None


def post_hashes(acc_dir):
    out = {}
    for post in sorted((acc_dir / 'posts').glob('20*')):
        if not post.is_dir():
            continue
        f = first_slide(post)
        if f:
            try:
                out[post.name] = dhash(Image.open(f))
            except Exception:
                pass
    return out


def match(cover_url, hashes):
    if not cover_url or not hashes:
        return None, None
    r = tp.cr.get(cover_url, timeout=25, impersonate=tp.TARGET, headers={'Referer': 'https://www.tiktok.com/'})
    h = dhash(Image.open(io.BytesIO(r.content)))
    best = min(((sum(x != y for x, y in zip(h, ph)), name) for name, ph in hashes.items()), default=(None, None))
    if best[0] is not None and best[0] <= MATCH_MAX_DIST:
        return best[1], best[0]
    return None, best[0]


def main():
    acc_dir = Path(JOB['account_dir'])
    known = JOB.get('known') or {}
    hashes = None
    items = []
    for vid in embed_ids(JOB['handle']):
        it = item(JOB['handle'], vid)
        c = known.get(vid)
        if c is None or (c.get('post') is None and c.get('checked', 0) < 3):
            if hashes is None:
                hashes = post_hashes(acc_dir)
            post, d = match(it['cover'], hashes)
            c = {'post': post, 'dist': d, 'checked': (c or {}).get('checked', 0) + 1}
            known[vid] = c
        rec = {k: v for k, v in it.items() if k != 'cover'}
        rec.update({'post_dir': c.get('post'), 'match_dist': c.get('dist')})
        items.append(rec)
    print(json.dumps({'items': items, 'known': known}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'{type(e).__name__}: {e}', file=sys.stderr)
        sys.exit(1)
