const {chromium}=require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1366,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>document.querySelector('#vehicle-select').options.length===6);
  await page.selectOption('#vehicle-select','3139');await page.selectOption('#date-select','2026-09-14');await page.selectOption('#route-select','6');await page.click('#open-trip');
  await page.waitForFunction(()=>document.querySelector('#current-speed').textContent!=='—');
  await page.click('#timeline-zoom');if(await page.locator('#timeline-zoom').innerText()!=='Вся поездка')throw Error('Timeline zoom failed');
  const before=await page.locator('#cursor-time').innerText();await page.click('#play');await page.waitForTimeout(1100);await page.click('#play');
  if(await page.locator('#cursor-time').innerText()===before)throw Error('Playback did not move');
  await page.locator('#snapshot-details').evaluate(e=>e.open=true);
  const options=await page.locator('#snapshot-select option').evaluateAll(es=>es.map(e=>({value:e.value,text:e.textContent})).filter(e=>e.value));
  if(!options.length)throw Error('Rich snapshots are missing');
  await page.selectOption('#snapshot-select',options[0].value);
  const raw=await (await page.request.get('http://127.0.0.1:5173/api/record?id='+options[0].value)).json();
  const target=Date.parse(raw.raw.telemetry_timestamp)||raw.record.t;
  await page.click('#go-snapshot');
  await page.waitForFunction(t=>document.querySelector('#cursor-time').textContent===new Date(t+10800000).toISOString().slice(11,23),target);
  await page.check('#show-snapshot');await page.waitForTimeout(100);
  if(!(await page.locator('#snapshot-content').innerText()).includes('TRAFFIC_LIGHT'))throw Error('Snapshot payload not displayed');
  const three=await page.locator('#scene').evaluate(c=>c.toDataURL());await page.click('#view-2d');const two=await page.locator('#scene').evaluate(c=>c.toDataURL());
  if(three===two)throw Error('2D/3D projections are identical');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'tmp/app-snapshot.png',fullPage:true});
  const invariant=await page.evaluate(async()=>{
    const {positionAt}=await import('/map.js');
    const track=[{t:0,lat:59.95,lon:30.3,pos:0,segment:'a'},{t:10000,lat:59.9501,lon:30.3,pos:10,segment:'a'}];
    const fused=positionAt(track,5000,{t:5000,pos:3,segment:'a'}),reset=positionAt(track,5000,{t:5000,pos:3,segment:'b'});
    const gap=positionAt([{t:0,lat:59.95,lon:30.3},{t:60000,lat:59.96,lon:30.3}],30000);
    const before=positionAt(track,-1),future=positionAt(track,5000,{t:5500,pos:3,segment:'a'});return {fused:fused.method,reset:reset.method,gap,before,future:future.method};
  });
  if(invariant.fused!=='odometry'||invariant.reset!=='gps'||invariant.gap!==null||invariant.before!==null||invariant.future!=='gps')throw Error('Odometry/gap invariant failed');
  if(errors.length)throw Error(errors.join('\n'));
  console.log(JSON.stringify({playback:true,zoom:true,snapshotTime:true,geometryViews:true,odometry:invariant,pageErrors:errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
