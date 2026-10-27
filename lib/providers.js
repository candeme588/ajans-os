const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const STATUS_FILE = path.join(DATA, 'model-status.json');
const EXTRA_FILE = path.join(DATA, 'providers.json');
const OPCODE_CFG = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

/* ---------------------------------------------------------------
   MODEL HAVUZU
   Sağlayıcılar opencode.json'dan otomatik okunur (OpenAI uyumlu).
   Ek sağlayıcı için data/providers.json kullanılabilir:
   { "providers": { "openrouter": { "name": "...", "baseURL": "...", "apiKey": "..." } } }
---------------------------------------------------------------- */

/* bilinen modellerin gerçek yetenekleri (elle tanımlı — en doğru bilgi) */
const KNOWN = {
  'evren/glm-5.3': { tier: 'leader', power: 88, vision: false, speed: 55, maxOut: 16000, note: 'güçlü akıl yürütme' },
  'evren/deepseek-v4-flash': { tier: 'fast', power: 72, vision: false, speed: 92, maxOut: 16000, note: 'hızlı genel amaç' },
  'evren/deepseek-v4.1-flash': { tier: 'balanced', power: 82, vision: true, speed: 78, maxOut: 65000, note: 'görsel + uzun çıktı' },
  'evren/mimo-v2.6-pro': { tier: 'vision', power: 76, vision: true, speed: 68, maxOut: 16000, note: 'görsel' },
  'evren/qwen3-vl-30b': { tier: 'vision', power: 70, vision: true, speed: 74, maxOut: 16000, note: 'görsel' },
  'evren/gemma-4-31b': { tier: 'vision', power: 68, vision: true, speed: 80, maxOut: 16000, note: 'görsel, hafif' },

  'nvidia/nemotron-3-ultra-550b-a55b': { tier: 'leader', power: 95, vision: false, speed: 42, maxOut: 16000, note: 'en güçlü reasoning (550B)' },
  'nvidia/nemotron-3.5-super-vl-120b-a12b': { tier: 'leader', power: 90, vision: true, speed: 60, maxOut: 16000, note: 'güçlü + görsel (120B VL)' },
  'nvidia/nemotron-3.5-lightning-30b-a3b': { tier: 'fast', power: 74, vision: false, speed: 95, maxOut: 16000, note: 'en hızlı (30B lightning)' },
  'meta/llama-3.2-11b-vision-instruct': { tier: 'vision', power: 62, vision: true, speed: 88, maxOut: 8000, note: 'hafif görsel' },
  'meta/llama-3.2-90b-vision-instruct': { tier: 'vision', power: 80, vision: true, speed: 50, maxOut: 8000, note: 'görsel 90B' },
  'z-ai/glm-5.3': { tier: 'leader', power: 86, vision: false, speed: 55, maxOut: 16000, note: 'güçlü' },
  'z-ai/glm-5.3-flash': { tier: 'fast', power: 70, vision: false, speed: 90, maxOut: 16000, note: 'hızlı' },
};

function loadExtra() {
  try { return JSON.parse(fs.readFileSync(EXTRA_FILE, 'utf8')).providers || {}; }
  catch { return {}; }
}

function loadProviders() {
  const out = {};
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(OPCODE_CFG, 'utf8')); } catch {}

  for (const [id, p] of Object.entries(cfg.providers || {})) {
    const s = p.settings || p.options || {};
    const baseURL = s.baseURL || p.options?.baseURL;
    const apiKey = s.apiKey || p.options?.apiKey || process.env[`${id.toUpperCase()}_API_KEY`];
    if (!baseURL || !apiKey) continue;
    out[id] = {
      id,
      name: p.name || id,
      baseURL,
      apiKey,
      models: Object.entries(p.models || {}).map(([mid, mv]) => ({
        model: mid,
        label: mv?.name || mid,
      })),
    };
  }

  for (const [id, p] of Object.entries(loadExtra())) {
    const existing = out[id];
    const extraModels = (p.models || []).map((m) => (typeof m === 'string' ? { model: m, label: m } : m));

    if (existing) {
      // aynı sağlayıcı: mevcut modelleri koru, yenileri ekle (tekrar etmeyen)
      const have = new Set(existing.models.map((m) => m.model));
      for (const m of extraModels) if (!have.has(m.model)) existing.models.push(m);
      if (p.apiKey) existing.apiKey = p.apiKey;
      if (p.name) existing.name = p.name;
    } else {
      out[id] = {
        id,
        name: p.name || id,
        baseURL: p.baseURL,
        apiKey: p.apiKey || process.env[`${id.toUpperCase()}_API_KEY`] || '',
        models: extraModels,
      };
    }
  }

  return out;
}

/* model boyutundan güç tahmini (bilinmeyen modeller için) */
function powerFromId(model) {
  let power = 60;
  const size = model.match(/(\d{2,4})\s*b\b/i);
  if (size) {
    const b = Number(size[1]);
    if (b >= 400) power = 95;
    else if (b >= 200) power = 88;
    else if (b >= 100) power = 82;
    else if (b >= 60) power = 74;
    else if (b >= 25) power = 66;
    else power = 58;
  }
  if (/ultra/i.test(model)) power = Math.max(power, 92);
  if (/flash|lightning|nano|mini|small|lite|air|turbo|8b/i.test(model)) power -= 8;
  return Math.max(40, Math.min(96, power));
}

function speedFromId(model) {
  if (/lightning|nano|mini|small|lite|turbo|flash/i.test(model)) return 92;
  if (/ultra|550b|340b|253b/i.test(model)) return 42;
  return 70;
}

function isVision(id, label) {
  if (KNOWN[id]?.vision) return true;
  if (/vl[-_/]|vision|vila|llava|nemotron-3\.5-super-vl/i.test(id)) return true;
  if (/görsel/i.test(label || '')) return true;
  return false;
}

/* tüm modelleri tek listede topla */
function catalog() {
  const providers = loadProviders();
  const status = loadStatus();
  const list = [];

  for (const p of Object.values(providers)) {
    for (const m of p.models) {
      const id = `${p.id}::${m.model}`;
      const known = KNOWN[id] || KNOWN[m.model] || KNOWN[`${p.id}/${m.model}`] || null;
      const st = status[id] || {};
      list.push({
        id,
        provider: p.id,
        providerName: p.name,
        model: m.model,
        label: m.label,
        vision: known?.vision ?? isVision(id, m.label),
        power: known?.power ?? powerFromId(m.model),
        speed: known?.speed ?? speedFromId(m.model),
        maxOut: known?.maxOut ?? 16000,
        note: known?.note || '',
        tier: known?.tier || 'balanced',
        ok: st.ok !== false,
        ms: st.ms || null,
      });
    }
  }
  return { providers, models: list };
}

/* ---------------- sağlık durumu önbelleği ---------------- */
function loadStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); }
  catch { return {}; }
}

function saveStatus(s) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2), 'utf8');
  } catch {}
}

module.exports = { loadProviders, catalog, loadStatus, saveStatus, KNOWN, STATUS_FILE };
