"""Build a local, dependency-free visual review page from the slicer manifest."""
import html,json
from pathlib import Path
root=Path('output/lyric-slices')
records=json.loads((root/'results.json').read_text(encoding='utf8'))
parts=['''<!doctype html><meta charset="utf-8"><title>整行简谱与歌词切片检查</title><style>body{font-family:system-ui;background:#f5f5f3;color:#242424;margin:32px}h1{font-size:26px}section{background:white;padding:24px;margin:24px 0;border-radius:12px}summary{cursor:pointer;font-size:20px}article{margin:20px 0;border-top:1px solid #ddd;padding-top:12px}img{max-width:100%;display:block}small{color:#777}.overlay{max-height:85vh}a{color:#856a19}</style><h1>整行简谱＋对应歌词</h1><p>纯图像算法实验输出；橙框为裁切边界。展开歌曲可逐行查看原图像素切片。</p>''']
for r in records:
 folder=r['folder'];parts.append(f'<section><details><summary>{html.escape(r["file"])} · {len(r["rows"])} 行</summary><p><a href="{folder}/result.json">坐标与检测证据</a></p><img class="overlay" src="{folder}/overlay.jpg">')
 if r.get('warnings'):parts.append('<p>需检查：扰动测试的行数不稳定。</p>')
 for row in r['rows']:
  parts.append(f'<article><small>{row["id"]} · {"检测到歌词" if row["lyricsBands"] else "未检测到歌词，请核对是否为器乐行"}</small><img loading="lazy" src="{folder}/{row["id"]}.png"></article>')
 parts.append('</details></section>')
(root/'index.html').write_text('\n'.join(parts),encoding='utf8')
