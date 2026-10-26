const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/core.js');
const at=(d,t)=>Date.parse(`${d}T${t}:00+02:00`);
const SIG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l4sAAAAASUVORK5CYII=';
function fixture(){
 const s=C.createState('demo'), c={now:at('2026-10-01','09:00'),rand:C.prng(32)};
 const staff=C.addStaff(s,c,null,{name:'Administrator',role:'admin',pinHash:'a'.repeat(64)});
 s.sessions.x={staffId:staff.id};const a={session:'x'};
 const pa=C.addStaff(s,c,a,{name:'Reception',role:'pa',pinHash:'b'.repeat(64)});s.sessions.y={staffId:pa.id};
 C.updateApproval(s,c,a,{activityNumber:'TEST',ceus:'2',level:'1'});
 C.updateSignatory(s,c,a,{name:'Test signatory',title:'Organiser',image:SIG});
 const p={firstName:'Test',lastName:'Attendee',profession:'Pharmacist',hpcnaStatus:'provided',hpcna:'PHS12345',phone:'0817501017',email:'test@example.com',channel:'whatsapp',consentEvent:true};
 const b=C.createBooking(s,c,null,p,{});
 return {s,c,a,b,p,pa:{session:'y'}};
}
function attend(f){f.c.now=at('2026-10-23','17:40');C.recordArrival(f.s,f.c,f.pa,f.b.id,'search');f.c.now=at('2026-10-23','19:30');C.confirmCompletion(f.s,f.c,f.pa,f.b.id,'register');C.markDetailsChecked(f.s,f.c,f.pa,f.b.id);}

test('automatic issuance requires confirmed attendance; survey and admin release are unnecessary',()=>{
 const f=fixture();C.markDetailsChecked(f.s,f.c,f.a,f.b.id);assert.equal(C.synchronizeCertificates(f.s,f.c),0);
 f.c.now=at('2026-10-23','17:40');C.recordArrival(f.s,f.c,f.pa,f.b.id,'search');assert.equal(C.synchronizeCertificates(f.s,f.c),0);
 f.c.now=at('2026-10-23','19:30');C.confirmCompletion(f.s,f.c,f.pa,f.b.id,'register');assert.equal(f.b.feedback,null);
 assert.equal(C.synchronizeCertificates(f.s,f.c),1);assert.equal(C.synchronizeCertificates(f.s,f.c),0);assert.equal(f.s.certificates.length,1);
 assert.equal(f.s.messages.filter(m=>m.type==='certificate').length,1);
});
test('required signature, identity checks, approval and unresolved exceptions still block issuance',()=>{
 const f=fixture();attend(f);f.s.event.signatory.image=null;assert.equal(C.synchronizeCertificates(f.s,f.c),0);
 f.s.event.signatory.image=SIG;f.b.flags.duplicate={resolved:null,matches:[]};assert.equal(C.synchronizeCertificates(f.s,f.c),0);
 f.b.flags.duplicate=null;f.s.event.approval.ceus='';assert.equal(C.synchronizeCertificates(f.s,f.c),0);
 f.s.event.approval.ceus='2';f.b.detailsChecked=null;assert.equal(C.synchronizeCertificates(f.s,f.c),0);
});
test('certificate layout freezes signature, event date and provider; new settings never alter it',()=>{
 const f=fixture();attend(f);C.synchronizeCertificates(f.s,f.c);const cert=C.currentCert(f.s,f.b);
 const e=C.certificateEvent(f.s,cert);assert.equal(e.date,'2026-10-23');assert.equal(e.signatory.image,SIG);
 C.updateSignatory(f.s,f.c,f.a,{name:'Changed',image:null});f.s.event.date='2027-01-01';
 assert.equal(C.certificateEvent(f.s,cert).date,'2026-10-23');assert.equal(C.certificateEvent(f.s,cert).signatory.name,'Test signatory');
 assert.equal(C.certificateEvent(f.s,cert).signatory.image,SIG);
});
test('no-show migration archives once; preserves arrivals, newly added records and restored records',()=>{
 const f=fixture();const missing=f.b;
 const present=C.createBooking(f.s,f.c,null,{...f.p,firstName:'Present',email:'present@example.com',hpcna:'PHS456'},{});
 f.c.now=at('2026-10-23','17:40');C.recordArrival(f.s,f.c,f.a,present.id,'search');
 f.c.now=at('2026-10-26','09:00');
 const late=C.createBooking(f.s,f.c,f.a,{...f.p,firstName:'Late',email:'late@example.com',hpcna:'PHS789'},{channel:'staff',reason:'Missing entry from signed register'});
 assert.throws(()=>C.applyPostEventUpdate(f.s,f.c,f.pa),e=>e.code==='perm');
 assert.equal(C.applyPostEventUpdate(f.s,f.c,f.a).archived,1);assert.ok(missing.archived);assert.ok(!present.archived);assert.ok(!late.archived);
 C.restoreArchived(f.s,f.c,f.a,missing.id);assert.ok(!missing.archived);C.applyPostEventUpdate(f.s,f.c,f.a);assert.ok(!missing.archived);
 assert.throws(()=>C.prepareMessage(f.s,f.c,null,(present.archived={at:f.c.now},present.id),'feedback'),e=>e.code==='archived');
});
test('existing eligible attendance issues once on first admin update and legacy certificates keep identity',()=>{
 const f=fixture();attend(f);f.c.now=at('2026-10-26','10:00');assert.equal(C.applyPostEventUpdate(f.s,f.c,f.a).issued,1);
 const cert=C.currentCert(f.s,f.b), token=cert.token;delete cert.layoutId;C.applyPostEventUpdate(f.s,f.c,f.a);
 assert.equal(C.currentCert(f.s,f.b).token,token);assert.equal(f.s.certificates.length,1);assert.ok(cert.layoutId);
});
test('WhatsApp unavailable prepares messages honestly; connected transport upgrades prepared queue',()=>{
 const f=fixture();attend(f);C.synchronizeCertificates(f.s,f.c);let m=f.s.messages.find(m=>m.type==='certificate');assert.equal(m.status,'prepared');
 f.s.integration={whatsapp:true};f.c.now=at('2026-10-26','10:00');C.applyPostEventUpdate(f.s,f.c,f.a);
 m=f.s.messages.find(m=>m.type==='certificate');assert.equal(m.status,'queued');assert.deepEqual(C.claimWhatsApps(f.s,f.c),[m.id]);
 C.markWhatsAppResult(f.s,f.c,m.id,{ok:true,id:'wamid.test'});assert.equal(m.status,'accepted');assert.equal(m.providerId,'wamid.test');
 assert.deepEqual(C.claimWhatsApps(f.s,f.c),[]);
});
test('bulk WhatsApp does not duplicate queued or accepted messages; explicit resend creates one copy',()=>{
 const f=fixture();f.s.integration={whatsapp:true};attend(f);C.synchronizeCertificates(f.s,f.c);C.sendAllCertificates(f.s,f.c,f.a,false);C.sendAllCertificates(f.s,f.c,f.a,true);
 assert.equal(f.s.messages.filter(m=>m.type==='certificate').length,1);
 const [id]=C.claimWhatsApps(f.s,f.c);C.markWhatsAppResult(f.s,f.c,id,{ok:true,id:'wamid.1'});
 C.sendAllCertificates(f.s,f.c,f.a,false);assert.equal(f.s.messages.filter(m=>m.type==='certificate').length,1);
 C.sendAllCertificates(f.s,f.c,f.a,true);assert.equal(f.s.messages.filter(m=>m.type==='certificate').length,2);
});
test('uncertain WhatsApp sending never silently retries; staff must review retry',()=>{
 const f=fixture();f.s.integration={whatsapp:true};attend(f);C.synchronizeCertificates(f.s,f.c);const [id]=C.claimWhatsApps(f.s,f.c);
 f.c.now+=3*C.MIN;C.claimWhatsApps(f.s,f.c);const m=f.s.messages.find(m=>m.id===id);assert.equal(m.status,'unknown');
 assert.deepEqual(C.claimWhatsApps(f.s,f.c),[]);C.sendAllCertificates(f.s,f.c,f.a,false);assert.equal(f.s.messages.filter(m=>m.type==='certificate').length,1);
 C.retryWhatsApp(f.s,f.c,f.a,id);assert.equal(m.status,'queued');assert.deepEqual(C.claimWhatsApps(f.s,f.c),[id]);
});
test('failed messages wait for explicit retry; archived or superseded certificates are not sent',()=>{
 const f=fixture();f.s.integration={whatsapp:true};attend(f);C.synchronizeCertificates(f.s,f.c);const [id]=C.claimWhatsApps(f.s,f.c);C.markWhatsAppResult(f.s,f.c,id,{ok:false,error:'Bad template'});
 C.sendAllCertificates(f.s,f.c,f.a,false);assert.equal(f.s.messages.filter(m=>m.type==='certificate').length,1);
 C.retryWhatsApp(f.s,f.c,f.a,id);f.b.archived={at:f.c.now};assert.deepEqual(C.claimWhatsApps(f.s,f.c),[]);assert.equal(f.s.messages.find(m=>m.id===id).status,'cancelled');
});
test('email queues on issuance; delivery contacts can be corrected without changing certificate identity',()=>{
 const f=fixture();f.s.integration={email:true};attend(f);C.synchronizeCertificates(f.s,f.c);
 const cert=C.currentCert(f.s,f.b);assert.equal(f.s.messages.filter(m=>m.type==='certificate'&&m.channel==='email'&&m.status==='queued').length,1);
 C.updateContact(f.s,f.c,f.a,f.b.id,{phone:'0814285408',email:'new@example.com'});assert.equal(f.b.phoneIntl,'264814285408');assert.equal(C.currentCert(f.s,f.b).token,cert.token);
});
module.exports={fixture,attend,SIG};
