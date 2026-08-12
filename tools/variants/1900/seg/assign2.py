#!/usr/bin/env python3
"""Phase 2b: anchor-warp assignment. ~57 region indices read off the printed map codes
serve as ground-truth correspondences; a thin-plate-spline warp + Hungarian match assigns
the remaining provinces. Region indices refer to tools/variants/1900/seg/regions.json."""
import re, json, numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.interpolate import RBFInterpolator

# region idx -> our lowercase province id (transcribed from the canonical map labels)
ANCHORS = {
 2:'nat',3:'nws',4:'bar',1:'sib',7:'ice',6:'fin',8:'swe',9:'nwy',10:'gbo',13:'lvo',
 14:'ska',15:'bal',16:'den',19:'pru',20:'hel',21:'mid',23:'sev',26:'kie',27:'war',
 29:'net',30:'ukr',32:'mun',33:'boh',36:'gal',37:'bur',38:'bre',43:'tyr',44:'bla',
 47:'gas',50:'mar',51:'pie',52:'mil',53:'spa',55:'rom',59:'arm',60:'por',61:'gly',
 63:'ank',64:'kon',66:'tys',67:'con',71:'gib',72:'nap',73:'ion',75:'gre',76:'eas',
 77:'par',78:'wes',79:'egy',80:'mor',81:'alg',82:'tun',84:'pal',86:'trp',17:'ire',
 24:'lon',25:'wal',31:'eng',
}

regions = json.load(open('tools/variants/1900/seg/regions.json'))
R = np.array([[r['cx'], r['cy']] for r in regions])
ridx = {r['idx']: k for k,r in enumerate(regions)}   # region idx -> row in R

# dsvg base-province points (1522x1426 space)
dsvg = open('public/maps/1900.dsvg').read()
g = re.search(r'<g id="unit-positions">(.*?)</g>', dsvg, re.S).group(1)
P = {}
for c in re.finditer(r'<circle id="([^"]+)" cx="([\d.]+)" cy="([\d.]+)"', g):
    if '/' in c.group(1): continue
    P[c.group(1)] = (float(c.group(2)), float(c.group(3)))
ids = list(P); Pp = np.array([P[i] for i in ids])

# Fit warp from dsvg point -> PNG centroid on the anchors.
known = [(ids.index(v), ridx[k]) for k,v in ANCHORS.items() if v in ids and k in ridx]
src = np.array([Pp[a] for a,_ in known]); dst = np.array([R[b] for _,b in known])
warp = RBFInterpolator(src, dst, kernel='thin_plate_spline', smoothing=0.5)
Pw = warp(Pp)

# Hungarian over ALL provinces, but force the anchors to their known region (cost 0).
BIG = 1e9
cost = ((Pw[:,None,:]-R[None,:,:])**2).sum(2)
for a,b in known:
    cost[a,:] += BIG; cost[a,b] -= BIG    # pin anchor a to region b
rows, cols = linear_sum_assignment(cost)
mapped = {ids[r]: regions[c]['idx'] for r,c in zip(rows,cols)}     # id -> region idx
resid  = {ids[r]: float(np.sqrt(max(0,((Pw[r]-R[c])**2).sum()))) for r,c in zip(rows,cols)}

inferred = {i:mapped[i] for i in ids if ridx.get(mapped[i]) is not None and i not in [ids[a] for a,_ in known]}
print(f"{len(known)} anchors pinned; {len(ids)-len(known)} inferred")
print("INFERRED (verify these):")
for i in sorted(inferred, key=lambda x:-resid[x]):
    print(f"  {i:>4} -> region {mapped[i]:>2}  resid {resid[i]:.0f}")
json.dump({i:mapped[i] for i in ids}, open('tools/variants/1900/seg/idmap.json','w'), indent=0)
print("wrote idmap.json")
