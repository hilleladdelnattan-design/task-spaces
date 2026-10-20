/* תשובה אחידה מהשרת. כל תשובה מדווחת כמה זמן CPU היא צרכה (x-cpu-ms) והאם זו הפעלה ראשונה של המופע (x-cold),
   כדי למדוד את הצריכה מול מכסת Active CPU של Vercel Hobby לפני שמפעילים תזמון */
let warm = false;

function send(res, status, body, cpu0) {
  if (cpu0) {
    const u = process.cpuUsage(cpu0);
    res.setHeader('x-cpu-ms', String(Math.round((u.user + u.system) / 1000)));
  }
  res.setHeader('x-cold', warm ? '0' : '1');
  warm = true;
  res.setHeader('cache-control', 'no-store');
  res.status(status).json(body);
}

module.exports = { send };
