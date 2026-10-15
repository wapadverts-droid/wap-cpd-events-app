# WAP CPD Events App

A mobile-friendly web app for WAP Medical Supplies (CPD provider ORG01637) that manages CPD attendees from advance RSVP through arrival, session completion, mandatory feedback and certificate release.

First event: **Clinical Update on Rhinosinusitis**, Friday 23 October 2026, Epikaizo Guest House, Outapi. Event details are configurable in the staff Settings page for future events.

## Status: prototype — not ready for real registrations

**Data is saved only in the browser of whoever is using the page.** A registration made on an attendee's phone stays on that phone; the staff dashboard will not see it, and the 50-place limit is not shared between devices. Booking links, QR check-in and certificate links only work in the browser that holds the data.

Use the public page for demonstrations and staff training only. Before taking real RSVPs it needs:

1. A shared online database with server-side capacity checks (planned: Supabase).
2. Real staff accounts. The PIN sign-in only separates roles inside one browser; it is not secure authentication.
3. A check of current HPCNA requirements for certificate content and register submission.

Other limits: messages are prepared for staff to send by hand (no live WhatsApp or email sending); no offline mode; QR scanning reads a photo rather than a live camera feed.

## Demo

Open the page and use **Demo controls** to load a scenario (booking phase or event night) and set the simulated time. Demo staff PINs: Administrator `1111`, PA/Reception `2222`. All demo attendees are fictional and marked `Demo-`.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The built app, served by GitHub Pages. Do not edit by hand — run `build.py`. |
| `src/core.js` | Rules engine: capacity, deadlines, waiting list, permissions, certificate eligibility. |
| `src/seed.js` | Fictional demo scenarios, built by running the real rules. |
| `src/store.js` | Browser storage with all-or-nothing saves. |
| `src/pdf.js` | Certificate, attendance register, evaluation survey, registration form, check-in list. |
| `src/app.js`, `src/styles.css`, `src/template.html` | User interface. |
| `assets/logo.jpg` | WAP Medical Supplies logo. |
| `tests/` | Rules tests (Node) and browser tests (Playwright). |
| `BUILD-NOTES.md` | Decisions taken and known limits. |

## Build and test

```
python3 build.py                  # writes index.html
node --test tests/core.test.js    # 21 rules tests
```

Browser tests: see the header of `tests/e2e.py`.

## Publishing

GitHub Pages: repository **Settings → Pages → Deploy from a branch → `main` / `(root)`**. The site updates a minute or two after each push.
