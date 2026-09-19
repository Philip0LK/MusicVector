import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {canonicalArcs} from '../src/lib/arcEditing.js';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

// 默认自己起一个临时实例；也可以把 PRODUCT_TEST_HOME 指向一个已经在运行的验收副本。
let own = null;
async function instanceInfo() {
  const home = process.env.PRODUCT_TEST_HOME;
  if (home) return JSON.parse(await fs.readFile(path.join(home, 'data/.instance.json'), 'utf8'));
  const dir = path.resolve('qa', '编辑器验收 ' + Date.now());
  await fs.mkdir(dir, {recursive: true});
  const child = spawn(path.resolve('runtime/node/node.exe'), [path.resolve('server/product.mjs'), '--home', dir], {
    env: {...process.env, YUEBEIDOU_NO_OPEN: '1', YUEBEIDOU_NO_USB: '1'},
    windowsHide: true,
    stdio: 'ignore',
  });
  own = {child, dir};
  for (let i = 0; i < 120; i += 1) {
    try {
      return JSON.parse(await fs.readFile(path.join(dir, 'data/.instance.json'), 'utf8'));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw Error('临时实例没有起来');
}
const instance = await instanceInfo();
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const errors=[];
try{
 for(const viewport of [{width:1500,height:1000},{width:1920,height:1080},{width:1000,height:650}]){
  const context=await browser.newContext({viewport}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(instance.url+'/?launch='+instance.token);await page.goto(instance.url+'/correction.html');
  {
   const rows=Array.from({length:4},(_,r)=>({id:'row-'+r,page:Math.floor(r/2),line:r%2,crop:{version:2,space:'image-normalized',x:0,y:.2,width:1,height:.1},notes:Array.from({length:8},(_,i)=>({id:`n${r}-${i}`,degree:i%7+1,octave:0,annotation:{durationTicks:24,dotted:false,measureEnd:i%4===3,tieToNext:false}}))}));
   await page.evaluate(({doc,songId})=>{window.saved=null;window.addEventListener('message',e=>{if(e.data.type==='correction-save')window.saved=e.data.document});
   window.postMessage({type:'correction-init',song:{id:songId,title:'工具栏验收',key:'C',octave:4,images:[{src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhX8AAAAASUVORK5CYII='},{src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhX8AAAAASUVORK5CYII='}]},document:doc,cursor:{row:0,note:0}},location.origin);
  },{doc:canonicalArcs({meter:{beats:4,beatUnit:4},rows,music:{arcs:[]}}),songId:'toolbar-'+viewport.width+'-'+Date.now()});}
  const ed=page.locator('.editor');await ed.waitFor();
  const pick=async i=>{await page.locator('.workspace-row[data-row="0"] .engraved-note').nth(i).click();await ed.focus()};
  const box=async()=>page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {y:r.y,height:r.height}};return {toolbar:rect('.editing-controls'),score:rect('.score-workspace'),note:rect('.workspace-row.current .note-anchor'),crop:rect('.crop')}});
  await page.waitForTimeout(250);const original=await box();assert.equal(await page.locator('.brand').count(),0);
  await ed.press('d');await page.getByLabel('变拍分子',{exact:true}).waitFor();assert.deepEqual(await box(),original,'变拍开关不能移动纵向布局');
  const a=await page.getByLabel('变拍分子',{exact:true}).boundingBox(),b=await page.getByLabel('变拍分母',{exact:true}).boundingBox();assert.equal(a.width,b.width);assert.equal(a.height,b.height);assert.equal(a.y,b.y);
  const meterEdge=await page.locator('.local-meter-fields').boundingBox(),paneEdge=await ed.boundingBox();assert.ok(meterEdge.x+meterEdge.width<=paneEdge.x+paneEdge.width-10,'变拍设置必须完整显示在工具栏右侧');
  const input=page.getByLabel('变拍分子',{exact:true});
  for(const value of ['', '0','33','3.5','abc','-1','1e1']){await input.fill(value);await input.press('Tab');assert.match(await page.locator('.meter-error').innerText(),/1–32/);assert.deepEqual(await box(),original,'错误不能推动界面');assert.equal(await page.getByLabel('拍号',{exact:true}).innerText(),'4/4');}
  await input.fill('3');await input.press('Enter');assert.equal(await page.getByLabel('拍号',{exact:true}).innerText(),'3/4');
  await page.getByLabel('变拍分母',{exact:true}).selectOption('8');assert.equal(await page.getByLabel('拍号',{exact:true}).innerText(),'3/8');
  await page.getByLabel('仅本小节',{exact:true}).check();await pick(4);assert.equal(await page.getByLabel('拍号',{exact:true}).innerText(),'4/4');await pick(0);assert.equal(await input.inputValue(),'3');
  await input.fill('32');await input.press('Enter');await input.fill('4');await input.press('Enter');await page.getByLabel('变拍分母',{exact:true}).selectOption('4');
  await page.screenshot({path:`qa/editor-toolbar-meter-${viewport.width}.png`});
  const before=await box();await ed.focus();await ed.press('w');await page.locator('.connection-panel').waitFor();assert.deepEqual(await box(),before,'连接模式不得压缩乐谱或移动基线');assert.equal(await page.locator('.duration-options').count(),0);assert.ok(await page.getByRole('button',{name:'保存并返回训练',exact:true}).isDisabled());assert.ok(await page.getByRole('button',{name:'全曲预览',exact:true}).isDisabled());
  await ed.press('q');await ed.press('d');await ed.press('r');await ed.press('w');assert.equal(await page.locator('.connection-panel').count(),1);
  await pick(3);assert.match(await page.locator('.arc-edit-controls').innerText(),/终点：第 1 页 · 第 1 行 · 第 4 音/);
  await page.getByRole('button',{name:'3连音',exact:true}).click();await ed.press('ArrowUp');await page.screenshot({path:`qa/editor-toolbar-connection-${viewport.width}.png`});assert.deepEqual(await box(),before);
  await ed.press('Escape');assert.equal(await page.locator('.connection-panel').count(),0);assert.equal(await page.locator('[data-arc-id]').count(),0);assert.deepEqual(await box(),before);
  // Commit, then use the arc hit area to edit. W at the origin deletes directly.
  await ed.press('w');await pick(3);await page.getByRole('button',{name:'3连音',exact:true}).click();await ed.press('Enter');assert.equal(await page.locator('.connection-panel').count(),0);
  await pick(0);await page.locator('.arc-hit').first().click();await page.getByRole('button',{name:'5连音',exact:true}).click();await ed.press('Escape');
  await page.locator('.arc-hit').first().click();assert.equal(await page.getByRole('button',{name:'3连音',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByLabel('编辑页',{exact:true}).selectOption('1');await ed.focus();assert.equal(await page.locator('.connection-panel').count(),1);await ed.press('Escape');assert.equal(await page.getByLabel('编辑页',{exact:true}).inputValue(),'0');
  await page.locator('.arc-hit').first().click();await page.getByLabel('编辑页',{exact:true}).selectOption('1');await ed.focus();await ed.press('Enter');
  await page.getByLabel('编辑页',{exact:true}).selectOption('0');await pick(0);await ed.press('w');assert.equal(await page.locator('[data-arc-id]').count(),0);assert.equal(await page.locator('.connection-panel').count(),0,'起点 W 应直接删除而非编辑');
  await page.getByRole('button',{name:'保存并返回训练',exact:true}).click();await page.waitForFunction(()=>window.saved);const saved=await page.evaluate(()=>window.saved);assert.equal(saved.music.meterChanges[0].meter.beats,4);assert.equal(saved.music.arcs.length,0);assert.equal(saved.rows[0].notes[0].annotation.dotted,false);assert.equal(saved.rows[0].notes[0].octave,0);
  console.log('PASS stable editor toolbar',viewport);await context.close();
 }
 assert.deepEqual(errors,[]);
}finally{
 await browser.close();
 if(own){
  await fetch(instance.url+'/api/shutdown',{method:'POST',headers:{'x-yuebeidou-token':instance.token}}).catch(()=>{});
  own.child.kill();
 }
}
