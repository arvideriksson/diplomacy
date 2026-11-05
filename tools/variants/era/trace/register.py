import cv2, numpy as np, sys
import os; S=os.environ.get('ERA_TRACE_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), '_work'))
blue=cv2.imread(f'{S}/src/p6-000.jpg'); 
def reg(path, out, model='affine'):
  im=cv2.imread(path)
  g1=cv2.cvtColor(blue,cv2.COLOR_BGR2GRAY); g2=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY)
  # equalize to make line structure comparable
  cl=cv2.createCLAHE(3,(8,8)); g1=cl.apply(g1); g2=cl.apply(g2)
  sift=cv2.SIFT_create(20000)
  k1,d1=sift.detectAndCompute(g1,None); k2,d2=sift.detectAndCompute(g2,None)
  m=cv2.BFMatcher().knnMatch(d2,d1,k=2)
  good=[a for a,b in m if a.distance<0.75*b.distance]
  src=np.float32([k2[a.queryIdx].pt for a in good]); dst=np.float32([k1[a.trainIdx].pt for a in good])
  if model=='affine':
    M,inl=cv2.estimateAffine2D(src,dst,ransacReprojThreshold=3,maxIters=20000)
    w=cv2.warpAffine(im,M,(blue.shape[1],blue.shape[0]),flags=cv2.INTER_CUBIC)
  else:
    M,inl=cv2.findHomography(src,dst,cv2.RANSAC,3,maxIters=20000)
    w=cv2.warpPerspective(im,M,(blue.shape[1],blue.shape[0]),flags=cv2.INTER_CUBIC)
  print(path, len(good), int(inl.sum()), M)
  # residuals
  inl=inl.ravel().astype(bool)
  p=cv2.transform(src[None,inl],M)[0] if model=='affine' else cv2.perspectiveTransform(src[None,inl],M)[0]
  r=np.linalg.norm(p-dst[inl],axis=1); print('resid mean %.2f p90 %.2f'%(r.mean(),np.percentile(r,90)))
  cv2.imwrite(out,w); np.save(out+'.npy',M)
if len(sys.argv)<2: reg(f'{S}/src/eoe.jpg', f'{S}/work/eoe_reg.png')
if __name__=='__main__' and len(sys.argv)>1 and sys.argv[1]=='photo':
  reg(f'{S}/src/board_hi.jpg', f'{S}/work/photo_reg.png', 'homography')
