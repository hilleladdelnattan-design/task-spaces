/* גישה ל-Google בלי ספריות כבדות (כדי לחסוך CPU):
   1. אימות Firebase ID Token של משתמש מחובר (חתימה, פרויקט, תוקף).
   2. טוקן גישה ל-Firestore בעזרת ה-Service Account (הרשאת Firestore בלבד).
   3. קריאה ומחיקה של מסמכים ב-Firestore דרך REST. */
const crypto = require('crypto');

const b64u = (b) => Buffer.from(b).toString('base64url');

/* ===== טוקן גישה של ה-Service Account ===== */
let accessTok = null;
async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (accessTok && accessTok.exp - 60 > now) return accessTok.value;
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const sig = b64u(crypto.sign('RSA-SHA256', Buffer.from(head + '.' + claims), sa.private_key));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claims + '.' + sig,
  });
  if (!r.ok) throw new Error('service account token: HTTP ' + r.status);
  const j = await r.json();
  accessTok = { value: j.access_token, exp: now + (j.expires_in || 3600) };
  return accessTok.value;
}

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
async function listDocs(sa, projectId, path) {
  const tok = await accessToken(sa);
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

async function deleteDoc(sa, projectId, path) {
  const tok = await accessToken(sa);
  const r = await fetch(docsBase(projectId) + encPath(path), { method: 'DELETE', headers: { authorization: 'Bearer ' + tok } });
  if (!r.ok && r.status !== 404) throw new Error('firestore delete: HTTP ' + r.status);
}

module.exports = { verifyIdToken, listDocs, deleteDoc };
