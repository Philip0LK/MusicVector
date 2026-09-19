"""Spatial ownership of score evidence; no OCR or song-specific rules."""
from statistics import median


def owned_barlines(stats, left, right, baseline, height, envelope=None):
    """A distant text stroke cannot establish music evidence for a digit band."""
    return [list(map(int, (x,y,w,h))) for x,y,w,h,area in stats
            if left-height*2 <= x <= right+height*2
            and w < height*.3 and height*1.25 <= h <= height*4
            and (y <= baseline <= y+h or (envelope is not None and envelope['top']<=baseline<=envelope['bottom'] and envelope['top']<=y and y+h<=envelope['bottom']))]


def system_connection(upper, lower, components, staff_regions):
    """A bounded left connector joins voices; distance alone never does.

    Both endpoints must correspond to the proposed voices. Page borders and
    connectors crossing an intervening staff cannot join consecutive melody rows.
    """
    h=min(upper['height'], lower['height'])
    top=upper['cy']; bottom=lower['cy']
    if bottom-top < h*1.5: return None
    if any(a < bottom and b > top for a,b in staff_regions): return None
    left=min(upper['left'], lower['left'])
    overlap=min(upper['right'],lower['right'])-max(upper['left'],lower['left'])
    if overlap < min(upper['span'],lower['span'])*.45: return None
    upper_bars=upper.get('barEvidence',[]);lower_bars=lower.get('barEvidence',[])
    columns=sorted({b[0] for b in upper_bars if any(abs(b[0]-d[0])<h*.5 for d in lower_bars)})
    # An indented pickup may start well inside the first measure. Aligned
    # measure columns provide the scale for its left connector search.
    indent=max(3*h,columns[1]-columns[0]) if len(columns)>=2 else 3*h
    for x,y,w,hh,area in components:
        if not (.15*h <= w <= 1.5*h and left-indent <= x and x+w <= left+h*.3): continue
        if not (top-2*h <= y <= top+h*.5 and bottom-h*.7 <= y+hh <= bottom+2*h): continue
        if hh < bottom-top-h*.7: continue
        return {'kind':'left-system-connector','box':list(map(int,(x,y,w,hh)))}
    return None


def music_extent(glyphs, dashes, height):
    """Follow horizontal duration symbols; stacked strokes are not two durations."""
    durations=[]
    for i,(x,y,w,h) in enumerate(dashes):
        stacked=any(i!=j and min(x+w,xx+ww)-max(x,xx)>min(w,ww)*.5
                    for j,(xx,yy,ww,hh) in enumerate(dashes))
        if not stacked: durations.append((x,y,w,h))
    left=min(c['x'] for c in glyphs);right=max(c['x']+c['w'] for c in glyphs)
    attached=[];pending=durations[:]
    while pending:
        close=[d for d in pending if d[0] <= right+height*4 and d[0]+d[2] >= left-height*4]
        if not close: break
        for d in close:
            left=min(left,d[0]);right=max(right,d[0]+d[2]);attached.append(d);pending.remove(d)
    positions=sorted(set([c['x'] for c in glyphs]+[d[0] for d in attached]))
    gaps=[b-a for a,b in zip(positions,positions[1:]) if b-a>height*.5]
    # The closing bar can follow a full beat of blank space in sparse music.
    padding=min(height*4,median(gaps))*.5 if gaps else 0
    return left-padding,right+padding,attached


def coherent_measure_columns(bars, height, page_width):
    """Repeated aligned measure boundaries are evidence independent of glyph font."""
    if len(bars)<3 or min(b[3] for b in bars)<height*1.25: return False
    return (max(b[0] for b in bars)-min(b[0] for b in bars)>page_width*.3
            and max(b[1] for b in bars)-min(b[1] for b in bars)<height*.35
            and max(b[1]+b[3] for b in bars)-min(b[1]+b[3] for b in bars)<height*.35)


def notation_extent(candidate, components, staff_regions, diagrams):
    """Associate detached marks through short vertical links to actual glyphs.

    A fixed rectangle also collects punctuation from adjacent text. Require a
    path from a numeral through its beams/dots, bounded by the original body.
    """
    h=candidate['height'];top=candidate['top'];bottom=candidate['bottom']
    anchors=[tuple(b) for b in candidate.get('glyphBoxes',[])]
    pending=[]
    for x,y,w,hh,area in components:
        dot=hh<=h*.4 and w<=h*.55 and area>=2
        beam=hh<=h*.25 and h*.4<=w<=h*8 and area>=h*.2
        if not (dot or beam):continue
        if y+hh<top-h*1.6 or y>bottom+h*1.6:continue
        if any(y<b and y+hh>a for a,b in staff_regions):continue
        if any(x<r and x+w>l and y<b and y+hh>t for l,t,r,b in diagrams):continue
        pending.append(tuple(map(int,(x,y,w,hh))))
    while pending:
        linked=[]
        for box in pending:
            x,y,w,hh=box
            if any(x+w>=gx-h*.2 and x<=gx+gw+h*.2
                   and max(y-(gy+gh),gy-(y+hh),0)<=h*.55
                   for gx,gy,gw,gh in anchors):linked.append(box)
        if not linked:break
        for box in linked:
            anchors.append(box);pending.remove(box)
            top=min(top,box[1]);bottom=max(bottom,box[1]+box[3])
    return [top,bottom]


def standalone_barlines(bars, labels, components, height):
    """A vertical stroke inside a text character is not a measure boundary."""
    result=[]
    for x,y,w,h,area in bars:
        identities=set(int(v) for v in labels[y+h//2,x:x+w] if v)
        if any(components[i][2]<=height*.5 and components[i][3]<=height*4 for i in identities):
            result.append((x,y,w,h,area))
    return result


def local_voice_envelopes(candidates, components, staff_regions):
    """Repeated matching braces enclose simultaneous voices within measures.

    Unlike one page-left connector, these can begin anywhere along a row.
    Their shared vertical envelope also covers a voice with too few standalone
    numerals to become its own candidate band.
    """
    if not candidates:return []
    h=median(c['height'] for c in candidates);parts=[]
    for x,y,w,hh,area in components:
        if not (h*.3<=w<=h*1.2 and h*2<=hh<=h*8 and area/(w*hh)<.6):continue
        if any(y<b and y+hh>a for a,b in staff_regions):continue
        parts.append(tuple(map(int,(x,y,w,hh))))
    groups=[]
    for part in parts:
        x,y,w,hh=part
        group=next((g for g in groups if abs(g[0][1]-y)<h*.3 and abs(g[0][1]+g[0][3]-y-hh)<h*.3),None)
        if group is None:groups.append([part])
        else:group.append(part)
    result=[]
    # Whole-system connectors are not limited to pairs of voices. Establish
    # their full envelope first, then associate every enclosed numeral band.
    for x,y,w,hh,area in components:
        if not (h*.3<=w<=h*1.5 and hh>=h*2):continue
        if any(y<b and y+hh>a for a,b in staff_regions):continue
        members=[c for c in candidates if y<=c['cy']<=y+hh]
        if len(members)<2:continue
        left=min(c['left'] for c in members)
        if x+w>left+h*.3 or x<left-h*3:continue
        if members[0]['cy']-y>h*2 or y+hh-members[-1]['cy']>h*2:continue
        result.append({'top':int(y),'bottom':int(y+hh),'left':int(x),'right':max(c['right'] for c in members),'braces':[list(map(int,(x,y,w,hh)))]})
    for group in groups:
        if len(group)<2:continue
        left=min(v[0] for v in group);right=max(v[0]+v[2] for v in group)
        top=min(v[1] for v in group);bottom=max(v[1]+v[3] for v in group)
        if right-left<h*3:continue
        if not any(top<=c['cy']<=bottom and c['right']>left and c['left']<right for c in candidates):continue
        existing=next((v for v in result if abs(v['top']-top)<h*.3 and abs(v['bottom']-bottom)<h*.3 and min(v['right'],right)>=max(v['left'],left)),None)
        if existing:
            existing['left']=min(existing['left'],left);existing['right']=max(existing['right'],right)
            existing['braces']=[list(v) for v in dict.fromkeys(tuple(b) for b in existing['braces']+[list(v) for v in group])]
        else:result.append({'top':top,'bottom':bottom,'left':left,'right':right,'braces':[list(v) for v in group]})
    return result
