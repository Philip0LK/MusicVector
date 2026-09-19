"""Geometry and reliability for score slicing. No OCR or song-specific inputs."""
import copy, math, time
import cv2
import numpy as np
from PIL import Image, ImageOps

VERSION='image-only-row-v5-geometry'

def project(points,matrix):
 p=np.c_[np.asarray(points,dtype=float),np.ones(len(points))]@np.asarray(matrix).T
 if np.any(np.abs(p[:,2])<1e-7):raise ValueError('singular projection')
 return p[:,:2]/p[:,2:]

def line_evidence(gray):
 h,w=gray.shape
 edges=cv2.Canny(gray,60,160)
 # Hough votes alone can connect pale watermark edges or disconnected glyphs.
 # Geometry needs continuous dark ink along the observed segment.
 threshold=min(180,cv2.threshold(gray,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)[0])
 dark=cv2.dilate((gray<=threshold).astype('uint8'),np.ones((3,3),np.uint8))
 lines=cv2.HoughLinesP(edges,1,np.pi/1800,threshold=25,minLineLength=w*.025,maxLineGap=5)
 groups={'horizontal':[],'vertical':[]}
 for line in ([] if lines is None else np.asarray(lines).reshape(-1,4)):
  ax,ay,bx,by=map(int,line);n=max(abs(bx-ax),abs(by-ay))+1
  xs=np.rint(np.linspace(ax,bx,n)).astype(int);ys=np.rint(np.linspace(ay,by,n)).astype(int)
  if dark[ys,xs].mean()<.8:continue
  x1,y1,x2,y2=(np.asarray(line,dtype=float)-[w/2,h/2,w/2,h/2])/w
  dx=x2-x1;dy=y2-y1
  if abs(dx)>.075 and abs(dy/dx)<.32:
   m=dy/dx;c=(y1+y2)/2-m*(x1+x2)/2;groups['horizontal'].append((c,m,abs(dx)))
  elif abs(dy)>.025 and abs(dx/dy)<.32:
   m=dx/dy;c=(x1+x2)/2-m*(y1+y2)/2;groups['vertical'].append((c,m,abs(dy)))
 def fit(items):
  # Keep a single observation per narrow positional bin to avoid counting
  # both edges of one printed line as independent evidence.
  bins={}
  for c,m,length in items:
   key=round(c/.008)
   if key not in bins or length>bins[key][2]:bins[key]=(c,m,length)
  a=np.array(list(bins.values()))
  if len(a)<4:return None
  pairs=[(q[1]-p[1])/(q[0]-p[0]) for i,p in enumerate(a) for q in a[i+1:] if abs(q[0]-p[0])>.15]
  k=float(np.median(pairs)) if pairs else 0.;b=float(np.median(a[:,1]-k*a[:,0]))
  residual=np.abs(a[:,1]-k*a[:,0]-b);inliers=residual<.012
  if inliers.sum()<4:return None
  good=a[inliers];coverage=float(np.ptp(good[:,0]));support=float(inliers.mean())
  if coverage<.2 or support<.65:return None
  # Refine using the supported lines only.
  k,b=np.polyfit(good[:,0],good[:,1],1)
  return {'slope':float(b),'convergence':float(k),'coverage':coverage,'support':support,'count':len(good),'residual':float(np.median(np.abs(good[:,1]-k*good[:,0]-b)))}
 return {name:fit(items) for name,items in groups.items()}

def projection_angle(gray):
 # Text-only/number-only pages: all connected ink contributes, not staff presence.
 h,w=gray.shape;scale=min(1,700/w);g=cv2.resize(gray,None,fx=scale,fy=scale)
 ink=(g<min(180,cv2.threshold(g,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)[0])).astype('uint8')
 if int(ink.sum())<40:return {'angle':0.,'reliable':False,'gain':1.}
 hh,ww=ink.shape
 def score(angle):
  mat=cv2.getRotationMatrix2D((ww/2,hh/2),angle,1)
  p=cv2.warpAffine(ink,mat,(ww,hh),flags=cv2.INTER_NEAREST).sum(axis=1).astype(float)
  return float(np.dot(p,p))
 angles=np.arange(-12,12.01,.5);scores=[score(a) for a in angles];i=int(np.argmax(scores))
 fine=np.arange(angles[i]-.5,angles[i]+.501,.1);fine_scores=[score(a) for a in fine];j=int(np.argmax(fine_scores));angle=float(fine[j])
 base=score(0);gain=fine_scores[j]/max(base,1)
 return {'angle':angle,'reliable':bool(gain>1.12 and abs(angle)<12),'gain':gain}

def transform_frame(image,matrix):
 w,h=image.size;corners=project([[0,0],[w,0],[w,h],[0,h]],matrix)
 lo=np.floor(corners.min(axis=0));hi=np.ceil(corners.max(axis=0));size=np.maximum(1,(hi-lo).astype(int))
 if size[0]*size[1]>40_000_000 or max(size/[w,h])>2.2:raise ValueError('excessive transform')
 translation=np.array([[1,0,-lo[0]],[0,1,-lo[1]],[0,0,1.]])
 forward=translation@matrix;inverse=np.linalg.inv(forward)
 pixels=cv2.warpPerspective(np.asarray(image),forward,tuple(size),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT,borderValue=(255,255,255))
 return Image.fromarray(pixels),forward,inverse

def geometry_candidates(image):
 w,h=image.size;scale=1400/w
 gray=cv2.cvtColor(np.asarray(image),cv2.COLOR_RGB2GRAY);gray=cv2.resize(gray,None,fx=scale,fy=scale)
 evidence=line_evidence(gray);hor=evidence['horizontal'];ver=evidence['vertical'];candidates=[]
 angle=math.degrees(math.atan(hor['slope'])) if hor else 0.
 if not hor:
  text=projection_angle(gray);evidence['projection']=text
  if text['reliable']:angle=text['angle']
 evidence['angle']=angle
 if abs(angle)>.65:
  rot=np.vstack([cv2.getRotationMatrix2D((w/2,h/2),angle,1),[0,0,1]])
  candidates.append(('rotation',rot))
 k=hor['convergence'] if hor else 0.;l=ver['convergence'] if ver else 0.
 perspective=bool((hor and abs(k)*hor['coverage']>.012) or (ver and abs(l)*ver['coverage']>.012))
 evidence['perspective']=perspective
 if perspective:
  b=hor['slope'] if hor else 0.;d=ver['slope'] if ver else 0.
  try:
   pq=np.linalg.solve([[1,b],[d,1]],[k,l]);center=np.array([[1/w,0,-.5],[0,1/w,-h/(2*w)],[0,0,1.]])
   rectify=np.array([[1,-d,0],[-b,1,0],[pq[0],pq[1],1.]])
   corners=np.array([[-.5,-h/(2*w),1],[.5,-h/(2*w),1],[.5,h/(2*w),1],[-.5,h/(2*w),1]])
   denominators=corners@rectify[2]
   if np.min(denominators)<.45 or np.max(denominators)>1.8:raise ValueError('unstable perspective')
   candidates.append(('perspective',np.linalg.inv(center)@rectify@center))
  except (ValueError,np.linalg.LinAlgError):evidence['invalidPerspective']=True
 return candidates,evidence

def reliability(image,result,alternatives,geometry):
 rows=result['rows'];H=result['analysis']['height'];W=result['analysis']['width'];reasons=[]
 if not rows:reasons.append('no-score-rows')
 for i,row in enumerate(rows):
  c=row['crop'];lo=c['y'];hi=lo+c['height'];height=row['evidence']['height']/H
  if not(0<=lo<hi<=1):reasons.append('invalid-bounds')
  if any(not(lo-1e-6<=a<b<=hi+1e-6) for a,b in row['digitBands']+row['lyricsBands']+row.get('notationBands',[])):reasons.append('clipped-content')
  if any(min(hi,b/H)-max(lo,a/H)>height*.35 for a,b in result['analysis']['staffRegions']):reasons.append('staff-overlap')
  if i and rows[i-1]['crop']['y']+rows[i-1]['crop']['height']>lo+1e-6:reasons.append('overlapping-content')
  # Require repeated detection of the same numeral region, independent of lyrics.
  envelope=row['evidence'].get('voiceEnvelope')
  def agrees(cand):
   if abs(cand['cy']/H-sum(row['digitBand'])/2)<max(height,cand['height']/H)*.7:return True
   other=cand.get('voiceEnvelope')
   # A multi-voice system can expose different numeral layers in each mask.
   # Require the same independently detected brace envelope AND an in-group band.
   return bool(envelope and other and all(abs(envelope[k]-other[k])<height*H*.3 for k in ('top','bottom')) and any(a-height*.5<=cand['cy']/H<=b+height*.5 for a,b in row['digitBands']))
  support=sum(any(agrees(cand) for cand in alt) for alt in alternatives)
  if support<1:reasons.append('unstable-row')
 # Strong bands agreed by both masks but missing from all selected digit layers.
 if alternatives:
  for c in alternatives[0]:
   strong=c['count']>=4 and c['fraction']>=.75 and c['barcount']>=2
   agreed=any(abs(c['cy']-p['cy'])<max(c['height'],p['height'])*.65 for p in alternatives[1])
   covered=any(a-c['height']/H*.5<=c['cy']/H<=b+c['height']/H*.5 for r in rows for a,b in r['digitBands'])
   if strong and agreed and not covered:reasons.append('uncovered-melody')
 # Pixel components crossing the top/bottom of a proposed crop are independent
 # of threshold agreement. Ignore tall system connectors and page edge rules.
 from score_pixels import analysis_gray
 gray=analysis_gray(image,W);mask=(gray<result['analysis']['threshold']).astype('uint8')
 stats=cv2.connectedComponentsWithStats(mask)[2][1:]
 from score_layout import content_components,crossing_components
 for row in rows:
  h=row['evidence']['height']
  components=content_components(stats,h,W,result['analysis'].get('staffExclusionRegions',result['analysis']['staffRegions']))
  for boundary in [row['crop']['y']*H,(row['crop']['y']+row['crop']['height'])*H]:
   if len(crossing_components(boundary,components,h))>=2:reasons.append('cutting-ink')
 if result['analysis'].get('layoutIssues'):reasons.append('unresolved-layout-boundary')
 if abs(geometry.get('angle',0))>.8:reasons.append('residual-rotation')
 if geometry.get('perspective'):reasons.append('residual-perspective')
 if geometry.get('invalidPerspective'):reasons.append('invalid-transform')
 return {'reliable':not reasons,'reasons':sorted(set(reasons))}

def mapped_crop(crop,frame,original_size):
 fw,fh=frame['width'],frame['height'];ow,oh=original_size
 x,y,w,h=[crop[k] for k in ('x','y','width','height')]
 points=project([[x*fw,y*fh],[(x+w)*fw,y*fh],[(x+w)*fw,(y+h)*fh],[x*fw,(y+h)*fh]],frame['toOriginal'])/np.array([ow,oh])
 lo=np.maximum(0,points.min(axis=0));hi=np.minimum(1,points.max(axis=0))
 if np.any(hi<=lo):raise ValueError('crop outside source')
 return {**crop,'version':3,'algorithm':VERSION,'x':float(lo[0]),'y':float(lo[1]),'width':float(hi[0]-lo[0]),'height':float(hi[1]-lo[1]),'quad':points.tolist(),'rectified':{**frame,'rect':copy.deepcopy(crop)}}

def analyze_geometry(image,upright,raw_analyze):
 started=time.perf_counter();original=ImageOps.exif_transpose(image).convert('RGB')
 candidates,evidence=geometry_candidates(original);evaluated=[]
 def assess(im,name,matrix=None,inverse=None):
  _,result=upright(im)
  alt=result.pop('_thresholdCandidates',None)
  if alt is None:alt=[raw_analyze(im,d)[1]['candidateBands'] for d in (-12,12)]
  geom=evidence if name=='original' else geometry_candidates(im)[1]
  quality=reliability(im,result,alt,geom)
  evaluated.append({'kind':name,'rows':len(result['rows']),**quality,'geometry':geom})
  return im,result,quality,matrix,inverse
 chosen=None;kind='original'
 # Correct supported geometry before row detection. Upright pages take only
 # the original path; an unsupported correction never replaces their pixels.
 for name,matrix in reversed(candidates):
  try:
   corrected,forward,inverse=transform_frame(original,matrix);candidate=assess(corrected,name,forward,inverse)
   if chosen is None or len(candidate[2]['reasons'])<len(chosen[2]['reasons']):chosen=candidate;kind=name
   if candidate[2]['reliable']:break
  except (ValueError,np.linalg.LinAlgError):evaluated.append({'kind':name,'reliable':False,'reasons':['invalid-transform']})
 if chosen is None or not chosen[2]['reliable']:
  base=assess(original,'original')
  if chosen is None or len(base[2]['reasons'])<=len(chosen[2]['reasons']):chosen=base;kind='original'
 corrected,result,quality,forward,inverse=chosen
 result['decision']='rows' if quality['reliable'] else 'page'
 result['reason']=None if quality['reliable'] else ','.join(quality['reasons'])
 result['reliability']={'version':1,**quality,'candidates':evaluated,'seconds':round(time.perf_counter()-started,3)}
 result['image']={'width':original.width,'height':original.height,'orientation':'exif-applied'}
 if kind!='original':
  frame={'width':corrected.width,'height':corrected.height,'fromOriginal':forward.tolist(),'toOriginal':inverse.tolist(),'originalWidth':original.width,'originalHeight':original.height,'kind':kind}
  result['frame']=frame
  for row in result['rows']:row['crop']=mapped_crop(row['crop'],frame,original.size)
 # Returning the selected image lets the bridge export the exact analyzed pixels.
 return corrected,result
