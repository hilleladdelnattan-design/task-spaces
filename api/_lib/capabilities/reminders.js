/* יכולת "התראות" של סוכן המשימות.
   1. מוצאת תזכורות שהגיע זמנן: push_jobs של כל המשתמשים עם now-15min < at <= now, שעוד לא סומנו "נשלח".
   2. "תופסת" כל תזכורת לפני השליחה: מסמנת sent:true בתנאי שהמסמך לא השתנה מאז שנקרא (updateTime).
      אם שתי הפעלות רצות במקביל, רק אחת מצליחה לתפוס, ולכן אין התראה כפולה.
   3. שולחת לכל המכשירים של בעל התזכורת: כותרת = שם המשימה בלבד, תוכן = היום/מחר + שעה. הקשה פותחת את היום של המשימה.
   4. מוחקת הרשמה שהמכשיר כבר לא מכיר (404/410).
   הזמנים נשמרו בידי האפליקציה כרגע מוחלט (UTC, לפי שעון ישראל כולל קיץ/חורף), כך שכאן אין חישובי שעון */
const webpush = require('web-push');
const { PROJECT_ID, vapid } = require('../config');
const { runQuery, claimDoc, listDocs, deleteDoc } = require('../google');
const { usableSub } = require('../push');

const WINDOW = 15 * 60 * 1000; // תזכורת באיחור של עד 15 דקות עדיין נשלחת (אותו חלון כמו באפליקציה)
const MAX_PER_RUN = 200;
const ilDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

function message(job, lang, now) {
  const en = lang === 'en';
  const day = job.date === ilDate(now) ? (en ? 'Today' : 'היום') : job.date === ilDate(now + 864e5) ? (en ? 'Tomorrow' : 'מחר') : String(+job.date.slice(8, 10)) + '/' + String(+job.date.slice(5, 7));
  return {
    title: job.title || (en ? 'Task reminder' : 'תזכורת למשימה'),
    body: job.time ? (en ? day + ' at ' + job.time : day + ' ב-' + job.time) : (en ? day : day),
  };
}

async function run({ token, now, dryRun }) {
  const rows = await runQuery(token, PROJECT_ID, {
    from: [{ collectionId: 'push_jobs', allDescendants: true }],
    where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'at' }, op: 'GREATER_THAN', value: { integerValue: String(now - WINDOW) } } },
      { fieldFilter: { field: { fieldPath: 'at' }, op: 'LESS_THAN_OR_EQUAL', value: { integerValue: String(now) } } },
    ] } },
    orderBy: [{ field: { fieldPath: 'at' }, direction: 'ASCENDING' }],
    limit: MAX_PER_RUN,
  });
  const due = rows.filter((r) => !r.data.sent);
  const out = { due: due.length, claimed: 0, notSent: 0, sent: 0, failed: 0, removed: 0 };
  if (dryRun || !due.length) return out;

  const v = vapid();
  if (!v) throw Object.assign(new Error('vapid not configured'), { code: 'not_configured' });
  webpush.setVapidDetails(v.subject, v.pub, v.priv);

  const subsByUser = new Map();
  for (const job of due) {
    const uid = job.path.split('/')[1]; // users/{uid}/push_jobs/{id}
    if (!(await claimDoc(token, job.name, job.updateTime, { sent: { booleanValue: true }, sentAt: { integerValue: String(now) } }))) continue;
    out.claimed++;
    let subs = subsByUser.get(uid);
    if (!subs) { subs = (await listDocs(token, PROJECT_ID, 'users/' + uid + '/push_subs')).filter(usableSub); subsByUser.set(uid, subs); }
    if (!subs.length) { out.notSent++; continue; }
    await Promise.all(subs.map(async (s) => {
      const m = message(job.data, s.lang, now);
      const payload = JSON.stringify({ title: m.title, body: m.body, url: '/cal.html#d=' + job.data.date, tag: 'job-' + job.id });
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, payload, { TTL: 3600, urgency: 'high' });
        out.sent++;
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          if (!s.removed) { s.removed = true; out.removed++; await deleteDoc(token, PROJECT_ID, 'users/' + uid + '/push_subs/' + s.id).catch(() => {}); }
        } else out.failed++;
      }
    }));
  }
  return out;
}

module.exports = { run };
