#!/usr/bin/env python3
"""Dump region index overlay on the original map + segmentation, for label transcription."""
import numpy as np, json
from PIL import Image, ImageDraw
from scipy import ndimage

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
    if (rlbl[0,:]==i).any() and (rlbl[-1,:]==i).any() and (rlbl[:,0]==i).any() and (rlbl[:,-1]==i).any(): continue
    regions.append(dict(idx=len(regions), rid=int(i), cx=round(float(cx),1), cy=round(float(cy),1), area=int(sizes[i-1])))
json.dump(regions, open('tools/variants/1900/seg/regions.json','w'), indent=0)

# overlay index numbers on the ORIGINAL (so I can read printed code + see index together), 3x upscale
base = Image.open('.debug-screenshots/image.png').convert('RGB').resize((W*3,H*3), Image.LANCZOS)
dr = ImageDraw.Draw(base)
for r in regions:
    x,y = r['cx']*3, r['cy']*3
    dr.rectangle([x-12,y-9,x+12,y+9], fill=(255,255,0))
    dr.text((x-10,y-6), str(r['idx']), fill=(200,0,0))
base.save('/tmp/1900_regionidx.png')
print(f"{len(regions)} regions -> /tmp/1900_regionidx.png (3x)")
