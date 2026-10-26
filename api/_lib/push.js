/* משותף לשליחת Web Push: רק לשירותי ה-push הרשמיים (Apple, Google, Microsoft, Mozilla),
   כדי שכתובת שהוזנה ידנית לא תגרום לשרת לפנות לכתובות אחרות */
const PUSH_HOSTS = ['.push.apple.com', 'fcm.googleapis.com', '.notify.windows.com', 'push.services.mozilla.com'];

function allowedEndpoint(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && PUSH_HOSTS.some((h) => (h.startsWith('.') ? x.hostname.endsWith(h) : x.hostname === h || x.hostname.endsWith('.' + h)));
  } catch (e) {
    return false;
  }
}

/* הרשמת מכשיר שאפשר לשלוח אליה */
const usableSub = (s) => s && s.enabled !== false && s.endpoint && s.keys && s.keys.p256dh && s.keys.auth && allowedEndpoint(s.endpoint);

module.exports = { allowedEndpoint, usableSub };
