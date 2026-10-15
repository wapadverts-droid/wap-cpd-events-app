/* PDF documents built with jsPDF, laid out to follow the supplied templates:
 * CPD_Certificate_Sample.pdf, CPD_Attendance_Register_With_Contact_Details.pdf
 * and CPD Evaluation Survey.pdf. */
(function (root) {
  'use strict';
  const CPD = root.CPD;
  const NAVY = [42, 40, 107], RED = [217, 29, 32], GREY = [90, 92, 112];

  function newDoc(orientation) {
    const { jsPDF } = root.jspdf;
    return new jsPDF({ orientation, unit: 'pt', format: 'a4' });
  }
  function centre(doc, txt, y, size, style) {
    doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size);
    doc.text(String(txt), doc.internal.pageSize.getWidth() / 2, y, { align: 'center' });
  }
  function safe(s) { return String(s == null ? '' : s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"'); }

  function watermark(doc, text, colour) {
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    doc.saveGraphicsState();
    if (doc.GState) doc.setGState(new doc.GState({ opacity: 0.16 }));
    doc.setTextColor.apply(doc, colour || RED);
    doc.setFont('helvetica', 'bold');
    const size = Math.min(54, (W * 1.0) / (text.length * 0.52));
    doc.setFontSize(size);
    const angle = Math.atan(H / W) * 180 / Math.PI;
    const tw = doc.getTextWidth(text);
    const rad = angle * Math.PI / 180;
    const x = W / 2 - (tw / 2) * Math.cos(rad), y = H / 2 + (tw / 2) * Math.sin(rad);
    doc.text(text, x, y, { angle });
    doc.restoreGraphicsState();
    doc.setTextColor(0, 0, 0);
  }

  /* opts: { booking, cert, sample(bool), demo(bool) } */
  function certificate(state, opts) {
    const e = state.event, doc = newDoc('landscape');
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const cert = opts.cert, approval = cert ? cert.approval : e.approval;
    const snap = cert ? cert.snapshot : {
      firstName: opts.booking.firstName, lastName: opts.booking.lastName,
      hpcna: opts.booking.hpcna || (opts.booking.hpcnaStatus === 'provided' ? '' : 'Not provided')
    };
    const sample = !CPD.approvalComplete({ approval });
    doc.setDrawColor.apply(doc, NAVY); doc.setLineWidth(1.2);
    doc.rect(22, 22, W - 44, H - 44);
    doc.setTextColor(0, 0, 0);
    centre(doc, safe(e.provider).toUpperCase(), 72, 15, 'bold');
    centre(doc, 'CERTIFICATE OF ATTENDANCE', 104, 25, 'bold');
    if (sample) { doc.setTextColor.apply(doc, RED); centre(doc, 'SAMPLE — NOT VALID FOR CPD', 124, 10, 'bold'); doc.setTextColor(0, 0, 0); }
    else if (!cert) { doc.setTextColor.apply(doc, RED); centre(doc, 'PREVIEW — NOT ISSUED', 124, 10, 'bold'); doc.setTextColor(0, 0, 0); }
    centre(doc, 'This certifies that', 160, 11);
    centre(doc, safe(`${snap.firstName} ${snap.lastName}`), 198, 22, 'bold');
    doc.setLineWidth(0.6); doc.setDrawColor(0, 0, 0); doc.line(W / 2 - 215, 206, W / 2 + 215, 206);
    centre(doc, 'Participant name', 222, 10);
    centre(doc, `HPCNA registration number: ${safe(snap.hpcna) || '______________________'}`, 252, 11);
    centre(doc, 'attended the CPD activity', 282, 11);
    centre(doc, safe(e.topic), 308, 20, 'bold');
    const dateStr = CPD.fmt(CPD.times(e).eventStart, e.timezone, { day: 'numeric', month: 'long', year: 'numeric' });
    centre(doc, `${dateStr} | ${safe(e.venueShort)}`, 330, 11);
    centre(doc, `Provider accreditation number: ${safe(e.providerNumber)}`, 360, 11);
    centre(doc, `Activity accreditation number: ${safe(approval.activityNumber) || '______________________'}`, 382, 11);
    centre(doc, `Approved CEUs: ${safe(approval.ceus) || '__________'}      Level: ${safe(approval.level) || '__________'}`, 404, 11);
    if (sample) centre(doc, 'Activity number, CEUs and level to be completed following HPCNA approval.', 424, 8);
    // signature + date
    doc.setLineWidth(0.6);
    doc.line(60, 512, 270, 512); doc.line(W - 270, 512, W - 60, 512);
    const sig = e.signatory || {};
    if (sig.image && cert) { try { doc.addImage(sig.image, 'PNG', 90, 462, 150, 46, undefined, 'FAST'); } catch (err) { /* ignore bad image */ } }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Authorised provider signature', 60, 527);
    if (sig.name) { doc.setFontSize(9); doc.text(safe(sig.name + (sig.title ? ', ' + sig.title : '')), 60, 540); }
    doc.setFontSize(10);
    doc.text('Date of issue', W - 270, 527);
    if (cert) { doc.setFontSize(12); doc.text(CPD.fmt(cert.issuedAt, e.timezone, { day: 'numeric', month: 'long', year: 'numeric' }), W - 270, 506); }
    doc.setFontSize(8); doc.setTextColor.apply(doc, GREY);
    if (cert) centre(doc, `Certificate no. ${cert.number}${cert.version > 1 ? ' (version ' + cert.version + ')' : ''}  ·  Verification code ${cert.verify}  ·  Booking ${cert.ref}`, H - 34, 8);
    else centre(doc, `Booking ${opts.booking.ref}  ·  not an issued certificate`, H - 34, 8);
    doc.setTextColor(0, 0, 0);
    if (sample) watermark(doc, 'SAMPLE — NOT VALID FOR CPD');
    else if (!cert) watermark(doc, 'PREVIEW — NOT ISSUED');
    if (opts.demo) watermark(doc, 'FICTIONAL DEMO — NOT VALID', NAVY);
    return doc;
  }

  function headerBlock(doc, e, title, y) {
    const t = CPD.times(e), tz = e.timezone;
    const date = CPD.fmt(t.eventStart, tz, { day: 'numeric', month: 'long', year: 'numeric' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text(`${safe(e.provider)} ${title}`, 40, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`${safe(e.topic)} | ${date} | Provider ${safe(e.providerNumber)}`, 40, y + 16);
    doc.text(`Venue: ${safe(e.venue)}, ${safe(e.venueAddress)}`, 40, y + 30);
    const p = k => (e.programme.find(x => x.key === k) || {});
    doc.text(`Event: ${p('welcome').start}-${p('dinner').end} | Presentation and Q&A: ${p('presentation').start}-${p('qa').end} | Evaluation: ${p('evaluation').start}-${p('evaluation').end}`, 40, y + 44);
  }

  /* rows: array of bookings or null for a blank register */
  function register(state, rows) {
    const e = state.event, doc = newDoc('landscape');
    const W = doc.internal.pageSize.getWidth();
    const per = 25;
    const count = rows ? Math.max(rows.length, 1) : e.maxCap;
    const pages = Math.ceil(count / per);
    const cols = [{ t: 'No.', w: 28 }, { t: 'Profession', w: 92 }, { t: 'HPCNA\nRegistration No', w: 92 }, { t: 'First name', w: 95 }, { t: 'Last name', w: 105 },
      { t: 'Telephone\nnumber', w: 82 }, { t: 'Email address', w: 140 }, { t: 'Signature on\ncompletion', w: 128 }];
    for (let pg = 0; pg < pages; pg++) {
      if (pg) doc.addPage();
      headerBlock(doc, e, 'CPD Attendance Register', 40);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
      doc.text('Attendees must sign on completion of the educational activity.', 40, 102);
      let x = 40, y = 112;
      const rh = 16.2;
      doc.setFontSize(8); doc.setLineWidth(0.5);
      for (const c of cols) { doc.rect(x, y, c.w, 24); doc.text(c.t.split('\n'), x + 3, y + 10); x += c.w; }
      y += 24;
      doc.setFont('helvetica', 'normal');
      for (let i = 0; i < per; i++) {
        const idx = pg * per + i;
        if (idx >= count) break;
        const b = rows ? rows[idx] : null;
        x = 40;
        const vals = [String(idx + 1)];
        if (b) vals.push(b.profession === 'Other' ? b.professionOther : b.profession, b.hpcna || '(review)', b.firstName, b.lastName, b.phone, b.email, '');
        cols.forEach((c, ci) => {
          doc.rect(x, y, c.w, rh);
          const v = vals[ci];
          if (v) { doc.setFontSize(ci === 6 ? 6.5 : 7.5); doc.text(doc.splitTextToSize(safe(v), c.w - 4)[0], x + 2, y + 11); }
          x += c.w;
        });
        y += rh;
      }
      doc.setFontSize(9);
      doc.text(`Facilitator: ${safe(e.presenter)} | Specialty: ${safe(e.presenterSpecialty || '')}`, 40, 560);
      doc.text('Number of attendees: __________   Facilitator signature: _____________________   Date: __________', 40, 575);
      doc.text(`Page ${pg + 1} of ${pages}`, W - 90, 575);
    }
    return doc;
  }

  function box(doc, x, y, s) { doc.rect(x, y - s + 2, s, s); }

  function survey(state) {
    const e = state.event, S = CPD.SURVEY, doc = newDoc('portrait');
    const W = doc.internal.pageSize.getWidth();
    // tear-off receipt slip
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('EVALUATION RECEIPT SLIP — reception keeps this part', 40, 40);
    doc.setFont('helvetica', 'normal');
    doc.text('Name: ______________________________   Booking ref: ______________   Received by: ____________', 40, 60);
    doc.setFontSize(7.5); doc.setTextColor.apply(doc, GREY);
    doc.text('Reception records that your evaluation was received, then separates this slip. Your answers below are stored without your name.', 40, 74);
    doc.setTextColor(0, 0, 0);
    doc.setLineDashPattern([4, 3], 0); doc.line(30, 86, W - 30, 86); doc.setLineDashPattern([], 0);
    doc.setFontSize(7); doc.text('cut here', W - 60, 82);
    let y = 120;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('CPD Evaluation Survey', 40, y);
    doc.setFontSize(11); doc.setFont('helvetica', 'normal');
    doc.text(`${safe(e.provider)} – Clinical Update`, 40, y + 20);
    doc.text(`Date: ${CPD.fmt(CPD.times(e).eventStart, e.timezone, { day: 'numeric', month: 'long', year: 'numeric' })}`, 40, y + 36);
    doc.text(`Topic: ${safe(e.topic)}`, 40, y + 52);
    y += 84;
    doc.setFont('helvetica', 'bold'); doc.text('1. Rate the following (1 = Poor, 5 = Excellent)', 40, y); y += 22;
    doc.setFont('helvetica', 'normal');
    for (const r of S.ratings) {
      doc.text('• ' + r.label, 52, y);
      for (let i = 1; i <= 5; i++) { box(doc, 300 + (i - 1) * 46, y, 10); doc.text(String(i), 314 + (i - 1) * 46, y); }
      y += 20;
    }
    y += 10;
    let section = '';
    let num = 1;
    for (const c of S.choices) {
      if (c.section !== section) { section = c.section; num++; doc.setFont('helvetica', 'bold'); doc.text(`${num}. ${section}`, 40, y); y += 22; doc.setFont('helvetica', 'normal'); }
      doc.text('• ' + c.label, 52, y);
      c.options.forEach((o, i) => { box(doc, 330 + i * 70, y, 10); doc.text(o, 344 + i * 70, y); });
      y += 22;
    }
    num++;
    y += 6; doc.setFont('helvetica', 'bold'); doc.text(`${num}. Feedback & Improvement`, 40, y); y += 18;
    doc.setFont('helvetica', 'normal'); doc.text('What can be improved?', 52, y); y += 14;
    doc.setFontSize(9); doc.text(`(${S.improveHint})`, 52, y); doc.setFontSize(11); y += 10;
    for (let i = 0; i < 4; i++) { y += 22; doc.line(52, y, W - 40, y); }
    y += 32; num++;
    doc.setFont('helvetica', 'bold'); doc.text(`${num}. Future CPD Needs`, 40, y); y += 18;
    doc.setFont('helvetica', 'normal'); doc.text('• Which areas would you like future CPDs on? (tick or add your own)', 52, y); y += 20;
    for (const t of S.topics.concat(['Other: __________________________'])) { box(doc, 64, y, 10); doc.text(t, 80, y); y += 18; }
    doc.setFontSize(8); doc.setTextColor.apply(doc, GREY);
    doc.text('NO FEEDBACK, NO CERTIFICATE. Hand this form to reception before you leave.', 40, 810);
    return doc;
  }

  function registrationForm(state) {
    const e = state.event, doc = newDoc('portrait');
    const W = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('CPD Registration Form (paper backup)', 40, 50);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`${safe(e.provider)} · ${safe(e.topic)} · ${CPD.fmt(CPD.times(e).eventStart, e.timezone, { day: 'numeric', month: 'long', year: 'numeric' })} · ${safe(e.venueShort)}`, 40, 68);
    doc.setFontSize(9); doc.setTextColor.apply(doc, GREY);
    doc.text('Please write clearly in capital letters. Reception will enter this form into the system.', 40, 84);
    doc.setTextColor(0, 0, 0);
    let y = 110;
    const field = (label, h) => {
      doc.setFontSize(10); doc.text(label, 40, y); doc.rect(40, y + 5, W - 80, h || 24); y += (h || 24) + 26;
    };
    field('First name'); field('Last name');
    doc.text('Profession (tick one)', 40, y); y += 16;
    CPD.PROFESSIONS.forEach((p, i) => { const cx = 48 + (i % 3) * 170, cy = y + Math.floor(i / 3) * 18; box(doc, cx, cy, 10); doc.text(p === 'Other' ? 'Other: ______________' : p, cx + 16, cy); });
    y += 66;
    field('HPCNA registration number');
    box(doc, 48, y - 14, 10); doc.text('I do not have a number available / not applicable (staff will review)', 64, y - 14); y += 8;
    field('Mobile number'); field('Email address');
    doc.text('Preferred contact (tick one):', 40, y); ['WhatsApp', 'Email', 'SMS'].forEach((c, i) => { box(doc, 200 + i * 90, y, 10); doc.text(c, 216 + i * 90, y); }); y += 30;
    box(doc, 48, y, 10); doc.text('I agree to receive messages about this CPD event (required).', 64, y); y += 20;
    box(doc, 48, y, 10); doc.text(`Optional: I would like to hear about future ${safe(e.provider)} events and offers.`, 64, y); y += 30;
    doc.text('Signature: _______________________________     Date: _______________', 40, y); y += 40;
    doc.setFillColor(240, 240, 246); doc.rect(40, y, W - 80, 70, 'F');
    doc.setFont('helvetica', 'bold'); doc.text('Office use', 50, y + 18); doc.setFont('helvetica', 'normal');
    doc.text('Booking ref: ______________   Entered by: ________________   Date/time entered: ______________', 50, y + 40);
    doc.text('Place: booked / waiting list / contingency (reason): ______________________________', 50, y + 58);
    return doc;
  }

  function checkinList(state, rows) {
    const e = state.event, doc = newDoc('portrait');
    const W = doc.internal.pageSize.getWidth();
    let y = 50, page = 1;
    const head = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(`Desk check-in list — ${safe(e.topic)}`, 40, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text(`Printed list of booked attendees. Tick on arrival and completion, then enter in the app afterwards with the times.`, 40, y + 14);
      y += 34;
      doc.setFont('helvetica', 'bold'); doc.text('Ref', 40, y); doc.text('Name', 110, y); doc.text('Profession', 290, y); doc.text('Arrived (time)', 410, y); doc.text('Completed', 495, y);
      doc.setFont('helvetica', 'normal'); y += 8; doc.line(40, y, W - 40, y); y += 14;
    };
    head();
    for (const b of rows) {
      if (y > 800) { doc.text(`Page ${page}`, W - 80, 820); doc.addPage(); page++; y = 50; head(); }
      doc.setFont('courier', 'normal'); doc.text(b.ref, 40, y); doc.setFont('helvetica', 'normal');
      doc.text(safe(`${b.lastName}, ${b.firstName}`).slice(0, 34), 110, y);
      doc.text(safe(b.profession === 'Other' ? b.professionOther : b.profession).slice(0, 22), 290, y);
      box(doc, 410, y, 9); doc.text('____', 424, y); box(doc, 495, y, 9);
      y += 18;
    }
    doc.text(`Page ${page}`, W - 80, 820);
    return doc;
  }

  root.CPDPdf = { certificate, register, survey, registrationForm, checkinList };
})(window);
