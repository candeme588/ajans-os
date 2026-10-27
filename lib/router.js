const { catalog, loadStatus, saveStatus } = require('./providers');

/* ---------------------------------------------------------------
   YÖNLENDİRİCİ
   Müdür (lider) = en güçlü model, tek ve sabit.
   Uzmanlar        = işin tipine göre en uygun (hızlı / görsel / uzun çıktı).
---------------------------------------------------------------- */

function usable(models, opts = {}) {
  return models.filter((m) => {
    if (m.ok === false) return false;
    if (opts.needsVision && !m.vision) return false;
    if (opts.needsLongOutput && m.maxOut < 20000) return false;
    return true;
  });
}

/* güç ağırlıklı skor */
const scoreLeader = (m) => m.power * 1.0 + m.speed * 0.1 + (m.vision ? 2 : 0);
const scoreFast = (m) => m.speed * 1.0 + m.power * 0.35;
const scoreBalanced = (m) => m.power * 1.0 + m.speed * 0.2;
const scoreVision = (m) => (m.vision ? 40 : 0) + m.power * 0.7 + m.speed * 0.2;

function pickBest(models) {
  const sorted = models.filter((m) => m.ok !== false).sort((a, b) => scoreLeader(b) - scoreLeader(a));
  return sorted[0] || null;
}

/**
 * Lider (müdür) modeli: havuzun en güçlüsü.
 * Görsel şart değilse en güçlü text modelini, görsel gerekiyorsa en güçlü vision modelini seçer.
 */
function pickLeader(models, { needsVision = false } = {}) {
  const pool = needsVision
    ? usable(models, { needsVision: true })
    : usable(models, {});
  return pickBest(pool) || pickBest(models);
}

/**
 * Uzman modeli: işin tipine göre.
 *   needsVision  -> görsel görebilen en dengeli model
 *   longOutput   -> uzun çıktı kapasitesi yüksek model
 *   heavy        -> karmaşık iş, güçlü model
 *   aksi         -> en hızlı model
 */
function pickWorker(models, { needsVision = false, longOutput = false, heavy = false, leaderId = null } = {}) {
  let pool = usable(models, { needsVision, needsLongOutput: longOutput });
  if (!pool.length) pool = usable(models, {}) ;
  if (!pool.length) pool = models;

  // lider ile aynı modeli her görevde kullanmak maliyeti/süreyi artırır; tek adım varsa kabul
  const sorted = [...pool].sort((a, b) => {
    if (needsVision) return scoreVision(b) - scoreVision(a);
    if (heavy) return scoreBalanced(b) - scoreBalanced(a);
    return scoreFast(b) - scoreFast(a);
  });

  const best = sorted[0];
  if (!best) return null;

  // lider'den farklı ve hızlı bir seçenek varsa onu tercih et (paralel iş yükü)
  if (!heavy && !needsVision && leaderId) {
    const alt = sorted.find((m) => m.id !== leaderId);
    if (alt) return alt;
  }
  return best;
}

/* iş tipini tahmin et */
function taskProfile(text) {
  const t = String(text || '').toLowerCase();
  // gerçek web/kod işi
  const web = /(web ?sitesi|landing|html|css|javascript|kodla|kod yaz|tek dosya|sayfa yap|site yap|arayüz|şablon|wordpress)/.test(t);
  const heavy = /(strateji|plan|analiz|rapor|bütçe|teklif|hesap|denetim|audit|araştır|karşılaştır)/.test(t);
  const creative = /(metn|başlık|slogan|içerik|gönderi|caption|hook|reklam metni|brief|senaryo)/.test(t);
  return { web, heavy, creative, complex: web || heavy };
}

/* ---------------- sağlık kontrolü ---------------- */
async function probeOne(p, m, timeoutMs) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(p.baseURL.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({
        model: m.model,
        messages: [{ role: 'user', content: 'Merhaba, tek kelimeyle cevap ver: evet' }],
        max_tokens: 64,
        temperature: 0,
      }),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    return { ok: res.ok, ms: Date.now() - t0, status: res.status };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, ms: Date.now() - t0, error: e.name || 'hata' };
  }
}

async function probeAll({ timeoutMs = 20000, retry = true } = {}) {
  const { providers, models } = catalog();
  const status = loadStatus();
  const results = {};

  const jobs = models.map(async (m) => {
    const p = providers[m.provider];
    if (!p) return;

    let r = await probeOne(p, m, timeoutMs);
    // geçici hatayı kalıcı sayma: bir kez daha dene
    if (!r.ok && retry) {
      r = await probeOne(p, m, timeoutMs);
    }
    results[m.id] = { ...r, at: new Date().toISOString() };
  });

  await Promise.all(jobs);
  Object.assign(status, results);
  saveStatus(status);

  const okCount = Object.values(results).filter((r) => r.ok).length;
  return { results, okCount, total: Object.keys(results).length };
}

/* kısa özet (arayüz için) */
function summary() {
  const { models } = catalog();
  const ok = models.filter((m) => m.ok !== false);
  const leader = pickLeader(models);
  const fast = pickWorker(models, {});
  const vision = pickWorker(models, { needsVision: true });
  return {
    total: models.length,
    working: ok.length,
    leader: leader ? { id: leader.id, label: leader.label, power: leader.power } : null,
    fast: fast ? { id: fast.id, label: fast.label, ms: fast.ms } : null,
    vision: vision ? { id: vision.id, label: vision.label } : null,
  };
}

/* ajan bildirimi varsa onu uygula (frontmatter: model: vision|leader|fast|long) */
function pickForAgent(pool, agent, leaderId, ctx = {}) {
  const pref = (agent?.modelPref || '').toLowerCase();

  if (!pref) return null; // otomatik karar sunucuda

  if (pref === 'vision') {
    return pickWorker(pool, { needsVision: true });
  }
  if (pref === 'leader') {
    // en güçlü: liderin kendisi
    return pickLeader(pool);
  }
  if (pref === 'fast' || pref === 'hizli') {
    return pickWorker(pool, { leaderId });
  }
  if (pref === 'long' || pref === 'uzun') {
    return pickWorker(pool, { longOutput: true });
  }
  if (pref === 'balanced' || pref === 'dengeli') {
    return pickWorker(pool, { heavy: true });
  }

  // tam model id'si verilmişse
  if (pref.includes('::') || pref.includes('/')) {
    return pool.find((m) => m.id === pref || m.id.endsWith(pref) || m.model === pref) || null;
  }
  return null;
}

module.exports = { pickLeader, pickWorker, pickForAgent, taskProfile, probeAll, summary, usable, scoreLeader };
