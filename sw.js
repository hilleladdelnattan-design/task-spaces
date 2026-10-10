/* Service Worker של לוח המשימות (גרסה 0.3)
   מטרה: לשמור את קבצי האפליקציה במכשיר כדי שהיא תיפתח גם בלי אינטרנט.
   הנתונים עצמם (המשימות) נשמרים על ידי Firestore במטמון המקומי שלו, לא כאן.
   אסטרטגיה: קודם הרשת (כדי שעדכון שהועלה יופיע מיד), ואם אין רשת או שהיא איטית מדי, הגרסה השמורה. */
const CACHE='cal-v0.5';
const CORE=['/cal.html','/fb.js'];
const OPTIONAL=['/manifest.json','/icon-180.png','/icon-192.png','/icon-512.png','/icon-maskable-512.png'];
const ALL=new Set([...CORE,...OPTIONAL]);
const WAIT_MS=4000;

self.addEventListener('install',e=>{
  e.waitUntil((async()=>{
    const c=await caches.open(CACHE);
    await Promise.all(CORE.map(async u=>{const r=await fetch(u,{cache:'reload'});if(!r.ok)throw new Error('precache '+u+' '+r.status);await c.put(u,r)}));
    await Promise.all(OPTIONAL.map(async u=>{try{const r=await fetch(u,{cache:'reload'});if(r.ok)await c.put(u,r)}catch(_){}}));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('cal-')&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
/* iOS לא מקבל תשובת SW שעברה הפניה (redirect), לכן מנקים אותה */
async function plain(r){
  if(!r||!r.redirected)return r;
  const b=await r.blob();
  return new Response(b,{status:r.status,statusText:r.statusText,headers:r.headers});
}
async function handle(e,key){
  const cache=await caches.open(CACHE);
  const net=fetch(e.request).then(async r=>{
    if(r&&r.ok){const p=await plain(r.clone());await cache.put(key,p.clone());return plain(r)}
    return r;
  });
  e.waitUntil(net.catch(()=>{}));
  const cached=await cache.match(key);
  if(!cached)return net;
  try{
    const r=await Promise.race([net,new Promise((_,rej)=>setTimeout(()=>rej(new Error('slow')),WAIT_MS))]);
    return r&&r.ok?r:cached;
  }catch(_){return cached}
}
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  if(!ALL.has(url.pathname))return;
  e.respondWith(handle(e,url.origin+url.pathname));
});
