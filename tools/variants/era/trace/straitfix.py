# Straits (the #07 approach). Near each arrow, land vs water comes from a colour classifier trained
# on the rest of the photo; then a narrow channel is carved at right angles to the arrow through
# its wettest point, out to open sea on both sides.
import numpy as np, cv2
from scipy import ndimage as ndi
from sklearn.ensemble import HistGradientBoostingClassifier
def strait_fix(L, ids, kind, ARROWS, x0, y0, S, R=34, CARVE=None):
  ph=cv2.imread(f'{S}/work/photo_reg2.png')
  H,W=L.shape
  sea_ids=[n for n,i in enumerate(ids,1) if kind.get(i)=='sea']
  land_ids=[n for n,i in enumerate(ids,1) if kind.get(i)=='land']
  seamask=np.isin(L,sea_ids); landm=np.isin(L,land_ids)
  def feats(img):
    f=img.astype(np.float32); hsv=cv2.cvtColor(img,cv2.COLOR_BGR2HSV).astype(np.float32)
    return np.concatenate([f,hsv,cv2.GaussianBlur(f,(0,0),1.5)],2)
  zone=np.zeros((H,W),bool)
  for (a,b) in ARROWS.values():
    cx,cy=(a[0]+b[0])//2-x0,(a[1]+b[1])//2-y0; zone[max(0,cy-R):cy+R,max(0,cx-R):cx+R]=True
  interior=ndi.binary_erosion(seamask,iterations=6)|ndi.binary_erosion(landm,iterations=6)
  F=feats(ph[y0:y0+H,x0:x0+W]); rng=np.random.default_rng(0)
  pick=np.argwhere(interior&~zone); pick=pick[rng.choice(len(pick),60000,replace=False)]
  clf=HistGradientBoostingClassifier(max_iter=150).fit(F[pick[:,0],pick[:,1]],seamask[pick[:,0],pick[:,1]])
  out=L.copy()
  _,(sy,sx)=ndi.distance_transform_edt(~seamask,return_indices=True)
  _,(ly,lx)=ndi.distance_transform_edt(~landm,return_indices=True)
  for (a,b) in ARROWS.values():
    cx,cy=(a[0]+b[0])//2,(a[1]+b[1])//2
    f=feats(ph[cy-R:cy+R,cx-R:cx+R]); p=clf.predict_proba(f.reshape(-1,f.shape[2]))[:,1].reshape(2*R,2*R)
    water=ndi.binary_opening(cv2.GaussianBlur(p,(0,0),1.2)>0.5,iterations=1)
    ys,xs=np.mgrid[cy-R-y0:cy+R-y0,cx-R-x0:cx+R-x0]
    cur=seamask[ys,xs]; ts=water&~cur; tl=~water&cur
    out[ys[ts],xs[ts]]=L[sy[ys[ts],xs[ts]],sx[ys[ts],xs[ts]]]
    out[ys[tl],xs[tl]]=L[ly[ys[tl],xs[tl]],lx[ys[tl],xs[tl]]]
  seam2=np.isin(out,sea_ids); Fp=feats(ph); carve=np.zeros((H,W),bool)
  for k,(a,b) in ARROWS.items():
    a=np.array(a,float); b=np.array(b,float); u=(b-a)/np.hypot(*(b-a)); v=np.array([-u[1],u[0]])
    best=None
    for t in np.linspace(0.12,0.88,40):
      m=a+(b-a)*t; ps=[Fp[int(round(q[1])),int(round(q[0]))] for q in (m+v*o for o in (-6,-5,5,6))]
      pw=clf.predict_proba(np.array(ps))[:,1].mean()
      if best is None or pw>best[0]: best=(pw,m)
    m=best[1]-(x0,y0); width=(CARVE or {}).get(k,7); ends=[]
    for sg in (1,-1):
      e=0
      for t in range(1,70):
        q=np.round(m+v*sg*t).astype(int)
        if not (0<=q[0]<W and 0<=q[1]<H): break
        if seam2[q[1],q[0]]: e=t+2; break
      ends.append(e)
    if not any(ends): continue
    band=np.zeros((H,W),np.uint8)
    cv2.line(band,tuple(np.round(m+v*ends[0]).astype(int)),tuple(np.round(m-v*ends[1]).astype(int)),1,width)
    carve|=band>0
  from seeds import CHANNELS
  for pl,w in CHANNELS.values():
    band=np.zeros((H,W),np.uint8); cv2.polylines(band,[np.int32([(x-x0,y-y0) for x,y in pl])],False,1,w); carve|=band>0
  _,(sy,sx)=ndi.distance_transform_edt(~(seam2&~carve),return_indices=True)
  out[carve]=out[sy[carve],sx[carve]]
  return out
