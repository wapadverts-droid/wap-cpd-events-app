# Build notes

## Version history
- **v1 (5 Oct 2026)** — Prototype built and tested in claude.ai.
- **15 Oct 2026** — Moved to GitHub (`wapadverts-droid/wap-cpd-events-app`) for public hosting with GitHub Pages. App code is unchanged from v1. The page template now includes its own document header (doctype, character set, viewport) so it renders correctly outside claude.ai. File downloads use the browser's normal download when not inside claude.ai.

- **15 Oct 2026 (b)** — Landing page: "About this session" paragraph replaces the learning-objectives list (editable in Settings).
- **15 Oct 2026 (c)** — First-time visitors get a "fresh start": real date and time, no bookings, RSVPs open until 23 Oct 12:00; demo staff PINs still work. Demo controls has a "Fresh start" button for browsers holding older demo data. The RSVP box now sits above the event details on all screen sizes. Banner warns that bookings stay on the device.
- **16 Oct 2026** — Shared test database (Supabase project `wap-cpd-test`, region EU). The rules engine now also runs on the server (Edge Function `cpd`) against one shared copy of the data, locked per change, so simultaneous bookings cannot overbook. Staff sign in with email and password (Supabase Auth); roles come from the staff list (WAP Administrator, Sarah RC-Empire as PA). Attendees receive only their own booking. PA does not receive audit history or feedback answers. Hourly snapshots kept in `app_state_history`. The website defaults to the shared database; practice mode (fictional data, simulated clock, this device only) stays available. Server deployed automatically from GitHub when `SUPABASE_ACCESS_TOKEN` is saved as a repository secret.

- **16 Oct 2026 (b)** — Check-in by name is the main method: booking page says "Your place is confirmed. Give your name at the registration desk from 17:30." with a smaller, optional QR code. Check-in page leads with name/phone search (QR scan is a small optional button). Completion leads with the signed register; QR check-out stays available as a secondary option. Confirmation message wording matches.
- **16 Oct 2026 (c)** — Presenter photo: small square photo (64 px) beside the presenter's name in Event details on the landing page, below the RSVP box. Supplied photo cropped from the image provided by the organiser (assets/presenter.jpg). Administrator can replace it, restore it or hide it in Settings.
- **16 Oct 2026 (d)** — Contact details: the organiser's name and number are no longer shown. Attendees see two contacts everywhere (event page, booking page, footer, closed/invalid-link messages, prepared messages): +264 81 220 9167 · Executive@rcempiremedical.com, or +264 81 695 1252 · marketing@wappharm.com. Editable in Settings as two contact lines. Older saved data without contacts shows these defaults.
- **16 Oct 2026 (e) — LIVE.** Server serves a fresh live record (`app_state` id `live`, mode live: no test banner, no demo watermark); test bookings archived in record `main`. Same project, website address and staff logins. Hidden spam-trap field on the public RSVP form (filled-in submissions refused by the server; staff registrations unaffected). Staff can open practice mode from Settings. Deploy check now confirms the server answers with live data. WAP accepted EU data storage; PA testing by Sarah waived by the administrator.

## Decisions taken
- Pending offers hold places. Offers go in queue order; the administrator may skip the queue with a recorded reason. Offers last 24 h, 2 h on the event day, and are capped at event start (18:00). Windows under 30 minutes are refused and handled at the desk as late cases.
- New applicants join the waiting list whenever anyone is already waiting, even if a place is free (first come, first served).
- Releasing unused bookings: administrator only, from presentation start (18:05) to event end. Released bookings can be reinstated while a place is free.
- Completion: only from the end of Q&A (19:30) and only after a recorded arrival. Methods: signed register or QR check-out, recorded by staff. Earlier departures create an early-departure exception for the administrator to approve or reject.
- After the event, paper entries require the time from the paper record.
- Feedback answers are stored anonymously (no booking ID, day only, random position). Bookings record only that feedback was received and how.
- Certificate release needs: confirmed completion, feedback, details checked (duplicate and HPCNA-number reviews resolved), no open exceptions, approval number/CEUs/level entered, and administrator release. Previews show "SAMPLE — NOT VALID FOR CPD" until approval details exist and "PREVIEW — NOT ISSUED" before release. Demo data is always watermarked "FICTIONAL DEMO — NOT VALID". Corrections reissue a new version with the same number; the old link shows "replaced".
- Approval details are locked once certificates are issued.
- Messages: prepared or manually shared only. "Sent" and "Delivery confirmed" are refused until a live integration exists.
- Demo and real data use separate storage keys. Real-data mode uses the real clock and starts with administrator setup.

## Shared-database design (16 Oct 2026)
- One row (`app_state`, id `main`) holds the event data as JSON; every change runs in a transaction with `SELECT … FOR UPDATE`, then saves. Suits one event of ~60 attendees; revisit for much larger events.
- The website tries each change locally first (instant form errors), then sends the list of rules-engine calls to the server, which runs them again on the real data. The server's result is what counts. The browser's "actor" is always replaced by the signed-in staff member.
- Public visitors may only run: createBooking (public channel), and updateDetails / cancelBooking / respondToOffer / submitFeedback with their private token.
- Tables have row-level security on and no access for the public website key; only the server program (database owner connection) reads or writes them.
- Free Supabase projects pause after about a week without activity.
- Spam protection is a hidden form field only; there is no rate limit or CAPTCHA.

## Known limits before live use
- Practice mode data lives on one device only (by design).
- No live WhatsApp or email sending; no offline mode.
- QR scanning reads a photo (camera capture via file input), not a live camera feed.
- HPCNA requirements (certificate content, register submission within one month per Form 3) have not been checked against current official guidance.
- The public page is visible to anyone with the link. It holds no attendee data (that stays in each visitor's browser), and asks search engines not to index it.

## Tests (16 Oct 2026, go-live build)
- 22 Node rules tests pass, including 70 simultaneous registrations for 50 places with no overbooking.
- 10 server tests against a local Postgres (incl. live record separation and spam trap): tables and staff created on first use, public view has no personal data, attendees see only their own booking, staff-only actions refused for the public and for forged staff claims, PA vs administrator permissions, all-or-nothing saves, server-side deadline and offer expiry, 70 simultaneous bookings for 50 places (exactly 50 booked, 20 waiting, none lost), anonymous feedback, hourly snapshot.
- 32 browser checks on the shared database (live configuration) (local stand-in): RSVP on one device seen on another, private links across devices, staff email sign-in, wrong password, PA registration seen by others, PA restrictions, admin audit and staff management, non-staff account, attendee cancellation, practice mode separation, phone layouts.
- Server program also started under Deno (the Supabase runtime) against local Postgres.
- 64 practice-mode browser checks on desktop and phone sizes: RSVP, waiting list and offers, PA permission refusals, duplicates, check-in, completion, QR photo check-out, early-departure review, certificate blocking and release, PDF and CSV downloads, persistence after reload, separate real-data mode, no horizontal scrolling on phone.
