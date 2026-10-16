"""Browser test of the shared-database version (desktop + phone).

Starts tests/devserver.mjs (real server program on a local Postgres, fake sign-in)
and sends the page's Supabase requests to it.
    PGURL=postgres://postgres@localhost:54329/postgres WAPCPD_LIB=<dir>/node_modules python3 tests/e2e_remote.py
"""
import json, os, pathlib, re, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
LIB = pathlib.Path(os.environ.get('WAPCPD_LIB', ROOT / 'node_modules'))
SHOTS = ROOT / 'tests' / 'output'; SHOTS.mkdir(exist_ok=True)
PAGE = (ROOT / 'index.html').read_text()
SUPA = 'https://ezsqpmlmtrmovnikmxrs.supabase.co'
PORT = 54400
CDN = {'jspdf.umd.min.js': LIB / 'jspdf/dist/jspdf.umd.min.js', 'qrcode.js': LIB / 'qrcode-generator/qrcode.js', 'jsQR.js': LIB / 'jsqr/dist/jsQR.js'}
errors, results = [], []

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(detail) if detail and not cond else ''))

def route(r):
    url = r.request.url
    if url.startswith('http://app.test/'):
        return r.fulfill(body=PAGE, content_type='text/html')
    if url.startswith(SUPA):
        resp = r.fetch(url=url.replace(SUPA, f'http://127.0.0.1:{PORT}'))
        return r.fulfill(response=resp)
    for k, f in CDN.items():
        if url.endswith(k):
            return r.fulfill(body=f.read_bytes(), content_type='application/javascript')
    return r.abort()

def new_page(browser, w=1280, h=900):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, accept_downloads=True)
    ctx.route('**/*', route)
    pg = ctx.new_page()
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    return ctx, pg

def no_hscroll(pg):
    return pg.evaluate('document.scrollingElement.scrollWidth <= window.innerWidth + 1')

def sign_in(pg, email, pw):
    pg.goto('http://app.test/#staff'); pg.wait_for_selector('#lg-email')
    pg.fill('#lg-email', email); pg.fill('#lg-pw', pw); pg.click('form[data-form=login] button[type=submit]')

def fill_rsvp(pg, i):
    pg.fill('#a-firstName', f'Tester{i}'); pg.fill('#a-lastName', f'Shared{i}')
    pg.select_option('#a-profession', 'Pharmacist'); pg.fill('#a-hpcna', f'TEST-PS-{i:04d}')
    pg.fill('#a-phone', f'081 666 {1000+i}'); pg.fill('#a-email', f'tester{i}@example.com')
    pg.evaluate("document.getElementById('a-consentEvent').checked || document.getElementById('a-consentEvent').click()")
    pg.click('form[data-form=rsvp] button[type=submit]')

srv = subprocess.Popen(['node', str(ROOT / 'tests' / 'devserver.mjs'), str(PORT)], env=os.environ.copy(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
try:
    assert 'ready' in srv.stdout.readline()
    urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{PORT}/__reset', method='POST')).read()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        # device 1: attendee RSVPs
        c1, a = new_page(browser)
        a.goto('http://app.test/'); a.wait_for_selector('.status-card')
        ok('shared database is the default; RSVPs open with 50 of 50', re.search(r'50\s+of 50 places left', a.inner_text('.status-card')), a.inner_text('.status-card'))
        ok('live: no test banner or labels', 'TEST DATABASE' not in a.inner_text('.topbar') and a.locator('.modebar').count() == 0)
        a.screenshot(path=str(SHOTS / 'r-home.png'))
        a.click('text=RSVP to secure your place'); a.wait_for_selector('form[data-form=rsvp]')
        ok('spam trap field exists but is hidden from people', a.evaluate("(()=>{const r=document.querySelector('#a-website'); return !!r && r.getBoundingClientRect().right <= 0})()"))
        a.click('form[data-form=rsvp] button[type=submit]'); a.wait_for_selector('.form-errors')
        ok('empty RSVP shows field errors instantly', a.locator('.invalid').count() >= 4)
        a.fill('#a-firstName', 'No'); a.fill('#a-lastName', 'Email'); a.select_option('#a-profession', 'Pharmacist'); a.fill('#a-hpcna', 'X-1'); a.fill('#a-phone', '081 666 0999'); a.fill('#a-email', '')
        a.evaluate("document.getElementById('a-consentEvent').checked || document.getElementById('a-consentEvent').click()")
        a.click('form[data-form=rsvp] button[type=submit]'); a.wait_for_timeout(300)
        ok('email is required online', 'Your booking confirmation is emailed' in a.inner_text('form[data-form=rsvp]') and a.locator('.invalid #a-email').count() == 1)
        fill_rsvp(a, 1); a.wait_for_selector('.ref', timeout=15000)
        ok('booking page says the confirmation email is on its way', 'confirmation email' in a.inner_text('.alert.ok') and 'tester1@example.com' in a.inner_text('.alert.ok'))
        box = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/__outbox').read())
        ok('confirmation email sent with the private link', len(box) == 1 and box[0]['to'] == 'tester1@example.com' and '#m-' in box[0]['body'] and 'Booking confirmed' in box[0]['subject'], box)
        ok('RSVP saved to shared database, booking page with ref and QR', 'Your place is confirmed' in a.inner_text('main') and a.locator('img.qr').count() == 1)
        manage = a.url; ref = a.inner_text('.ref')
        a.screenshot(path=str(SHOTS / 'r-booked.png'), full_page=True)

        # device 2: another person sees the place taken and the private link works there too
        c2, b = new_page(browser)
        b.goto('http://app.test/'); b.wait_for_selector('.status-card')
        ok('second device sees 49 of 50', re.search(r'49\s+of 50 places left', b.inner_text('.status-card')), b.inner_text('.status-card'))
        b.goto(manage); b.wait_for_selector('.ref', timeout=15000)
        ok('private booking link works on another device', b.inner_text('.ref') == ref)
        ok('attendee page shows only this booking', b.evaluate('window.__wapcpd.A.state.bookings.length') == 1 and b.evaluate('window.__wapcpd.A.state.staff.length') == 0)
        b.goto('http://app.test/#rsvp'); b.wait_for_selector('#a-firstName'); fill_rsvp(b, 1); b.wait_for_selector('.form-errors', timeout=15000)
        ok('second online booking with the same email is refused and the link re-sent', 'already have a booking' in b.inner_text('.form-errors') and 'emailed your booking link' in b.inner_text('.form-errors'))
        box = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/__outbox').read())
        ok('link re-sent only to the existing address', len(box) == 2 and box[1]['to'] == 'tester1@example.com')
        b.goto('http://app.test/#m-' + 'x' * 26); b.wait_for_selector('main h1')
        ok('wrong link says not valid', 'Booking not found' in b.inner_text('main'))

        # staff sign-in
        sign_in(b, 'executive@rcempiremedical.com', 'wrong'); b.wait_for_selector('.form-errors')
        ok('wrong password refused', 'Wrong email or password' in b.inner_text('.form-errors'))
        b.fill('#lg-pw', 'pa-pass'); b.click('form[data-form=login] button[type=submit]'); b.wait_for_selector('.sidenav', timeout=15000)
        ok('PA (Sarah) signs in and sees the dashboard', 'Sarah RC-Empire' in b.inner_text('.sidenav'))
        ok('PA has no Settings', 'Settings' not in b.inner_text('.sidenav'))
        b.goto('http://app.test/#s-people'); b.wait_for_selector('#pp-q')
        ok('PA sees the online booking', ref in b.inner_text('#people-results'))
        b.goto('http://app.test/#s-register'); b.wait_for_selector('form[data-form=reg]')
        b.fill('#r-firstName', 'Phoned'); b.fill('#r-lastName', 'Shared-In'); b.select_option('#r-profession', 'Registered nurse'); b.fill('#r-hpcna', 'TEST-NR-0002')
        b.fill('#r-phone', '081 666 2002'); b.evaluate("document.getElementById('r-consentEvent').click()"); b.evaluate("document.getElementById('r-noEmail').click()")
        b.click('form[data-form=reg] button[type=submit]'); b.wait_for_selector('.alert.ok', timeout=15000)
        ok('PA registers a phone booking with the "no email" tick box', 'place booked' in b.inner_text('.alert.ok'))
        b.goto('http://app.test/#s-messages'); b.wait_for_selector('main h1')
        ok('Messages shows the automatic email as Sent', 'Emails are sent automatically' in b.inner_text('main') and b.locator('.pill', has_text='Sent').count() >= 1)
        forged = b.evaluate("""async () => { const w = window.__wapcpd; const r = await w.run((st,c) => CPD.updateApproval(st, c, {session:'remote'}, {activityNumber:'X',ceus:'1',level:'1'}), null, {render:false}); return r.ok ? 'allowed' : r.error.code; }""")
        ok('PA approval change refused', forged == 'perm', forged)
        ok('PA does not receive the audit history', b.evaluate('window.__wapcpd.A.state.audit.length') == 0)

        # device 1 updates without reload after refresh
        a.goto('http://app.test/#home'); a.wait_for_selector('.status-card'); a.evaluate('window.__wapcpd.refresh()'); a.wait_for_timeout(500); a.evaluate('window.location.hash = "#rsvp"'); a.wait_for_selector('form[data-form=rsvp]')
        ok('first device now sees 48 places (the PA booking)', '48 of 50' in a.inner_text('main'), a.inner_text('main')[:300])

        # administrator
        b.click('[data-act=logout]'); b.wait_for_selector('.status-card', timeout=15000)
        ok('sign out returns to the public page', b.evaluate('window.__wapcpd.A.state.viewKind') == 'public')
        sign_in(b, 'wapadverts@gmail.com', 'admin-pass'); b.wait_for_selector('.sidenav', timeout=15000)
        ok('administrator signs in', 'WAP Administrator' in b.inner_text('.sidenav') and 'Settings' in b.inner_text('.sidenav'))
        b.goto('http://app.test/#s-data'); b.wait_for_selector('#audit-results')
        aud = b.inner_text('#audit-results')
        ok('audit shows who did what', 'Sarah RC-Empire' in aud and 'Booking created' in aud)
        b.goto('http://app.test/#s-settings'); b.wait_for_selector('form[data-form=staff]')
        b.fill('#st-name', 'Desk Helper'); b.fill('#st-email', 'helper@example.com'); b.click('form[data-form=staff] button[type=submit]'); b.wait_for_timeout(800)
        ok('administrator adds a staff member by email', 'helper@example.com' in b.inner_text('main'))
        b.goto('http://app.test/#s-certs'); b.wait_for_selector('text=HPCNA approval details')
        b.locator('[data-act=cert-preview]').first.click(); b.wait_for_selector('.cert-sheet')
        ok('certificate preview marked SAMPLE until approval; no demo watermark on live', 'SAMPLE — NOT VALID FOR CPD' in b.inner_text('.cert-sheet') and 'FICTIONAL DEMO' not in b.inner_text('.cert-sheet'))
        b.click('[data-act=close-modal]')
        b.screenshot(path=str(SHOTS / 'r-admin.png'), full_page=True)

        # someone signed in who is not on the staff list
        c3, x = new_page(browser)
        sign_in(x, 'stranger@example.com', 'x-pass'); x.wait_for_selector('main h1', timeout=15000); x.wait_for_timeout(500)
        ok('non-staff account is told it is not on the staff list', 'Not on the staff list' in x.inner_text('main'), x.inner_text('main')[:200])

        # attendee cancels from device 2's copy of the link; device 1 sees it
        a.goto(manage); a.wait_for_selector('[data-act=pub-cancel]', timeout=15000); a.click('[data-act=pub-cancel]')
        a.wait_for_selector('.modal'); a.click('.modal button[type=submit]'); a.wait_for_timeout(1000)
        ok('attendee cancels own booking', 'Cancelled' in a.inner_text('main'))

        # practice mode is separate
        b.goto('http://app.test/#s-settings'); b.wait_for_selector('form[data-form=ev]')
        b.click('[data-act=mode][data-mode=demo]'); b.wait_for_selector('.status-card'); b.wait_for_timeout(300); x = b
        ok('staff open practice mode from Settings; it is separate (fresh, on this device)', 'PRACTICE' in x.inner_text('.topbar') and re.search(r'50\s+of 50', x.inner_text('.status-card')))
        x.click('[data-act=demo-panel]'); x.click('[data-act=mode][data-mode=shared]'); x.wait_for_selector('.status-card', timeout=15000)
        ok('back to shared (live) database', 'PRACTICE' not in x.inner_text('.topbar') and re.search(r'49\s+of 50', x.inner_text('.status-card')), x.inner_text('.status-card'))

        # phone
        c4, m = new_page(browser, 390, 844)
        m.goto('http://app.test/'); m.wait_for_selector('.status-card')
        ok('phone: home no horizontal scroll', no_hscroll(m)); m.screenshot(path=str(SHOTS / 'r-phone-home.png'))
        sign_in(m, 'executive@rcempiremedical.com', 'pa-pass'); m.wait_for_selector('.sidenav', timeout=15000)
        for v in ['s-dash', 's-people', 's-checkin', 's-register']:
            m.goto('http://app.test/#' + v); m.wait_for_timeout(200)
            ok(f'phone: {v} no horizontal scroll', no_hscroll(m))
        browser.close()
finally:
    srv.terminate()

errs = [e for e in errors if 'net::ERR_FAILED' not in e and 'Failed to load resource' not in e]
ok('no console errors', not errs, errs[:5])
print(f"\n{sum(1 for r in results if r[1])}/{len(results)} passed")
sys.exit(0 if all(r[1] for r in results) else 1)
