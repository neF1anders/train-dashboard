const {chromium}=require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(()=>document.querySelector('#vehicle-select').options.length===6);
  if(!(await page.locator('#archive-hours').innerText()).includes('470'))throw Error('Coverage total is missing');
  await page.screenshot({path:'tmp/app-home.png',fullPage:true});
  await page.selectOption('#vehicle-select','3139');await page.selectOption('#date-select','2026-09-14');await page.selectOption('#route-select','6');
  await page.click('#open-trip');await page.waitForFunction(()=>document.querySelector('#current-speed').textContent!=='—');
  await page.locator('.range-details').evaluate(e=>e.open=true);await page.fill('#range-start','2026-09-14T05:08:49.389');await page.fill('#range-end','2026-09-14T05:09:24.68');
  const windowResponse=page.waitForResponse(r=>r.url().includes('/api/window')&&r.status()===200);await page.click('#apply-range');await windowResponse;
  await page.click('#analyze-button');await page.locator('#analysis-result').waitFor({state:'visible'});
  if(!(await page.locator('#analysis-summary').innerText()).includes('ActuationAct'))throw Error('Known intervention not analyzed');
  await page.locator('#facts-details').evaluate(e=>e.open=true);if(await page.locator('.evidence-card').count()<2)throw Error('Missing evidence cards');
  await page.locator('.evidence-card').first().click();await page.waitForFunction(()=>document.querySelector('#raw-details').open&&document.querySelector('#raw-record').textContent.includes('timestamp'));
  const raw=JSON.parse(await page.locator('#raw-record').innerText());
  if(!raw.timestamp)throw Error('No source record');
  const time=await page.locator('#cursor-time').innerText();await page.click('#view-2d');
  if(await page.locator('#cursor-time').innerText()!==time)throw Error('2D switch reset time');
  await page.click('#view-3d');
  await page.locator('#questions-details').evaluate(e=>e.open=true);await page.click('[data-question="Кто управлял вагоном?"]');await page.waitForFunction(()=>document.querySelector('#answer').textContent.includes('cpilot'));
  await page.locator('#raw-details').evaluate(e=>e.open=false);
  await page.screenshot({path:'tmp/app-workspace.png',fullPage:true});
  await page.click('#map-toggle');await page.locator('#map-panel').waitFor({state:'visible'});await page.waitForTimeout(500);
  const box=await page.locator('#city-map').boundingBox();let found=false;
  for(const [x,y] of [[.5,.5],[.4,.4],[.6,.6],[.5,.3],[.3,.5],[.7,.5],[.5,.7],[.3,.3],[.7,.7],[.4,.6],[.6,.4]]){
   await page.mouse.click(box.x+x*box.width,box.y+y*box.height);
   if(await page.locator('#map-pass option').count()){found=true;break;}
  }
  if(!found)throw Error('Could not select a track point on map');
  await page.click('#map-set-start');await page.waitForTimeout(400);
  if(!(await page.locator('#analysis-state').innerText()).includes('предыдущего'))throw Error('Changed interval did not mark old analysis');
  await page.screenshot({path:'tmp/app-map.png',fullPage:true});
  const savedTime=await page.locator('#cursor-time').innerText();await page.waitForTimeout(750);
  await page.reload();await page.waitForFunction(()=>!document.querySelector('#work-view').hidden&&document.querySelector('#current-speed').textContent!=='—');
  if(await page.locator('#cursor-time').innerText()!==savedTime)throw Error('Reload did not restore cursor');
  if(await page.locator('#map-panel').isVisible())await page.click('#map-close');await page.click('#back-home');await page.locator('.history-item').first().waitFor();
  await page.selectOption('#vehicle-select','3119');await page.selectOption('#date-select','2026-10-05');await page.selectOption('#route-select','all');
  await page.click('#open-trip');await page.waitForFunction(()=>document.querySelector('#source-badge').textContent==='CSV');
  const results=[];
  for(const width of [1440,1024,768,390,320]){
   await page.setViewportSize({width,height:1100});await page.waitForTimeout(100);
   const size=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
   results.push({width,...size});if(size.scroll>size.client+1)throw Error('Horizontal overflow at '+width);
  }
  await page.screenshot({path:'tmp/app-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1100});await page.click('#theme-button');await page.screenshot({path:'tmp/app-dark.png',fullPage:true});
  if(errors.length)throw Error(errors.join('\n'));
  const result={passed:true,archiveFilters:true,evidenceNavigation:true,viewSync:true,mapSelection:true,analysisStaleness:true,reloadRestore:true,csvOnly:true,responsive:results,pageErrors:errors};
  fs.writeFileSync('tmp/browser-test-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){await page.screenshot({path:'tmp/app-test-failure.png',fullPage:true});console.log('UI_ERROR',await page.locator('#notification').textContent());throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
