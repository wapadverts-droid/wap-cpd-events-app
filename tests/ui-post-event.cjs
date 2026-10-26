const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..'),lib=process.env.WAPCPD_LIB || path.join(root,'node_modules');
const C=require('../src/core.js');const crypto=require('node:crypto');
function data(){
 const s=C.createState('demo'),c={now:Date.parse('2026-10-01T09:00:00+02:00'),rand:C.prng(42)};
 const staff=C.addStaff(s,c,null,{name:'Test Administrator',role:'admin',pinHash:crypto.createHash('sha256').update('wapcpd:1111').digest('hex')});s.sessions.test={staffId:staff.id};const a={session:'test'};
 C.updateApproval(s,c,a,{activityNumber:'DEMO-2026',ceus:'2',level:'1'});
 C.updateSignatory(s,c,a,{name:'Test Signatory',title:'Organiser',image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l4sAAAAASUVORK5CYII='});
 const people=['Confirmed','NoShow','ArrivalOnly','NeedsCheck'].map((firstName,i)=>C.createBooking(s,c,null,{firstName,lastName:'Test',profession:'Pharmacist',hpcnaStatus:'provided',hpcna:'PHS00'+i,phone:'08175010'+String(i).padStart(2,'0'),email:firstName.toLowerCase()+'@example.com',channel:'whatsapp',consentEvent:true},{}));
 c.now=Date.parse('2026-10-23T17:40:00+02:00');for(const i of [0,2,3])C.recordArrival(s,c,a,people[i].id,'search');
 c.now=Date.parse('2026-10-23T19:30:00+02:00');for(const i of [0,3])C.confirmCompletion(s,c,a,people[i].id,'register');C.markDetailsChecked(s,c,a,people[0].id);
 c.now=Date.parse('2026-10-26T09:00:00+02:00');C.applyPostEventUpdate(s,c,a);
 return {s,people,clock:{at:c.now,setAt:Date.now()}};
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}: {})});
 const fixtures=data(),errors=[];const output=path.join(__dirname,'output');fs.mkdirSync(output,{recursive:true});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const libraries={'jspdf.umd.min.js':path.join(lib,'jspdf/dist/jspdf.umd.min.js'),'qrcode.js':path.join(lib,'qrcode-generator/qrcode.js'),'jsQR.js':path.join(lib,'jsqr/dist/jsQR.js')};
 await ctx.route('**/*',route=>{const url=route.request().url();if(url.startsWith('http://app.test/'))return route.fulfill({body:fs.readFileSync(path.join(root,'index.html')),contentType:'text/html'});for(const [suffix,file] of Object.entries(libraries))if(url.endsWith(suffix))return route.fulfill({body:fs.readFileSync(file),contentType:'application/javascript'});return route.abort();});
 await ctx.addInitScript(({s,clock})=>{localStorage.setItem('wapcpd:pref:mode',JSON.stringify('demo'));localStorage.setItem('wapcpd:data:demo',JSON.stringify(s));localStorage.setItem('wapcpd:clock:demo',JSON.stringify(clock));sessionStorage.setItem('wapcpd:session:demo','test');},fixtures);
 const pg=await ctx.newPage();pg.on('pageerror',e=>errors.push(e.message));
 await pg.goto('http://app.test/#s-dash');await pg.getByRole('heading',{name:'Event overview'}).waitFor();assert.equal(await pg.locator('.sidenav > a').count(),5);await pg.screenshot({path:path.join(output,'overview.png'),fullPage:true});
 await pg.goto('http://app.test/#s-people');await pg.getByRole('heading',{name:'Attendees',exact:true}).waitFor();assert.equal(await pg.locator('tbody tr').count(),3);await pg.locator('#pp-q').fill('Confirmed');await pg.waitForTimeout(200);assert.equal(await pg.locator('tbody tr').count(),1);
 await pg.locator('#pp-q').fill('');await pg.waitForTimeout(200);assert.equal(await pg.locator('tbody tr').count(),3);
 await pg.goto('http://app.test/#s-certs');await pg.getByRole('heading',{name:'Certificates',exact:true}).waitFor();await pg.getByRole('button',{name:'Prepare all WhatsApp messages',exact:true}).click();await pg.locator('[data-act="cert-preview"]').first().click();await pg.locator('.cert-sheet').waitFor();assert.match(await pg.locator('.cert-sheet').innerText(),/Date of event: 23 October 2026/);assert.equal(await pg.locator('.cert-sheet img[alt="Signature"]').count(),1);assert.match(await pg.locator('.cert-sheet').innerText(),/Authorised provider signature/);
 await pg.screenshot({path:path.join(output,'certificate.png'),fullPage:true});
 const [dl]=await Promise.all([pg.waitForEvent('download'),pg.locator('[data-act="cert-pdf"]').last().click()]);await dl.saveAs(path.join(output,'certificate.pdf'));await pg.getByRole('button',{name:'Close',exact:true}).click();
 await pg.locator('[data-act="cert-preview"]').last().click();assert.equal(await pg.locator('.cert-sheet img[alt="Signature"]').count(),1);assert.match(await pg.locator('.cert-sheet').innerText(),/PREVIEW/);await pg.getByRole('button',{name:'Close',exact:true}).click();
 await pg.goto('http://app.test/#s-settings');await pg.getByRole('heading',{name:'Signatory',exact:true}).waitFor();assert.equal(await pg.locator('form[data-form=sig]').count(),1);
 await pg.goto('http://app.test/#s-archived');assert.equal(await pg.locator('tbody tr').count(),1);await pg.getByRole('button',{name:'Restore',exact:true}).click();await pg.waitForTimeout(100);assert.equal(await pg.locator('tbody tr').count(),0);
 // Phone screen checks: all core navigation works without page-wide horizontal scrolling.
 await pg.setViewportSize({width:390,height:844});for(const hash of ['s-dash','s-people','s-certs','s-settings','s-more']){await pg.goto('http://app.test/#'+hash);await pg.waitForTimeout(60);assert.ok(await pg.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow at '+hash);}
 await pg.goto('http://app.test/#s-dash');await pg.screenshot({path:path.join(output,'phone.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS UI: four main screens + More, attendee search, archive restore, certificate preview signature/date, issued PDF download, mobile navigation, no JS errors.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
