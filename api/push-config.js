/* המפתח הציבורי (VAPID) שהאפליקציה צריכה כדי לרשום מכשיר להתראות. ציבורי מטבעו; המפתח הפרטי לעולם לא יוצא מהשרת */
const { send } = require('./_lib/http');

module.exports = (req, res) => {
  const cpu0 = process.cpuUsage();
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' }, cpu0);
  const publicKey = process.env.VAPID_PUBLIC_KEY || '';
  if (!publicKey) return send(res, 503, { error: 'not_configured' }, cpu0);
  send(res, 200, { publicKey }, cpu0);
};
