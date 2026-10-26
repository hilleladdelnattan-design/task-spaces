/* בדיקת מצב: האם השרת עלה, ואילו הגדרות קיימות. מחזיר רק כן/לא לכל הגדרה, לעולם לא את הערכים עצמם */
const { vapid, cronSecret } = require('./_lib/config');
const { send } = require('./_lib/http');

module.exports = (req, res) => {
  const cpu0 = process.cpuUsage();
  send(res, 200, {
    ok: true,
    service: 'task-spaces-push',
    stage: 1,
    configured: { vapid: !!vapid(), cronSecret: !!cronSecret() },
  }, cpu0);
};
