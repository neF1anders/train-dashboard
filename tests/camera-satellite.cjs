const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const URL='http://127.0.0.1:5173/#work?vehicle=7752&day=2026-09-15&route=10&start=1789442185800&end=1789442230800&time=1789442200800';
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],tiles=[];
  const live=process.argv.includes('--live');
  // Default run is fully local. A fixture validates projection/CORS/rendering
  // without sending any route-derived tile coordinates to the imagery provider.
  if(!live)await page.route('https://services.arcgisonline.com/**',route=>route.fulfill({status:200,contentType:'image/svg+xml',headers:{'Access-Control-Allow-Origin':'*'},body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#537f59"/><path d="M0 120H256M125 0V256" stroke="#9a9990" stroke-width="22"/><rect x="25" y="25" width="55" height="42" fill="#bec3c2"/></svg>'}));
  if(!live)await page.route('**/api/settings?*',route=>route.fulfill({json:{imagery:{esri_allowed:false,default_style:'streets'}}}));
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('World_Imagery/MapServer/tile/'))tiles.push({url:r.url(),status:r.status()});});
  const camera=async()=>JSON.parse(await page.locator('#scene').getAttribute('data-camera'));
  try{
    await page.goto(URL);await page.waitForFunction(()=>document.querySelector('#scene').dataset.ground==='ready',{},{timeout:45000});
    await page.locator('.view-settings').evaluate(e=>e.open=true);
    if(!live){
      await page.selectOption('#ground-style','satellite');await page.locator('#satellite-consent').waitFor({state:'visible'});assert.equal(tiles.length,0,'Satellite requests must wait for explicit permission');
      await page.click('#allow-satellite');await page.waitForFunction(()=>document.querySelector('#scene').dataset.ground==='ready',{},{timeout:45000});
    }else assert(await page.locator('#satellite-consent').isHidden(),'Local authorization should not require confirmation again');
    assert.equal(await page.locator('#scene').getAttribute('data-ground-style'),'satellite');
    assert(tiles.some(t=>t.status===200),'No imagery tile was rendered');
    await page.locator('.scene-panel').screenshot({path:live?'tmp/satellite-scene.png':'tmp/satellite-fixture-test.png'});
    await page.locator('#scene').scrollIntoViewIfNeeded();let box=await page.locator('#scene').boundingBox();const x=box.x+box.width*.5,y=box.y+box.height*.45;
    const initial=await camera(),time=await page.locator('#cursor-time').innerText();
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+90,y+45,{steps:12});await page.mouse.up();
    let changed=await camera();assert.notEqual(changed.angle,initial.angle);assert.notEqual(changed.pitch,initial.pitch);assert.equal(await page.locator('#cursor-time').innerText(),time);
    await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.move(x+55,y+25,{steps:8});await page.mouse.up({button:'right'});
    changed=await camera();assert.equal(changed.following,false);assert(Math.hypot(changed.center.x-initial.center.x,changed.center.y-initial.center.y)>1);
    const beforeZoom=changed.zoom,scroll=await page.evaluate(()=>scrollY);await page.mouse.move(x,y);await page.mouse.wheel(0,-160);await page.waitForTimeout(100);
    assert((await camera()).zoom>beforeZoom);assert.equal(await page.evaluate(()=>scrollY),scroll);
    await page.locator('#scene').focus();const keyboardBefore=await camera();await page.keyboard.press('ArrowLeft');assert.notEqual((await camera()).angle,keyboardBefore.angle);assert.equal(await page.locator('#cursor-time').innerText(),time);
    await page.click('#reset-camera');assert.deepEqual({angle:(await camera()).angle,pitch:(await camera()).pitch,zoom:(await camera()).zoom,following:(await camera()).following},{angle:220,pitch:42,zoom:1.25,following:true});
    await page.selectOption('#ground-style','streets');await page.waitForFunction(()=>document.querySelector('#scene').dataset.ground==='ready');
    await page.click('#view-2d');await page.locator('#scene').scrollIntoViewIfNeeded();box=await page.locator('#scene').boundingBox();
    const top=await camera();await page.mouse.move(box.x+box.width/2,box.y+120);await page.mouse.down();await page.mouse.move(box.x+box.width/2+40,box.y+155,{steps:6});await page.mouse.up();
    assert.equal((await camera()).angle,top.angle);assert.equal((await camera()).following,false);
    await page.locator('#scene').dblclick();assert.equal((await camera()).following,true);
    const math=await page.evaluate(async()=>{
      const {OrbitCamera}=await import('/camera.js'),{tileXY,tileBounds}=await import('/satellite.js');
      const c=new OrbitCamera(document.createElement('canvas'),()=>{}),v=c.view(1000,600,'3d',{x:10,y:20}),p={x:26,y:-31},screen=v.project([p.x,p.y,0]),back=v.unproject(screen[0],screen[1]);
      const tile=tileXY(30.32,59.94,18),bounds=tileBounds(Math.floor(tile.x),Math.floor(tile.y),18);
      const cursor={x:260,y:180},beforeZoom=v.unproject(cursor.x,cursor.y);c.zoomAt(1.5,cursor.x,cursor.y);const afterZoom=c.view(1000,600,'3d',{x:10,y:20}).unproject(cursor.x,cursor.y);
      const fixed={...c.center};c.view(1000,600,'3d',{x:100,y:200});
      return {error:Math.hypot(p.x-back.x,p.y-back.y),anchorError:Math.hypot(beforeZoom.x-afterZoom.x,beforeZoom.y-afterZoom.y),freeCameraStable:c.center.x===fixed.x&&c.center.y===fixed.y,inside:bounds.west<=30.32&&bounds.east>=30.32&&bounds.south<=59.94&&bounds.north>=59.94};
    });assert(math.error<1e-9&&math.anchorError<1e-9&&math.freeCameraStable&&math.inside);
    for(const width of [320,768,1440]){await page.setViewportSize({width,height:1050});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');}
    assert.equal(errors.length,0,errors.join('\n'));
    const offline=await browser.newPage();await offline.route('https://services.arcgisonline.com/**',route=>route.abort());await offline.route('**/api/settings?*',route=>route.fulfill({json:{imagery:{esri_allowed:false,default_style:'streets'}}}));await offline.goto(URL);
    await offline.locator('#work-view').waitFor({state:'visible'});await offline.locator('.view-settings').evaluate(e=>e.open=true);await offline.selectOption('#ground-style','satellite');await offline.click('#allow-satellite');
    await offline.waitForFunction(()=>document.querySelector('#scene').dataset.ground==='unavailable',{},{timeout:30000});
    assert((await offline.locator('#ground-status').innerText()).includes('план улиц'));
    await offline.locator('.view-settings').evaluate(e=>e.open=true);await offline.selectOption('#ground-style','streets');await offline.waitForFunction(()=>document.querySelector('#scene').dataset.ground==='ready');await offline.close();
    console.log(JSON.stringify({imageryMode:live?'live':'local fixture',tiles:tiles.length,permissionGate:true,orbit:true,pan:true,cursorZoom:true,keyboard:true,reset:true,topView:true,projection:math,offlineFallback:true,pageErrors:errors}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
