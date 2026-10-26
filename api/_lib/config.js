/* הגדרות שרת ההתראות. ערכים סודיים מגיעים רק ממשתני הסביבה של Vercel, לעולם לא מהקוד או מ-GitHub.
   משתנים: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, CRON_SECRET, VAPID_SUBJECT (לא חובה).
   אין כאן Service Account ואין Admin SDK: כל גישה ל-Firestore היא עם ID Token של משתמש Firebase, ולכן כללי האבטחה תמיד חלים */
const PROJECT_ID = 'task-spaces';
const SITE_ORIGIN = 'https://task-spaces-orpin.vercel.app';

function vapid() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  return pub && priv ? { pub, priv, subject: process.env.VAPID_SUBJECT || SITE_ORIGIN } : null;
}

const cronSecret = () => process.env.CRON_SECRET || '';

module.exports = { PROJECT_ID, SITE_ORIGIN, vapid, cronSecret };
