# Build notes

## Version history
- **v1 (5 Oct 2026)** — Prototype built and tested in claude.ai.
- **15 Oct 2026** — Moved to GitHub (`wapadverts-droid/wap-cpd-events-app`) for public hosting with GitHub Pages. App code is unchanged from v1. The page template now includes its own document header (doctype, character set, viewport) so it renders correctly outside claude.ai. File downloads use the browser's normal download when not inside claude.ai.

- **15 Oct 2026 (b)** — Landing page: "About this session" paragraph replaces the learning-objectives list (editable in Settings).
- **15 Oct 2026 (c)** — First-time visitors get a "fresh start": real date and time, no bookings, RSVPs open until 23 Oct 12:00; demo staff PINs still work. Demo controls has a "Fresh start" button for browsers holding older demo data. The RSVP box now sits above the event details on all screen sizes. Banner warns that bookings stay on the device.

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

## Known limits before live use
- Data lives in one browser. A shared server database with server-side transactions is required for real attendees and multiple staff devices.
- PIN sign-in is not real authentication.
- No live WhatsApp or email sending; no offline mode.
- QR scanning reads a photo (camera capture via file input), not a live camera feed.
- HPCNA requirements (certificate content, register submission within one month per Form 3) have not been checked against current official guidance.
- The public page is visible to anyone with the link. It holds no attendee data (that stays in each visitor's browser), and asks search engines not to index it.

## Tests (15 Oct 2026, on the GitHub build)
- 21 Node rules tests pass, including 70 simultaneous registrations for 50 places with no overbooking.
- 65 Playwright browser checks pass (updated 15 Oct (c)) on desktop and phone sizes: RSVP, waiting list and offers, PA permission refusals, duplicates, check-in, completion, QR photo check-out, early-departure review, certificate blocking and release, PDF and CSV downloads, persistence after reload, separate real-data mode, no horizontal scrolling on phone.
