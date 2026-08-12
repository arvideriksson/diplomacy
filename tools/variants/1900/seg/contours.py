#!/usr/bin/env python3
"""Phase 3: extract simplified province contours, scale to the dsvg viewBox, emit geometry.json
and a standalone styled preview SVG so the geometry can be eyeballed."""
import json, numpy as np
from PIL import Image
from scipy import ndimage
from skimage import measure

VB_W, VB_H = 1522, 1426   # target dsvg space

g = np.asarray(Image.open('.debug-screenshots/image.png').convert('L'))
H, W = g.shape
wall = g < 100
lbl,n = ndimage.label(wall, structure=np.ones((3,3)))
sizes = ndimage.sum(np.ones_like(lbl),lbl,range(1,n+1))
border = ndimage.binary_dilation(lbl==1+int(np.argmax(sizes)), iterations=2)
rlbl,rn = ndimage.label(~border, structure=[[0,1,0],[1,1,1],[0,1,0]])
sizes = ndimage.sum(np.ones_like(rlbl),rlbl,range(1,rn+1))

regions = json.load(open('tools/variants/1900/seg/regions.json'))
idmap = json.load(open('tools/variants/1900/seg/idmap.json'))   # id -> region idx
rid_of_idx = {r['idx']: r['rid'] for r in regions}

# Borders are gaps (the dilated wall) of VARYING width, so independently-stroked province
# edges read as inconsistent thickness. Partition the wall pixels among the kept regions:
# each grows to meet its neighbour at the border centerline, so adjacent polygons share an
# edge exactly and a single thin uniform stroke = one consistent border everywhere.
from skimage.segmentation import expand_labels
keep_rids = list({r['rid'] for r in regions})
clean = np.where(np.isin(rlbl, keep_rids), rlbl, 0)
rlbl = expand_labels(clean, distance=14)

sx, sy = VB_W/W, VB_H/H

def chaikin(pts, iters=2):
    """Round a closed polygon's corners (Chaikin corner-cutting)."""
    for _ in range(iters):
        out = []
        n = len(pts)
        for i in range(n):
            ax, ay = pts[i]; bx, by = pts[(i+1) % n]
            out.append((0.75*ax+0.25*bx, 0.75*ay+0.25*by))
            out.append((0.25*ax+0.75*bx, 0.25*ay+0.75*by))
        pts = out
    return pts

def contour_path(rid):
    mask = (rlbl==rid)
    # pad so border contours close; find outer contour (largest)
    cs = measure.find_contours(np.pad(mask,1).astype(float), 0.5)
    if not cs: return None
    c = max(cs, key=len)                       # (row,col)=(y,x), +1 from pad
    poly = measure.approximate_polygon(c, tolerance=1.2)
    pts = [((x-1)*sx, (y-1)*sy) for y,x in poly]
    if len(pts) < 3: return None
    if pts[0] == pts[-1]: pts.pop()
    pts = chaikin(pts, 2)                       # smooth the facets
    d = "M " + " L ".join(f"{x:.1f} {y:.1f}" for x,y in pts) + " Z"
    return d

geom = {}
for pid, idx in idmap.items():
    d = contour_path(rid_of_idx[idx])
    if d: geom[pid] = d
json.dump(geom, open('tools/variants/1900/seg/geometry.json','w'))
print(f"extracted {len(geom)} province contours -> geometry.json")

# Standalone styled preview (land green, sea blue). Regions now tile (shared edges),
# so a single thin uniform stroke gives consistent borders.
import re
ts = open('src/lib/maps/1900.ts').read()
land={m.group(1).lower() for m in re.finditer(r"^    (\w+): \{\s*\n\s*name: '[^']*', type: '(land|coast)'", ts, re.M)}
STROKE = '#33332f'
SW = 0.6
parts=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1522 1426">',
       '<rect width="1522" height="1426" fill="#9fc6d8"/>']
for pid,d in geom.items():
    if pid not in land: parts.append(f'<path d="{d}" fill="#9fc6d8" stroke="{STROKE}" stroke-width="{SW}"/>')
for pid,d in geom.items():
    if pid in land: parts.append(f'<path d="{d}" fill="#d9e8c8" stroke="{STROKE}" stroke-width="{SW}"/>')
parts.append('</svg>')
open('/tmp/1900_new_geometry.svg','w').write('\n'.join(parts))
print("preview svg written")
