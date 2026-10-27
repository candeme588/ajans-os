const { chat, extractJson } = require('./llm');

/* Ekip listesini prompt'a sığacak şekilde kısalt */
function roster(agents) {
  return agents
    .map((a) => `- ${a.slug} | ${a.name} | ${a.description.slice(0, 180)}`)
    .join('\n');
}

function managerSystem(company, agents, attachments = []) {
  const attLine = attachments.length
    ? attachments.map((a) => `- ${a.name} (${a.kind === 'image' ? 'GÖRSEL' : 'dosya'})`).join('\n')
    : '(ek yok)';

  return `Sen tek kişilik bir şirketin MÜDÜRÜsün. İşin: gelen isteği doğru uzmana dağıtmak.

ŞİRKET: ${company.name}
AÇIKLAMA: ${company.desc || '-'}

ŞİRKET NOTLARI (uzmanlara aynen aktarılacak):
${(company.context || '(not yok)').slice(0, 6000)}

KULLANICININ EKTEKİ DOSYALARI:
${attLine}

EKİBİN (sadece bu slug'lardan seçebilirsin):
${roster(agents)}

KURALLAR:
1. En fazla 4 görev üret. Basit istekte 1 görev yeter; gereksiz bölme.
2. Görevler sıralı çalışacak. Sonraki görev öncekinin çıktısını görebilir; buna göre mantıklı sırala (önce analiz, sonra üretim).
3. Her görevin "talimat" alanı TEK BAŞINA anlaşılır olmalı. Uzman şirket notlarını görecek ama kullanıcının mesajını görmeyecek — talebi talimatta açıkça yaz.
4. Talimatta beklenen çıktıyı ve formatını belirt (tablo, mesaj metni, kontrol listesi gibi). Kopyala-yapıştır edilebilir olmasını iste.
5. EK DOSYA/GÖRSEL VARSA: talimatta "ekteki dosyayı/görseli incele" diye belirt. Görsel varsa, görseli analiz edebilen uzmanı seç (image-prompt-engineer, marka-kimlik, web-tasarim). İlk görev mutlaka görseli/dosyayı okuyan görev olsun.
6. WEB İŞİ KURALI: İstek bir web sitesi, sayfa, landing page, ürün sayfası veya tasarım önizlemesi içeriyorsa ilgili talimata mutlaka şunu ekle: "Çalışan, tek dosya HTML üret: CSS ve JS aynı dosyanın içinde <style> ve <script> etiketleriyle olsun, dış dosya/CDN kullanma. Çıktıyı sadece kod bloğu içinde ver. Gerçek ürün fotoğrafı yoksa https://picsum.photos/800/600 gibi yer tutucu görseller kullan."
7. Uzman seçimi: iş gerçekten hangi uzmanlığa giriyorsa onu seç. Bir uzman birden fazla işi yapabiliyorsa iki görev açma.
8. Türkçe yaz. Teknik jargon kullanma.

SADECE şu JSON'u döndür, başka hiçbir şey yazma:
{"ozet":"istegin tek cümlelik özeti","gorevler":[{"ajan":"slug","baslik":"kısa Türkçe başlık","talimat":"uzmana verilecek net talimat"}]}`;
}

/* LLM olmadan (veya hata olursa) anahtar kelimeyle eşleştirme */
function fallbackPlan(company, agents, request) {
  const norm = (s) => s.toLowerCase()
    .replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }[c]))
    .replace(/[^a-z0-9\s]/g, ' ');
  const tokens = new Set(norm(request).split(/\s+/).filter((w) => w.length > 3));

  const scored = agents.map((a) => {
    const hay = norm(`${a.slug} ${a.name} ${a.description} ${a.body.slice(0, 1500)}`);
    let score = 0;
    for (const t of tokens) if (hay.includes(t)) score += 1;
    if (norm(request).includes(norm(a.slug))) score += 5;
    return { agent: a, score };
  }).sort((x, y) => y.score - x.score);

  const top = scored[0]?.score > 0 ? scored.slice(0, 2) : scored.slice(0, 1);
  return {
    ozet: request.slice(0, 120),
    gorevler: top.map((s) => ({
      ajan: s.agent.slug,
      baslik: s.agent.name,
      talimat: request,
    })),
    _fallback: true,
  };
}

async function planTasks({ company, agents, request, provider, model, signal, attachments = [] }) {
  const messages = [
    { role: 'system', content: managerSystem(company, agents, attachments) },
    { role: 'user', content: `KULLANICI İSTEĞİ:\n${request}` },
  ];

  try {
    const raw = await chat({
      baseURL: provider.baseURL,
      apiKey: provider.apiKey,
      model,
      messages,
      maxTokens: 2000,
      temperature: 0.2,
      signal,
    });

    let plan = extractJson(raw);
    if (!plan || !Array.isArray(plan.gorevler) || !plan.gorevler.length) {
      const retry = await chat({
        baseURL: provider.baseURL,
        apiKey: provider.apiKey,
        model,
        messages: [
          ...messages,
          { role: 'assistant', content: raw || '' },
          { role: 'user', content: 'Yukarıdaki cevabın geçersiz. SADECE geçerli JSON döndür. Başka açıklama yazma.' },
        ],
        maxTokens: 2000,
        temperature: 0,
        signal,
      });
      plan = extractJson(retry);
    }

    if (!plan || !Array.isArray(plan.gorevler) || !plan.gorevler.length) {
      return fallbackPlan(company, agents, request);
    }

    // geçersiz ajan varsa temizle
    const validSlugs = new Set(agents.map((a) => a.slug));
    plan.gorevler = plan.gorevler
      .filter((g) => g && validSlugs.has(String(g.ajan)))
      .slice(0, 4)
      .map((g) => ({
        ajan: String(g.ajan),
        baslik: String(g.baslik || g.ajan).slice(0, 120),
        talimat: String(g.talimat || request),
      }));

    if (!plan.gorevler.length) return fallbackPlan(company, agents, request);
    return plan;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const fp = fallbackPlan(company, agents, request);
    fp._error = String(e.message || e);
    return fp;
  }
}

/* Uzman çağrısı için sistem promptu */
function agentSystem(agent, company, task, previous) {
  const prevText = previous.length
    ? previous.map((p) => `--- ${p.baslik} (${p.ajan}) ---\n${p.output.slice(0, 4000)}`).join('\n\n')
    : '(önceki görev yok)';

  return `${agent.body}

---

## BAĞLAM: ${company.name}
${company.desc || ''}

${(company.context || '').slice(0, 5000)}

## ÖNCEKİ ADIMLARIN ÇIKTILARI
${prevText}

## ÇALIŞMA KURALLARI
- Türkçe cevap ver.
- Çıktıyı doğrudan kullanılabilecek (kopyala-yapıştır) biçimde ver.
- Gereksiz giriş cümlesi yazma ("Elbette", "İşte" gibi). Doğrudan işe gir.
- Bilmediğin veriyi uydurma; "bu bilgi doğrulanmalı" diye belirt.
- Parasal konularda KDV, komisyon ve reklam bütçesini ayrı satırlarda göster.

## WEB / TASARIM ÇIKTISI (çok önemli)
Kullanıcı bir site, sayfa, landing page veya tasarım istiyorsa **çalışan tek dosya HTML** üret:
- Tüm CSS aynı dosyada \`<style>\` içinde, JS \`<script>\` içinde. Dış dosya, CDN veya derleme aracı kullanma.
- Çıktıyı tek bir \`\`\`html kod bloğu içinde ver. Kod bloğunun dışına HTML yazma.
- Mobil uyumlu olsun (meta viewport + basit media query).
- Gerçek görsel yoksa \`https://picsum.photos/800/600\` gibi yer tutucu kullan; kırık link bırakma.
- Sayfa gerçekten çalışsın: butonlar, menü, form görünür ve tıklanabilir olsun.
- HTML'den önce en fazla 5 satır kısa açıklama yaz (ne yaptın, hangi bölümler var), sonra kod bloğu gelsin.
- HTML'den sonra istersen 3-5 maddelik "nasıl geliştirilir" notu ekle.

Bu kural olmadan üretilen çıktı önizlenemez; kullanıcı sonucu göremez.`;
}

module.exports = { planTasks, fallbackPlan, agentSystem };
