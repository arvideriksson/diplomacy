import cv2, numpy as np, json, sys
from skimage.segmentation import watershed
from skimage.morphology import disk
from seeds import LAND, SEA, LAKES, ROCKS, FRAME
import os; S=os.environ.get('ERA_TRACE_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), '_work'))
x0,y0,x1,y1 = FRAME
blue=cv2.imread(f'{S}/src/p6-000.jpg')[y0:y1,x0:x1]
eoe=cv2.imread(f'{S}/work/eoe_reg.png')[y0:y1,x0:x1]
H,W=blue.shape[:2]
def lineness(img,k=11):
  g=img.max(axis=2).astype(np.float32)  # lines are dark in every channel; blue sea is bright in B
  inv=255-g
  th=cv2.morphologyEx(inv,cv2.MORPH_TOPHAT,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(k,k)))
  return cv2.GaussianBlur(th,(3,3),0)
from seeds import ARROWS, BARRIERS, CLEARS
LB=lineness(blue); LE=lineness(eoe,13)
from scipy import ndimage as ndi
from seeds import STRAIT_COASTS
STRIP=np.zeros((H,W),np.uint8)
for (a_,b_) in ARROWS.values():
  a_=np.array(a_,float)-(x0,y0); b_=np.array(b_,float)-(x0,y0); u=(b_-a_)/np.hypot(*(b_-a_))
  cv2.line(STRIP,tuple((a_-7*u).astype(int)),tuple((b_+7*u).astype(int)),1,15)
STRIP=STRIP>0
SL=np.zeros((H,W),np.uint8)
for pls in STRAIT_COASTS.values():
  for pl in pls: cv2.polylines(SL,[np.int32([(x-x0,y-y0) for x,y in pl])],False,1,3)
SLINES=SL>0
NEAR_STRAIT=cv2.dilate(STRIP.astype(np.uint8),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(61,61)))>0
def fix(L, ref=None):
  out=L.astype(np.float32).copy()
  for pl,w in CLEARS: cv2.polylines(out,[np.int32([(x-x0,y-y0) for x,y in pl])],False,0,w)
  for pl in BARRIERS: cv2.polylines(out,[np.int32([(x-x0,y-y0) for x,y in pl])],False,220,3)
  return out
LB0=LB.copy(); LB=fix(LB)
np.save(f'{S}/work/LB.npy',LB); np.save(f'{S}/work/LE.npy',LE)
ids=list(LAND)+list(SEA)+list(LAKES)+list(ROCKS)
kind={**{i:'land' for i in LAND},**{i:'sea' for i in SEA},**{i:'lake' for i in LAKES},**{i:'rock' for i in ROCKS}}
pts={**{i:v[1] for i,v in LAND.items()},**{i:v[1] for i,v in SEA.items()},**LAKES,**ROCKS}
_dt={}
def snap(L,x,y,r=12,T=70):
  key=id(L)
  if key not in _dt: _dt[key]=cv2.distanceTransform((L<T).astype(np.uint8),cv2.DIST_L2,3)
  dt=_dt[key]
  if dt[y,x]>=4: return x,y
  ya,yb,xa,xb=max(0,y-r),min(H,y+r),max(0,x-r),min(W,x+r)
  win=dt[ya:yb,xa:xb].copy()
  yy,xx=np.mgrid[ya:yb,xa:xb]; win-=0.04*np.hypot(xx-x,yy-y)
  k=np.unravel_index(win.argmax(),win.shape); return xa+k[1],ya+k[0]
def markers(which,L):
  M=np.zeros((H,W),np.int32)
  for n,i in enumerate(ids,1):
    if kind[i] not in which: continue
    for (x,y) in pts[i]:
      sx,sy=(x-x0,y-y0) if kind[i]=='rock' else snap(L,x-x0,y-y0)
      if M[sy,sx]: print('seed collision',i,ids[M[sy,sx]-1])
      cv2.circle(M,(sx,sy),2,n,-1)
  return M
# Stage 1: everything on the blue board's lines.
M1=markers({'land','sea','lake','rock'},LB); np.save(f'{S}/work/M1.npy',M1)
from gaps import close_gaps
RE0=fix(np.load(f'{S}/work/RE.npy'),LB0)
from seeds import RE_BOXES
REb=np.zeros_like(RE0)
for (ax,ay,bx_,by_) in RE_BOXES: REb[ay-y0:by_-y0,ax-x0:bx_-x0]=np.maximum(RE0[ay-y0:by_-y0,ax-x0:bx_-x0]-50,0)
E1,gsegs=close_gaps(np.maximum(np.maximum(LB-55,0),REb),avoid=NEAR_STRAIT); print('gap segs',len(gsegs)); json.dump(gsegs,open(f'{S}/work/gaps1.json','w')); np.save(f'{S}/work/E1.npy',E1)
L1=watershed(E1,M1)
np.save(f'{S}/work/L1.npy',L1)
json.dump({'ids':ids,'kind':kind},open(f'{S}/work/ids.json','w'))
# preview
rng=np.random.default_rng(3); pal=rng.integers(60,255,(len(ids)+1,3)).astype(np.uint8)
for n,i in enumerate(ids,1):
  if kind[i]=='sea': pal[n]=(200,150,90)
  if kind[i]=='lake': pal[n]=(255,120,0)
  if kind[i]=='rock': pal[n]=(40,40,40)
prev=(0.55*pal[L1]+0.45*blue).astype(np.uint8)
cv2.imwrite(f'{S}/work/L1_prev.png',prev)
print('stage1 done', H, W)
# Stage 2: land borders from the linked (retail) board, inside stage 1's land.
landlab={n for n,i in enumerate(ids,1) if kind[i] in('land','rock')}
landmask=np.isin(L1,list(landlab))
print('LE pct',np.percentile(LE[landmask],[50,90,95,99]))
RE=fix(np.load(f'{S}/work/RE.npy'),LB0)
M2=np.where(np.isin(M1,list(landlab)),M1,0).astype(np.int32)
M2[~landmask]=0
import os
GT=float(os.environ.get('GT','30'))
Lb=np.maximum(LB-55,0); Re=np.maximum(RE-40,0)
K=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(9,9))
supR=cv2.dilate((Re>20).astype(np.uint8),K).astype(np.float32); supB=cv2.dilate((Lb>20).astype(np.uint8),K).astype(np.float32)
E2=Lb*supR+Re*(1-supB)
np.save(f'{S}/work/E2.npy',E2)
from seeds import BLUE_LAND_BOXES
for (ax,ay,bx_,by_) in BLUE_LAND_BOXES: E2[ay-y0:by_-y0,ax-x0:bx_-x0]=E1[ay-y0:by_-y0,ax-x0:bx_-x0]
E2,_=close_gaps(E2,avoid=NEAR_STRAIT); L2=watershed(E2,M2,mask=landmask)
L=np.where(landmask,L2,L1)
# Under each strait arrow, every pixel takes the label of the nearest pixel outside the arrow's
# strip: arrows cross their channel, so the water and the coasts carry on straight through.

from straitfix import strait_fix
_,(iy,ix)=ndi.distance_transform_edt(STRIP,return_indices=True)
L[STRIP]=L[iy[STRIP],ix[STRIP]]
L=strait_fix(L, ids, kind, ARROWS, x0, y0, S)
# Japan's land is white on the photo: inside WATER_BOXES, blue pixels are sea (the Inland Sea
# between Kyoto, Shikoku and Kyushu), taken by the nearest sea.
from seeds import WATER_BOXES
PH2=cv2.imread(f'{S}/work/photo_reg2.png')[y0:y1,x0:x1].astype(np.float32)
BRp=cv2.blur(PH2[...,0]-PH2[...,2],(3,3)); dk=cv2.blur(PH2.mean(axis=2),(3,3))
seam=np.isin(L,[n for n,i in enumerate(ids,1) if kind[i]=='sea'])
_,(qy,qx)=ndi.distance_transform_edt(~seam,return_indices=True)
for (ax,ay,bx_,by_) in WATER_BOXES:
  box=np.zeros(L.shape,bool); box[ay-y0:by_-y0,ax-x0:bx_-x0]=True
  wet=box&~seam&(BRp>45)&(dk>90)&np.isin(L,list(landlab))
  wet=ndi.binary_opening(wet,iterations=1)
  L[wet]=L[qy[wet],qx[wet]]
  print('japan water px',int(wet.sum()))
# Thin spikes of land provinces (photo/line seams, e.g. Oman's needle): pixels an opening removes,
# in components that are long and thin, go to the nearest other region.
for n in sorted(landlab):
  m=L==n
  if not m.any(): continue
  op=ndi.binary_opening(m,structure=np.ones((5,5)))
  sp=m&~op; lab,kk=ndi.label(sp)
  for c,sl in enumerate(ndi.find_objects(lab),1):
    pm=np.zeros(L.shape,bool); pm[sl]=lab[sl]==c
    if pm.sum()<6: continue
    h,w=sl[0].stop-sl[0].start, sl[1].stop-sl[1].start
    if max(h,w)<5*max(1,pm.sum()/max(h,w)): continue
    other=(L!=n)
    _,(oy,ox)=ndi.distance_transform_edt(~other,return_indices=True)
    L[pm]=L[oy[pm],ox[pm]]; print('removed spike',ids[n-1],int(pm.sum()))
# Thin sea slivers running into land along sea-border lines: mostly enclosed by land, away from
# the straits, they become land.
seaN=[n for n,i in enumerate(ids,1) if kind[i]=='sea']
for n in seaN:
  m=L==n; op=ndi.binary_opening(m,structure=np.ones((7,7)))
  sp=m&~op&~ndi.binary_dilation(STRIP,iterations=6); lab,kk=ndi.label(sp)
  for c,sl in enumerate(ndi.find_objects(lab),1):
    pm=np.zeros(L.shape,bool); pm[sl]=lab[sl]==c
    if pm.sum()<25: continue
    ring=ndi.binary_dilation(pm,iterations=2)&~pm
    if np.isin(L[ring],list(landlab)).mean()<0.6: continue
    landm=np.isin(L,list(landlab))
    _,(oy,ox)=ndi.distance_transform_edt(~landm,return_indices=True)
    L[pm]=L[oy[pm],ox[pm]]; print('removed sea sliver',ids[n-1],int(pm.sum()))
from seeds import SEA_FORCE
_seaN=[n for n,i in enumerate(ids,1) if kind[i]=='sea']
for pl in SEA_FORCE:
  fm=np.zeros(L.shape,np.uint8); cv2.fillPoly(fm,[np.int32([(x-x0,y-y0) for x,y in pl])],1); fm=fm>0
  ref=np.isin(L,_seaN)&~fm
  _,(fy,fx)=ndi.distance_transform_edt(~ref,return_indices=True)
  L[fm]=L[fy[fm],fx[fm]]
from hatch import hatch_mask
HM=hatch_mask()
# The strip's western tip is Punjab's, so Nepal meets Punjab along a real border below it.
# The strip starts at board x=1084 as on the board; west of that, Nepal's tip meets Punjab.
# West edge as on the board: a line slanting south-west from (1083,552) to (1079,571); the
# detected tail below it is the Punjab-Nepal border line, not mountains.
_yy,_xx=np.mgrid[0:L.shape[0],0:L.shape[1]]
_edge=1083+(_yy-552)*(1079-1083)/(571-552)
HM &= (_xx >= _edge) & ~((_yy > 571) & (_xx < 1090))
_cut=hatch_mask() & ~HM
_p,_n=ids.index('PUN')+1,ids.index('NEP')+1
dP=ndi.distance_transform_edt(L!=_p); dN=ndi.distance_transform_edt(L!=_n)
L[_cut]=np.where(dP[_cut]<dN[_cut],_p,_n)
L[HM]=ids.index('#himalaya')+1

np.save(f'{S}/work/L2.npy',L)
