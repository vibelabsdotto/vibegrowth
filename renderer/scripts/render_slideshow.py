#!/usr/bin/env python3
"""Render gym/photo or editorial paper slides from a JSON manifest.

Usage: python3 render_slideshow.py --manifest post.json --output-dir ./render
Use --no-video for JPGs, contact sheet and geometry report only.
Durations round up to the next 30fps frame. Explicit durations cannot bypass
reading-time or cover minimums. Photos contain-fit without cropping.
"""
import argparse
import json
import math
import random
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

WIDTH, HEIGHT, FPS = 1080, 1920, 30
FONT_ROOT = Path('/System/Library/Fonts/Supplemental')
# OFL fonts bundled with the skill (licences next to the files).
BUNDLED_FONTS = Path(__file__).resolve().parent.parent / 'assets' / 'fonts'
FONTS = {'body': FONT_ROOT / 'Arial.ttf', 'bold': FONT_ROOT / 'Arial Bold.ttf',
         'condensed': FONT_ROOT / 'DIN Condensed Bold.ttf',
         'display': BUNDLED_FONTS / 'BebasNeue-Regular.ttf',
         'sans': BUNDLED_FONTS / 'Montserrat-Medium.ttf',
         'sans-regular': BUNDLED_FONTS / 'Montserrat-Regular.ttf',
         'sans-semibold': BUNDLED_FONTS / 'Montserrat-SemiBold.ttf',
         'sans-bold': BUNDLED_FONTS / 'Montserrat-Bold.ttf',
         'sans-extrabold': BUNDLED_FONTS / 'Montserrat-ExtraBold.ttf',
         'sans-bolditalic': BUNDLED_FONTS / 'Montserrat-BoldItalic.ttf',
         'sans-extrabolditalic': BUNDLED_FONTS / 'Montserrat-ExtraBoldItalic.ttf'}
STYLES = ('gym', 'paper', 'native')
# native: TikTok-like white overlay text on the untouched photo at its own size.
NATIVE_FONT = Path('/System/Library/Fonts/HelveticaNeue.ttc')
NATIVE_FONT_INDEX = 10  # Helvetica Neue Medium
EMOJI_FONT = Path('/System/Library/Fonts/Apple Color Emoji.ttc')
EMOJI_STRIKE = 160  # Apple Color Emoji only renders at bitmap strike sizes
EMOJI_RE = re.compile('[\u2600-\u27bf\u2b00-\u2bff\U0001f000-\U0001faff\ufe0f\u200d]+')
# (headline max, headline min, body max, body min) at 1080 px image width
NATIVE_SIZES = {'cover': (66, 44, 40, 30), 'label': (50, 36, 34, 28), 'step': (44, 34, 34, 28)}


class LayoutError(ValueError):
    """Text cannot fit without violating the minimum legible size."""


def font_at(kind, size):
    if kind not in FONTS:
        raise ValueError(f'unknown font {kind!r}; use one of {sorted(FONTS)}')
    return ImageFont.truetype(str(FONTS[kind]), size)


def wrap_text(draw, text, font, width):
    """Wrap paragraphs and split oversize tokens without dropping characters."""
    lines = []
    for paragraph in text.split('\n'):
        current = ''
        for word in paragraph.split():
            if draw.textlength(word, font=font) > width:
                if current:
                    lines.append(current)
                    current = ''
                for char in word:
                    if draw.textlength(char, font=font) > width:
                        raise LayoutError('Text overflow: single character wider than column')
                    if draw.textlength(current + char, font=font) > width:
                        lines.append(current)
                        current = ''
                    current += char
            elif not current or draw.textlength(current + ' ' + word, font=font) <= width:
                current = (current + ' ' + word).strip()
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines


def fit_text(draw, text, kind, maximum, minimum, width, height, stroke=0, leading=1.25):
    if isinstance(leading, bool) or not isinstance(leading, (int, float)) or not 0.8 <= leading <= 2.5:
        raise ValueError('leading must be a number between 0.8 and 2.5')
    for size in range(maximum, minimum - 1, -1):
        font = font_at(kind, size)
        lines = wrap_text(draw, text, font, width - 2 * stroke)
        pitch = math.ceil(size * leading)
        ink_widths = [draw.textbbox((0, 0), line, font=font, anchor='lt')[2] - draw.textbbox((0, 0), line, font=font, anchor='lt')[0] for line in lines]
        if len(lines) * pitch + 2 * stroke <= height and max(ink_widths, default=0) + 2 * stroke <= width:
            return font, lines, pitch
    raise LayoutError(f'Text overflow at minimum {minimum}px in {width}x{height}: {text[:90]!r}')


def accent_spans(text, accents):
    """Map coloured accent phrases to spans of the whitespace-normalised text.

    Phrases may wrap across lines. A phrase that does not occur raises instead
    of silently rendering uncoloured.
    """
    normalised = '\n'.join(' '.join(p.split()) for p in text.split('\n'))
    if not isinstance(accents, list):
        raise ValueError('accents must be a list of {text, fill}')
    spans = []
    for item in accents:
        if not isinstance(item, dict) or not str(item.get('text', '')).strip() \
                or not isinstance(item.get('fill'), str) or not item['fill']:
            raise ValueError('each accent requires nonempty text and fill')
        phrase = ' '.join(str(item['text']).split())
        found = [(m.start(), m.end(), item['fill']) for m in re.finditer(
            r'(?<!\w)' + re.escape(phrase) + r'(?!\w)', normalised, re.IGNORECASE)]
        if not found:
            raise ValueError(f'accent not found in text: {phrase!r}')
        spans.extend(found)
    return normalised, spans


def draw_text_box(draw, text, box, kind='body', maximum=44, minimum=38,
                  fill='#171717', centered=False, stroke=0, accent=None, role='body',
                  accents=None, leading=1.25, underline=False):
    if not text:
        return [], 0
    x, y, right, bottom = box
    font, lines, pitch = fit_text(draw, text, kind, maximum, minimum, right-x, bottom-y, stroke, leading)
    normalised, spans = accent_spans(text, accents) if accents else ('', [])
    cursor = 0
    geometry = []
    for line in lines:
        ink = draw.textbbox((0, 0), line, font=font, anchor='lt')
        left = x + stroke - ink[0]
        if centered:
            left = (x + right - (ink[2] - ink[0])) / 2 - ink[0]
        # Anchor at ink top: all recorded bboxes include the contour.
        top = y + stroke
        bbox = draw.textbbox((left, top), line, font=font, anchor='lt', stroke_width=stroke)
        if line and (bbox[0] < x or bbox[2] > right or bbox[3] > bottom):
            raise LayoutError(f'Text overflow in {role}: {line!r}')
        draw.text((left, top), line, font=font, anchor='lt', fill=fill,
                  stroke_width=stroke, stroke_fill='black')
        if underline and line:
            under = bbox[3] + max(3, round(font.size * 0.08))
            draw.line((bbox[0], under, bbox[2], under), fill=fill, width=max(2, round(font.size * 0.07)))
        if accent:
            for match in re.finditer(r'(?<!\w)' + re.escape(accent) + r'(?!\w)', line, re.IGNORECASE):
                # Match the full line's baseline, not the word's own ink top.
                px = left + draw.textlength(line[:match.start()], font=font)
                baseline = top - draw.textbbox((0, 0), line, font=font, anchor='ls')[1]
                draw.text((px, baseline), match.group(), font=font, anchor='ls', fill='#c72d27')
        record = {'role': role, 'text': line, 'bbox': list(bbox), 'font_size': font.size}
        if spans:
            start = normalised.find(line, cursor) if line else cursor
            if start < 0:
                raise LayoutError(f'Accent mapping failed in {role}: {line!r}')
            end = cursor = start + len(line)
            baseline = top - draw.textbbox((0, 0), line, font=font, anchor='ls')[1]
            coloured = []
            for span_start, span_end, colour in sorted(spans):
                a, b = max(span_start, start), min(span_end, end)
                if a < b:
                    px = left + draw.textlength(line[:a-start], font=font)
                    draw.text((px, baseline), line[a-start:b-start], font=font, anchor='ls', fill=colour)
                    coloured.append({'text': line[a-start:b-start], 'fill': colour})
            if coloured:
                record['accents'] = coloured
        geometry.append(record)
        y += pitch
    return geometry, len(lines) * pitch + 2 * stroke


def all_text(slide):
    if slide.get('layout') == 'canvas':
        return '\n'.join(str(e.get('text', '')) for e in slide.get('elements', [])
                         if e.get('type') == 'text')
    return '\n'.join([slide.get('headline', ''), slide.get('body', '')] +
                     [b.get(k, '') for b in slide.get('blocks', []) for k in ('title', 'body')])


def duration_for(slide):
    reading = len(all_text(slide).split()) / 3 + 1
    cover = slide.get('layout') == 'cover' or (
        slide.get('layout') == 'canvas' and slide.get('role') in ('hook', 'cover'))
    requested = slide.get('duration', 5 if cover else max(12, min(16, reading)))
    if isinstance(requested, bool) or not isinstance(requested, (int, float)) or not math.isfinite(requested) or requested <= 0:
        raise ValueError('duration must be a finite positive number')
    return math.ceil(max(5 if cover else 0, reading, requested) * FPS) / FPS


def place_image(canvas, path, box, alpha=False, trim_alpha=True, crop=None, valign='bottom', halign='center'):
    """Contain-fit an image in box. crop=[x1,y1,x2,y2] as 0..1 fractions of the
    source, for own derived assets only (never crop third-party references)."""
    path = Path(path)
    if not path.is_absolute():
        raise ValueError(f'Image paths must be absolute: {path}')
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert('RGBA' if alpha else 'RGB')
    original_size = image.size
    if crop is not None:
        if (not isinstance(crop, list) or len(crop) != 4 or
                any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in crop) or
                not (0 <= crop[0] < crop[2] <= 1 and 0 <= crop[1] < crop[3] <= 1)):
            raise ValueError('crop must be [x1,y1,x2,y2] fractions with x1<x2, y1<y2 in 0..1')
        w, h = image.size
        image = image.crop((round(crop[0]*w), round(crop[1]*h), round(crop[2]*w), round(crop[3]*h)))
    if alpha and trim_alpha:
        bounds = image.getchannel('A').getbbox()
        if bounds is None:
            raise ValueError('Cutout has no visible pixels')
        image = image.crop(bounds)
    if valign not in ('top', 'center', 'bottom') or halign not in ('left', 'center', 'right'):
        raise ValueError('valign must be top|center|bottom, halign left|center|right')
    x, y, right, bottom = box
    image = ImageOps.contain(image, (right-x, bottom-y), Image.Resampling.LANCZOS)
    px = {'left': x, 'center': x + (right-x-image.width)//2, 'right': right-image.width}[halign]
    py = {'top': y, 'center': y + (bottom-y-image.height)//2, 'bottom': bottom-image.height}[valign]
    position = (px, py)
    canvas.paste(image, position, image if alpha else None)
    report = {'source': str(path), 'original_size': list(original_size), 'bbox': [*position, position[0]+image.width, position[1]+image.height], 'fit': 'contain'}
    if crop is not None:
        report['crop'] = crop
    return report


def background_canvas(path):
    """Cover-fit a texture plate (e.g. paper) to the full frame."""
    path = Path(path)
    if not path.is_absolute():
        raise ValueError(f'background path must be absolute: {path}')
    with Image.open(path) as source:
        plate = ImageOps.exif_transpose(source).convert('RGB')
    return ImageOps.fit(plate, (WIDTH, HEIGHT), Image.Resampling.LANCZOS)


def paper_canvas():
    rng = random.Random(173)
    grain = Image.new('RGB', (270, 480))
    grain.putdata([(244+n, 241+n, 233+n) for n in (rng.randrange(-3, 4) for _ in range(270*480))])
    return grain.resize((WIDTH, HEIGHT), Image.Resampling.BICUBIC)


def render_canvas(slide, handle=''):
    """Paper infographic canvas; explicit semantic elements, no fixed roles."""
    elements = slide.get('elements')
    if not isinstance(elements, list) or not elements:
        raise ValueError('canvas requires a nonempty elements list')
    canvas = background_canvas(slide['background']) if slide.get('background') else paper_canvas()
    draw = ImageDraw.Draw(canvas)
    geometry, images, element_report = [], [], []
    seen = set()
    for el in elements:
        element_id, kind = el.get('id'), el.get('type')
        if not element_id or element_id in seen:
            raise ValueError('canvas elements require unique nonempty ids')
        seen.add(element_id)
        box = el.get('box')
        if not isinstance(box, list) or len(box) != 4:
            raise ValueError(f'{element_id}: requires [x1,y1,x2,y2] box')
        if any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in box):
            raise ValueError(f'{element_id}: nonfinite canvas coordinates')
        x1, y1, x2, y2 = box
        if not all(0 <= x <= WIDTH for x in (x1, x2)) or not all(0 <= y <= HEIGHT for y in (y1, y2)):
            raise ValueError(f'{element_id}: canvas element outside frame')
        if kind not in ('line', 'arrow') and (x2 <= x1 or y2 <= y1):
            raise ValueError(f'{element_id}: empty canvas box')
        color = el.get('fill', '#1c1b18')
        start = len(geometry)
        if kind == 'text':
            records, _ = draw_text_box(draw, str(el.get('text', '')), box,
                                      kind=el.get('font', 'body'), maximum=el.get('size', 44),
                                      minimum=el.get('minimum', 36), fill=color,
                                      centered=el.get('align', 'left') == 'center',
                                      accent=el.get('accent'), accents=el.get('accents'),
                                      role=str(element_id), leading=el.get('leading', 1.25),
                                      underline=bool(el.get('underline', False)))
            geometry.extend(records)
        elif kind == 'image':
            source = el.get('path', '')
            if not source or not Path(source).is_absolute():
                raise ValueError(f'{element_id}: image path must be absolute')
            images.append(place_image(canvas, source, box, alpha=el.get('alpha', False),
                                      trim_alpha=el.get('trim_alpha', True), crop=el.get('crop'),
                                      valign=el.get('valign', 'bottom'), halign=el.get('halign', 'center')))
            images[-1]['element_id'] = element_id
        elif kind in ('line', 'arrow'):
            width = max(1, int(el.get('width', 4)))
            length = math.hypot(x2 - x1, y2 - y1)
            if not length:
                raise ValueError(f'{element_id}: zero-length line')
            draw.line(box, fill=color, width=width)
            if kind == 'arrow':
                ux, uy = (x2-x1)/length, (y2-y1)/length
                head = min(el.get('head', 22), length / 2)
                draw.polygon([(x2, y2), (x2-head*ux-head*.55*uy, y2-head*uy+head*.55*ux),
                              (x2-head*ux+head*.55*uy, y2-head*uy-head*.55*ux)], fill=color)
        elif kind in ('rect', 'ellipse'):
            outline_width = max(1, int(el.get('width', 1)))
            if kind == 'rect' and el.get('radius'):
                draw.rounded_rectangle(box, radius=int(el['radius']), fill=color,
                                       outline=el.get('outline'), width=outline_width)
            else:
                painter = draw.rectangle if kind == 'rect' else draw.ellipse
                painter(box, fill=color, outline=el.get('outline'), width=outline_width)
        else:
            raise ValueError(f'{element_id}: unsupported canvas element {kind!r}')
        for record in geometry[start:]:
            record['element_id'] = element_id
            record['region'] = box
        element_report.append({'id': element_id, 'type': kind, 'box': box})
    if handle and slide.get('show_handle', True):
        records, _ = draw_text_box(draw, handle, (80, 1790, 1000, 1860),
                                   maximum=27, minimum=27, fill='#555149', role='handle')
        geometry.extend(records)
    return canvas.convert('RGB'), {'text': all_text(slide), 'text_geometry': geometry,
                                  'images': images, 'elements': element_report}


def text_segments(text):
    """Split a line into (is_emoji, text) runs."""
    segments, cursor = [], 0
    for match in EMOJI_RE.finditer(text):
        if match.start() > cursor:
            segments.append((False, text[cursor:match.start()]))
        segments.append((True, match.group()))
        cursor = match.end()
    if cursor < len(text):
        segments.append((False, text[cursor:]))
    return segments


_EMOJI_CACHE = {}


def emoji_image(run, size):
    clean = run.replace('\ufe0f', '').replace('\u200d', '')
    key = (clean, size)
    if key not in _EMOJI_CACHE:
        font = ImageFont.truetype(str(EMOJI_FONT), EMOJI_STRIKE)
        width = max(1, math.ceil(font.getlength(clean)))
        strip = Image.new('RGBA', (width, EMOJI_STRIKE), (0, 0, 0, 0))
        ImageDraw.Draw(strip).text((0, 0), clean, font=font, embedded_color=True)
        scale = size / EMOJI_STRIKE
        _EMOJI_CACHE[key] = strip.resize((max(1, round(width * scale)), max(1, round(EMOJI_STRIKE * scale))),
                                         Image.Resampling.LANCZOS)
    return _EMOJI_CACHE[key]


def rich_width(text, font):
    return sum(emoji_image(part, font.size).width if is_emoji else font.getlength(part)
               for is_emoji, part in text_segments(text))


def wrap_rich(text, font, width):
    lines = []
    for paragraph in text.split('\n'):
        current = ''
        for word in paragraph.split():
            if rich_width(word, font) > width:
                raise LayoutError(f'Text overflow: word wider than column: {word!r}')
            candidate = (current + ' ' + word).strip()
            if not current or rich_width(candidate, font) <= width:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines


def fit_native(text, maximum, minimum, width):
    for size in range(maximum, minimum - 1, -1):
        font = ImageFont.truetype(str(NATIVE_FONT), size, index=NATIVE_FONT_INDEX)
        lines = wrap_rich(text, font, width)
        if max((rich_width(line, font) for line in lines), default=0) <= width:
            return font, lines
    raise LayoutError(f'Native text overflow at minimum {minimum}px: {text[:90]!r}')


def render_native(slide):
    """Original photo at its own size plus centered white TikTok-style text."""
    source = slide.get('image')
    if not source:
        raise ValueError('native style requires an image')
    path = Path(source)
    if not path.is_absolute():
        raise ValueError(f'Image paths must be absolute: {path}')
    with Image.open(path) as opened:
        canvas = ImageOps.exif_transpose(opened).convert('RGBA')
    width, height = canvas.size
    scale = width / 1080
    kind = slide.get('size', 'cover' if slide.get('layout') == 'cover' else 'label')
    if kind not in NATIVE_SIZES:
        raise ValueError(f'native size must be one of {sorted(NATIVE_SIZES)}')
    text_scale = slide.get('text_scale', 1)
    if isinstance(text_scale, bool) or not isinstance(text_scale, (int, float)) or not 0.8 <= text_scale <= 1.5:
        raise ValueError('text_scale must be a number between 0.8 and 1.5')
    head_max, head_min, body_max, body_min = (round(v * scale * text_scale) for v in NATIVE_SIZES[kind])
    column = round(slide.get('column', 860) * scale)
    blocks = []
    for field, maximum, minimum in (('headline', head_max, head_min), ('body', body_max, body_min)):
        text = slide.get(field, '')
        if not isinstance(text, str):
            raise ValueError(f'{field} must be text')
        if text:
            font, lines = fit_native(text, maximum, minimum, column)
            blocks.append((field, font, lines, math.ceil(font.size * 1.22)))
    gap = round(head_max * 0.3)
    total = sum(len(lines) * pitch for _, _, lines, pitch in blocks) + gap * max(0, len(blocks) - 1)
    position = slide.get('position', 'center')
    if position == 'top':
        top = 0.10 * height
    elif position == 'bottom':
        top = 0.84 * height - total
    elif position == 'center':
        top = 0.5 * height - total / 2
    elif isinstance(position, (int, float)) and not isinstance(position, bool) and 0 < position < 1:
        top = position * height - total / 2
    else:
        raise ValueError('position must be top, center, bottom or a fraction between 0 and 1')
    top = round(min(max(top, 0.04 * height), 0.94 * height - total))
    text_layer = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    shadow_layer = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    text_draw, shadow_draw = ImageDraw.Draw(text_layer), ImageDraw.Draw(shadow_layer)
    stroke = max(1, round(2 * scale))
    geometry, y = [], top
    for index, (field, font, lines, pitch) in enumerate(blocks):
        ascent, _ = font.getmetrics()
        for line in lines:
            line_width = rich_width(line, font)
            x = (width - line_width) / 2
            baseline = y + ascent
            for is_emoji, part in text_segments(line):
                if is_emoji:
                    glyph = emoji_image(part, font.size)
                    text_layer.alpha_composite(glyph, (round(x), round(baseline - font.size * 0.9)))
                    x += glyph.width
                else:
                    shadow_draw.text((x, baseline + 2 * scale), part, font=font, anchor='ls', fill=(0, 0, 0, 150))
                    text_draw.text((x, baseline), part, font=font, anchor='ls', fill=(255, 255, 255, 255),
                                   stroke_width=stroke, stroke_fill=(0, 0, 0, 80))
                    x += font.getlength(part)
            box = [round((width - line_width) / 2) - stroke, round(y), round((width + line_width) / 2) + stroke, round(y + pitch)]
            if line and (box[0] < 0 or box[2] > width or box[1] < 0 or box[3] > height):
                raise LayoutError(f'Native text outside frame: {line!r}')
            geometry.append({'role': field, 'text': line, 'bbox': box, 'font_size': font.size})
            y += pitch
        if index < len(blocks) - 1:
            y += gap
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(max(1, 4 * scale)))
    canvas = Image.alpha_composite(Image.alpha_composite(canvas, shadow_layer), text_layer).convert('RGB')
    return canvas, {'text': all_text(slide), 'text_geometry': geometry,
                    'images': [{'source': str(path), 'original_size': [width, height],
                                'bbox': [0, 0, width, height], 'fit': 'original'}]}


def render_slide(slide, style, handle=''):
    if style not in STYLES:
        raise ValueError('style must be gym, paper or native')
    if style == 'native':
        if slide.get('layout', 'text') not in ('cover', 'text'):
            raise ValueError('native layout must be cover or text')
        return render_native(slide)
    if slide.get('layout') == 'canvas':
        if style != 'paper':
            raise ValueError('canvas layout currently requires paper style')
        return render_canvas(slide, handle)
    if slide.get('layout', 'text') not in ('cover', 'text', 'list', 'closing'):
        raise ValueError('Unknown slide layout')
    for field in ('headline', 'body'):
        if not isinstance(slide.get(field, ''), str):
            raise ValueError(f'{field} must be text')
    cover = slide.get('layout') == 'cover'
    canvas = Image.new('RGB', (WIDTH, HEIGHT), '#101114') if style == 'gym' else paper_canvas()
    report = {'text': all_text(slide), 'text_geometry': [], 'images': []}
    if style == 'gym' and slide.get('image'):
        report['images'].append(place_image(canvas, slide['image'], (0, 0, WIDTH, HEIGHT)))
    if style == 'paper' and slide.get('image') and not slide.get('cutout'):
        report['images'].append(place_image(canvas, slide['image'], (80, 1210, 1000, 1780)))
    if slide.get('cutout'):
        cutout_top = 850 if cover and not slide.get('body') else 1210
        report['images'].append(place_image(canvas, slide['cutout'], (120, cutout_top, 960, 1750), alpha=True))
    if style == 'gym':
        overlay = Image.new('RGBA', canvas.size)
        scrim = ImageDraw.Draw(overlay)
        for y in range(910, 1700):
            opacity = int(155 * min(1, (y-910)/100, (1700-y)/120))
            scrim.line((0, y, WIDTH, y), fill=(0, 0, 0, max(0, opacity)))
        canvas = Image.alpha_composite(canvas.convert('RGBA'), overlay).convert('RGB')
    draw = ImageDraw.Draw(canvas)
    def put(text, box, **kwargs):
        geometry, height = draw_text_box(draw, text, box, **kwargs)
        report['text_geometry'].extend(geometry)
        return height
    if style == 'gym':
        body = slide.get('body', '')
        if slide.get('blocks'):
            body += ('\n\n' if body else '') + '\n\n'.join(b.get('title', '')+'\n'+b.get('body', '') for b in slide['blocks'])
        headline_height = put(slide.get('headline', ''), (80, 1000, 1000, 1380 if cover else 1260),
                             kind='bold', maximum=76 if cover else 64, minimum=56,
                             centered=True, fill='white', stroke=3, role='headline')
        put(body, (90, 1000+headline_height+34, 990, 1590), maximum=44, minimum=38,
            centered=True, fill='white', stroke=2)
    else:
        put('BULKING, EXPLAINED', (80, 90, 1000, 135), maximum=24, minimum=24, fill='#55514a', role='eyebrow')
        headline_box = (80, 240, 1000, 800) if cover and not slide.get('body') else (80, 200, 1000, 540)
        put(slide.get('headline', ''), headline_box, kind='condensed', maximum=150 if cover and not slide.get('body') else 110,
            minimum=56, accent=slide.get('accent'), role='headline')
        bottom = 1160 if report['images'] else 1730
        blocks = slide.get('blocks', [])
        body = slide.get('body', '')
        if blocks:
            # Allocate by measured line demand, with a single global body font size.
            for size in range(52, 37, -1):
                demands = []
                if body:
                    demands.append(len(wrap_text(draw, body, font_at('body', size), 920))*math.ceil(size*1.25)+36)
                for block in blocks:
                    demands.append(len(wrap_text(draw, block.get('title', ''), font_at('bold', size+4), 820))*math.ceil((size+4)*1.25) + len(wrap_text(draw, block.get('body', ''), font_at('body', size), 820))*math.ceil(size*1.25)+64)
                if sum(demands) <= bottom-600:
                    break
            else:
                raise LayoutError('Paper blocks overflow at minimum body 38px')
            y = 600
            if body:
                y += put(body, (80, y, 1000, bottom), maximum=size, minimum=size)+36
            for index, block in enumerate(blocks, 1):
                draw.line((80, y, 1000, y), fill='#99958c', width=1)
                y += 24
                put(f'{index:02}', (80, y, 160, y+70), kind='condensed', maximum=48, minimum=48, fill='#c72d27', role='number')
                y += put(block.get('title', ''), (180, y, 1000, bottom), kind='bold', maximum=size+4, minimum=size+4, role='block_title')
                y += 12
                y += put(block.get('body', ''), (180, y, 1000, bottom), maximum=size, minimum=size)+28
        else:
            put(body, (80, 600, 1000, bottom), maximum=52, minimum=38)
    if handle:
        put(handle, (80, 1810, 1000, 1870), maximum=27, minimum=27,
            centered=(style == 'gym'), fill='white' if style == 'gym' else '#55514a', role='handle')
    return canvas, report


def export_video(slides, destination, size=(WIDTH, HEIGHT)):
    if not shutil.which('ffmpeg'):
        raise RuntimeError('ffmpeg is required; install it or use --no-video')
    w, h = size[0] - size[0] % 2, size[1] - size[1] % 2  # H.264 4:2:0 needs even dimensions
    video_filter = (f'scale={w}:{h}:force_original_aspect_ratio=decrease:in_range=full:out_range=tv,'
                    f'pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,format=yuv420p')
    with tempfile.TemporaryDirectory(prefix='slideshow-') as temp:
        temp = Path(temp)
        for index, slide in enumerate(slides):
            clip = temp / f'{index:04}.mp4'
            frames = round(slide['duration'] * FPS)
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-framerate', str(FPS), '-i', slide['path'], '-frames:v', str(frames), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '20', '-vf', video_filter, '-color_range', 'tv', '-pix_fmt', 'yuv420p', str(clip)], check=True)
        concat = temp / 'clips.txt'
        concat.write_text(''.join(f"file '{index:04}.mp4'\n" for index in range(len(slides))))
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(concat), '-c', 'copy', '-an', '-movflags', '+faststart', str(destination)], check=True)


def render_manifest(manifest, output_dir, video=True):
    identifier = manifest.get('id', '')
    if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', identifier):
        raise ValueError('id must be a safe filename using letters, numbers, _, . or -')
    slides = manifest.get('slides')
    if not isinstance(slides, list) or not slides:
        raise ValueError('slides must be a nonempty list')
    style = manifest.get('style')
    out = Path(output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    report = {'id': identifier, 'style': style, 'width': WIDTH, 'height': HEIGHT, 'fps': FPS, 'slides': []}
    thumbs = []
    for index, source in enumerate(slides, 1):
        try:
            image, item = render_slide(source, style, manifest.get('handle', ''))
            item['duration'] = duration_for(source)
        except (ValueError, OSError) as exc:
            raise ValueError(f'Slide {index}: {exc}') from exc
        path = out / f'{identifier}-{index:02}.jpg'
        image.save(path, quality=95, subsampling=0)
        item.update({'index': index, 'path': str(path), 'size': list(image.size)})
        report['slides'].append(item)
        thumbs.append(image.resize((216, round(216 * image.height / image.width)), Image.Resampling.LANCZOS))
    report['width'], report['height'] = report['slides'][0]['size']
    columns = min(5, len(thumbs))
    cell = max(thumb.height for thumb in thumbs)
    sheet = Image.new('RGB', (columns*216, math.ceil(len(thumbs)/columns)*cell), '#242424')
    for i, thumb in enumerate(thumbs):
        sheet.paste(thumb, ((i % columns)*216, (i // columns)*cell))
    sheet.save(out / 'contact-sheet.jpg', quality=92)
    report['duration'] = sum(s['duration'] for s in report['slides'])
    report['video'] = None
    if video:
        destination = out / f'{identifier}.mp4'
        export_video(report['slides'], destination, (report['width'], report['height']))
        report['video'] = str(destination)
    (out / 'render-report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False)+'\n')
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--no-video', action='store_true')
    args = parser.parse_args(argv)
    try:
        manifest = json.loads(args.manifest.read_text())
        report = render_manifest(manifest, args.output_dir, video=not args.no_video)
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(2, f'ERROR: {exc}\n')
    print(json.dumps({'slides': len(report['slides']), 'duration': report['duration'], 'video': report['video'], 'report': str(args.output_dir.resolve() / 'render-report.json')}, indent=2))


if __name__ == '__main__':
    main()
