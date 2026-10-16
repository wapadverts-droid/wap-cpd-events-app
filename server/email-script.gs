/**
 * WAP CPD Events — email sender (Google Apps Script).
 *
 * Paste this whole file into a new project at https://script.google.com while signed in
 * as wapadverts@gmail.com, put your own passphrase below, then Deploy → New deployment →
 * Web app (Execute as: Me, Who has access: Anyone).
 *
 * The CPD server sends booking emails through this script, so they come from the
 * Gmail account itself. Free Gmail accounts can send to 100 recipients a day this way.
 */

// Type your NEW passphrase between the quote marks. This is the ONLY place to change.
// Save the exact same passphrase in Supabase as the secret EMAIL_SCRIPT_KEY.
const SECRET = 'TYPE-YOUR-NEW-PASSPHRASE-HERE';

const SENDER_NAME = 'WAP Medical Supplies CPD';

function doPost(e) {
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!SECRET || SECRET.indexOf('TYPE-YOUR') === 0 || d.key !== SECRET) {
      return reply({ ok: false, error: 'Not allowed (passphrase does not match).' });
    }
    const to = String(d.to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return reply({ ok: false, error: 'Invalid email address.' });
    if (MailApp.getRemainingDailyQuota() < 1) return reply({ ok: false, error: 'Daily Gmail sending limit reached. Try again tomorrow.' });
    MailApp.sendEmail({
      to: to,
      subject: String(d.subject || 'WAP CPD event').slice(0, 250),
      body: String(d.body || '').slice(0, 20000),
      name: SENDER_NAME
    });
    return reply({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

// Opening the web app address in a browser shows this, to check the deployment works.
function doGet() {
  return ContentService.createTextOutput('WAP CPD email script is running. Emails left today: ' + MailApp.getRemainingDailyQuota());
}

// 2) Run this once from the editor (select testEmail, click Run) to give permission and send yourself a test.
function testEmail() {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Test: WAP CPD email script', 'The email script works. You can now deploy it as a web app.', { name: SENDER_NAME });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
