/* הגדרות שרת ההתראות. ערכים סודיים מגיעים רק ממשתני הסביבה של Vercel, לעולם לא מהקוד או מ-GitHub.
   משתנים: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, CRON_SECRET, FIREBASE_SA_B64 (קובץ ה-JSON של ה-Service Account בקידוד base64), VAPID_SUBJECT (לא חובה) */
const PROJECT_ID = 'task-spaces';
const SITE_ORIGIN = 'https://task-spaces-orpin.vercel.app';

function serviceAccount() {
  const raw = process.env.FIREBASE_SA_B64;
  if (!raw) return null;
  try {
    const sa = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    return sa && sa.client_email && sa.private_key ? sa : null;
  } catch (e) {
    return null;
  }
}

function vapid() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  return pub && priv ? { pub, priv, subject: process.env.VAPID_SUBJECT || SITE_ORIGIN } : null;
}

const cronSecret = () => process.env.CRON_SECRET || '';

module.exports = { PROJECT_ID, SITE_ORIGIN, serviceAccount, vapid, cronSecret };
