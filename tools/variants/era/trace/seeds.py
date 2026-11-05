# Seeds in blue-image pixel coordinates. id: (name, kind, [points])
LAND = {
 'ABY':('Abyssinia',[(370,1110)]), 'ADE':('Aden',[(560,965)]), 'AFG':('Afghanistan',[(870,545)]),
 'AKI':('Akita',[(2215,450)]), 'ANG':('Angora',[(250,480)]), 'ANN':('Annam',[(1785,935)]),
 'ARA':('Arabia',[(540,800)]), 'ARM':('Armenia',[(400,470)]), 'ASM':('Assam',[(1520,700)]),
 'BAG':('Baghdad',[(450,620)]), 'BAK':('Baku',[(420,390)]), 'BAN':('Bangkok',[(1620,975)]),
 'BEN':('Bengal',[(1415,790)]), 'BOK':('Bokhara',[(760,440)]), 'BOM':('Bombay',[(1090,880)]),
 'BOR':('Borneo',[(1925,1260)]), 'CAM':('Cambodia',[(1700,990)]), 'CAN':('Canton',[(1855,735)]),
 'CEB':('Cebu',[(2070,980)]), 'CEL':('Celebes',[(2040,1280)]), 'CEY':('Ceylon',[(1235,1125)]),
 'CHU':('Chungking',[(1680,645)]), 'COC':('Cochin',[(1760,1030)]), 'CON':('Constantinople',[(120,420)]),
 'COR':('Corea',[(2035,530)]), 'DAV':('Davao',[(2140,1060)]), 'DEL':('Delhi',[(1170,775)]),
 'EGY':('Egypt',[(150,730),(280,660)]), 'ERI':('Eritrea',[(360,970)]), 'FOR':('Formosa',[(2060,700)]),
 'HK':('Hong Kong',[(1820,860)]), 'HYD':('Hyderabad',[(1230,890)]), 'IRK':('Irkutsk',[(1530,170)]),
 'JAV':('Java',[(1820,1395)]), 'KAR':('Karachi',[(910,675)]), 'KAG':('Kashgar',[(1140,505)]),
 'KAM':('Kashmir',[(1135,585)]), 'KIR':('Kirghiz',[(1070,235)]), 'KYO':('Kyoto',[(2170,540),(2170,580)]),
 'KYU':('Kyushu',[(2120,620)]), 'LAN':('Lanchow',[(1590,480)]), 'LUC':('Lucknow',[(1260,795)]),
 'MAA':('Maasai',[(215,1340)]), 'MAD':('Madras',[(1195,1035)]), 'MAL':('Malaya',[(1665,1160)]),
 'MAN':('Manchuria',[(1790,340)]), 'MAY':('Mandalay',[(1580,860)]), 'MNA':('Manila',[(2045,855)]),
 'MEC':('Mecca',[(350,750)]), 'MOM':('Mombasa',[(330,1380)]), 'MON':('Mongolia',[(1530,350)]),
 'MOS':('Moscow',[(375,150)]), 'MYS':('Mysore',[(1095,945),(1140,1040)]), 'NAG':('Nagpur',[(1230,820)]),
 'NEP':('Nepal',[(1260,690)]), 'NG':('New Guinea',[(2290,1345)]), 'ODE':('Odessa',[(240,275),(257,363)]),
 'OMA':('Oman',[(760,850)]), 'OMS':('Omsk',[(1010,125)]), 'ORE':('Orenburg',[(780,190)]),
 'OTA':('Otaru',[(2215,345)]), 'PEK':('Peking',[(1700,430)]), 'PER':('Persia',[(720,570)]),
 'PA':('Port Arthur',[(1920,440)]), 'PUN':('Punjab',[(1030,620)]), 'RAJ':('Rajputana',[(1015,735)]),
 'RAN':('Rangoon',[(1550,890)]), 'RUM':('Rumania',[(160,330)]), 'SAK':('Sakhalin',[(2110,220)]),
 'SAR':('Sarawak',[(1925,1180)]), 'SHA':('Shanghai',[(1880,600)]), 'SHI':('Shiraz',[(575,610)]),
 'SIG':('Singapore',[(1760,1240)]), 'SIN':('Sinkiang',[(1430,560)]), 'SOM':('Somalia',[(520,1160)]),
 'SUD':('Sudan',[(195,1000)]), 'SUM':('Sumatra',[(1640,1270)]), 'SYR':('Syria',[(330,540)]),
 'TAB':('Tabriz',[(515,515)]), 'TAS':('Tashkent',[(1020,385)]), 'TIB':('Tibet',[(1260,630)]),
 'TOK':('Tokyo',[(2235,540)]), 'TON':('Tonkin',[(1700,830)]), 'URU':('Urumchi',[(1210,405)]),
 'VLA':('Vladivostok',[(1880,230)]), 'YUN':('Yunnan',[(1630,770)]),
}
SEA = {
 'ANS':('Andaman Sea',[(1590,1070)]), 'ARS':('Arabian Sea',[(880,880)]), 'BOB':('Bay of Bengal',[(1410,1000)]),
 'BS':('Black Sea',[(290,395),(200,425)]), 'CS':('Celebes Sea',[(2060,1130)]), 'ECS':('East China Sea',[(2000,800)]),
 'EIO':('East Indian Ocean',[(1420,1215)]), 'GOA':('Gulf of Aden',[(580,1300)]), 'GOS':('Gulf of Siam',[(1830,1120)]),
 'JS':('Java Sea',[(1880,1330)]), 'LPO':('Lower Pacific Ocean',[(2250,1150)]), 'MS':('Mediterranean Sea',[(250,580)]),
 'MPO':('Middle Pacific Ocean',[(2220,830)]), 'PG':('Persian Gulf',[(640,735)]), 'RS':('Red Sea',[(420,900)]),
 'SOJ':('Sea of Japan',[(2085,440),(2160,303)]), 'SOO':('Sea of Okhotsk',[(2230,160)]), 'SCS':('South China Sea',[(1950,950)]),
 'SIO':('South Indian Ocean',[(820,1430)]), 'TS':('Timor Sea',[(2060,1460)]), 'UPO':('Upper Pacific Ocean',[(2275,610)]),
 'WIO':('West Indian Ocean',[(1000,1160)]), 'YS':('Yellow Sea',[(2030,600)]),
}
# Impassable, unnamed: lakes are water, the rest land.
LAKES = {'#caspian':[(580,420)], '#aral':[(725,380)], '#victoria':[(245,1265)]}
ROCKS = {'#himalaya':[]}  # stamped from the hatch texture (hatch.py)
FRAME = (104, 104, 2300, 1514)
assert len(LAND)==86 and len(SEA)==23, (len(LAND),len(SEA))
# Strait arrows (blue px): drawn over coasts; in-painted out of the line maps.
ARROWS = {
 ('CON','ANG'):[(156,424),(178,456)], ('MAD','CEY'):[(1202,1075),(1231,1117)],
 ('VLA','SAK'):[(2000,179),(2029,154)], ('SAK','OTA'):[(2135,287),(2158,319)],
 ('OTA','AKI'):[(2213,373),(2220,424)], ('KYO','KYU'):[(2137,549),(2118,588)],
 ('CAN','HK'):[(1820,805),(1835,842)], ('MAL','SIG'):[(1714,1203),(1729,1237)],
 ('MNA','CEB'):[(2062,905),(2068,947)], ('CEB','DAV'):[(2132,979),(2150,1017)],
}
SUEZ = [(242,643),(260,688)]
# Extra ridges (blue px polylines) and cleared corridors for the segmentation.
BARRIERS = [
 [(193,380),(191,390),(190,397),(188,405),(185,413),(178,418),(174,425),(170,432)],   # Constantinople's Black Sea coast under its label box
 [(2120,1022),(2134,1013),(2147,1007),(2160,1003),(2172,1000)],   # Cebu ring under the Cebu-Davao arrow
 [(2036,924),(2050,920),(2064,918),(2078,918)],   # Cebu ring under the Manila-Cebu arrow
 [(2175,495),(2177,507),(2170,517),(2160,526),(2142,527),(2132,531),(2121,542),(2120,555)],   # Kyoto's faint west coast (white land)
 [(2112,561),(2128,556),(2142,550)], [(2100,572),(2117,569),(2133,578)],   # Kyoto / Kyushu coasts beside the strait arrow
 [(2092,582),(2094,598),(2100,612)],
]
CLEARS = []

# Boxes (blue px x0,y0,x1,y1) where a label erased the blue coast: use the linked board's ridge there.
RE_BOXES = [(2070,170,2160,240), (2125,280,2175,335)]
# Boxes where stage 2 (land borders) uses the blue board's lines: island groups whose borders match and whose retail relief is noisy.
BLUE_LAND_BOXES = [(2090,330,2300,640), (1990,830,2200,1100)]

# Areas where water hidden under strait arrows or squeezed between islands is recovered from
# the photo's colour (blue-board px x0,y0,x1,y1): the Inland Sea between Kyoto, Shikoku and Kyushu.
WATER_BOXES = [(2090,530,2200,640)]
# The title logo in the South Indian Ocean (blue px), never islands.
LOGO = (940,1290,1560,1514)
# Coastlines hidden under each strait arrow, traced from the 3484px photo (blue-board px).
# The arrow strip is erased from the line maps and only these lines are drawn back, so the
# channel between the two coasts stays water.
STRAIT_COASTS = {
 ('CON','ANG'): [[(137,436),(149,438),(157,436),(165,432),(171,429),(177,424),(183,421),(197,420)],
                 [(137,448),(149,447),(163,443),(171,440),(179,436),(189,432),(197,430)]],
 ('MAD','CEY'): [[(1200,1095),(1207,1092),(1217,1088),(1227,1085),(1234,1081)],
                 [(1233,1086),(1232,1094),(1230,1104),(1229,1112),(1233,1120)]],
 ('VLA','SAK'): [[(2005,146),(2007,152),(2011,159),(2010,166),(2007,172),(2004,178),(2000,186)],
                 [(2018,138),(2020,144),(2024,151),(2027,157),(2030,163),(2033,170)]],
 ('SAK','OTA'): [[(2125,282),(2129,284),(2137,287),(2143,291),(2147,292),(2149,290),(2152,285)],
                 [(2144,315),(2143,308),(2143,301),(2146,303),(2150,305),(2156,307),(2163,309)]],
 ('OTA','AKI'): [[(2187,380),(2197,384),(2207,387),(2217,389),(2227,387),(2235,382),(2239,377)],
                 [(2195,404),(2199,402),(2207,398),(2213,399),(2219,403),(2222,412),(2223,420)]],
 ('KYO','KYU'): [[(2115,540),(2120,543),(2126,548),(2134,550),(2142,552),(2148,553)],
                 [(2100,574),(2106,571),(2118,566),(2128,569),(2138,565),(2148,559)]],
 ('CAN','HK'):  [[(1806,806),(1812,805),(1820,802),(1828,803),(1840,802),(1846,803)],
                 [(1822,836),(1826,833),(1831,829),(1838,829),(1846,831),(1850,834)]],
 ('MAL','SIG'): [[(1712,1229),(1718,1228),(1725,1227),(1732,1226),(1738,1225)],
                 [(1714,1235),(1720,1233),(1727,1231),(1734,1232),(1740,1234)]],
 ('MNA','CEB'): [[(2051,914),(2057,912),(2063,910),(2069,912),(2075,914)],
                 [(2053,938),(2059,936),(2065,933),(2071,935),(2077,937)]],
 ('CEB','DAV'): [[(2129,994),(2135,996),(2141,998),(2147,999),(2153,998)],
                 [(2133,1010),(2139,1008),(2145,1008),(2151,1010),(2157,1011)]],
}
# Each channel is seeded as water midway between its two traced coasts, along the arrow.
def _channel_seed(arrow, coasts):
  from shapely.geometry import LineString
  (ax,ay),(bx,by)=arrow; dx,dy=bx-ax,by-ay
  line=LineString([(ax-dx,ay-dy),(bx+dx,by+dy)])
  ps=[]
  for c in coasts:
    hit=line.intersection(LineString(c))
    if hit.is_empty: return None
    p=hit if hit.geom_type=='Point' else list(hit.geoms)[0]; ps.append((p.x,p.y))
  return (round((ps[0][0]+ps[1][0])/2),round((ps[0][1]+ps[1][1])/2))
# Hand-drawn channels (centreline in blue-board px, width) for straits the automatic carve misses.
CHANNELS = {
 ('VLA','SAK'): ([(2010,118),(2012,135),(2013,150),(2016,168),(2019,185),(2022,200)], 9),
 ('OTA','AKI'): ([(2178,390),(2192,393),(2205,394),(2217,396),(2230,392),(2245,384)], 9),
 ('KYO','KYU'): ([(2082,576),(2100,573),(2115,570),(2130,568),(2145,566),(2162,563)], 7),
 ('CAN','HK'):  ([(1786,834),(1800,834),(1815,835),(1830,833),(1845,831),(1862,830)], 6),
}
# Water areas forced to sea (blue px polygons), traced from the photo where labels or arrows hide it:
# the Black Sea under Constantinople's label box, and the Bosphorus channel.
SEA_FORCE_OLD = [
 [(190,383),(190,398),(184,413),(178,425),(240,425),(240,383)],
 [(184,414),(177,426),(170,432),(151,438),(131,439),(122,443),(122,447),(128,445),(134,442),(156,442),(176,437),(189,429),(206,425),(226,422),(226,414)],
]
# Land forced to a province (blue px polygons): Angora's north shore along the Bosphorus.
LAND_FORCE_OLD = [('ANG', [(132,446),(134,444),(156,444),(176,439),(189,431),(206,427),(226,424),(240,424),(240,495),(150,495),(132,470)])]
# Boxes (board units x0,y0,x1,y1) rebuilt from the photo's colour: land vs water per pixel, then
# provinces from the nearest land label and seas from the nearest sea label. `owners` force whole
# land components (within the box) containing a board point to one province.
PHOTO_BOXES = [
 ((872,695,925,735), {}),                         # Rajputana inlet (Gulf of Kutch) and its mouth
 ((2060,240,2180,335), {}),                       # Otaru - Akita
 ((1870,20,2010,240), {'SAK':(2006,130)}),        # Vladivostok - Sakhalin
 ((2000,90,2060,135), {}),                        # Sakhalin's label box (clear of the Sakhalin - Otaru strait)
 ((0,262,160,380), {}),                           # Constantinople - Angora (Bosphorus)
 ((1870,1070,2072,1265), {}),                     # Celebes (stops west of the impassable islets: the photo drifts there)
 ((1350,1040,1560,1260), {}),                     # Sumatra's south-west islets (glare streak)
]
# Channels traced from gridded photo zooms, in BOARD units: always water.
WATER_POLYS = [
 # Mouth of the Rajputana inlet
 [(899,713),(906,717),(895,724),(887,725),(889,720)],
 # Black Sea under Constantinople's label box (the photo's colour handles the rest)
 [(86,262),(105,262),(118,280),(160,280),(160,304),(124,316),(100,320),(88,320),(83,316),(80,300),(84,288),(86,276)],
 # Bosphorus west of the arrow, between Constantinople's south coast and Angora's north coast
 [(18,339),(30,337),(40,339),(50,340),(60,337),(70,332),(76,329),(86,324),(86,327),(78,331),(70,336),(60,340),(50,341),(40,343),(30,345),(18,346)],
 # Sakhalin's label box: water east of the island's real north-east coast
 [(1999,99),(2048,99),(2048,127),(2028,126),(2016,120),(2008,112),(1999,103)],
 # Celebes: gap between the middle peninsula's tip and the islet east of it
 [(2017,1128),(2023,1128),(2024,1153),(2018,1153)],
 # Vladivostok - Sakhalin: between the mainland's coast and Sakhalin's west coast, north to south
 [(1874,20),(1881,35),(1889,48),(1896,62),(1903,73),(1911,83),(1919,92),(1928,102),(1939,114),(1949,124),(1957,135),
  (1972,124),(1965,119),(1957,112),(1947,104),(1937,95),(1927,87),(1918,77),(1912,67),(1906,57),(1900,44),(1895,32),(1890,20)],
 # Otaru - Akita
 [(2085,302),(2089,286),(2100,283),(2112,284),(2122,282),(2130,279),(2140,279),(2142,328),(2127,316),(2117,309),(2108,302),(2100,298),(2093,302),(2087,310)],
]

SEA_FORCE = []
LAND_FORCE = []
# Land of one province given to another inside a box (board units): (from, to, box).
LAND_REASSIGN = [('NG','CEL',(1980,1120,2058,1160))]
# Angora land north of the Bosphorus is Constantinople's (handled per pixel in vectorize: above the channel).
BOSPHORUS_NORTH = (14,320,92,340)
# Sea borders placed as on the board (board units): inside box, sea pixels left/right of the line
# p0->p1 go to the named seas.
SEA_SPLITS = [
 ((2080,276,2165,330), ((2134,279),(2145,327)), 'SOJ', 'SOO'), # Otaru - Akita: sea border east of the arrow
 ((1712,700,1770,735), ((1741,698),(1742,735)), 'SCS', 'ECS'),   # Canton - Hong Kong channel
]
# Sea pixels inside a polygon (board units) belong to the named sea.
SEA_ASSIGN = [
 # Java Sea / Timor Sea: the board's smooth curve from Java's eastern tip to Celebes
 ('JS', [(1760,1225),(1924,1225),(1921,1250),(1905,1257),(1890,1264),(1870,1272),(1850,1278),(1833,1281),(1828,1290),(1760,1290)]),
 ('TS', [(1833,1281),(1850,1278),(1870,1272),(1890,1264),(1905,1257),(1921,1250),(1926,1252),(1926,1320),(1833,1320)]),
 ('GOS', [(1610,1080),(1621,1104),(1633,1126),(1648,1114),(1662,1098),(1680,1078),(1680,1060),(1610,1060)]),  # north of Singapore, west of the curve
 ('JS',  [(1621,1104),(1633,1126),(1633,1140),(1600,1140),(1600,1104)]),                                      # Malacca side, west of the diagonal
]
# Boxes (board units) rebuilt from the blue board's outlines: what an outline encloses is land of the
# nearest land province (islets become pieces of it), the rest is sea; each outline pixel goes to
# the nearer side.
BLUE_BOXES = [(1970,1190,2048,1268), (1776,1256,1852,1290)]   # south-east Celebes islets; islets north-east of Java
