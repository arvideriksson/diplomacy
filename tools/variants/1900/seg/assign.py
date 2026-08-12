#!/usr/bin/env python3
"""Phase 2: assign province IDs to segmented regions via affine ICP against dsvg unit points."""
import re, sys, numpy as np
from PIL import Image
from scipy import ndimage

# --- segment (reuse phase-1 params) ---
g = np.asarray(Image.open('.debug-screenshots/image.png').convert('L'))
H, W = g.shape
wall = g < 100
lbl, n = ndimage.label(wall, structure=np.ones((3,3)))
sizes = ndimage.sum(np.ones_like(lbl), lbl, range(1, n+1))
border = ndimage.binary_dilation(lbl == 1+int(np.argmax(sizes)), iterations=2)
rlbl, rn = ndimage.label(~border, structure=[[0,1,0],[1,1,1],[0,1,0]])
sizes = ndimage.sum(np.ones_like(rlbl), rlbl, range(1, rn+1))
coms = ndimage.center_of_mass(np.ones_like(rlbl), rlbl, range(1, rn+1))
regions = []
for i in range(1, rn+1):
    if sizes[i-1] < 200: continue
    cy, cx = coms[i-1]
    touches = (rlbl[0,:]==i).any() and (rlbl[-1,:]==i).any() and (rlbl[:,0]==i).any() and (rlbl[:,-1]==i).any()
    if touches: continue  # outer frame
    regions.append(dict(rid=i, cx=cx, cy=cy))
R = np.array([[r['cx'], r['cy']] for r in regions])
print(f"{len(R)} regions")

# --- dsvg base-province unit points (1522x1426 space) ---
dsvg = open('public/maps/1900.dsvg').read()
m = re.search(r'<g id="unit-positions">(.*?)</g>', dsvg, re.S)
pts = {}
for c in re.finditer(r'<circle id="([^"]+)" cx="([\d.]+)" cy="([\d.]+)"', m.group(1)):
    pid = c.group(1)
    if '/' in pid: continue  # skip named-coast variants
    pts[pid] = (float(c.group(2)), float(c.group(3)))
ids = list(pts)
P = np.array([pts[i] for i in ids])
print(f"{len(P)} dsvg province points")

# --- affine ICP: map dsvg points P -> PNG region centroids R ---
def fit_affine(src, dst):  # least-squares 2x3 affine src->dst
    A = np.hstack([src, np.ones((len(src),1))])
    M, *_ = np.linalg.lstsq(A, dst, rcond=None)
    return M  # 3x2
def apply(M, src):
    return np.hstack([src, np.ones((len(src),1))]) @ M

# init: align bounding boxes
def bbox_align(src, dst):
    s0,s1 = src.min(0), src.max(0); d0,d1 = dst.min(0), dst.max(0)
    scale = (d1-d0)/(s1-s0)
    return src*scale + (d0 - s0*scale), scale
Pa, _ = bbox_align(P, R)
M = fit_affine(P, Pa)  # start from bbox transform expressed as affine
for it in range(40):
    Pt = apply(M, P)
    # nearest region for each province point
    d = ((Pt[:,None,:]-R[None,:,:])**2).sum(2)
    j = d.argmin(1)
    M = fit_affine(P, R[j])
Pt = apply(M, P)
# Affine gives a coarse fit (jDip layout != canonical map). Use the confident matches
# as anchors for a thin-plate-spline warp that captures local distortion, then re-match.
from scipy.optimize import linear_sum_assignment
from scipy.interpolate import RBFInterpolator

def match(srcpts):
    cost = ((srcpts[:,None,:]-R[None,:,:])**2).sum(2)
    r,c = linear_sum_assignment(cost)
    return c, np.sqrt(cost[r,c])

cols, res = match(Pt)
trust = res < 35.0                       # confident anchors
print(f"affine anchors: {trust.sum()}/{len(P)} with residual<35")
# TPS warp dsvg->PNG fit on trusted anchors, smoothed.
warp = RBFInterpolator(P[trust], R[cols[trust]], kernel='thin_plate_spline', smoothing=1.0)
Pw = warp(P)
cols, res = match(Pw)
mapped = {ids[i]: regions[cols[i]]['rid'] for i in range(len(ids))}
resid = {ids[i]: float(res[i]) for i in range(len(ids))}
# detect collisions (Hungarian guarantees distinct, but report merged-region risk)
print(f"TPS warp. residual px: median {np.median(res):.1f}, max {res.max():.1f}")
print(f"assigned {len(set(cols))}/{len(ids)} to distinct regions")
worst = sorted(((resid[i], i) for i in ids), reverse=True)[:10]
print("worst residuals:", ', '.join(f"{i}={d:.0f}" for d,i in worst))

# visualize labels
from PIL import ImageDraw
vis = Image.open('/tmp/1900_segmented.png').convert('RGB')
dr = ImageDraw.Draw(vis)
for pid, rid in mapped.items():
    r = next(x for x in regions if x['rid']==rid)
    dr.text((r['cx']-7, r['cy']-4), pid.upper(), fill=(0,0,0))
vis.save('/tmp/1900_assigned.png')
print("-> /tmp/1900_assigned.png")
