import cv2,numpy as np
import os; S=os.environ.get('ERA_TRACE_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), '_work'))
ph=cv2.imread(f'{S}/work/photo_reg.png'); bl=cv2.imread(f'{S}/src/p6-000.jpg')
gp=cv2.cvtColor(ph,cv2.COLOR_BGR2GRAY).astype(np.float32); gb=cv2.cvtColor(bl,cv2.COLOR_BGR2GRAY).astype(np.float32)
H,W=gb.shape; step=60; P=64
ys=np.arange(P,H-P,step); xs=np.arange(P,W-P,step)
DX=np.zeros((len(ys),len(xs)),np.float32); DY=DX.copy(); C=DX.copy()
win=cv2.createHanningWindow((2*P,2*P),cv2.CV_32F)
for i,y in enumerate(ys):
  for j,x in enumerate(xs):
    a=gb[y-P:y+P,x-P:x+P]; b=gp[y-P:y+P,x-P:x+P]
    if a.std()<8 or b.std()<8: continue
    (dx,dy),r=cv2.phaseCorrelate(a,b,win)
    if r>0.2 and abs(dx)<8 and abs(dy)<8: DX[i,j],DY[i,j],C[i,j]=dx,dy,r
# fill low-confidence cells by weighted smoothing
w=cv2.GaussianBlur(C,(0,0),1.5)+1e-6
DXs=cv2.GaussianBlur(DX*C,(0,0),1.5)/w; DYs=cv2.GaussianBlur(DY*C,(0,0),1.5)/w
fx=cv2.resize(DXs,(W,H),interpolation=cv2.INTER_CUBIC); fy=cv2.resize(DYs,(W,H),interpolation=cv2.INTER_CUBIC)
gx,gy=np.meshgrid(np.arange(W,dtype=np.float32),np.arange(H,dtype=np.float32))
out=cv2.remap(ph,gx+fx,gy+fy,cv2.INTER_LINEAR)
cv2.imwrite(f'{S}/work/photo_reg2.png',out)
print('shift stats',np.percentile(np.hypot(DX,DY)[C>0],[50,90,99]))
# verify residual
for (x,y) in [(167,440),(2015,166),(1828,823),(1640,1270)]:
  (dx,dy),r=cv2.phaseCorrelate(gb[y-40:y+40,x-40:x+40],cv2.cvtColor(out,cv2.COLOR_BGR2GRAY).astype(np.float32)[y-40:y+40,x-40:x+40]); print((x,y),round(dx,1),round(dy,1))
