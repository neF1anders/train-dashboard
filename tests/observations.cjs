const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const time=t=>new Date(t+10800000).toISOString().slice(11,23);
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],mapRequests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/map?'))mapRequests.push(r.url());});
  try{
    const t=Date.parse('2026-09-15T06:16:40.800+03:00');
    await page.goto(`http://127.0.0.1:5173/#work?vehicle=7752&day=2026-09-15&route=10&start=${t-15000}&end=${t+30000}&time=${t}`);
    await page.locator('#event-context [data-snapshot-id]').waitFor();
    assert((await page.locator('#event-context').innerText()).includes('Автомобиль'));
    assert((await page.locator('#event-context').innerText()).includes('0,209 с до'));
    await page.waitForFunction(()=>document.querySelector('#scene').dataset.ground==='ready');
    const ground=await page.locator('#scene').evaluate(c=>c.toDataURL());await page.uncheck('#show-ground');
    assert.equal(await page.locator('#scene').getAttribute('data-ground'),'off');
    assert.notEqual(ground,await page.locator('#scene').evaluate(c=>c.toDataURL()));await page.check('#show-ground');
    await page.locator('#event-context [data-snapshot-id]').click();
    await page.waitForFunction(t=>document.querySelector('#cursor-time').textContent===t,time(t-209));
    assert(await page.locator('#show-snapshot').isChecked());
    assert((await page.locator('#snapshot-content').innerText()).includes('TRACKED'));
    await page.locator('.scene-panel').screenshot({path:'tmp/observed-car.png'});
    const trip=await(await page.request.get('http://127.0.0.1:5173/api/trip?vehicle=7752&day=2026-09-15&route=10')).json();
    assert.equal(await page.locator('#snapshot-select option').count(),trip.snapshots.length+1);
    await page.click('#map-toggle');await page.check('#map-observations');
    assert.equal(await page.locator('#map-observation-list [data-snapshot-id]').count(),trip.snapshots.length);
    assert.equal(await page.locator('#city-map').getAttribute('data-observation-count'),String(trip.snapshots.length));
    assert((await page.locator('.observation-note').innerText()).includes('не положение самого объекта'));
    await page.screenshot({path:'tmp/observation-map.png'});
    const first=trip.snapshots[0];await page.locator(`#map-observation-list [data-snapshot-id="${first.id}"]`).click();
    await page.waitForFunction(t=>document.querySelector('#cursor-time').textContent===t,time(first.t));
    assert(await page.locator('#map-panel').isHidden());
    await page.waitForFunction(()=>document.querySelector('#scene').dataset.ground==='ready');
    const before=mapRequests.length;for(let i=0;i<4;i++){await page.click('#view-2d');await page.click('#view-3d');}
    assert(mapRequests.length-before<=1,'Static map should not be fetched on each redraw');
    await page.click('#theme-button');assert.equal(errors.length,0,errors.join('\n'));
    for(const width of [320,768,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');}
    console.log(JSON.stringify({brakingObject:true,ownTimestamp:true,groundToggle:true,observationOrigins:true,deduplication:true,cachedMap:true,pageErrors:errors}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
