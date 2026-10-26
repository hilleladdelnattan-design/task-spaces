/* גישה ל-Google בלי ספריות כבדות (כדי לחסוך CPU), ובלי Admin SDK ובלי Service Account:
   1. אימות Firebase ID Token של משתמש מחובר (חתימה, פרויקט, תוקף).
   2. קריאה ומחיקה של מסמכים ב-Firestore דרך REST. ה-bearer הוא תמיד ID Token של משתמש Firebase,
      ולכן כללי האבטחה של Firestore חלים, והשרת רואה רק את מה שהמשתמש הזה רשאי לראות. */
const crypto = require('crypto');

/* ===== אימות Firebase ID Token ===== */
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwks = null;
async function signingKeys() {
  const now = Date.now();
  if (jwks && jwks.exp > now) return jwks.keys;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error('jwks: HTTP ' + r.status);
  const j = await r.json();
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  jwks = { keys: j.keys || [], exp: now + (m ? +m[1] * 1000 : 3600 * 1000) };
  return jwks.keys;
}

/* מחזיר {uid} אם הטוקן תקין ושייך לפרויקט, אחרת null */
async function verifyIdToken(token, projectId) {
  const p = String(token || '').split('.');
  if (p.length !== 3) return null;
  let h, c;
  try {
    h = JSON.parse(Buffer.from(p[0], 'base64url').toString('utf8'));
    c = JSON.parse(Buffer.from(p[1], 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (h.alg !== 'RS256' || !h.kid) return null;
  const k = (await signingKeys()).find((x) => x.kid === h.kid);
  if (!k) return null;
  const ok = crypto.verify('RSA-SHA256', Buffer.from(p[0] + '.' + p[1]), crypto.createPublicKey({ key: k, format: 'jwk' }), Buffer.from(p[2], 'base64url'));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (c.aud !== projectId || c.iss !== 'https://securetoken.google.com/' + projectId) return null;
  if (typeof c.sub !== 'string' || !c.sub || c.sub.length > 128) return null;
  if (!(c.exp > now) || c.iat > now + 60 || (c.auth_time && c.auth_time > now + 60)) return null;
  return { uid: c.sub };
}

/* ===== Firestore דרך REST ===== */
const docsBase = (projectId) => 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents/';
const encPath = (path) => path.split('/').map(encodeURIComponent).join('/');

function decode(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) {
    const o = {};
    const f = v.mapValue.fields || {};
    for (const k in f) o[k] = decode(f[k]);
    return o;
  }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  return null;
}

/* כל המסמכים באוסף (עד 500). אוסף שלא קיים מחזיר רשימה ריקה */
async function listDocs(bearer, projectId, path) {
  const tok = bearer;
  const out = [];
  let page = '';
  do {
    const url = docsBase(projectId) + encPath(path) + '?pageSize=100' + (page ? '&pageToken=' + encodeURIComponent(page) : '');
    const r = await fetch(url, { headers: { authorization: 'Bearer ' + tok } });
    if (r.status === 404) return out;
    if (!r.ok) throw new Error('firestore list: HTTP ' + r.status);
    const j = await r.json();
    for (const d of j.documents || []) {
      const o = {};
      for (const k in d.fields || {}) o[k] = decode(d.fields[k]);
      o.id = d.name.split('/').pop();
      out.push(o);
    }
    page = j.nextPageToken || '';
  } while (page && out.length < 500);
  return out;
}

async function deleteDoc(bearer, projectId, path) {
  const tok = bearer;
  const r = await fetch(docsBase(projectId) + encPath(path), { method: 'DELETE', headers: { authorization: 'Bearer ' + tok } });
  if (!r.ok && r.status !== 404) throw new Error('firestore delete: HTTP ' + r.status);
}

module.exports = { verifyIdToken, listDocs, deleteDoc };
