/* יכולת "התראות" של סוכן המשימות.
   1. מוצאת התראות שהגיע זמנן: push_jobs של כל המשתמשים עם now-15min < at <= now, שעוד לא סומנו "נשלח".
   2. "תופסת" כל אחת לפני השליחה: מסמנת sent:true בתנאי שהמסמך לא השתנה מאז שנקרא (updateTime).
      אם שתי הפעלות רצות במקביל, רק אחת מצליחה לתפוס, ולכן אין התראה כפולה.
   3. שולחת לכל המכשירים של בעל ההתראה. לפי kind:
      'rem' (או בלי kind, מסמך ישן) תזכורת: כותרת = שם המשימה בלבד, תוכן = היום/מחר/תאריך + שעה.
      'late' תזכורת מאוחרת ו-'snooze' נודניק: אותה כותרת, ותוכן "עדיין פתוחה" / "תזכורת חוזרת" + מתי.
      'sum' סיכום: "נותרו לך N משימות שדורשות טיפול".
      הקשה פותחת את המשימה המדויקת (#n=...&t=<מזהה>), ובסיכום את היום הנוכחי.
   4. מוחקת הרשמה שהמכשיר כבר לא מכיר (404/410).
   הזמנים, כולל שעות שקט, תזכורת מאוחרת וסיכומים, חושבו מראש באפליקציה כרגע מוחלט (לפי שעון ישראל כולל קיץ/חורף).
   לכן הסוכן לא קורא משימות או העדפות, ואין כאן חישובי שעון */
const webpush = require('web-push');
const { PROJECT_ID, vapid } = require('../config');
const { runQuery, claimDoc, listDocs, deleteDoc } = require('../google');
const { usableSub } = require('../push');

const WINDOW = 15 * 60 * 1000; // תזכורת באיחור של עד 15 דקות עדיין נשלחת (אותו חלון כמו באפליקציה)
const MAX_PER_RUN = 200;
const ilDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

function when(job, en, now) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(job.date || '') ? job.date : '';
  const day = !d ? '' : d === ilDate(now) ? (en ? 'Today' : 'היום') : d === ilDate(now + 864e5) ? (en ? 'Tomorrow' : 'מחר') : d === ilDate(now - 864e5) ? (en ? 'Yesterday' : 'אתמול') : String(+d.slice(8, 10)) + '/' + String(+d.slice(5, 7));
  return job.time ? (en ? (day ? day + ' at ' : '') + job.time : (day ? day + ' ב-' : '') + job.time) : day;
}
function message(job, lang, now) {
  const en = lang === 'en', kind = job.kind || 'rem';
  if (kind === 'sum') {
    const n = +job.count || 0;
    return {
      title: en ? 'Task summary' : 'סיכום משימות',
      body: en ? (n === 1 ? 'You have 1 task that needs attention' : 'You have ' + n + ' tasks that need attention') : (n === 1 ? 'נותרה לך משימה אחת שדורשת טיפול' : 'נותרו לך ' + n + ' משימות שדורשות טיפול'),
    };
  }
  const title = job.title || (en ? 'Task reminder' : 'תזכורת למשימה'), w = when(job, en, now);
  if (kind === 'late') return { title, body: (en ? 'Still open' : 'עדיין פתוחה') + (w ? ' · ' + w : '') };
  if (kind === 'snooze') return { title, body: (en ? 'Reminder again' : 'תזכורת חוזרת') + (w ? ' · ' + w : '') };
  return { title, body: w };
}
/* לאן ההקשה מובילה: המשימה המדויקת לפי המזהה שלה (ולא לפי השם). מסמך ישן בלי tid: המזהה הוא {tid}_{at} */
function link(job) {
  const d = job.data, kind = d.kind || 'rem', e = encodeURIComponent;
  if (kind === 'sum') return '/cal.html#n=sum&d=' + e(d.date || '');
  const tid = d.tid || job.id.replace(/_\d+$/, '');
  return '/cal.html#n=' + e(kind) + '&d=' + e(d.date || '') + '&t=' + e(tid) + (d.sid ? '&s=' + e(d.sid) : '');
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
    if (!subs.length || (job.data.kind === 'sum' && !(+job.data.count > 0))) { out.notSent++; continue; }
    await Promise.all(subs.map(async (s) => {
      const m = message(job.data, s.lang, now);
      const payload = JSON.stringify({ title: m.title, body: m.body, url: link(job), tag: job.data.kind === 'sum' ? 'sum' : 'job-' + job.id });
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
