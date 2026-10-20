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
/* ===== התראות (Web Push): כל הודעה שמגיעה מוצגת כהתראה (חובה באייפון), והקשה עליה פותחת את האפליקציה =====
   מנגנון המטמון למעלה לא משתנה */
self.addEventListener('push',e=>{
  let d={};
  try{d=e.data?e.data.json():{}}catch(_){d={}}
  const opt={body:d.body||'',icon:'/icon-192.png',data:{url:d.url||'/cal.html'}};
  if(d.tag)opt.tag=d.tag;
  e.waitUntil(self.registration.showNotification(d.title||'לוח משימות',opt));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  let url;
  try{url=new URL((e.notification.data&&e.notification.data.url)||'/cal.html',self.location.origin)}catch(_){url=null}
  /* רק כתובות של האפליקציה עצמה */
  const target=url&&url.origin===self.location.origin?url.href:self.location.origin+'/cal.html';
  e.waitUntil((async()=>{
    const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of all){
      if(c.url.startsWith(self.location.origin)&&'focus' in c){
        try{if(c.url!==target&&'navigate' in c)await c.navigate(target)}catch(_){}
        return c.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  if(!ALL.has(url.pathname))return;
  e.respondWith(handle(e,url.origin+url.pathname));
});
