"""Local image-only adapter. Reads one image from stdin; never accepts file paths."""
import sys,json,base64,io,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from score_slicer import analyze
from PIL import Image
try:
 payload=json.load(sys.stdin)
 data=base64.b64decode(payload['image'].split(',',1)[1],validate=True)
 image=Image.open(io.BytesIO(data))
 if image.width*image.height>40_000_000:raise ValueError('图片像素过大')
 original,result=analyze(image)
 result['image']['sha256']=hashlib.sha256(data).hexdigest()
 for row in result['rows']:
  c=row['crop'].get('rectified',{}).get('rect',row['crop']);w,h=original.size
  import math
  crop=original.crop((0,math.floor(c['y']*h),w,math.ceil((c['y']+c['height'])*h)))
  output=io.BytesIO();crop.save(output,format='PNG')
  row['src']='data:image/png;base64,'+base64.b64encode(output.getvalue()).decode()
 print(json.dumps(result,ensure_ascii=True))
except Exception as e:
 print(json.dumps({'error':'切片失败：'+str(e)},ensure_ascii=True));sys.exit(1)
