"""Branded App Store QR for the SkyMap counter card.

Rounded modules, rounded finder eyes, app icon in the middle (error
correction H so the icon can cover the centre). Writes qr-branded.svg.
Needs segno: python3 -m venv .venv && .venv/bin/pip install segno
Always confirm it scans after a change: render, then `zbarimg preview.png`.
"""
import segno, pathlib

URL = "https://apps.apple.com/app/id6792509326"
INK = "#14213d"
here = pathlib.Path(__file__).parent

qr = segno.make(URL, error="h", micro=False)
m = [list(row) for row in qr.matrix]
n = len(m)
q = 2  # quiet zone in modules; the white tile around it adds more

def in_eye(r, c):
    return any(r0 <= r < r0 + 7 and c0 <= c < c0 + 7
               for r0, c0 in ((0, 0), (0, n - 7), (n - 7, 0)))

logo = round(n * 0.26) | 1           # odd module count, ~26% of width
lo = (n - logo) // 2
def in_logo(r, c):
    return lo - 1 <= r < lo + logo + 1 and lo - 1 <= c < lo + logo + 1

parts = []
for r in range(n):
    for c in range(n):
        if m[r][c] and not in_eye(r, c) and not in_logo(r, c):
            parts.append(f'<rect x="{c+q+0.08:.2f}" y="{r+q+0.08:.2f}" width="0.84" height="0.84" rx="0.3"/>')
for r0, c0 in ((0, 0), (0, n - 7), (n - 7, 0)):
    x, y = c0 + q, r0 + q
    parts.append(f'<rect x="{x+0.5}" y="{y+0.5}" width="6" height="6" rx="1.6" fill="none" stroke="{INK}" stroke-width="1"/>')
    parts.append(f'<rect x="{x+2}" y="{y+2}" width="3" height="3" rx="0.9"/>')

icon = (here / "icon.svg").read_text()
icon = icon.replace('<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">',
                    f'<svg x="{lo+q}" y="{lo+q}" width="{logo}" height="{logo}" viewBox="0 0 512 512">')
size = n + 2 * q
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">'
       f'<rect width="{size}" height="{size}" fill="#fff"/><g fill="{INK}">{"".join(parts)}</g>{icon}</svg>')
(here / "qr-branded.svg").write_text(svg)
print(f"qr-branded.svg version={qr.version} modules={n} logo={logo}")
