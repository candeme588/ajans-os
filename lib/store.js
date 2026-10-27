const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const COMPANIES = path.join(DATA, 'companies');
const RUNS = path.join(ROOT, 'runs');
const OPCODE_CFG = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

for (const d of [DATA, COMPANIES, RUNS]) fs.mkdirSync(d, { recursive: true });

function expand(p) {
  if (!p) return p;
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

/* ---------- Sağlayıcı ayarı (opencode.json'dan okunur) ---------- */
function loadProvider() {
  const fallback = {
    baseURL: 'https://evren-llmapi.ssyz.org.tr/v1',
    apiKey: process.env.EVREN_API_KEY || '',
    models: ['deepseek-v4-flash', 'glm-5.3'],
    defaultModel: 'deepseek-v4-flash',
  };
  try {
    const cfg = JSON.parse(fs.readFileSync(OPCODE_CFG, 'utf8'));
    const prov = cfg.providers?.evren;
    if (!prov) return fallback;
    const s = prov.settings || {};
    const models = Object.keys(prov.models || {});
    return {
      baseURL: s.baseURL || fallback.baseURL,
      apiKey: s.apiKey || process.env.EVREN_API_KEY || '',
      models: models.length ? models : fallback.models,
      defaultModel: models.includes('deepseek-v4-flash') ? 'deepseek-v4-flash' : models[0],
      labels: Object.fromEntries(
        Object.entries(prov.models || {}).map(([k, v]) => [k, v.name || k])
      ),
    };
  } catch {
    return fallback;
  }
}

/* ---------- Şirketler ---------- */
function companyFile(id) {
  return path.join(COMPANIES, `${id}.json`);
}

function listCompanies() {
  const files = fs.readdirSync(COMPANIES).filter((f) => f.endsWith('.json'));
  const list = files.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(COMPANIES, f), 'utf8'));
    } catch {
      return null;
    }
  }).filter(Boolean);
  return list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

function getCompany(id) {
  const f = companyFile(id);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function saveCompany(c) {
  if (!c.id) throw new Error('id zorunlu');
  fs.writeFileSync(companyFile(c.id), JSON.stringify(c, null, 2), 'utf8');
  return c;
}

function deleteCompany(id) {
  const f = companyFile(id);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

/* ---------- İlk açılışta iki hazır şirket ---------- */
function seed() {
  if (fs.existsSync(companyFile('jenovin'))) return;

  const readIf = (p) => {
    try { return fs.readFileSync(expand(p), 'utf8'); } catch { return ''; }
  };

  saveCompany({
    id: 'jenovin',
    name: 'Jenovin',
    emoji: '🧴',
    desc: 'Karavan ve tekne tuvalet kimyasalı (1L / 3L). Hepsiburada, N11/Pazarama/Çiçekse ve kendi site (İdeasoft). Günlük sipariş 20 altı, kargo MNG/PTT, muhasebe BizimHesap.',
    context: readIf('~/.config/opencode/JENOVIN.md'),
    agents: ['jenovin', 'operasyon', 'finans', 'icerik-seo', 'sosyal-medya', 'pazar-analiz', 'seo-audit', 'yorum-cevap', 'analytics-rapor', 'kreatif-metin', 'web-denetim'],
    createdAt: new Date().toISOString(),
  });

  saveCompany({
    id: 'reklam-ajansi',
    name: 'Reklam Ajansı',
    emoji: '📣',
    desc: 'Tek kişilik dijital pazarlama ajansı. Meta / Google / TikTok reklamları, SEO-GEO, sosyal medya yönetimi, ölçüm-raporlama ve web tasarım hizmeti verir. Dış müşterilerle çalışır.',
    context: readIf('~/OneDrive/Masaüstü/reklam-ajansi/AJANS.md'),
    agents: ['strateji', 'meta-reklam', 'google-reklam', 'tiktok-reklam', 'seo-geo', 'sosyal-yonetim', 'analytics-rapor', 'kreatif-metin', 'musteri-kazanma', 'musteri-yonetimi', 'web-tasarim', 'web-gelistirme', 'web-denetim', 'marka-kimlik', 'pricing-analyst', 'legal-compliance-checker', 'research-synthesist', 'growth-hacker'],
    createdAt: new Date(Date.now() + 1).toISOString(),
  });
}

/* ---------- Çalıştırmalar (runs) ---------- */
function newRunId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function saveRun(run) {
  const dir = path.join(RUNS, run.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run, null, 2), 'utf8');

  // okunabilir markdown çıktısı
  const lines = [
    `# ${run.companyName} — ${run.request.slice(0, 80)}`,
    ``,
    `**Tarih:** ${run.createdAt}`,
    `**Model:** ${run.model}`,
    ``,
    `## Müdür özeti`,
    run.plan?.ozet || '-',
    ``,
  ];
  for (const t of run.tasks) {
    lines.push(`---`, ``, `## ${t.baslik}`, `*Ajan: ${t.ajan}*`, ``, t.output || '*(çıktı yok)*', ``);
  }
  fs.writeFileSync(path.join(dir, 'rapor.md'), lines.join('\n'), 'utf8');
  return dir;
}

function listRuns() {
  return fs.readdirSync(RUNS)
    .filter((d) => fs.existsSync(path.join(RUNS, d, 'run.json')))
    .map((d) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(RUNS, d, 'run.json'), 'utf8'));
        return {
          id: r.id,
          request: r.request,
          companyName: r.companyName,
          createdAt: r.createdAt,
          taskCount: r.tasks?.length || 0,
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.id.localeCompare(a.id))
    .slice(0, 50);
}

function getRun(id) {
  const f = path.join(RUNS, id, 'run.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

module.exports = {
  ROOT, RUNS, DATA,
  expand,
  loadProvider,
  listCompanies, getCompany, saveCompany, deleteCompany, seed,
  newRunId, saveRun, listRuns, getRun,
};
