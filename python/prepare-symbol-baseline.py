from pathlib import Path
import json,hashlib
from PIL import Image,ImageEnhance
root=Path('output/symbol-baseline');root.mkdir(parents=True,exist_ok=True)
specs=[
 ('04',1,'1 6 1 3 3 2 | 3 2 3 2 1 7 6 5 | 6 7 1 2 3 4 |',[0,1,1,0,1,1,1,1,1,1,1,1,1,1,0,1,1,0,1,1],[],[6,14,20],[]),
 ('04',2,'5 - 3 5 2 | 3 1 6 3 3 1 6 3 3 1 6 3 3 1 6 3 |',[0,1,0,1]+[2]*16,[],[4,20],[]),
 ('05',8,'1 - - - |',[0],[],[1],[]),
 ('02',15,'6 6 1 3 1 1 1 | 1 - - - |',[1,2,1,1,1,1,0,0],[1],[7,8],[1,2]),
 ('00',3,'4 3 2 1 1 2 2 | 2 - 4 3 2 2 | 0 1 1 - - | 0 0 0 3 2 1 | 3 3 4 4 3 2 2 1 |',[1,1,1,1,0,1,1,0,1,2,2,0,1,1,0,0,0,1,1,2,1,0,2,2,1,1,2,1,1],[21,22],[7,12,15,21,29],[])
]
records=[]
for folder,row,text,u,d,b,low in specs:
 p=Path(f'output/lyric-slices/{folder}/row-{row}.png');im=Image.open(p).convert('RGBA')
 rec=dict(id=f'{folder}-{row}',source=str(p),sha256=hashlib.sha256(p.read_bytes()).hexdigest(),text=text,underlines=u,rightDots=d,measureEnds=b,lowOctaves=low,variants=[])
 for name,v in [('original',im),('resize75',im.resize((round(im.width*.75),round(im.height*.75)))),('brightness110',ImageEnhance.Brightness(im).enhance(1.1))]:
  # Same analysis width as the production browser adapter.
  v=v.resize((1440,round(v.height*1440/v.width)))
  binary=f'{rec["id"]}-{name}.rgba';(root/binary).write_bytes(v.tobytes());rec['variants'].append(dict(name=name,width=v.width,height=v.height,file=binary))
 records.append(rec)
(root/'labels.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf8')
