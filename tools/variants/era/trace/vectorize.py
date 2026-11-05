import cv2, numpy as np, json, collections
from scipy import ndimage as ndi
from shapely.geometry import LineString, Polygon, MultiPolygon, mapping, Point
from shapely.ops import polygonize, unary_union
import shapely
from seeds import LAND, SEA, LAKES, ROCKS, FRAME, ARROWS, SUEZ
import os; S=os.environ.get('ERA_TRACE_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), '_work'))
x0,y0,x1,y1=FRAME
L=np.load(f'{S}/work/L2.npy').astype(np.int32); H,W=L.shape
meta=json.load(open(f'{S}/work/ids.json')); ids=meta['ids']; kind=meta['kind']
LB=np.load(f'{S}/work/LB.npy'); P=np.load(f'{S}/work/P.npy')
num={i:n for n,i in enumerate(ids,1)}
pts={**{i:v[1] for i,v in LAND.items()},**{i:v[1] for i,v in SEA.items()},**LAKES,**ROCKS}

# --- A. tidy: small detached pieces join the neighbour they touch most.
def tidy(L, keep_min=250):
  for n,i in enumerate(ids,1):
    m=L==n
    cc,k=ndi.label(m)
    if k<2: continue
    sizes=ndi.sum(m,cc,range(1,k+1))
    seeded={cc[y-y0,x-x0] for (x,y) in pts.get(i,[]) if 0<=y-y0<H and 0<=x-x0<W}
    for c in range(1,k+1):
      if c in seeded or sizes[c-1]>=keep_min and c==1+int(np.argmax(sizes)): continue
      if c==1+int(np.argmax(sizes)) and not seeded: continue
      if c in seeded: continue
      piece=cc==c; ring=ndi.binary_dilation(piece)&~piece
      nb=L[ring]; nb=nb[nb!=n]
      # a detached piece of sea (a strait channel) stays water: it joins a neighbouring sea
      if kind[i]=='sea' and sizes[c-1]>=30:
        seanb=[v for v in nb if 0<v<=len(ids) and kind[ids[v-1]]=='sea']
        if seanb: L[piece]=np.bincount(seanb).argmax()
        continue
      if len(nb): L[piece]=np.bincount(nb).argmax()
  return L
L=tidy(L)

# --- B. islands and Cebu's water. Line-free components inside seas and Cebu are land or water by
# colour on the linked board: its water is saturated blue (B-R 50..130), its land is grey-green,
# yellow, orange or white (B-R below 40).
ISL=len(ids)+1; CEBW=len(ids)+2
line=LB>45
eoe=cv2.imread(f'{S}/work/photo_reg2.png')[y0:y1,x0:x1].astype(np.float32); BR=cv2.blur(eoe[...,0]-eoe[...,2],(3,3))
for i in list(SEA)+['CEB']:
  n=num[i]; m=(L==n)&~line
  cc,k=ndi.label(m)
  if not k: continue
  sizes=ndi.sum(m,cc,range(1,k+1)); br=ndi.mean(BR,cc,range(1,k+1))
  landish=np.zeros(k+1,bool); landish[1:]=(br<45)&(sizes>=5)
  water=np.zeros(k+1,bool); water[1:]=br>=45
  land=landish[cc]&m
  if i=='CEB':
    # Cebu's islands crowd together: classify each pixel by the photo's colour, not by component.
    region=L==n
    bright=cv2.blur(eoe.mean(axis=2),(3,3))
    landpx=ndi.binary_opening(region&(BR<40)&(bright>120),iterations=1)
    lab,kk=ndi.label(landpx); sz=ndi.sum(landpx,lab,range(1,kk+1))
    keep=np.zeros(kk+1,bool); keep[1:]=sz>=12
    landpx=keep[lab]
    landpx=ndi.binary_closing(ndi.binary_opening(landpx,iterations=2),iterations=1)
    lab2,k2=ndi.label(landpx); sz2=ndi.sum(landpx,lab2,range(1,k2+1))
    keep2=np.zeros(k2+1,bool); keep2[1:]=sz2>=40; landpx=keep2[lab2]&region
    L[region&~landpx]=CEBW
  else:
    L[ndi.binary_dilation(land,iterations=1)&(L==n)]=ISL
# Islets too small to have a line-free interior: bright, unsaturated pixels of the photo inside
# the seas, away from the mainland coast, the gold strait arrows and the title logo.
from seeds import LOGO
bright=cv2.blur(eoe.mean(axis=2),(3,3))
seas=np.isin(L,[num[i] for i in SEA])
inner=ndi.binary_erosion(seas|(L==ISL),iterations=3)
cand=inner&(BR<35)&(bright>110)
excl=np.zeros(L.shape,np.uint8)
for (a,b) in ARROWS.values(): cv2.line(excl,(a[0]-x0,a[1]-y0),(b[0]-x0,b[1]-y0),1,16)
excl[LOGO[1]-y0:LOGO[3]-y0,LOGO[0]-x0:LOGO[2]-x0]=1
cand&=excl==0
lab,kk=ndi.label(cand); sz=ndi.sum(cand,lab,range(1,kk+1))
keep=np.zeros(kk+1,bool); keep[1:]=sz>=6
isl=ndi.binary_dilation(keep[lab],iterations=1)&seas
L[isl]=ISL
print('photo islets px',int(isl.sum()),'components',int(keep.sum()))
# Cebu like classical Denmark: the province is its islands; the water between them joins the
# surrounding seas (each pixel to the nearest one), so the sea borders run on through it.
cw=np.zeros(L.shape,bool)
if cw.any():
  near=np.full(L.shape,np.inf); lab=np.zeros(L.shape,np.int32)
  for i in SEA:
    d=ndi.distance_transform_edt(L!=num[i]); upd=d<near; near[upd]=d[upd]; lab[upd]=num[i]
  L[cw]=lab[cw]
# Cebu's ring is a smooth closed curve on the board: fit an ellipse to the traced ring and use it.
# Inside it, sea is Cebu's water; Manila/Davao keep only land connected to their main bodies;
# every other island inside is Cebu. Outside it, Cebu's water goes back to the nearest sea.
ring=((L==num['CEB'])|(L==CEBW)).astype(np.uint8)
cnts,_=cv2.findContours(ring,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
cnt=max(cnts,key=cv2.contourArea)
ell=cv2.fitEllipse(cnt)
# Shrink it until it clears the Manila and Davao mainlands (the ring runs through water only).
def _main(n):
  m=L==n; cc,k=ndi.label(m); sz=ndi.sum(m,cc,range(1,k+1)); return cc==1+int(np.argmax(sz))
_mm=_main(num['MNA'])|_main(num['DAV'])
for sc_ in [1.0]:
  e2=(ell[0],(ell[1][0]*sc_,ell[1][1]*sc_),ell[2])
  E_=np.zeros(L.shape,np.uint8); cv2.ellipse(E_,e2,1,-1); E_=E_>0
  if (E_&ndi.binary_dilation(_mm,iterations=2)).sum()<2: break
ell=e2
# Where the ring meets Manila it follows Manila's coast: thin water between the ellipse and
# Manila's mainland is Cebu's.
_sea0=np.isin(L,[num[i] for i in SEA])
_band=ndi.binary_dilation(E_,iterations=9)&ndi.binary_dilation(_main(num['MNA']),iterations=9)&_sea0&~E_
E_=E_|_band
seaN=[num[i] for i in SEA]
for nm_ in ['MNA','DAV']:
  m=L==num[nm_]; out_=m&~E_
  cc,k=ndi.label(m); keep=set(np.unique(cc[out_]))-{0}
  stray=m&~np.isin(cc,list(keep))
  L[stray]=num['CEB']
inner_land=E_&np.isin(L,[num['CEB'],ISL])
L[E_&np.isin(L,seaN+[CEBW])]=CEBW
L[inner_land]=num['CEB']
outside=~E_&((L==CEBW)|(L==num['CEB']))
_,(sy2,sx2)=ndi.distance_transform_edt(~(np.isin(L,seaN)&~E_),return_indices=True)
L[outside&(L==CEBW)]=L[sy2[outside&(L==CEBW)],sx2[outside&(L==CEBW)]]
print('cebu ellipse',[round(v,1) for v in (*ell[0],*ell[1],ell[2])])
# Clean the islets: none in the title logo; an islet touching a land province is a piece of its
# coast and joins it; needle-thin slivers (photo seams along coasts) go back to the sea.
seasets=[num[i] for i in SEA]
isl=L==ISL
lab,kk=ndi.label(isl)
_,(sy,sx)=ndi.distance_transform_edt(~np.isin(L,seasets),return_indices=True)
landn=[num[i] for i in LAND]
for c,sl in enumerate(ndi.find_objects(lab),1):
  m=np.zeros(L.shape,bool); m[sl]=lab[sl]==c
  ys,xs=np.nonzero(m); cx,cy=xs.mean()+x0,ys.mean()+y0
  ring=ndi.binary_dilation(m,iterations=1)&~m
  nb=L[ring]; touch=[v for v in nb if v in landn]
  thin=ndi.distance_transform_edt(np.pad(m,1))[1:-1,1:-1].max()<2.2
  hh,ww=sl[0].stop-sl[0].start,sl[1].stop-sl[1].start
  thin=thin or max(hh,ww)>5*min(hh,ww)  # glare streaks in the photo
  inlogo=LOGO[0]<=cx<LOGO[2] and LOGO[1]<=cy<LOGO[3]
  if inlogo or thin or m.sum()<45: L[m]=L[sy[m],sx[m]]
  elif len(touch)>len(nb)*0.25: L[m]=np.bincount(touch).argmax()
# Every remaining islet belongs to the nearest land province (drawn as one more piece of it,
# like the islands of classical Denmark).
landmask=np.isin(L,landn)
_,(ly,lx)=ndi.distance_transform_edt(~landmask,return_indices=True)
OWNER=L[ly,lx]
# The Maasai lake from the photo: blue pixels inside its basin are lake.
vic=num['#victoria']; box=np.zeros(L.shape,bool); box[1180-y0:1340-y0,140-x0:320-x0]=True
basin=box&np.isin(L,[vic,num['MAA']])&ndi.binary_dilation(L==vic,iterations=6)
lake=basin&(BR>45)
lake=ndi.binary_opening(lake,iterations=1)
L[basin&lake]=vic; L[basin&~lake&(L==vic)]=num['MAA']
# Angora's north coast at the Bosphorus is traced as an islet; it is Angora.
_b=np.zeros(L.shape,bool); _b[438-y0:460-y0,120-x0:230-x0]=True
L[_b&(L==ISL)]=num['ANG']
from seeds import PHOTO_BOXES
_ph=cv2.imread(f'{S}/work/photo_reg2.png').astype(np.int32)[y0:y0+H,x0:x0+W]
_B,_G,_R=_ph[...,0],_ph[...,1],_ph[...,2]
_water=((_B-_R>45)&(_G-_R>25)&(_ph.sum(2)>300))|((_B>225)&(_G>195)&(_B-_R>30))  # incl. photo glare
_unknown=(_ph.sum(2)<260)|((_R-_B>40)&(_R>110))
# the dark sea-border line along y≈1182 (board) is ink on water, not land
_unknown[1178:1187,1350:1520]=True
_landN=[num[i] for i in LAND]
for (bx0,by0,bx1,by1),owners in PHOTO_BOXES:
  box=np.zeros(L.shape,bool); box[by0:by1,bx0:bx1]=True
  known=box&~_unknown
  _,(ky,kx)=ndi.distance_transform_edt(~known,return_indices=True)
  wat=np.where(box,_water[ky,kx],False)
  wat=ndi.binary_opening(ndi.binary_closing(wat,iterations=1),iterations=1)
  wat=ndi.binary_dilation(wat,iterations=1)
  from seeds import WATER_POLYS
  for pl in WATER_POLYS:
    cb=np.zeros(L.shape,np.uint8); cv2.fillPoly(cb,[np.int32(pl)],1); wat|=cb>0
  wat&=box
  lnd=box&~wat
  # drop specks
  lab,kk=ndi.label(lnd); sz=ndi.sum(lnd,lab,range(1,kk+1)); small=np.zeros(kk+1,bool); small[1:]=sz<25
  sp=small[lab]&lnd; wat|=sp; lnd&=~sp
  isLand=np.isin(L,_landN); isSea=np.isin(L,seasets)
  _,(ly,lx)=ndi.distance_transform_edt(~(isLand&(~box|lnd)),return_indices=True)
  _,(sy,sx)=ndi.distance_transform_edt(~(isSea&(~box|wat)),return_indices=True)
  newL=L.copy()
  newL[lnd]=L[ly[lnd],lx[lnd]]; newL[wat]=L[sy[wat],sx[wat]]
  for pid,(px,py) in owners.items():
    lab,_=ndi.label(lnd); c=lab[py,px]
    if c: newL[lab==c]=num[pid]
  L=newL
  print('photo box',(bx0,by0,bx1,by1),'land',int(lnd.sum()),'water',int(wat.sum()))
from seeds import SEA_FORCE
for pl in SEA_FORCE:
  fm=np.zeros(L.shape,np.uint8); cv2.fillPoly(fm,[np.int32([(x-x0,y-y0) for x,y in pl])],1); fm=fm>0
  ref=np.isin(L,seasets)&~fm
  _,(fy,fx)=ndi.distance_transform_edt(~ref,return_indices=True)
  L[fm]=L[fy[fm],fx[fm]]
from seeds import LAND_REASSIGN
for a_,b_,(bx0,by0,bx1,by1) in LAND_REASSIGN:
  sub=L[by0:by1,bx0:bx1]; sub[sub==num[a_]]=num[b_]
from seeds import BOSPHORUS_NORTH
bx0,by0,bx1,by1=BOSPHORUS_NORTH
for x in range(bx0,bx1):
  col=L[by0:by1+15,x]; seaY=[i for i,v in enumerate(col) if v in seasets]
  if not seaY: continue
  top=seaY[0]
  for i in range(top):
    if col[i]==num['ANG']: L[by0+i,x]=num['CON']
from seeds import SEA_SPLITS
for (bx0,by0,bx1,by1),(p0,p1),left,right in SEA_SPLITS:
  ys,xs=np.mgrid[by0:by1,bx0:bx1]
  sub=L[by0:by1,bx0:bx1]; sm=np.isin(sub,seasets)
  cr=(p1[0]-p0[0])*(ys-p0[1])-(p1[1]-p0[1])*(xs-p0[0])
  sub[sm&(cr>0)]=num[left]; sub[sm&(cr<=0)]=num[right]
from seeds import SEA_ASSIGN
for sid,pl in SEA_ASSIGN:
  fm=np.zeros(L.shape,np.uint8); cv2.fillPoly(fm,[np.int32(pl)],1)
  L[(fm>0)&np.isin(L,seasets)]=num[sid]
# The islets north of New Guinea straight from the blue board: inside the box, the regions an
# outline encloses are islets (one class, impassable); everything else is the surrounding sea.
_bx=(2085,1060,2196,1175)
sub=LB[_bx[1]:_bx[3],_bx[0]:_bx[2]]
line=sub>45; cc_,k_=ndi.label(~line)
sz=ndi.sum(~line,cc_,range(1,k_+1)); seac=1+int(np.argmax(sz))
inner=(~line)&(cc_!=seac)&(cc_>0)
# thin legs have no line-free interior: count dark outline pixels enclosed by the island's hull too
filled=ndi.binary_fill_holes(ndi.binary_closing(line,iterations=2))
inner=(ndi.binary_dilation(inner,iterations=2)|ndi.binary_erosion(filled&line,iterations=1))&filled
reg=L[_bx[1]:_bx[3],_bx[0]:_bx[2]]
seam=np.isin(reg,seasets)
_,(qy,qx)=ndi.distance_transform_edt(~seam,return_indices=True)
reg[~inner]=reg[qy[~inner],qx[~inner]]
reg[inner]=ISL
# a thin water gap between the large island and the small islet touching it to the north-east
gap=np.zeros(L.shape,np.uint8); cv2.line(gap,(2121,1082),(2125,1094),1,2); gap=gap>0
L[gap&(L==ISL)]=L[qy[0,0]+_bx[1],qx[0,0]+_bx[0]] if False else num['LPO']
# Southern Manila from the blue board: land is what its outlines enclose; the thick dark inlets
# drawn into the peninsula are water. Only Manila and sea pixels change (Cebu keeps its own).
_mb=(1960,780,2060,850)
sub=LB[_mb[1]:_mb[3],_mb[0]:_mb[2]]; line=sub>45
cc_,k_=ndi.label(~line); sz=ndi.sum(~line,cc_,range(1,k_+1))
seac={i+1 for i,v in enumerate(sz) if v>1500}
reg=L[_mb[1]:_mb[3],_mb[0]:_mb[2]]
_seaf=ndi.mean(np.isin(reg,seasets).astype(float),cc_,range(1,k_+1))
landc={i+1 for i in range(k_) if (i+1) not in seac and (_seaf[i]<0.5 or sz[i]<150)}
landm=np.isin(cc_,list(landc))
landm=ndi.binary_dilation(landm,iterations=1)
editable=(reg==num['MNA'])|np.isin(reg,seasets)
seam=np.isin(reg,seasets)
_,(qy,qx)=ndi.distance_transform_edt(~seam,return_indices=True)
newsea=editable&~landm
reg[newsea]=reg[qy[newsea],qx[newsea]]
reg[editable&landm]=num['MNA']
lc,_=ndi.label(landm|(reg==num['MNA']))
mnac=set(np.unique(lc[reg==num['MNA']]))-{0}
tip=np.isin(lc,list(mnac))&(reg==num['CEB'])
reg[tip]=num['MNA']; print('manila tip px from cebu',int(tip.sum()))
from seeds import BLUE_BOXES
_landN2=[num[i] for i in LAND]
for (bx0,by0,bx1,by1) in BLUE_BOXES:
  sub=LB[by0:by1,bx0:bx1]; line=sub>45
  reg=L[by0:by1,bx0:bx1]
  cc_,k_=ndi.label(~line); sz=ndi.sum(~line,cc_,range(1,k_+1))
  landf=ndi.mean(np.isin(reg,_landN2).astype(float),cc_,range(1,k_+1))
  # land: mostly-land components, or small enclosed ones not touching the box edge
  edge=set(np.unique(np.concatenate([cc_[0],cc_[-1],cc_[:,0],cc_[:,-1]])))
  landc=[i+1 for i in range(k_) if landf[i]>0.5 or (sz[i]<600 and (i+1) not in edge)]
  lm=np.isin(cc_,landc); sm=(~line)&~lm
  dl=ndi.distance_transform_edt(~lm); ds=ndi.distance_transform_edt(~sm)
  # only a thin rim of each outline is land, so islets whose outlines touch stay apart
  lm=lm|(line&(dl<=1.5)&(dl<=ds))
  # labels: land from the nearest land pixel outside the box or a mostly-land component; sea likewise
  full_land=np.isin(L,_landN2); full_sea=np.isin(L,seasets)
  boxm=np.zeros(L.shape,bool); boxm[by0:by1,bx0:bx1]=True
  keepL=full_land&~boxm; keepL[by0:by1,bx0:bx1]|=np.isin(cc_,[i+1 for i in range(k_) if landf[i]>0.5])&np.isin(reg,_landN2)
  keepS=full_sea&~boxm
  _,(ly,lx)=ndi.distance_transform_edt(~keepL,return_indices=True)
  _,(sy,sx)=ndi.distance_transform_edt(~keepS,return_indices=True)
  ys,xs=np.mgrid[by0:by1,bx0:bx1]
  new=np.where(lm,L[ly[by0:by1,bx0:bx1],lx[by0:by1,bx0:bx1]],L[sy[by0:by1,bx0:bx1],sx[by0:by1,bx0:bx1]])
  L[by0:by1,bx0:bx1]=new
# Akita: a pale patch inside it was traced as a lake
_ak=np.zeros(L.shape,bool); _ak[290:320,2090:2130]=True
L[_ak&np.isin(L,seasets+[ISL])&ndi.binary_fill_holes(L==num['AKI'])]=num['AKI']
from seeds import LAND_FORCE
for pid,pl in LAND_FORCE:
  fm=np.zeros(L.shape,np.uint8); cv2.fillPoly(fm,[np.int32([(x-x0,y-y0) for x,y in pl])],1)
  L[fm>0]=num[pid]
for sid,pl in SEA_ASSIGN:
  fm=np.zeros(L.shape,np.uint8); cv2.fillPoly(fm,[np.int32(pl)],1)
  L[(fm>0)&np.isin(L,seasets)]=num[sid]
# Cebu's ring, north-west: follow the board's curve from Manila's coast round to the west.
_cr=np.zeros(L.shape,np.uint8)
_ring=[(1933,808),(1923,809),(1916,813),(1909,819),(1905,827),(1902,838),(1901,848),(1901,859),(1902,869),(1904,880),(1907,889)]
cv2.fillPoly(_cr,[np.int32(_ring+[(1960,889),(1960,808)])],1); _cr=_cr>0
_sect=np.zeros(L.shape,bool); _sect[800:890,1870:1960]=True
_out=_sect&~_cr&(L==CEBW)
_sm=np.isin(L,seasets)&~_sect
_,(_qy,_qx)=ndi.distance_transform_edt(~_sm,return_indices=True)
L[_out]=L[_qy[_out],_qx[_out]]
L[_cr&np.isin(L,seasets)]=CEBW
_isl_in=_cr&ndi.binary_fill_holes(_cr)&(L==ISL)
L[_isl_in]=num['CEB']
# small land pieces of Manila inside the ring that are separate islets are Cebu's
_m=(L==num['MNA'])&_cr; _lab,_k=ndi.label(L==num['MNA'])
_main=1+int(np.argmax(ndi.sum(L==num['MNA'],_lab,range(1,_k+1))))
L[_m&(_lab!=_main)]=num['CEB']
# Sakhalin's northern tip: islet pieces there are Sakhalin
_st=np.zeros(L.shape,bool); _st[5:45,1870:1905]=True
L[_st&(L==ISL)]=num['SAK']
# Cebu's ring, north-east: from Manila's south-eastern tip along y=831, then round to the east.
_ring2=[(2020,831),(2045,831),(2052,834),(2057,840),(2060,850),(2064,860),(2069,870),(2073,880),(2074,888),(2072,895)]
_cr2=np.zeros(L.shape,np.uint8); cv2.fillPoly(_cr2,[np.int32(_ring2+[(2000,895),(2000,831)])],1); _cr2=_cr2>0
_sect2=np.zeros(L.shape,bool); _sect2[818:895,2015:2085]=True
_out2=_sect2&~_cr2&(L==CEBW)
_sm2=np.isin(L,seasets)&~_sect2
_,(_qy,_qx)=ndi.distance_transform_edt(~_sm2,return_indices=True)
L[_out2]=L[_qy[_out2],_qx[_out2]]
L[_sect2&_cr2&np.isin(L,seasets)]=CEBW
# the islet north of the ring off Manila's tip is Manila's
_ni=np.zeros(L.shape,bool); _ni[810:828,2005:2025]=True
L[_ni&np.isin(L,[num['CEB'],ISL])]=num['MNA']
# a speck of Java on the Java Sea / Timor Sea border
_jv=np.zeros(L.shape,bool); _jv[1270:1282,1836:1850]=True
L[_jv&(L==num['JAV'])]=num['JS']
# Sarawak's north-east: an islet piece lying on its coast is Sarawak
_sw=np.zeros(L.shape,bool); _sw[1000:1035,1875:1910]=True
L[_sw&(L==ISL)]=num['SAR']
# Enclosed specks: a small piece of sea surrounded by land becomes that land.
_seaall=np.isin(L,seasets)
_lab,_k=ndi.label(_seaall)
_sz=ndi.sum(_seaall,_lab,range(1,_k+1))
for c in np.nonzero(_sz<120)[0]+1:
  m=_lab==c; ring=ndi.binary_dilation(m)&~m; nb=L[ring]; nb=nb[~np.isin(nb,seasets)]
  if len(nb) and len(nb)==ring.sum(): L[m]=np.bincount(nb).argmax()
np.save(f'{S}/work/Lfinal.npy',L)
names=ids+['#island','#cebuwater']
def nm(v): return names[v-1]

# --- C. crack-edge chains.
pad=np.pad(L,1,constant_values=0)  # 0 = outside the board
edges=collections.defaultdict(list)  # vertex -> list of (other vertex, labels)
segs=[]
# vertical cracks: between pad[y,x] and pad[y,x+1] at lattice x (board), spanning y-1..y (board)
a=pad[:,:-1]; b=pad[:,1:]; ys,xs=np.nonzero(a!=b)
for y,x in zip(ys,xs):
  segs.append(((x,y-1),(x,y),(a[y,x],b[y,x])))
a=pad[:-1,:]; b=pad[1:,:]; ys,xs=np.nonzero(a!=b)
for y,x in zip(ys,xs):
  segs.append(((x-1,y),(x,y),(a[y,x],b[y,x])))
adj=collections.defaultdict(list)
for k,(p,q,lab) in enumerate(segs): adj[p].append(k); adj[q].append(k)
used=np.zeros(len(segs),bool)
def pair(k): return tuple(sorted(segs[k][2]))
junction={v for v,ks in adj.items() if len(ks)!=2}
chains=[]
def walk(k,start):
  path=[start]; v=start
  while True:
    used[k]=True; p,q,_=segs[k]; v=q if p==v else p; path.append(v)
    if v in junction or v==start: return path
    nxt=[j for j in adj[v] if not used[j]]
    if not nxt: return path
    k=nxt[0]
for v in junction:
  for k in adj[v]:
    if not used[k]: chains.append((walk(k,v),pair(k)))
for k in range(len(segs)):
  if not used[k]: chains.append((walk(k,segs[k][0]),pair(k)))
print('chains',len(chains))

def smooth(path, closed, win=5, tol=0.35):
  pts=np.array(path,float)
  if len(pts)<5: return pts
  if closed and len(pts)<140:
    # small islets: a light smooth that keeps the ring valid
    r=pts[:-1]; k=np.array([0.25,0.5,0.25])
    sm=np.stack([np.convolve(np.concatenate([r[-1:,j],r[:,j],r[:1,j]]),k,'valid') for j in (0,1)],1)
    return np.vstack([sm,sm[:1]])
  if closed: pts=pts[:-1]
  n=len(pts); w=min(win, (n-1)//2*2+1 if not closed else win)
  if w>=3:
    k=np.ones(w)/w
    if closed:
      ext=np.concatenate([pts[-(w//2):],pts,pts[:w//2]]); sm=np.stack([np.convolve(ext[:,j],k,'valid') for j in (0,1)],1)
    else:
      sm=pts.copy()
      for j in (0,1):
        c=np.convolve(pts[:,j],k,'same'); sm[w//2:n-w//2,j]=c[w//2:n-w//2]
      # taper toward fixed endpoints
    pts=sm
  if closed: pts=np.vstack([pts,pts[:1]])
  ls=LineString(pts).simplify(tol,preserve_topology=False)
  return np.array(ls.coords)
lines=[]; chain_out=[]
for path,(la,lb) in chains:
  closed=path[0]==path[-1]
  frame_edge=(la==0 or lb==0)
  sp=np.array(path,float) if frame_edge else smooth(path,closed)
  if len(sp)<2: continue
  lines.append(LineString(sp))
noded=unary_union(lines)
faces=list(polygonize(noded))
print('faces',len(faces))
geo=collections.defaultdict(list)
Lpad=L
for f in faces:
  if f.area<0.05: continue
  rp=f.representative_point(); x,y=int(rp.x),int(rp.y)
  x=min(max(x,0),W-1); y=min(max(y,0),H-1)
  v=Lpad[y,x]
  if v==0: continue
  geo[v].append(f)
out={}
for v,fs in geo.items():
  g=unary_union(fs).buffer(0)
  if g.geom_type=='Polygon': g=MultiPolygon([g])
  out[nm(v)]=[[list(map(lambda c:[round(c[0],2),round(c[1],2)],r.coords)) for r in [p.exterior,*p.interiors]] for p in g.geoms]
missing=[i for i in ids if i not in out and kind[i]!='rock' or (kind[i]=='rock' and i not in out)]
print('missing',missing)
# area check vs pixels
for v,i in enumerate(names,1):
  if i in out:
    a=sum(Polygon(p[0],p[1:]).area for p in out[i]); px=(L==v).sum()
    if px and abs(a-px)/px>0.1: print('area mismatch',i,round(a),px)

# --- D. supply centres: template matches, plus Tokyo/Otaru (white islands) and Bangkok placed by eye.
SC="ADE ANG ANN BAG BAN BEN BOM BOR CAN CEY CHU COC CON COR DAV DEL EGY FOR HK IRK JAV KAM KAR KYO KYU MAD MNA MOM MOS NG ODE OTA PA PEK PER RAN RUM SAK SAR SHA SHI SIG SIN SUD SUM TAB TAS TOK TON VLA".split()
assert len(SC)==50 and len(set(SC))==50
st=json.load(open(f'{S}/work/stars.json'))
centers={}
for x,yv,sc in sorted(st,key=lambda t:-t[2]):
  i=nm(L[yv-y0,x-x0]) if L[yv-y0,x-x0] else None
  if i in SC and i not in centers and sc>0.36: centers[i]=[x-x0,yv-y0]
centers.update({'TOK':[2239-x0,526-y0],'OTA':[2175-x0,375-y0],'BAN':[1648-x0,991-y0]})
assert set(centers)==set(SC), set(SC)^set(centers)
def shift(p): return [p[0]-x0,p[1]-y0]
geo={
  'width':W,'height':H,
  'provinces':{k:v for k,v in out.items() if not k.startswith('#')},
  'lakes':[out[k] for k in LAKES if k!='#strait' and k in out], 'islands':[{'owner':names[OWNER[int(Polygon(p[0]).representative_point().y),int(Polygon(p[0]).representative_point().x)]-1],'poly':p} for p in out.get('#island',[])], 'himalaya':out.get('#himalaya',[]),
  'cebuWater':out.get('#cebuwater',[]),
  'centers':centers,
  'seeds':{i:[shift(p) for p in pts[i]] for i in list(LAND)+list(SEA)},
  'names':{**{i:v[0] for i,v in LAND.items()},**{i:v[0] for i,v in SEA.items()}},
  'sea':list(SEA),
  'arrows':{f'{a}|{b}':[shift(p) for p in pq] for (a,b),pq in ARROWS.items()},
  'suez':[shift(p) for p in SUEZ],
}
json.dump(geo,open(f'{S}/work/geometry.json','w'))
print('wrote geometry', len(geo['provinces']), 'provinces', len(geo['islands']), 'island polys')
