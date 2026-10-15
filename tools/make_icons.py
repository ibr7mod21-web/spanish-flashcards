"""Generate the app icons as PNGs (no dependencies). Run: python3 tools/make_icons.py

Design: teal background, a tilted back card and a white front card with an amber stripe.
"""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'icons')

BG = (31, 111, 92)
BACK = (124, 196, 176)
FRONT = (255, 255, 255)
STRIPE = (242, 180, 90)


def rounded_rect_sdf(px, py, cx, cy, hw, hh, r, angle):
    # Signed distance from point to a rotated rounded rectangle (negative = inside).
    c, s = math.cos(-angle), math.sin(-angle)
    x, y = px - cx, py - cy
    x, y = x * c - y * s, x * s + y * c
    qx, qy = abs(x) - hw + r, abs(y) - hh + r
    outside = math.hypot(max(qx, 0), max(qy, 0))
    return outside + min(max(qx, qy), 0) - r


def render(size, inset):
    # inset: fraction of the canvas reserved as padding (bigger for maskable icons).
    pixels = bytearray()
    scale = size * (1 - 2 * inset)
    off = size * inset
    shapes = [
        # (cx, cy, half-w, half-h, radius, angle-deg, colour, stripe)
        (0.54, 0.47, 0.25, 0.31, 0.05, 12, BACK, False),
        (0.46, 0.53, 0.25, 0.31, 0.05, -6, FRONT, True),
    ]
    ss = 3  # supersampling for smooth edges
    for j in range(size):
        pixels.append(0)  # PNG filter byte
        for i in range(size):
            acc = [0, 0, 0]
            for sj in range(ss):
                for si in range(ss):
                    x = (i + (si + 0.5) / ss - off) / scale
                    y = (j + (sj + 0.5) / ss - off) / scale
                    col = BG
                    for cx, cy, hw, hh, r, ang, colour, stripe in shapes:
                        a = math.radians(ang)
                        if rounded_rect_sdf(x, y, cx, cy, hw, hh, r, a) < 0:
                            col = colour
                            if stripe:
                                # stripe across the card, in card space
                                c, s = math.cos(-a), math.sin(-a)
                                ly = (x - cx) * s + (y - cy) * c
                                lx = (x - cx) * c - (y - cy) * s
                                if -0.05 < ly < 0.02 and abs(lx) < 0.15:
                                    col = STRIPE
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]
            n = ss * ss
            pixels += bytes((acc[0] // n, acc[1] // n, acc[2] // n))
    return bytes(pixels)


def write_png(path, size, raw):
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#1f6f5c"/>
<rect x="29" y="16" width="50" height="62" rx="5" fill="#7cc4b0" transform="rotate(12 54 47)"/>
<g transform="rotate(-6 46 53)"><rect x="21" y="22" width="50" height="62" rx="5" fill="#fff"/>
<rect x="31" y="48" width="30" height="7" rx="1.5" fill="#f2b45a"/></g>
</svg>
"""

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, size, inset in [
        ('apple-touch-icon.png', 180, 0.0),
        ('icon-192.png', 192, 0.0),
        ('icon-512.png', 512, 0.0),
        ('icon-maskable-512.png', 512, 0.12),
    ]:
        write_png(os.path.join(OUT, name), size, render(size, inset))
        print('wrote', name)
    with open(os.path.join(OUT, 'icon.svg'), 'w') as f:
        f.write(SVG)
    print('wrote icon.svg')
