import numpy as np, cv2
from skimage.morphology import skeletonize
def close_gaps(E, thr=1, minlen=80, maxgap=28, cone=0.5, debug=None, avoid=None):
  sk=skeletonize(E>thr).astype(np.uint8)
  n,cc,st,_=cv2.connectedComponentsWithStats(sk,8)
  k=np.ones((3,3),np.uint8); nb=cv2.filter2D(sk,-1,k)-1
  ends=np.argwhere((sk==1)&(nb==1))
  ys,xs=np.nonzero(sk); allpts=np.stack([xs,ys],1)
  segs=[]
  for (y,x) in ends:
    c=cc[y,x]
    if st[c,4]<minlen: continue
    # walk back along the stroke ~10px to get the end's direction
    path=[(x,y)]; prev=None; cur=(x,y)
    for _ in range(10):
      cx,cy=cur; nxt=None
      for dy in(-1,0,1):
        for dx in(-1,0,1):
          if (dx or dy) and 0<=cy+dy<sk.shape[0] and 0<=cx+dx<sk.shape[1] and sk[cy+dy,cx+dx] and (cx+dx,cy+dy) not in path:
            nxt=(cx+dx,cy+dy); break
        if nxt: break
      if not nxt: break
      path.append(nxt); cur=nxt
    if len(path)<5: continue
    d=np.subtract(path[0],path[-1]).astype(float); d/=np.hypot(*d)+1e-9
    # candidates: skeleton pixels ahead within maxgap, not on the own stroke near the end
    sel=np.abs(allpts[:,0]-x)<=maxgap; sel&=np.abs(allpts[:,1]-y)<=maxgap
    P=allpts[sel]; v=P-[x,y]; dist=np.hypot(v[:,0],v[:,1])
    ok=(dist>3)&(dist<=maxgap)
    ok&=((v@d)/np.maximum(dist,1e-9))>cone
    # exclude own stroke within 15px along it
    own=np.array([cc[p[1],p[0]]==c for p in P]); near_own=own&(dist<15)
    ok&=~near_own
    if not ok.any(): continue
    j=np.argmin(np.where(ok,dist,1e9)); segs.append(((int(x),int(y)),tuple(int(t) for t in P[j])))
  out=E.copy()
  if avoid is not None: segs=[(a,b) for a,b in segs if not (avoid[a[1],a[0]] or avoid[b[1],b[0]])]
  for a,b in segs: cv2.line(out,a,b,float(E.max()*0.6),2)
  return out,segs
