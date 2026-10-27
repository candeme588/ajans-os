const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const jsIds = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));

const missing = [...jsIds].filter((i) => !htmlIds.has(i));
const unused = [...htmlIds].filter((i) => !jsIds.has(i));

console.log(`HTML id: ${htmlIds.size} · JS referansı: ${jsIds.size}`);
console.log(missing.length ? `EKSİK ID: ${missing.join(', ')}` : '✓ Tüm id referansları HTML\'de var');
console.log(unused.length ? `Kullanılmayan id: ${unused.join(', ')}` : '✓ Kullanılmayan id yok');
