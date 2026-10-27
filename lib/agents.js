const fs = require('fs');
const path = require('path');
const os = require('os');

const AGENT_DIRS = [
  // proje içindeki agents/ klasörü (sunucu kurulumu için)
  path.join(__dirname, '..', 'agents'),
  path.join(os.homedir(), '.config', 'opencode', 'agents'),
  path.join(os.homedir(), '.opencode', 'agents'),
];

let cache = { at: 0, list: [] };

function expand(p) {
  if (!p) return p;
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

function parseFrontmatter(text) {
  const out = { data: {}, body: text };
  if (!text.startsWith('---')) return out;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return out;
  const raw = text.slice(3, end);
  out.body = text.slice(end + 4).replace(/^\s*\n/, '');

  let key = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) {
      key = m[1];
      let val = m[2].trim();
      val = val.replace(/^['"]|['"]$/g, '');
      out.data[key] = val;
    } else if (/^\s+\S/.test(line) && key) {
      // devam satırı (çok satırlı description)
      out.data[key] = (out.data[key] ? out.data[key] + ' ' : '') + line.trim();
    }
  }
  return out;
}

function readAgent(file, dir) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const { data, body } = parseFrontmatter(text);
    const slug = path.basename(file, '.md');
    return {
      slug,
      name: (data.name || slug).replace(/^['"]|['"]$/g, ''),
      description: (data.description || '').replace(/\s+/g, ' ').trim(),
      mode: data.mode || 'subagent',
      color: data.color || null,
      modelPref: (data.model || '').replace(/^['"]|['"]$/g, '') || null,
      dir,
      file,
      body,
    };
  } catch {
    return null;
  }
}

function loadAgents(force = false) {
  if (!force && Date.now() - cache.at < 5000) return cache.list;
  const seen = new Map();
  for (const dir of AGENT_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const full = path.join(dir, f);
      const a = readAgent(full, dir);
      if (a && !seen.has(a.slug)) seen.set(a.slug, a);
    }
  }
  const list = [...seen.values()].sort((a, b) => a.slug.localeCompare(b.slug, 'tr'));
  cache = { at: Date.now(), list };
  return list;
}

function getAgent(slug) {
  return loadAgents().find((a) => a.slug === slug) || null;
}

module.exports = { loadAgents, getAgent, expand, AGENT_DIRS };
