#!/usr/bin/env python3
"""Region-segment the canonical 1900 B&W map: black borders = walls, flood-fill enclosed regions."""
import sys, numpy as np
from PIL import Image
from scipy import ndimage

SRC = sys.argv[1] if len(sys.argv) > 1 else '.debug-screenshots/image.png'
THRESH = 100      # luminance below this = wall (border/text/star)
DILATE = 2        # seal hairline gaps in border lines (px radius)
MIN_AREA = 200    # drop regions smaller than this (glyph holes, slivers)

g = np.asarray(Image.open(SRC).convert('L'))
H, W = g.shape
wall = g < THRESH

# Keep only the largest connected wall component = the border network.
# Province labels / SC stars are small separate blobs -> dropped automatically.
lbl, n = ndimage.label(wall, structure=np.ones((3,3)))  # 8-conn for thin lines
if n:
    sizes = ndimage.sum(np.ones_like(lbl), lbl, range(1, n+1))
    biggest = 1 + int(np.argmax(sizes))
    border = lbl == biggest
else:
    border = wall

# Seal gaps so flood-fill can't leak between provinces.
border = ndimage.binary_dilation(border, iterations=DILATE)

# Label background (non-wall) regions with 4-conn (no diagonal leaks).
bg = ~border
rlbl, rn = ndimage.label(bg, structure=[[0,1,0],[1,1,1],[0,1,0]])
sizes = ndimage.sum(np.ones_like(rlbl), rlbl, range(1, rn+1))

# Region stats: id, area, centroid. Drop tiny ones and the outer frame.
regions = []
coms = ndimage.center_of_mass(np.ones_like(rlbl), rlbl, range(1, rn+1))
for i in range(1, rn+1):
    area = sizes[i-1]
    if area < MIN_AREA: continue
    cy, cx = coms[i-1]
    # outer frame region touches all 4 edges and is huge — flag it
    touches = (rlbl[0,:]==i).any() and (rlbl[-1,:]==i).any() and (rlbl[:,0]==i).any() and (rlbl[:,-1]==i).any()
    regions.append(dict(id=i, area=int(area), cx=round(cx,1), cy=round(cy,1), frame=bool(touches)))

regions.sort(key=lambda r:-r['area'])
print(f"image {W}x{H}, walls<{THRESH}, {rn} raw regions -> {len(regions)} kept (area>={MIN_AREA})")
print(f"{'area':>8} {'cx':>6} {'cy':>6}  frame")
for r in regions[:12]:
    print(f"{r['area']:>8} {r['cx']:>6} {r['cy']:>6}  {r['frame']}")
print(f"  ... ({len(regions)} total)")

# Visualize: random color per kept region.
rng = np.random.default_rng(7)
vis = np.zeros((H,W,3), np.uint8)
keep_ids = {r['id'] for r in regions if not r['frame']}
for r in regions:
    if r['frame']: continue
    vis[rlbl==r['id']] = rng.integers(60,235,3)
vis[border] = (20,20,20)
Image.fromarray(vis).save('/tmp/1900_segmented.png')
print(f"kept (non-frame): {len(keep_ids)}  -> /tmp/1900_segmented.png")
