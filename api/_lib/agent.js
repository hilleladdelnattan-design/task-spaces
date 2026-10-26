/* "סוכן המשימות": הזהות של השרת מול Firebase.
   הסוכן הוא משתמש Firebase רגיל (אימייל וסיסמה), ולכן כל פעולה שלו עוברת דרך כללי האבטחה של Firestore.
   מה מותר לו מוגדר רק בכללים (isTaskAgent). כרגע: push_jobs (קריאה + סימון "נשלח") ו-push_subs (קריאה + מחיקה).
   משתני סביבה (Vercel): TASK_AGENT_EMAIL, TASK_AGENT_PASSWORD (Secret), FIREBASE_API_KEY (ציבורי, כמו ב-cal.html).
   הטוקן נשמר בזיכרון ומחודש עם refresh token, כדי לא להתחבר מחדש בכל הפעלה */
let session = null;

const agentConfigured = () => !!(process.env.FIREBASE_API_KEY && process.env.TASK_AGENT_EMAIL && process.env.TASK_AGENT_PASSWORD);

async function agentToken() {
  if (!agentConfigured()) throw Object.assign(new Error('task agent not configured'), { code: 'not_configured' });
  const key = process.env.FIREBASE_API_KEY, now = Date.now();
  if (session && session.exp - 2 * 60 * 1000 > now) return session.idToken;
  if (session && session.refreshToken) {
    try {
      const r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refreshToken),
      });
      if (r.ok) {
        const j = await r.json();
        session = { idToken: j.id_token, refreshToken: j.refresh_token, exp: now + (+j.expires_in || 3600) * 1000 };
        return session.idToken;
      }
    } catch (e) { /* נופלים להתחברות מלאה */ }
  }
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.TASK_AGENT_EMAIL, password: process.env.TASK_AGENT_PASSWORD, returnSecureToken: true }),
  });
  if (!r.ok) throw new Error('task agent sign-in: HTTP ' + r.status);
  const j = await r.json();
  session = { idToken: j.idToken, refreshToken: j.refreshToken, exp: now + (+j.expiresIn || 3600) * 1000 };
  return session.idToken;
}

module.exports = { agentToken, agentConfigured };
