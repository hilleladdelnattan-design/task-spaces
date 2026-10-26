/* "סוכן המשימות": נקודת ההפעלה. נקראת פעם בדקה (cron-job.org) או ידנית.
   דורשת Authorization: Bearer <CRON_SECRET>. מריצה את היכולות לפי הסדר; כרגע יש אחת: התראות (reminders).
   יכולת חדשה = מודול נוסף ב-_lib/capabilities וכלל אבטחה מפורש משלה (רק באישור).
   ?dry=1 = רק לספור מה הגיע זמנו, בלי לשלוח ובלי לסמן */
const crypto = require('crypto');
const { cronSecret } = require('./_lib/config');
const { agentToken } = require('./_lib/agent');
const { send } = require('./_lib/http');

const CAPABILITIES = { reminders: require('./_lib/capabilities/reminders') };

function authorized(req) {
  const secret = cronSecret();
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || '');
  if (!secret || !m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  const cpu0 = process.cpuUsage();
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, cpu0);
  if (!authorized(req)) return send(res, 401, { error: 'unauthorized' }, cpu0);
  const dryRun = /[?&]dry=1(&|$)/.test(req.url || '');
  const now = Date.now();
  const result = {};
  try {
    const token = await agentToken();
    for (const [name, cap] of Object.entries(CAPABILITIES)) result[name] = await cap.run({ token, now, dryRun });
  } catch (e) {
    console.error('agent-tick', e && e.message);
    return send(res, e && e.code === 'not_configured' ? 503 : 500, { error: e && e.code === 'not_configured' ? 'not_configured' : 'agent_failed' }, cpu0);
  }
  send(res, 200, { ok: true, dryRun, ...result }, cpu0);
};
