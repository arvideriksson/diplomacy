import cv2, numpy as np
from seeds import FRAME
import os; S=os.environ.get('ERA_TRACE_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), '_work'))
x0,y0,x1,y1=FRAME
def hatch_mask():
  g=cv2.imread(f'{S}/src/p6-000.jpg').max(axis=2).astype(np.float32)
  bx0,by0,bx1,by1=1180,630,1385,735
  sub=g[by0:by1,bx0:bx1]
  m=cv2.blur(sub,(5,5)); sd=np.sqrt(np.maximum(cv2.blur(sub*sub,(5,5))-m*m,0))
  # stripes: high std and moderately dark mean
  k=((sd>28)&(m<170)).astype(np.uint8)
  k=cv2.morphologyEx(k,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7)))
  k=cv2.morphologyEx(k,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
  n,cc,st,_=cv2.connectedComponentsWithStats(k,8); c=1+np.argmax(st[1:,4]); k=(cc==c).astype(np.uint8)
  cnts,_=cv2.findContours(k,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE); k[:]=0; cv2.drawContours(k,cnts,-1,1,-1)
  M=np.zeros((y1-y0,x1-x0),np.uint8); M[by0-y0:by1-y0,bx0-x0:bx1-x0]=k
  return M.astype(bool)
if __name__=='__main__':
  M=hatch_mask(); print(M.sum())
  b=cv2.imread(f'{S}/src/p6-000.jpg')[y0:y1,x0:x1].copy(); 
  ov=b.copy(); ov[M]=(0,0,255); b=cv2.addWeighted(b,0.5,ov,0.5,0)
  cv2.imwrite(f'{S}/work/hatch.png',cv2.resize(b[630-y0:735-y0,1180-x0:1385-x0],None,fx=4,fy=4))
