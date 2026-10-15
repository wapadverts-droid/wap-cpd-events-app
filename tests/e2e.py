"""End-to-end browser test of the built page (desktop + phone).

Needs: Python Playwright with Chromium, and the three browser libraries installed
locally with npm, because the test does not use the internet:
    npm install --prefix <dir> jspdf@2.5.1 qrcode-generator@1.4.4 jsqr@1.4.0
Run:
    python3 build.py
    WAPCPD_LIB=<dir>/node_modules python3 tests/e2e.py
Screenshots and downloaded files go to tests/output/ (ignored by git).
"""
import base64, os, pathlib, re, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
LIB = pathlib.Path(os.environ.get('WAPCPD_LIB', ROOT / 'node_modules'))
SHOTS = ROOT / 'tests' / 'output'; SHOTS.mkdir(exist_ok=True)
PAGE = (ROOT / 'index.html').read_text()
CDN = {
    'jspdf.umd.min.js': LIB / 'jspdf/dist/jspdf.umd.min.js',
    'qrcode.js': LIB / 'qrcode-generator/qrcode.js',
    'jsQR.js': LIB / 'jsqr/dist/jsQR.js',
}
errors, results = [], []

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(detail) if detail and not cond else ''))

def route(r):
    url = r.request.url
    if url.startswith('http://app.test/'):
        return r.fulfill(body=PAGE, content_type='text/html')
    for k, f in CDN.items():
        if url.endswith(k):
            return r.fulfill(body=f.read_bytes(), content_type='application/javascript')
    return r.abort()

def new_page(browser, w, h):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, accept_downloads=True)
    ctx.route('**/*', route)
    pg = ctx.new_page()
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    return ctx, pg

def no_hscroll(pg):
    return pg.evaluate('document.scrollingElement.scrollWidth <= window.innerWidth + 1')

def login(pg, who, pin):
    pg.goto('http://app.test/#staff'); pg.wait_for_selector('#lg-staff')
    pg.select_option('#lg-staff', label=who)
    pg.fill('#lg-pin', pin); pg.click('form[data-form=login] button[type=submit]')
    pg.wait_for_selector('.sidenav')

def demo(pg, sc):
    pg.click('[data-act=demo-panel]'); pg.click(f'[data-act=scenario][data-sc={sc}]'); pg.wait_for_timeout(200)

def fill_rsvp(pg, i, **kw):
    pg.fill('#a-firstName', kw.get('first', f'Ehtest{i}')); pg.fill('#a-lastName', kw.get('last', f'Demo-Browser{i}'))
    pg.select_option('#a-profession', 'Pharmacist'); pg.fill('#a-hpcna', f'DEMO-PS-9{i:03d}')
    pg.fill('#a-phone', f'081 777 {1000+i}'); pg.fill('#a-email', f'eh{i}@example.com')
    pg.evaluate("document.getElementById('a-consentEvent').checked || document.getElementById('a-consentEvent').click()")
    pg.click('form[data-form=rsvp] button[type=submit]')

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx, pg = new_page(browser, 1280, 900)
    pg.goto('http://app.test/'); pg.wait_for_selector('.hero')
    ok('loads with event-night demo; RSVPs closed at 19:40', 'Online RSVPs are closed' in pg.inner_text('.status-card'))
    ok('logo shown', pg.locator('.brand img').get_attribute('src').startswith('data:image/jpeg'))
    ok('page has its own doctype (standards mode)', pg.evaluate('document.compatMode') == 'CSS1Compat')
    pg.screenshot(path=str(SHOTS / 'd-home-closed.png'))

    # booking phase
    demo(pg, 'booking'); pg.goto('http://app.test/#home'); pg.wait_for_selector('.status-card')
    ok('booking scenario shows 2 of 50 left', re.search(r'2\s+of 50 places left', pg.inner_text('.status-card')), pg.inner_text('.status-card'))
    pg.click('text=RSVP to secure your place'); pg.wait_for_selector('form[data-form=rsvp]')
    pg.click('form[data-form=rsvp] button[type=submit]')
    pg.wait_for_selector('.form-errors')
    ok('empty RSVP shows field errors', pg.locator('.invalid').count() >= 4, pg.locator('.invalid').count())
    fill_rsvp(pg, 1); pg.wait_for_selector('.ref')
    ok('RSVP 1 confirmed with ref and QR', 'Your place is booked' in pg.inner_text('main') and pg.locator('img.qr').count() == 1)
    manage1 = pg.url
    pg.goto('http://app.test/#rsvp'); pg.wait_for_selector('#a-firstName'); fill_rsvp(pg, 2); pg.wait_for_selector('.ref')
    ok('RSVP 2 takes last place', 'Your place is booked' in pg.inner_text('main'))
    pg.goto('http://app.test/#rsvp'); pg.wait_for_selector('#a-firstName')
    ok('form now says waiting list', 'Join the waiting list' in pg.inner_text('main'))
    fill_rsvp(pg, 3); pg.wait_for_selector('.ref')
    ok('RSVP 3 goes to waiting list position 1', 'waiting list' in pg.inner_text('main').lower() and 'position 1' in pg.inner_text('main'))
    wl_url = pg.url
    # duplicate
    pg.goto('http://app.test/#rsvp'); pg.wait_for_selector('#a-firstName'); fill_rsvp(pg, 1, first='Ehtest1', last='Demo-Browser1'); pg.wait_for_selector('.ref')

    # PA permissions
    login(pg, 'Demo Reception (PA) — PA / Reception', '2222')
    ok('PA has no Settings link', 'Settings' not in pg.inner_text('.sidenav'))
    forged = pg.evaluate("""async () => { const w = window.__wapcpd; const r = await w.run((st,c) => CPD.updateApproval(st, c, {session: w.A.session}, {activityNumber:'X',ceus:'1',level:'1'}), null, {render:false}); return r.ok ? 'allowed' : r.error.code; }""")
    ok('PA approval change refused by rules (not just hidden)', forged == 'perm', forged)
    forged2 = pg.evaluate("""async () => { const w = window.__wapcpd; const r = await w.run((st,c) => CPD.createBooking(st, c, {session: w.A.session}, {firstName:'A',lastName:'B',profession:'Pharmacist',hpcna:'X1',phone:'0812223333',channel:'whatsapp',consentEvent:true}, {channel:'staff', pool:'contingency', reason:'trying'}), null, {render:false}); return r.ok ? 'allowed' : r.error.code; }""")
    ok('PA contingency allocation refused by rules', forged2 == 'perm', forged2)
    pg.goto('http://app.test/#s-people'); pg.wait_for_selector('#pp-q')
    pg.click('[data-act=chip][data-group=flag][data-val=duplicate]')
    ok('duplicate flagged in list', pg.locator('#people-results .pill', has_text='Possible duplicate').count() >= 1)
    pg.goto('http://app.test/#s-register'); pg.wait_for_selector('form[data-form=reg]')
    ok('PA register form has no contingency option', pg.locator('#r-pool').count() == 0)
    pg.click('[data-act=logout]')

    # waiting list offer by admin after cancellation
    login(pg, 'Demo Administrator — Administrator', '1111')
    pg.goto(manage1); pg.wait_for_selector('[data-act=pub-cancel]'); pg.click('[data-act=pub-cancel]')
    pg.wait_for_selector('.modal'); pg.click('.modal button[type=submit]'); pg.wait_for_timeout(300)
    ok('attendee cancelled own booking', 'Cancelled' in pg.inner_text('main'))
    pg.goto('http://app.test/#s-waitlist'); pg.wait_for_selector('[data-act=offer]')
    pg.click('button[data-act=offer]'); pg.wait_for_timeout(300)
    txt = pg.inner_text('main')
    ok('offer made with 24h expiry', 'Pending offers' in txt and 'expires' in txt and '13 Oct' in txt, txt[:400])
    pg.goto(wl_url); pg.wait_for_selector('[data-act=pub-accept]'); pg.click('[data-act=pub-accept]'); pg.wait_for_timeout(300)
    ok('attendee accepted offer', 'Your place is confirmed' in pg.inner_text('main'))

    # event night: full workflow
    demo(pg, 'event'); login(pg, 'Demo Administrator — Administrator', '1111')
    dash = pg.inner_text('main')
    ok('dashboard shows attention items', 'early departure' in dash and 'HPCNA approval details not entered' in dash, dash[:300])
    pg.screenshot(path=str(SHOTS / 'd-dash.png'), full_page=True)
    pg.goto('http://app.test/#s-certs'); pg.wait_for_selector('text=HPCNA approval details')
    ok('certs blocked before approval', '0 ready' in pg.inner_text('.page-head'))
    pg.locator('[data-act=cert-preview]').first.click(); pg.wait_for_selector('.cert-sheet')
    ok('preview watermarked SAMPLE', 'SAMPLE — NOT VALID FOR CPD' in pg.inner_text('.cert-sheet'))
    with pg.expect_download() as dl:
        pg.click('[data-act=cert-preview-pdf]')
    path = SHOTS / 'preview.pdf'; dl.value.save_as(str(path))
    ok('preview PDF downloads', path.stat().st_size > 5000)
    pg.click('[data-act=close-modal]')
    pg.click('[data-act=demo-approval]'); pg.wait_for_timeout(300)
    head = pg.inner_text('.page-head')
    m = re.search(r'(\d+) ready', head); ready = int(m.group(1)) if m else 0
    ok('fictional approval makes eligible attendees ready', ready > 10, head)
    pg.click('[data-act=release-all]'); pg.click('.modal button[type=submit]'); pg.wait_for_timeout(500)
    head = pg.inner_text('.page-head')
    ok('release all ready', re.search(rf'{ready} released', head), head)
    blocked_left = int(re.search(r'(\d+) blocked', head).group(1))
    ok('others remain blocked with reasons', blocked_left > 0 and 'NO FEEDBACK' in pg.inner_text('main'))
    with pg.expect_download() as dl:
        pg.locator('[data-act=cert-pdf]').first.click()
    path = SHOTS / 'cert.pdf'; dl.value.save_as(str(path))
    ok('issued certificate PDF downloads', path.stat().st_size > 5000)

    # check-in: completion for someone arrived but not completed
    pg.goto('http://app.test/#s-checkin'); pg.wait_for_selector('#ci-q')
    pg.click('[data-act=ci-mode][data-val=completion]'); pg.wait_for_timeout(100)
    pg.locator('#ci-results [data-act=complete][data-method=register]').first.click(); pg.wait_for_timeout(300)
    ok('completion via signed register', 'completion confirmed' in pg.inner_text('main').lower())
    st = pg.evaluate("() => { const s = window.__wapcpd.A.state; const b = s.bookings.find(x => x.status==='confirmed' && x.arrival && !x.completion); return b ? {p: CPD.qrPayload(b), name: b.firstName+' '+b.lastName} : null; }")
    if st:
        gif = pg.evaluate("p => { const q = qrcode(0,'M'); q.addData(p); q.make(); return q.createDataURL(8, 4); }", st['p'])
        qrp = SHOTS / 'qr.gif'; qrp.write_bytes(base64.b64decode(gif.split(',')[1]))
        pg.set_input_files('#qrfile', str(qrp)); pg.wait_for_timeout(800)
        ok('QR photo check-out recognised', 'QR check-out' in pg.inner_text('main') and st['name'].split()[0] in pg.inner_text('main'), pg.inner_text('main')[:300])
    pg.click('[data-act=ci-mode][data-val=arrival]'); pg.wait_for_timeout(100)
    if pg.locator('#ci-results [data-act=arrive]').count():
        pg.locator('#ci-results [data-act=arrive]').first.click(); pg.wait_for_timeout(300)
        ok('arrival recorded at desk', 'checked in at' in pg.inner_text('main'))

    # release unused and confirm late walk-in
    pg.goto('http://app.test/#s-waitlist'); pg.wait_for_selector('[data-act=release-unused]')
    pg.click('[data-act=release-unused]'); pg.wait_for_selector('form[data-form=release]'); pg.click('form[data-form=release] button[type=submit]'); pg.wait_for_timeout(300)
    ok('unused bookings released after 18:05', 'Released (' in pg.inner_text('main'))
    wl0 = pg.evaluate("window.__wapcpd.A.state.bookings.filter(b=>b.status==='waitlisted').length")
    pg.locator('[data-act=confirm-late]').first.click(); pg.wait_for_selector('.modal'); pg.click('.modal button[type=submit]'); pg.wait_for_timeout(300)
    wl1 = pg.evaluate("window.__wapcpd.A.state.bookings.filter(b=>b.status==='waitlisted').length")
    ok('late walk-in confirmed directly from waiting list', wl1 == wl0 - 1, (wl0, wl1))
    ok('capacity never exceeded', pg.evaluate("(()=>{const c=CPD.capacity(window.__wapcpd.A.state);return c.publicUsed<=c.publicCap&&c.total<=c.maxCap})()"))

    # early departure review
    pg.goto('http://app.test/#s-people'); pg.click('[data-act=chip][data-group=flag][data-val=early]'); pg.wait_for_timeout(100)
    pg.locator('#people-results tr.click').first.click(); pg.wait_for_selector('[data-act=early-review]')
    pg.click('[data-act=early-review]'); pg.fill('#ask-note', 'Missed most of the presentation'); pg.select_option('#ask-decision', 'reject'); pg.click('.modal button[type=submit]'); pg.wait_for_timeout(300)
    ok('early departure reviewed by admin', 'Attendance was not accepted' in pg.inner_text('main'))

    # messages: cannot mark sent
    pg.locator('[data-act=msg-open]').first.click(); pg.wait_for_selector('.modal')
    pg.click('.modal [data-act=msg-status][data-status=sent]'); pg.wait_for_timeout(300)
    ok('marking "sent" is refused without live integration', 'not connected' in pg.inner_text('.modal'))
    pg.click('.modal [data-act=close-modal]')

    # online feedback by attendee
    tok = pg.evaluate("() => { const b = window.__wapcpd.A.state.bookings.find(x => x.status==='confirmed' && CPD.completed(x) && !x.feedback); return b && b.token; }")
    pg.goto(f'http://app.test/#f-{tok}'); pg.wait_for_selector('form[data-form=fb]')
    pg.click('form[data-form=fb] button[type=submit]'); pg.wait_for_selector('.form-errors')
    ok('feedback requires answers', pg.locator('.invalid').count() >= 7)
    tap = lambda i: pg.evaluate('id => document.getElementById(id).click()', i)
    for k in ['relevance', 'quality', 'usefulness', 'overall']: tap(f'fb-{k}-5')
    tap('fb-understanding-Yes'); tap('fb-apply-Partly'); tap('fb-bias-Yes')
    pg.fill('#fb-improve', 'More case studies please.')
    pg.click('form[data-form=fb] button[type=submit]'); pg.wait_for_timeout(300)
    ok('feedback submitted', 'has been received' in pg.inner_text('main'))

    # exports and paper forms
    pg.goto('http://app.test/#s-data'); pg.wait_for_selector('[data-act=export]')
    with pg.expect_download() as dl:
        pg.click('[data-act=export][data-kind=attendees]')
    path = SHOTS / 'attendees.csv'; dl.value.save_as(str(path))
    ok('attendee CSV export', path.read_text(encoding='utf-8-sig').count('\n') > 50)
    ok('audit history shows staff actions', 'Certificate released' in pg.inner_text('#audit-results'))
    pg.goto('http://app.test/#s-paper'); pg.wait_for_selector('[data-act=pdf-register]')
    for act, sel, name in [('register', '[data-act=pdf-register][data-kind=blank]', 'register.pdf'), ('survey', '[data-act=pdf-survey]', 'survey.pdf'),
                           ('registration form', '[data-act=pdf-regform]', 'regform.pdf'), ('check-in list', '[data-act=pdf-checkin]', 'checkin.pdf')]:
        with pg.expect_download() as dl:
            pg.click(sel)
        path = SHOTS / name; dl.value.save_as(str(path)); ok(f'{act} PDF', path.stat().st_size > 3000)

    # persistence after reload
    count = pg.evaluate('window.__wapcpd.A.state.certificates.length')
    pg.reload(); pg.wait_for_selector('#app main')
    ok('data persists after reload', pg.evaluate('window.__wapcpd.A.state.certificates.length') == count and count > 0)

    # live mode is separate and empty
    pg.click('[data-act=demo-panel]'); pg.click('[data-act=mode][data-mode=live]'); pg.wait_for_timeout(300)
    ok('real-data mode starts empty with admin setup', 'Set up the administrator' in pg.inner_text('main'))
    ok('real-data warning shown', 'not shared with other staff devices' in pg.inner_text('.modebar'))
    pg.click('[data-act=demo-panel]'); pg.click('[data-act=mode][data-mode=demo]'); pg.wait_for_timeout(300)
    ok('demo data still there after switching back', pg.evaluate('window.__wapcpd.A.state.certificates.length') == count)
    ctx.close()

    # phone
    ctx, pg = new_page(browser, 390, 844)
    pg.goto('http://app.test/'); pg.wait_for_selector('.hero')
    demo(pg, 'booking'); pg.goto('http://app.test/#home'); pg.wait_for_selector('.status-card')
    ok('phone: home no horizontal scroll', no_hscroll(pg))
    pg.screenshot(path=str(SHOTS / 'm-home.png'), full_page=True)
    pg.goto('http://app.test/#rsvp'); pg.wait_for_selector('#a-firstName')
    ok('phone: RSVP no horizontal scroll', no_hscroll(pg))
    h = pg.evaluate("Math.min(...[...document.querySelectorAll('main .btn, main input[type=text], main select')].map(e => e.getBoundingClientRect().height))")
    ok('phone: touch targets at least 44px', h >= 44, h)
    demo(pg, 'event'); login(pg, 'Demo Reception (PA) — PA / Reception', '2222')
    for v in ['s-dash', 's-people', 's-checkin', 's-waitlist', 's-certs', 's-feedback', 's-messages', 's-paper', 's-data']:
        pg.goto('http://app.test/#' + v); pg.wait_for_timeout(150)
        ok(f'phone: {v} no horizontal scroll', no_hscroll(pg))
    pg.goto('http://app.test/#s-dash'); pg.wait_for_timeout(100); pg.screenshot(path=str(SHOTS / 'm-dash.png'), full_page=True)
    ctx.close()
    browser.close()

errs = [e for e in errors if 'net::ERR_FAILED' not in e and 'Failed to load resource' not in e]
ok('no console errors', not errs, errs[:5])
print(f"\n{sum(1 for r in results if r[1])}/{len(results)} passed")
sys.exit(0 if all(r[1] for r in results) else 1)
