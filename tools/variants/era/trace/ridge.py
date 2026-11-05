import cv2, numpy as np
from skimage.filters import sato
from seeds import FRAME
import os; S=os.environ.get('ERA_TRACE_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), '_work'))
x0,y0,x1,y1=FRAME
im=cv2.imread(f'{S}/src/eoe.jpg').astype(np.float32)/255
g=im.mean(axis=2)
r=sato(g,sigmas=[0.8,1.2],black_ridges=True)
r=r/np.percentile(r,99.5)*200
M=np.load(f'{S}/work/eoe_reg.png.npy')
W=cv2.warpAffine(r.astype(np.float32),M,(2401,1614),flags=cv2.INTER_LINEAR)[y0:y1,x0:x1]
np.save(f'{S}/work/RE.npy',W)
print(np.percentile(W,[50,90,95,99]))
cv2.imwrite(f'{S}/work/RE.png',np.clip(W,0,255).astype(np.uint8))
