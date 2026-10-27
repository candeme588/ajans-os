const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* ---------------------------------------------------------------
   Basit oturum koruması (harici paket yok)

   ADMIN_PASSWORD tanımlıysa koruma açılır.
   Tanımlı değilse panel yalnızca yerel modda çalışır (uyarı verilir).
---------------------------------------------------------------- */

const COOKIE = 'ajans_oturum';
const SURE_MS = 1000 * 60 * 60 * 24 * 14; // 14 gün

const ROOT = path.resolve(__dirname, '..');
const SECRET_FILE = path.join(ROOT, 'data', '.oturum-anahtari');

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
  } catch {}
  return s;
}

const ANAHTAR = secret();
const SIFRE = process.env.ADMIN_PASSWORD || '';

function aktif() {
  return SIFRE.length > 0;
}

/* imzalı jeton: <son kullanma>.<imza> */
function jetonUret() {
  const bitis = Date.now() + SURE_MS;
  const imza = crypto.createHmac('sha256', ANAHTAR).update(String(bitis)).digest('hex');
  return `${bitis}.${imza}`;
}

function jetonGecerli(token) {
  if (!token || !token.includes('.')) return false;
  const [bitis, imza] = token.split('.');
  if (!bitis || !imza) return false;
  const beklenen = crypto.createHmac('sha256', ANAHTAR).update(String(bitis)).digest('hex');
  if (imza.length !== beklenen.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(imza), Buffer.from(beklenen))) return false;
  return Number(bitis) > Date.now();
}

function cerezOku(req) {
  const raw = req.headers.cookie || '';
  for (const parca of raw.split(';')) {
    const [k, ...v] = parca.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

function girisYapmis(req) {
  if (!aktif()) return true; // şifre tanımlı değilse serbest
  return jetonGecerli(cerezOku(req));
}

function cerezAyarla(res, token) {
  const guvenli = process.env.CEREZ_GUVENLI === '1' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${Math.floor(SURE_MS / 1000)}; SameSite=Lax${guvenli}`
  );
}

function cerezSil(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

/* kaba kuvvet koruması: aynı IP'den 10 hatalı denemeden sonra 15 dk kilit */
const denemeler = new Map();
const MAX_DENEME = 10;
const KILIT_MS = 15 * 60 * 1000;

function kilitliMi(ip) {
  const k = denemeler.get(ip);
  if (!k) return false;
  if (Date.now() - k.ilk > KILIT_MS) {
    denemeler.delete(ip);
    return false;
  }
  return k.sayi >= MAX_DENEME;
}

function hataliDeneme(ip) {
  const k = denemeler.get(ip) || { sayi: 0, ilk: Date.now() };
  k.sayi += 1;
  denemeler.set(ip, k);
}

function sifirla(ip) {
  denemeler.delete(ip);
}

function sifreDogru(girilen) {
  if (!aktif()) return true;
  const a = Buffer.from(String(girilen || ''));
  const b = Buffer.from(SIFRE);
  if (a.length !== b.length) {
    // uzunluk farkını da sabit zamanda ele al
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function ipAl(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'bilinmiyor'
  );
}

module.exports = {
  aktif, girisYapmis, sifreDogru, cerezAyarla, cerezSil,
  kilitliMi, hataliDeneme, sifirla, ipAl, jetonUret,
};
