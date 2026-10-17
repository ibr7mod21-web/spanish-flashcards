"""Generate the Tridioma raven logo (SVG) and app icons (PNG).

Run: python3 tools/make_icons.py
Needs Google Chrome installed (used headless to turn the SVG into PNGs); no Python packages.

The raven is one set of polygons (RAVEN below), drawn in two treatments:
- "color": dark navy facets with a cyan eye, on the blue→violet gradient (app icons)
- "mono":  white facets at different opacities, for the gradient header (icons/raven-white.svg)
"""
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'icons')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

GRAD_FROM = '#1e40af'  # deep blue
GRAD_TO = '#6d28d9'    # violet

# Raven in profile facing right, on a 100×100 grid: (name, points, color fill, mono opacity)
RAVEN = [
    ('tail',       '28,58 10,80 19,87 38,68',          '#0b0d2a', 0.62),
    ('wing-tip',   '28,58 38,68 48,62',                '#141846', 0.74),
    ('wing-low',   '40,40 28,58 48,62',                '#1a1f55', 0.86),
    ('wing-up',    '40,40 60,40 48,62',                '#232a6b', 0.95),
    ('back',       '53,28 40,40 60,40',                '#10133a', 0.78),
    ('breast',     '60,40 70,44 66,56 54,70 48,62',    '#0d1033', 0.70),
    ('head',       '72,29 63,22 53,28 60,40 70,44 73,41', '#181d52', 1.00),
    ('beak-top',   '90,38 72,29 73,36',                '#cfd4ff', 1.00),
    ('beak-low',   '90,38 73,36 73,41',                '#8e96e6', 0.80),
    ('leg-1',      '50,69 52,69 51,79 49,79',          '#0b0d2a', 0.70),
    ('leg-2',      '57,67 59,67 59,79 57,79',          '#0b0d2a', 0.70),
]
EYE = (65.5, 31.5)


def raven_shapes(mode):
    parts = []
    for _name, pts, color, alpha in RAVEN:
        if mode == 'color':
            parts.append(f'<polygon points="{pts}" fill="{color}"/>')
        else:
            parts.append(f'<polygon points="{pts}" fill="#fff" fill-opacity="{alpha}"/>')
    x, y = EYE
    if mode == 'color':
        parts.append(f'<circle cx="{x}" cy="{y}" r="2.8" fill="#5eead4"/>')
        parts.append(f'<circle cx="{x + 0.7}" cy="{y - 0.6}" r="0.9" fill="#fff"/>')
    else:
        parts.append(f'<circle cx="{x}" cy="{y}" r="2.6" fill="{GRAD_FROM}"/>')
    # perch
    stroke = '#5eead4' if mode == 'color' else '#fff'
    parts.append(f'<rect x="34" y="78.5" width="40" height="3" rx="1.5" fill="{stroke}" fill-opacity="{0.9 if mode == "color" else 0.6}"/>')
    return '\n  '.join(parts)


def gradient_defs():
    return (f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{GRAD_FROM}"/><stop offset="1" stop-color="{GRAD_TO}"/>'
            f'</linearGradient></defs>')


def icon_svg(radius, scale):
    """Gradient tile with the colour raven. radius: corner radius (0 = full bleed). scale: raven size."""
    # Raven art spans roughly x 10–90, y 22–87; centre it in the tile.
    tx = 50 - 50 * scale
    ty = 50 - 54.5 * scale
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
{gradient_defs()}
<rect width="100" height="100" rx="{radius}" fill="url(#g)"/>
<g transform="translate({tx:.2f} {ty:.2f}) scale({scale})">
  {raven_shapes('color')}
</g>
</svg>
'''


def mono_svg():
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 18 86 72">
  {raven_shapes('mono')}
</svg>
'''


def rasterize(svg, size, path):
    with tempfile.TemporaryDirectory() as tmp:
        html = os.path.join(tmp, 'icon.html')
        with open(html, 'w') as f:
            f.write(f'<!doctype html><html><body style="margin:0;background:transparent">'
                    f'<div style="width:{size}px;height:{size}px">{svg.replace("<svg ", f"<svg width={size} height={size} ", 1)}</div>'
                    f'</body></html>')
        subprocess.run([
            CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
            f'--user-data-dir={os.path.join(tmp, "profile")}',
            '--default-background-color=00000000', '--force-device-scale-factor=1',
            f'--window-size={size},{size}', f'--screenshot={path}', 'file://' + html,
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    if not os.path.exists(CHROME):
        raise SystemExit('Google Chrome not found at ' + CHROME)
    os.makedirs(OUT, exist_ok=True)

    with open(os.path.join(OUT, 'icon.svg'), 'w') as f:
        f.write(icon_svg(radius=22, scale=0.92))
    with open(os.path.join(OUT, 'raven-white.svg'), 'w') as f:
        f.write(mono_svg())
    print('wrote icon.svg, raven-white.svg')

    full = icon_svg(radius=0, scale=0.92)       # iOS rounds the corners itself; must be opaque
    rounded = icon_svg(radius=22, scale=0.92)
    maskable = icon_svg(radius=0, scale=0.70)   # keep the raven inside Android's safe zone
    for name, svg, size in [
        ('apple-touch-icon.png', full, 180),
        ('icon-192.png', rounded, 192),
        ('icon-512.png', rounded, 512),
        ('icon-maskable-512.png', maskable, 512),
    ]:
        rasterize(svg, size, os.path.join(OUT, name))
        print('wrote', name)
