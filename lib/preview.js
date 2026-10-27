/* ------------------------------------------------------------------
   Çıktıdan önizlenecek HTML üretir + yarım kalmış HTML'i onarır.
   Amaç: hiçbir durumda beyaz ekran göstermemek.
------------------------------------------------------------------- */

const FENCE = /```([a-zA-Z0-9]*)[^\n]*\n([\s\S]*?)```/g;

function extractBlocks(text) {
  const blocks = [];
  FENCE.lastIndex = 0;
  let m;
  while ((m = FENCE.exec(text)) !== null) {
    blocks.push({ lang: (m[1] || '').toLowerCase(), code: m[2] });
  }
  return blocks;
}

/* yarım kalan fenced bloğu kurtar (kapanış ``` yok) */
function salvageUnclosedFence(text) {
  const open = text.lastIndexOf('```');
  if (open === -1) return null;
  const before = text.lastIndexOf('```', open - 1);
  // tek sayıda ``` varsa blok kapanmamıştır
  const count = (text.match(/```/g) || []).length;
  if (count % 2 === 1 && open > (before === -1 ? -1 : before)) {
    const langMatch = text.slice(open + 3).match(/^([a-zA-Z0-9]*)/);
    const lang = (langMatch?.[1] || '').toLowerCase();
    return { lang, code: text.slice(open + 3 + lang.length).replace(/^\n/, '') };
  }
  return null;
}

/* Yarım HTML'i kapat: <style>, <script>, <body>, <html> */
function repairHtml(doc) {
  if (!doc) return doc;
  let s = String(doc);

  // baştaki kod bloğu işaretlerini ve açıklama metnini at
  const docStart = s.search(/<!doctype\s+html|<html[\s>]/i);
  if (docStart > 0) s = s.slice(docStart);
  s = s.replace(/^```[a-zA-Z0-9]*\s*\n?/, '');

  // yarım kalan son etiketi kes (<h3>Döng  gibi)
  s = s.replace(/<([a-zA-Z][\w-]*)([^<>]*)$/, (full, tag, attrs) => {
    // eğer bu gerçekten açılmış ve tamamlanmamış bir etiketse at
    return '';
  });

  // yarım CSS/JS bloğunu kapat
  const opensStyle = (s.match(/<style[\s>]/gi) || []).length;
  const closesStyle = (s.match(/<\/style>/gi) || []).length;
  const opensScript = (s.match(/<script[\s>]/gi) || []).length;
  const closesScript = (s.match(/<\/script>/gi) || []).length;

  if (opensStyle > closesStyle) {
    // style içinde yarım kalan son kuralı temizle
    s = s.replace(/[^\n{}]*$/, '');
    s += '\n</style>';
  }
  if (opensScript > closesScript) {
    s += '\n</script>';
  }

  // body/html kapanışları
  if (/<body[\s>]/i.test(s) && !/<\/body>/i.test(s)) s += '\n</body>';
  if (/<html[\s>]/i.test(s) && !/<\/html>/i.test(s)) s += '\n</html>';

  return s;
}

/* kesilmiş çıktıya görünür uyarı bandı ekle */
function addTruncationBanner(doc) {
  const banner = `
<div style="position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#221c10;color:#f5b942;
     border-top:1px solid #5c4a20;padding:10px 16px;font:13px/1.5 -apple-system,'Segoe UI',sans-serif;
     text-align:center">
  ⚠️ Bu çıktı <strong>yarıda kesildi</strong> — sayfa eksik görünüyor. İsteği tekrar çalıştır veya
  "daha kısa tut, tek ekran yeter" diye ekle.
</div>`;
  if (/<\/body>/i.test(doc)) return doc.replace(/<\/body>/i, `${banner}\n</body>`);
  return doc + banner;
}

/* Markdown çıktısını basit bir sayfaya çevir (HTML yoksa son çare) */
function markdownFallback(output, title) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let body = esc(output)
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>');

  return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title || 'Önizleme')}</title>
<style>
  body{margin:0;padding:36px 28px;background:#f7f8fa;color:#1a1d23;
       font:15px/1.75 -apple-system,"Segoe UI",Inter,system-ui,sans-serif}
  .wrap{max-width:760px;margin:0 auto;background:#fff;border:1px solid #e3e6ec;
        border-radius:14px;padding:32px 36px;box-shadow:0 2px 12px rgba(0,0,0,.05)}
  .note{background:#fff8e6;border:1px solid #f0d89a;color:#8a6a10;
        padding:12px 16px;border-radius:9px;font-size:13px;margin-bottom:22px;line-height:1.6}
  h1{font-size:23px;margin:0 0 14px} h2{font-size:18px;margin:22px 0 8px;color:#0f1f3d}
  h3{font-size:15px;margin:16px 0 6px} ul{padding-left:22px} strong{color:#000}
  p{margin:10px 0} table{border-collapse:collapse;margin:12px 0}
  td,th{border:1px solid #e3e6ec;padding:7px 10px;font-size:13px}
</style></head>
<body><div class="wrap">
<div class="note"><strong>Bu iş bir sayfa üretmedi.</strong> Aşağıda uzmanın metin çıktısı var.
Sayfa görmek için isteğe şunu ekle: <em>"çalışan tek dosya HTML olarak ver"</em>.</div>
<p>${body}</p>
</div></body></html>`;
}

/**
 * Ana fonksiyon.
 * Dönen: { html, kind: 'page'|'fallback'|null, truncated:boolean }
 */
function buildPreview(output) {
  if (!output || !output.trim()) return { html: null, kind: null, truncated: false };

  const truncated = (() => {
    const fenceCount = (output.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) return true;
    if (/<html[\s>]/i.test(output) && !/<\/html>/i.test(output)) return true;
    return false;
  })();

  const blocks = extractBlocks(output);
  const pick = (langs) => blocks.filter((b) => langs.includes(b.lang)).map((b) => b.code).join('\n');

  let html = pick(['html', 'htm']).trim();
  let css = pick(['css']).trim();
  let js = pick(['js', 'javascript']).trim();

  // kapanmamış fenced blok varsa kurtar
  if (!html) {
    const salv = salvageUnclosedFence(output);
    if (salv && (['html', 'htm'].includes(salv.lang) || /<html[\s>]|<!doctype/i.test(salv.code))) {
      html = salv.code.trim();
    }
  }

  // hiç kod bloğu yok ama çıktının kendisi HTML
  if (!html) {
    const m = output.match(/<!doctype\s+html[\s\S]*$/i) || output.match(/<html[\s>][\s\S]*$/i);
    if (m) html = m[0].trim();
    else if (/<(section|div|header|main)[\s>]/i.test(output) && /<style[\s>]/i.test(output)) {
      const sm = output.match(/<style[\s>][\s\S]*$/i);
      if (sm) html = output.slice(output.search(/<style[\s>]/i));
    }
  }

  // CSS bloğu ayrı verilmişse birleştir
  if (html && css && !/<style[\s>]/i.test(html)) {
    html = `<style>\n${css}\n</style>\n${html}`;
  }
  if (html && js && !/<script[\s>]/i.test(html)) {
    html = `${html}\n<script>\n${js}\n</script>`;
  }

  if (!html) {
    return { html: markdownFallback(output, 'Çıktı'), kind: 'fallback', truncated };
  }

  const isFullDoc = /<!doctype|<html[\s>]/i.test(html);

  let doc;
  if (isFullDoc) {
    doc = repairHtml(html);
  } else {
    doc = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Önizleme</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,"Segoe UI",Inter,system-ui,sans-serif;color:#1a1d23}
  img{max-width:100%}
  ${css}
</style>
</head>
<body>
${html}
</body>
</html>`;
    doc = repairHtml(doc);
  }

  return { html: truncated ? addTruncationBanner(doc) : doc, kind: 'page', truncated };
}

module.exports = { buildPreview, repairHtml, markdownFallback, addTruncationBanner };
