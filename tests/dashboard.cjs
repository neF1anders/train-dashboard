const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:5173';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.route('**/api/settings?*',r=>r.fulfill({json:{imagery:{esri_allowed:false,default_style:'streets'}}}));
 try{
  await page.goto(base);await page.locator('.vehicle-card').last().waitFor();
  assert.equal(await page.locator('.vehicle-card').count(),6);
  await page.click('[data-vehicle="7752"]');assert.equal(await page.locator('#vehicle-select').inputValue(),'7752');
  await page.selectOption('#date-select','2026-09-15');await page.selectOption('#route-select','10');
  await page.locator('.episode-search>summary').click();await page.locator('#home-episodes .episode-row').first().waitFor();
  assert((await page.locator('#home-episodes .episode-row').count())<=12);
  await page.click('#home-more');assert((await page.locator('#home-episodes .episode-row').count())>12);
  await page.screenshot({path:'tmp/integrated-home.png',fullPage:true});
  await page.locator('#home-episodes .episode-row').first().click();await page.locator('#analysis-result').waitFor({state:'visible'});
  assert.equal(await page.locator('#episode-card .card-section').count(),4);
  assert(!(await page.locator('#signals-details').evaluate(e=>e.open)));
  assert(!(await page.locator('#system-details').evaluate(e=>e.open)));
  assert((await page.locator('#scene').boundingBox()).width>900);
  assert.equal(requests.filter(u=>u.includes('/api/signals?')).length,0);
  await page.locator('#signals-details>summary').click();await page.waitForFunction(()=>document.querySelector('#signals-status').textContent.includes('JSON'));
  const box=await page.locator('#signals').boundingBox(),before=await page.locator('#cursor-time').innerText();
  await page.mouse.move(box.x+box.width*.6,box.y+80);await page.waitForTimeout(200);const preview=await page.locator('#cursor-time').innerText();assert.notEqual(preview,before);
  await page.mouse.click(box.x+box.width*.6,box.y+80);await page.mouse.move(20,20);await page.waitForTimeout(200);assert.equal(await page.locator('#cursor-time').innerText(),preview);
  await page.locator('#system-details>summary').click();await page.locator('#system-state .module-table').waitFor();
  const invalid=await page.request.get(base+'/api/signals?vehicle=7752&route=10&start=1789442185800&end=1789442230800&limit=0');assert.equal(invalid.status(),400);
  const signals=await(await page.request.get(base+'/api/signals?vehicle=7752&route=10&start=1789442185800&end=1789442230800&limit=1600')).json();assert(signals.rows.every(r=>r.family==='json'&&r.route==='10'));
  // Delay the old analysis, choose another interval, then let the stale response arrive.
  let delayed=false;await page.route('**/api/analyze',async route=>{if(!delayed){delayed=true;await new Promise(r=>setTimeout(r,1700));}await route.continue();});
  await page.click('#analyze-top');await page.waitForFunction(()=>document.querySelector('#analyze-button').disabled);
  await page.locator('.range-details').evaluate(e=>e.open=true);
  await page.click('[data-span="30000"]');await page.waitForTimeout(2400);
  const stale=await page.locator('#analysis-state').innerText();assert(stale.includes('предыдущего'),'Old analysis replaced the newly selected interval');
  await page.screenshot({path:'tmp/integrated-workspace.png',fullPage:true});
  for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:1100});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Overflow at '+width);}
  const preserved=page.url().split('#')[1];await page.goto(base+'/classic.html#'+preserved);await page.locator('#work-view').waitFor({state:'visible'});assert.equal(new URL(page.url()).pathname,'/');
  const continuity=await page.evaluate(async()=>{const {SignalChart}=await import('/dashboard.js'),s=new SignalChart(document.createElement('canvas'),{commit(){},leave(){}});s.gaps=[[1000,60000]];return [s.continuous({t:1000,family:'json',route:'10'},{t:60000,family:'json',route:'10'}),s.continuous({t:70000,family:'json',route:'10'},{t:71000,family:'csv',route:'10'}),s.continuous({t:70000,family:'json',route:'10'},{t:71000,family:'json',route:'20'})];});assert(continuity.every(x=>!x));
  assert(!requests.some(u=>/yandex|ymaps/.test(u)));assert.deepEqual(errors,[]);
  console.log(JSON.stringify({vehicleCards:true,episodePagination:true,autoAnalysis:true,lazyDiagnostics:true,signalCursor:true,sourceIsolation:true,staleAnalysisIgnored:true,legacyLink:true,responsive:true,noYandex:true}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
