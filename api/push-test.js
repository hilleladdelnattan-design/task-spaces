/* "שלח התראת בדיקה": רק למשתמש מחובר (Firebase ID Token), ורק למכשירים שלו (users/{uid}/push_subs).
   את רשימת המכשירים השרת קורא עם הטוקן של המשתמש עצמו, כך שכללי האבטחה של Firestore חלים ואין צורך בחשבון שרת.
   שולח הודעה קבועה בלי שום תוכן ממשימות. מוגבל לפעם בדקה לכל משתמש (בכל מופע של השרת) */
const webpush = require('web-push');
const { PROJECT_ID, vapid } = require('./_lib/config');
const { verifyIdToken, listDocs, deleteDoc } = require('./_lib/google');
const { send } = require('./_lib/http');
const { allowedEndpoint } = require('./_lib/push');

const lastSent = new Map();

module.exports = async (req, res) => {
  const cpu0 = process.cpuUsage();
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, cpu0);

  const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || '');
  const user = m ? await verifyIdToken(m[1], PROJECT_ID).catch(() => null) : null;
  if (!user) return send(res, 401, { error: 'unauthorized' }, cpu0);

  const v = vapid();
  if (!v) return send(res, 503, { error: 'not_configured' }, cpu0);

  const now = Date.now();
  if (now - (lastSent.get(user.uid) || 0) < 60 * 1000) return send(res, 429, { error: 'rate_limited' }, cpu0);
  lastSent.set(user.uid, now);

  const base = 'users/' + user.uid + '/push_subs';
  let subs;
  try {
    subs = (await listDocs(m[1], PROJECT_ID, base)).filter((s) => s.enabled !== false && s.endpoint && s.keys && s.keys.p256dh && s.keys.auth && allowedEndpoint(s.endpoint));
  } catch (e) {
    return send(res, 502, { error: 'firestore_unavailable' }, cpu0);
  }
  if (!subs.length) return send(res, 200, { ok: true, devices: 0, sent: 0, removed: 0, failed: 0 }, cpu0);

  const en = req.body && req.body.lang === 'en';
  const payload = JSON.stringify({
    title: en ? 'Test notification' : 'התראת בדיקה',
    body: en ? 'Notifications work on this device ✓' : 'ההתראות עובדות במכשיר הזה ✓',
    url: '/cal.html',
    tag: 'push-test',
  });
  webpush.setVapidDetails(v.subject, v.pub, v.priv);

  let sent = 0, removed = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, payload, { TTL: 300, urgency: 'high' });
      sent++;
    } catch (e) {
      /* הרשמה שהמכשיר כבר לא מכיר: נמחקת, כדי שלא ננסה לשלוח אליה שוב */
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        removed++;
        await deleteDoc(m[1], PROJECT_ID, base + '/' + s.id).catch(() => {});
      } else failed++;
    }
  }));
  return send(res, 200, { ok: true, devices: subs.length, sent, removed, failed }, cpu0);
};
