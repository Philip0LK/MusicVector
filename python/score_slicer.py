"""Image-only numbered-score row slicer. No OCR, model calls or song-specific coordinates."""
import argparse,json,hashlib

CROP_ALGORITHM = "image-only-row-v5-geometry"
from pathlib import Path
import cv2
import numpy as np
from PIL import Image,ImageOps,ImageDraw,ImageEnhance
from score_pixels import analysis_gray
from score_structure import owned_barlines,system_connection,music_extent,coherent_measure_columns,notation_extent,standalone_barlines,local_voice_envelopes

def runs(values):
 out=[];start=None
 for i,v in enumerate(list(values)+[False]):
  if v and start is None:start=i
  if not v and start is not None:out.append((start,i));start=None
 return out

def detect_local_staff_regions(raw, include_beams=True):
 """Recover five/six-line systems from overlapping local strips, including attached TAB beams."""
 H,W=raw.shape;tile=max(100,round(W*.10));step=tile//2
 mask=cv2.morphologyEx(raw,cv2.MORPH_OPEN,np.ones((1,max(25,round(W*.025))),np.uint8))
 pieces=[]
 for x in range(0,W-tile+1,step):
  ys=[(a+b-1)/2 for a,b in runs(mask[:,x:x+tile].sum(axis=1)>tile*.6) if b-a<=10]
  for size in [6,5]:
   for i in range(len(ys)-size+1):
    group=ys[i:i+size];gaps=np.diff(group);spacing=float(np.median(gaps))
    if 6<=spacing<=45 and np.max(np.abs(gaps-spacing))<=max(2,spacing*.22):
     pieces.append({'x':x,'right':x+tile,'top':group[0],'bottom':group[-1],'spacing':spacing,'lines':size})
 groups=[]
 for p in sorted(pieces,key=lambda p:p['top']):
  old=next((g for g in groups if min(g['bottom'],p['bottom'])-max(g['top'],p['top'])>min(g['bottom']-g['top'],p['bottom']-p['top'])*.5 and .7*g['spacing']<=p['spacing']<=1.4*g['spacing']),None)
  if old:
   old['top']=min(old['top'],p['top']);old['bottom']=max(old['bottom'],p['bottom']);old['left']=min(old['left'],p['x']);old['right']=max(old['right'],p['right']);old['tiles'].add(p['x'])
  else:groups.append(dict(top=p['top'],bottom=p['bottom'],left=p['x'],right=p['right'],spacing=p['spacing'],tiles={p['x']}))
 regions=[]
 for g in groups:
  if len(g['tiles'])<2 or g['right']-g['left']<W*.12:continue
  # TAB rhythm beams sit below the lowest string. Include them only when a
  # vertical stem joins them to that string; nearby melody underlines do not.
  bottom=int(np.ceil(g['bottom']));spacing=g['spacing'];end=min(H,bottom+int(spacing*2)+2)
  lower=raw[bottom:end]
  beams=cv2.morphologyEx(lower,cv2.MORPH_OPEN,np.ones((1,max(8,round(spacing*1.4))),np.uint8))
  extent=bottom
  stems=cv2.morphologyEx(lower,cv2.MORPH_OPEN,np.ones((max(8,round(spacing*.7)),1),np.uint8))
  ends=[(x,y+h) for x,y,w,h,a in cv2.connectedComponentsWithStats(stems)[2][1:] if y<=2 and w<=spacing*.35 and spacing*.7<=h<=spacing*2.2 and g['left']<=x<=g['right']]
  if len(ends)>=3:
   supported=[(x,y) for x,y in ends if sum(abs(y-z)<=spacing*.3 for xx,z in ends)>=3]
   if supported and max(x for x,y in supported)-min(x for x,y in supported)>W*.1:extent=max(extent,bottom+max(y for x,y in supported))
  for x,y,w,h,area in cv2.connectedComponentsWithStats(beams)[2][1:]:
   if y<2 or w<spacing*1.5 or h>spacing*.5:continue
   # A small endpoint neighbourhood tolerates resampling of the stem/beam joint.
   joined=False
   for edge in (x,x+w-1):
    patch=lower[:y+1,max(0,edge-2):min(W,edge+3)]
    if patch.size and patch.sum(axis=0).max()>=(y+1)*.75:joined=True
   if joined:extent=max(extent,bottom+y+h)
  regions.append((max(0,int(g['top'])-8),min(H,max(bottom+12,int(extent+spacing*.3)) if include_beams else bottom+12)))
 return regions


def detect_chord_diagrams(raw):
 """Small repeated two-dimensional grids, unlike long staff systems or numerals."""
 H,W=raw.shape;k=max(10,round(W*.012))
 horizontal=cv2.morphologyEx(raw,cv2.MORPH_OPEN,np.ones((1,k),np.uint8))
 vertical=cv2.morphologyEx(raw,cv2.MORPH_OPEN,np.ones((k,1),np.uint8))
 grid=cv2.morphologyEx(horizontal|vertical,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8));boxes=[]
 for x,y,w,h,area in cv2.connectedComponentsWithStats(grid)[2][1:]:
  if not(W*.02<=w<=W*.14 and 20<=h<=130 and .4<=w/h<=2.5):continue
  hs=runs(horizontal[y:y+h,x:x+w].sum(axis=1)>w*.55)
  vs=runs(vertical[y:y+h,x:x+w].sum(axis=0)>h*.55)
  def regular(lines):
   gaps=np.diff([(a+b)/2 for a,b in lines]);return len(gaps)>=3 and np.max(np.abs(gaps-np.median(gaps)))<=max(1.5,np.median(gaps)*.25)
  if len(hs)>=4 and len(vs)>=5 and regular(hs) and regular(vs):boxes.append((int(x),int(y),int(x+w),int(y+h)))
 return boxes

def _analyze(image, threshold_delta=0, candidates_override=None):
 original=ImageOps.exif_transpose(image).convert('RGB');ow,oh=original.size
 g=analysis_gray(original);H,W=g.shape
 # Dark-core threshold rejects pale watermark ink; contrast-normalized backup
 # will be assessed separately rather than modifying exported source pixels.
 otsu=int(cv2.threshold(g,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)[0])
 threshold=min(165,max(105,otsu - 15))
 threshold=max(1,min(254,threshold+threshold_delta))
 raw=(g<threshold).astype(np.uint8)
 _,full_labels,full_stats,_=cv2.connectedComponentsWithStats(raw)
 # Thin antialiased rules can be lighter than the numeral cores. Detect
 # their structure at the page's contrast split, with the same text-parent guard.
 rule_raw=(g<max(threshold,min(254,otsu+threshold_delta))).astype(np.uint8)
 _,rule_labels,rule_stats,_=cv2.connectedComponentsWithStats(rule_raw)
 bar_mask=cv2.morphologyEx(rule_raw,cv2.MORPH_CLOSE,np.ones((3,1),np.uint8))
 horizontal=cv2.morphologyEx(raw,cv2.MORPH_OPEN,np.ones((1,85),np.uint8))
 stafflines=runs(horizontal.sum(axis=1)>W*.38)
 staff=[]
 for lo,hi in stafflines:
  if staff and lo-staff[-1][-1][1]<28:staff[-1].append((lo,hi))
  else:staff.append([(lo,hi)])
 staff=[(v[0][0]-8,v[-1][1]+12) for v in staff if len(v)>=4]
 local=detect_local_staff_regions(raw)
 # Pale string rules need a separate mask; numeral detection keeps dark ink.
 # Only repeated, equally spaced five/six-line structures can enter this mask.
 pale=detect_local_staff_regions((g<240).astype(np.uint8))
 pale_new=[(a,b) for a,b in pale if not any(min(b,y)-max(a,x)>min(b-a,y-x)*.5 for x,y in local+staff)]
 local += pale_new
 missing=[(a,b) for a,b in local if not any(min(b,y)-max(a,x)>min(b-a,y-x)*.5 for x,y in staff)]
 if missing:
  # Incomplete global projection: use local extents, including attached beams.
  staff=[(a,b) for a,b in staff if not any(min(b,y)-max(a,x)>min(b-a,y-x)*.5 for x,y in local)]+local
 # Complete systems can still have rhythm beams below their last string.
 staff=[(a,max([b]+[y for x,y in local if min(b,y)-max(a,x)>(b-a)*.6 and 0<y-b<(b-a)*.5])) for a,b in staff]
 staff.sort()
 pale_core=detect_local_staff_regions((g<240).astype(np.uint8),include_beams=False) if pale_new else []
 crop_staff=[(a,min([b]+[y for x,y in pale_core if abs(x-a)<12])) if any(abs(a-x)<12 for x,y in pale_new) else (a,b) for a,b in staff]
 fit_staff=[(a,b) for a,b in crop_staff if not any(abs(a-x)<12 for x,y in pale_new)]
 diagrams=list(dict.fromkeys(detect_chord_diagrams(raw)+detect_chord_diagrams((g<240).astype(np.uint8))))
 in_diagram=lambda c:any(x-2<=c['x']+c['w']/2<=r+2 and y-2<=c['cy']<=b+2 for x,y,r,b in diagrams)
 clean=raw.copy();clean&=1-cv2.morphologyEx(raw,cv2.MORPH_OPEN,np.ones((1,48),np.uint8));clean&=1-cv2.morphologyEx(raw,cv2.MORPH_OPEN,np.ones((65,1),np.uint8))
 _,_,stats,_=cv2.connectedComponentsWithStats(clean)
 components=[]
 for x,y,w,h,a in stats[1:]:
  if 10<=h<=52 and 3<=w<=58 and a>=18:components.append(dict(x=int(x),y=int(y),w=int(w),h=int(h),density=float(a/(w*h)),cy=float(y+h/2)))
 # Most numeral glyphs have a narrow body and aligned centres/heights.
 digit=[c for c in components if .18<=c['w']/c['h']<=.82 and c['density']>=.37 and not in_diagram(c) and not any(a<=c['cy']<=b for a,b in staff)]
 candidates=[]
 bar_cache={}
 def measured_bars(height,light=False):
  key=(height,light)
  if key not in bar_cache:
   source=bar_mask if light else raw
   bs=cv2.connectedComponentsWithStats(cv2.morphologyEx(source,cv2.MORPH_OPEN,np.ones((max(15,int(height*1.25)),1),np.uint8)))[2][1:]
   bar_cache[key]=standalone_barlines(bs,rule_labels if light else full_labels,rule_stats if light else full_stats,height)
  return bar_cache[key]
 # Numeral shape proposes ordinary rows. Independently aligned measure bars
 # can propose rows in other typefaces; broad glyphs alone never establish music.
 structural_glyphs=[c for c in components if .12<=c['w']/c['h']<=1.45 and c['density']>=.12 and not in_diagram(c) and not any(a<=c['cy']<=b for a,b in staff)]
 for structural,proposal_glyphs in [(False,digit),(True,structural_glyphs)]:
  hist=np.zeros(H)
  for c in proposal_glyphs:hist[int(c['cy'])]+=1
  sm=np.convolve(hist,np.ones(13),'same');remaining=sm.copy()
  while remaining.max()>=1:
   y=int(remaining.argmax());near=[c for c in proposal_glyphs if abs(c['cy']-y)<=9]
   remaining[max(0,y-24):y+25]=0
   if len(near)<1:continue
   h=float(np.median([c['h'] for c in near]));near=[c for c in near if .72*h<=c['h']<=1.3*h]
   allnear=[c for c in components if abs(c['cy']-y)<=h*.4 and c['h']>=h*.7]
   if not near:continue
   # Resampling can leave one-pixel holes in thin bars. Close only short
   # vertical gaps; ownership still uses the original connected glyphs.
   bars=measured_bars(h)
   dashes=[(x,yy,w,hh) for x,yy,w,hh,aa in stats[1:] if abs(yy+hh/2-y)<h*.35 and h*.4<=w<=h*3 and hh<h*.23]
   left,right,dashes=music_extent(near,dashes,h)
   baseline=float(np.median([v['cy'] for v in near]))
   owned=owned_barlines(bars,left,right,baseline,h)
   if not owned:
    # In partial polyphony, bars can lie between the voices. Repeated
    # braces establish the shared measure extent before a band is accepted.
    probe={'height':h,'cy':baseline,'left':left,'right':right}
    envelope=next((e for e in local_voice_envelopes([probe],full_stats[1:],staff) if e['top']<=baseline<=e['bottom']),None)
    if envelope:owned=owned_barlines(bars,left,right,baseline,h,envelope)
   if not owned:
    owned=owned_barlines(measured_bars(h,light=True),left,right,baseline,h,envelope)
   barcount=len(owned)
   if not barcount:continue
   span=max(c['x'] for c in near)-min(c['x'] for c in near)
   if len(near)>3 and span/(len(near)-1)<h*.9:continue
   supported_short=len(near)>=3 and span>=h*2 and any(0<y-b<h*8 for a,b in staff)
   if len(near)<10 and not(barcount and (span>W*.12 or len(dashes)>=2 or supported_short)):continue
   fraction=len(near)/max(1,len(allnear))
   if structural:fraction=min(1.,fraction)
   measure_support=len(allnear)>=6 and coherent_measure_columns(owned,max(h,float(np.median([v['h'] for v in allnear] or [h]))),W)
   if structural and not measure_support:continue
   if (fraction<.55 and not measure_support) or fraction>1.15:continue
   # Chord names/diagrams sit above a staff, melody below it.
   if len(near)<12 and any(y<a and a-y<h*8 for a,b in staff) and not any(0<y-b<h*8 for a,b in staff):continue
   candidates.append(dict(structuralProposal=structural,cy=float(np.median([c['cy'] for c in near])),top=min(c['y'] for c in near),bottom=max(c['y']+c['h'] for c in near),height=h,count=len(near),fraction=round(fraction,3),glyphBoxes=[[v['x'],v['y'],v['w'],v['h']] for v in allnear],barcount=barcount,barEvidence=owned,measureSupport=bool(measure_support),span=span,left=min(v['x'] for v in near),right=max(v['x']+v['w'] for v in near)))
 candidates.sort(key=lambda c:(c['structuralProposal'],-c['count']))
 unique=[]
 for c in candidates:
  if not any(abs(c['cy']-p['cy'])<max(c['height'],p['height'])*.65 for p in unique):unique.append(c)
 candidates=sorted(unique,key=lambda c:c['cy'])
 # A partly detected accompaniment is not a page-wide start-of-melody boundary.
 if candidates:
  typical=float(np.median([c['height'] for c in candidates if c['count']>=12 and c['fraction']>=.75] or [c['height'] for c in candidates]))
  sized=[c for c in candidates if c.get('measureSupport') or .80*typical<=c['height']<=1.25*typical]
  if not sized:
   # A median between two font-size populations need not describe any glyph.
   typical=max(candidates,key=lambda c:sum(p['count'] for p in candidates if .8*c['height']<=p['height']<=1.25*c['height']))['height']
   sized=[c for c in candidates if c.get('measureSupport') or .80*typical<=c['height']<=1.25*typical]
  candidates=sized
 if candidates_override is not None:candidates=candidates_override

 # The staff detector adds a 12px safety margin. A confirmed numeral body
 # can bound that padding, without deleting any observed staff line.
 def bound_padding(regions):
  return [(a,min([b]+[c['top']-c['height']*.2 for c in candidates if c['top']<=b<c['cy'] and b-c['top']<=12])) for a,b in regions]
 crop_staff=bound_padding(crop_staff);fit_staff=bound_padding(fit_staff)
 for c in candidates:c['notationBands']=[notation_extent(c,full_stats[1:],crop_staff,diagrams)]
 envelopes=local_voice_envelopes(candidates,full_stats[1:],staff)
 for c in candidates:
  envelope=next((v for v in envelopes if v['top']<=c['cy']<=v['bottom']),None)
  if envelope:
   c['voiceEnvelope']=envelope
   c['notationBands'][0]=[min(c['notationBands'][0][0],envelope['top']),max(c['notationBands'][0][1],envelope['bottom'])]
 physical_candidates=[dict(c) for c in candidates]
 # Nearby aligned numeral bands without a lyric band between them are one
 # ambiguous score region, not two consecutive melody rows. Preserve both for review.
 grouped=[]
 structure_components=cv2.connectedComponentsWithStats(raw)[2][1:]
 for c in candidates:
  previous=grouped[-1] if grouped else None
  if previous:
   gap=c['top']-previous['bottom'];h=min(c['height'],previous['height'])
   text_between=[v for v in components if previous['bottom']<v['cy']<c['top'] and v['w']/v['h']>.85 and v['h']>=h*.65]
   overlap=min(c['right'],previous['right'])-max(c['left'],previous['left'])
   # Equal-width layers need shared bars crossing both baselines. Proximity
   # alone also occurs between separate instrumental rows.
   shared=0
   if 0<=gap<h*1.5:
    for bx,by,bw,bh,area in cv2.connectedComponentsWithStats(cv2.morphologyEx(raw,cv2.MORPH_OPEN,np.ones((max(2,int(c['cy']-previous['cy'])),1),np.uint8)))[2][1:]:
     if bw<h*.3 and by<=previous['cy'] and by+bh>=c['cy'] and max(c['left'],previous['left'])-h<=bx<=min(c['right'],previous['right'])+h:shared+=1
   connection=system_connection(previous,c,structure_components,staff)
   if previous.get('voiceEnvelope') and previous.get('voiceEnvelope')==c.get('voiceEnvelope'):connection={'kind':'local-voice-braces','envelope':c['voiceEnvelope']}
   nearby=0<=gap<h*1.5 and (min(c['span'],previous['span'])<max(c['span'],previous['span'])*.8 or shared>=2) and len(text_between)<3 and overlap>min(c['span'],previous['span'])*.45
   if connection or nearby:
    if connection:previous.setdefault('systemConnections',[]).append(connection)
    previous.setdefault('bands',[[previous['top'],previous['bottom']]]).append([c['top'],c['bottom']])
    previous['notationBands'].extend(c['notationBands'])
    previous['bottom']=c['bottom'];previous['left']=min(previous['left'],c['left']);previous['right']=max(previous['right'],c['right'])
    continue
  grouped.append(c)
 candidates=grouped
 rows=[]
 for i,c in enumerate(candidates):
  h=c['height']
  # Preserve upper context without classifying lyric glyphs as another numeral band.
  top=max(0,c['top']-h*2.7);limit=candidates[i+1]['top']-candidates[i+1]['height']*.55 if i+1<len(candidates) else H
  if i+1<len(candidates):
   following=candidates[i+1]
   # Long overhead brackets belong to the next row, including their pass labels.
   start=max(max(b for a,b in c['notationBands'])+1,int(following['top']-following['height']*2.6))
   next_brackets=runs(horizontal[start:following['top']].sum(axis=1)>W*.2)
   if next_brackets:limit=min(limit,start+next_brackets[0][0])
  nextstaff=[a for a,b in fit_staff if a>c['bottom']]
  if nextstaff:limit=min(limit,min(nextstaff)-h*1.6)
  next_diagrams=[y for x,y,r,b in diagrams if y>c['bottom']]
  if next_diagrams:limit=min(limit,min(next_diagrams)-h*.4)
  # Include nearby volta brackets without consuming the previous lyric band.
  upper=max(0,int(c['top']-h*2.6))
  bracket=runs(horizontal[upper:int(c['top'])].sum(axis=1)>h*3)
  if bracket:top=min(top,upper+bracket[0][0]-h*.15)
  # Following aligned text bands, including a second verse line. Blank gaps stop expansion.
  eligible=[v for v in components if c['left']-h*2<=v['x']<=c['right']+h*4 and v['cy']>c['bottom']+h*.45 and v['y']+v['h']<=limit and v['h']>=h*.65 and not any(y-h*1.8<v['cy']<y and x-h<=v['x']<=r+h for x,y,r,b in diagrams) and not any(v['cy']<a and a-v['cy']<h*3 for a,b in fit_staff)]
  ink=np.zeros(H)
  for v in eligible:ink[max(0,v['y']):v['y']+v['h']]+=v['w']
  occupied=ink>max(10,W*.009);occupied=cv2.morphologyEx(occupied.astype('uint8').reshape(-1,1),cv2.MORPH_CLOSE,np.ones((max(2,int(h*.22)),1),np.uint8)).ravel()
  bottom=c['bottom']+h*.5;lyrics=[]
  for a,b in runs(occupied):
   if b-a<h*.45:continue
   if a-bottom>h*1.35:break
   lyrics.append([a,b]);bottom=max(bottom,b+h*.15)
  bottom=max(bottom,max(b for a,b in c['notationBands'])+h*.15)
  top=min(top,min(a for a,b in c['notationBands'])-h*.15)
  bottom=min(limit,bottom);top=max(top,max([b+h*.1 for a,b in fit_staff if b<c['top']] or [0]))
  if bottom<=top:continue
  rect={'version':2,'space':'image-normalized','x':0,'y':float(top/H),'width':1,'height':float((bottom-top)/H),'source':'auto','algorithm':CROP_ALGORITHM,'reviewed':False}
  rows.append({'id':f'row-{len(rows)+1}','crop':rect,'digitBand':[v/H for v in (c.get('bands') or [[c['top'],c['bottom']]])[0]],'digitBands':[[a/H,b/H] for a,b in c.get('bands',[[c['top'],c['bottom']]])],'notationBands':[[a/H,b/H] for a,b in c['notationBands']],'lyricsBands':[[a/H,b/H] for a,b in lyrics],'evidence':c,'warnings':([] if lyrics else ['no-lyrics-detected'])+(['multiple-digit-bands'] if len(c.get('bands',[]))>1 else [])})
 # Fit display bounds to observed content, keeping numeral evidence unchanged.
 # A neighbouring row's fixed headroom must never cut through a complete lyric band.
 # Extra verse/alternative bands are followed by continuity, not a fixed band count.
 ink=raw.sum(axis=1)>max(3,W*.002)
 _,_,full_stats,_=cv2.connectedComponentsWithStats(raw)
 fitted=[]
 for i,row in enumerate(rows):
  c=row['evidence'];h=c['height'];old=row['crop']
  # Vertical fitting uses the music span; page-edge braces must not pull the
  # crop into the preceding accompaniment or following system.
  ink=(raw[:,max(0,int(c['left']-h*2)):min(W,int(c['right']+h*3))] if fit_staff else raw).sum(axis=1)>max(3,W*.002)
  floor=int(round(old['y']*H));ceiling=min(H,int(np.ceil((old['y']+old['height'])*H)))
  # Exclude the preceding line's lyrics (or the page heading) before looking
  # for this line's upper dots, arcs, volta bracket or alternate numeral band.
  if fitted:floor=max(floor,int(np.ceil(fitted[-1]['contentBottom'])))
  else:
   text_ink=np.zeros(H)
   # Use whole components here: large/connected heading letters were intentionally
   # excluded from numeral detection, but still delimit the first music row.
   for x,y,w,hh,area in full_stats[1:]:
    if h*.65<=hh<=h*2.5 and hh*.85<=w<W*.6 and area/(w*hh)>=.2:
     text_ink[y:y+hh]+=min(6,w/hh)
   text_bands=[(a,b) for a,b in runs(text_ink>0) if max(text_ink[a:b])>=3]
   heading=[b for a,b in text_bands if b<c['top']-h*.8 and b>floor and b-a>=h*.55]
   if heading:floor=max(floor,max(heading))
  above=np.flatnonzero(ink[floor:c['top']])
  content_top=floor+int(above[0]) if len(above) else c['top']
  below=np.flatnonzero(ink[c['bottom']:ceiling])
  content_bottom=max(c['bottom']+int(below[-1])+1 if len(below) else c['bottom'],max([b*H for a,b in row['lyricsBands']] or [c['bottom']]))
  top=max(floor,content_top-h*.7)
  bottom=min(H,content_bottom+h*.3)
  if fitted and not any(fitted[-1]['contentBottom']<=a<c['top'] for a,b in fit_staff):
   prev=fitted[-1]
   if content_top>=prev['contentBottom']:
    # Split actual inter-line whitespace; neither side consumes ink.
    # Very large blank regions remain blank rather than bloating both crops.
    gap=content_top-prev['contentBottom']
    top=content_top-min(gap/2,h*.7)
    prev['bottom']=prev['contentBottom']+min(gap/2,prev['height']*.7)
  fitted.append(dict(top=top,bottom=bottom,contentTop=content_top,contentBottom=content_bottom,height=h))
 # One constraint solver replaces separate snapping, heading and staff trims.
 from score_layout import fit_boundaries
 layout_issues=fit_boundaries(rows,fitted,full_stats[1:],W,H,crop_staff,staff)
 for row,box in zip(rows,fitted):
  row['crop']['y']=float(box['top']/H)
  row['crop']['height']=float((box['bottom']-box['top'])/H)
  row['boundaryEvidence']={k:float(v/H) for k,v in box.items() if k in ('contentTop','contentBottom')}
 for row in rows:
  assert 0<=row['digitBand'][0]<row['digitBand'][1]<=1
  assert row['digitBand'] in row['digitBands']
  assert all(0<=a<b<=1 for a,b in row['digitBands'])
 return original,{'version':1,'image':{'width':ow,'height':oh,'orientation':'exif-applied'},'analysis':{'width':W,'height':H,'threshold':threshold,'staffRegions':crop_staff,'staffExclusionRegions':staff,'chordDiagrams':diagrams,'layoutIssues':layout_issues},'rows':rows,'candidateBands':physical_candidates,'warnings':[] if rows else ['no-score-rows-detected']}

def analyze_upright(image):
 original,base=_analyze(image)
 candidates=base.pop('candidateBands')
 alternatives=[_analyze(original,delta)[1]['candidateBands'] for delta in (-12,12)]
 original_candidates=candidates
 # Sparse, text-like candidates are rejected only with BOTH contextual and
 # cross-threshold evidence. A short or mixed-symbol row alone is not an error.
 if candidates:
  fraction=float(np.median([c['fraction'] for c in candidates]));count=float(np.median([c['count'] for c in candidates]))
  kept=[]
  for i,c in enumerate(candidates):
   support=sum(any(abs(c['cy']-p['cy'])<=max(c['height'],p['height'])*.65 for p in alt) for alt in alternatives)
   weak=c['fraction']<fraction*.75 and not c.get('measureSupport',False)
   sparse=c['count']<count*.7
   context=i==0 or c['top']-candidates[i-1]['bottom']<c['height']*2
   # Broad-shape proposals can be disconnected text strokes. When most
   # glyphs disagree AND neither alternate threshold confirms the structure,
   # reject locally; a strong but unstable music candidate remains for review.
   unconfirmed_text=c.get('structuralProposal',False) and c['fraction']<.55 and support==0
   if not(unconfirmed_text or (weak and (support==0 or (sparse and context and support<2)))):kept.append(c)
  candidates=kept
 # Only recover a band independently present in both alternate masks. Keep
 # primary geometry wherever available, so stable existing rows do not drift.
 added=[]
 for c in alternatives[0]:
  close=lambda p:abs(c['cy']-p['cy'])<=max(c['height'],p['height'])*.65
  if any(close(p) for p in candidates+added):continue
  match=next((p for p in alternatives[1] if close(p)),None)
  if match is None or min(c['fraction'],match['fraction'])<.75:continue
  if candidates:
   h=float(np.median([p['height'] for p in candidates]));count=float(np.median([p['count'] for p in candidates]))
   if not(.8*h<=c['height']<=1.25*h and c['count']>=count*.5):continue
  added.append(c)
 if added or len(candidates)!=len(original_candidates):
  original,base=_analyze(original,candidates_override=sorted(candidates+added,key=lambda c:c['cy']))
  base.pop('candidateBands',None)
  base['warnings'].append('row-bands-verified-by-threshold-consensus')
 for row in base['rows']:
  row['crop']['algorithm']=CROP_ALGORITHM
 base['_thresholdCandidates']=alternatives
 return original,base

def analyze(image):
 from score_geometry import analyze_geometry
 return analyze_geometry(image,analyze_upright,_analyze)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('input');ap.add_argument('--check-stability',action='store_true');ap.add_argument('--out',default='output/lyric-slices');args=ap.parse_args();out=Path(args.out);out.mkdir(parents=True,exist_ok=True);records=[]
 for index,p in enumerate(sorted(Path(args.input).iterdir())):
  if p.suffix.lower() not in ['.png','.jpg','.jpeg']:continue
  im,result=analyze(Image.open(p));result['file']=p.name;result['image']['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();folder=out/f'{index:02d}';folder.mkdir(exist_ok=True)
  # Remove only stale generated row PNGs inside this output folder.
  for old in folder.glob('row-*.png'):
   if old.parent.resolve()==folder.resolve() and old.stem[4:].isdigit():old.unlink()
  if args.check_stability:
   counts=[len(analyze(im.resize((max(1,round(im.width*.75)),max(1,round(im.height*.75)))))[1]['rows']),len(analyze(ImageEnhance.Brightness(im).enhance(1.1))[1]['rows'])]
   result['stability']={'original':len(result['rows']),'resize75':counts[0],'brightness110':counts[1]}
   if any(n!=len(result['rows']) for n in counts):result['warnings'].append('unstable-row-detection')
  result['reviewRequired']=True
  overlay=im.copy();draw=ImageDraw.Draw(overlay,'RGBA');w,h=im.size
  for row in result['rows']:
   c=row['crop'].get('rectified',{}).get('rect',row['crop']);a=int(c['y']*h);b=int(np.ceil((c['y']+c['height'])*h));im.crop((0,a,w,b)).save(folder/(row['id']+'.png'));draw.rectangle((0,a,w-1,b),outline=(225,120,0,255),width=2);draw.text((4,a+2),row['id'],fill=(200,40,0,255))
  overlay.thumbnail((700,1600));overlay.save(folder/'overlay.jpg');(folder/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');records.append({'folder':folder.name,**result});print(index,len(result['rows']))
 (out/'results.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
if __name__=='__main__':main()

