import cv2, numpy as np, json
from sklearn.ensemble import HistGradientBoostingClassifier
from seeds import LAND, SEA, LAKES, ROCKS, FRAME
import os; S=os.environ.get('ERA_TRACE_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), '_work'))
x0,y0,x1,y1=FRAME
blue=cv2.imread(f'{S}/src/p6-000.jpg')[y0:y1,x0:x1].astype(np.float32)
eoe=cv2.imread(f'{S}/work/eoe_reg.png')[y0:y1,x0:x1].astype(np.float32)
H,W=blue.shape[:2]
def feats():
  F=[blue,eoe,cv2.GaussianBlur(blue,(0,0),4),cv2.GaussianBlur(eoe,(0,0),4)]
  for im in (blue,eoe):
    g=im.mean(2); m=cv2.GaussianBlur(g,(0,0),3); v=cv2.GaussianBlur((g-m)**2,(0,0),3)
    F.append(np.sqrt(v)[...,None])
  hsv=cv2.cvtColor(eoe.astype(np.uint8),cv2.COLOR_BGR2HSV).astype(np.float32); F.append(hsv)
  return np.concatenate(F,2)
F=feats(); D=F.shape[2]
LBm=np.load(f'{S}/work/LB.npy')
# training: discs around seeds (exclude line pixels), land=1 sea=0
X=[];Y=[]
rng=np.random.default_rng(0)
def sample(pts,lab,r=22,n=400):
  for (x,y) in pts:
    cx,cy=x-x0,y-y0
    for _ in range(n):
      a=rng.uniform(0,2*np.pi); d=r*np.sqrt(rng.uniform()); px,py=int(cx+d*np.cos(a)),int(cy+d*np.sin(a))
      if 0<=px<W and 0<=py<H and LBm[py,px]<50: X.append(F[py,px]); Y.append(lab)
for v in LAND.values(): sample(v[1],1,r=14)
for v in SEA.values(): sample(v[1],0,r=60,n=1500)
for v in LAKES.values(): sample(v,0,r=10)
# extra sea samples in coastal glow: ring just outside each sea seed is far from coast, so add points along the frame edges known to be sea
for (x,y) in [(1100,1450),(1500,1450),(2250,300),(2280,900),(800,1300),(2200,1400),(1700,1050),(1950,1050),(2000,880),(2120,500),(2080,640),(1960,700),(1500,1150),(1300,1060),(700,950),(600,1050),(1850,1250),(2100,1180)]: sample([(x,y)],0,r=25,n=300)
X=np.array(X);Y=np.array(Y); print('train',X.shape,Y.mean())
clf=HistGradientBoostingClassifier(max_iter=200,learning_rate=0.1).fit(X,Y)
P=clf.predict_proba(F.reshape(-1,D))[:,1].reshape(H,W).astype(np.float32)
np.save(f'{S}/work/P.npy',P)
cv2.imwrite(f'{S}/work/P.png',(P*255).astype(np.uint8))
