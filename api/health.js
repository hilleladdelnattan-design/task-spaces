/* בדיקת מצב: האם השרת עלה, ואילו הגדרות קיימות. מחזיר רק כן/לא לכל הגדרה, לעולם לא את הערכים עצמם */
const { vapid, cronSecret } = require('./_lib/config');
const { agentConfigured } = require('./_lib/agent');
const { send } = require('./_lib/http');

module.exports = (req, res) => {
  const cpu0 = process.cpuUsage();
  send(res, 200, {
    ok: true,
    service: 'task-agent',
    capabilities: ['reminders'],
    configured: { vapid: !!vapid(), cronSecret: !!cronSecret(), taskAgent: agentConfigured() },
  }, cpu0);
};
