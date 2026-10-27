/* ============ durum ============ */
const S = {
  companies: [],
  agents: [],
  models: [],
  routing: {},
  activeId: null,
  editing: null,
  running: false,
  controller: null,
  tasks: [],
  picked: new Set(),
  attachments: [],
  currentRunId: null,
  previewUrl: null,
};

const $ = (id) => document.getElementById(id);

/* ============ yardımcılar ============ */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function hue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}
function avatar(slug) {
  const initials = slug.split('-').slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
  const h = hue(slug);
  return `<div class="avatar" style="background:hsl(${h} 55% 42%)">${esc(initials)}</div>`;
}

/* küçük markdown okuyucu */
function md(src) {
  const lines = String(src).replace(/\r/g, '').split('\n');
  let out = '';
  let i = 0;
  let listOpen = null;

  const inline = (t) => {
    let s = esc(t);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  };
  const closeList = () => { if (listOpen) { out += `</${listOpen}>`; listOpen = null; } };

  while (i < lines.length) {
    const line = lines[i];

    // kod bloğu
    if (/^```/.test(line)) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out += `<pre class="code">${esc(buf.join('\n'))}</pre>`;
      continue;
    }

    // tablo
    if (/\|/.test(line) && lines[i + 1] && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      closeList();
      const cells = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { rows.push(cells(lines[i])); i++; }
      out += '<table><thead><tr>' + head.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>';
      for (const r of rows) out += '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
      out += '</tbody></table>';
      continue;
    }

    // başlık
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); out += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; i++; continue; }

    // yatay çizgi
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeList(); out += '<hr />'; i++; continue; }

    // alıntı
    if (/^>\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out += `<blockquote>${inline(buf.join(' '))}</blockquote>`;
      continue;
    }

    // listeler
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const type = ul ? 'ul' : 'ol';
      if (listOpen !== type) { closeList(); out += `<${type}>`; listOpen = type; }
      out += `<li>${inline((ul || ol)[1])}</li>`;
      i++;
      continue;
    }

    if (!line.trim()) { closeList(); i++; continue; }

    closeList();
    out += `<p>${inline(line)}</p>`;
    i++;
  }
  closeList();
  return out;
}

/* ============ yükleme ============ */
async function boot() {
  const [b, a] = await Promise.all([
    fetch('/api/bootstrap').then((r) => r.json()),
    fetch('/api/agents').then((r) => r.json()),
  ]);
  S.companies = b.companies || [];
  S.agents = a.agents || [];
  S.models = b.models || [];
  S.routing = b.routing || {};

  $('agentCount').textContent = `${S.agents.length} uzman`;
  renderModelSelect();
  renderLeaderPill();

  if (!S.companies.length) {
    $('companySelect').innerHTML = '<option>şirket yok</option>';
    return;
  }

  S.activeId = S.companies[0].id;
  $('companySelect').innerHTML = S.companies
    .map((c) => `<option value="${esc(c.id)}">${esc(c.emoji || '🏢')} ${esc(c.name)}</option>`)
    .join('');

  renderCompany();
  renderRuns();
}

function activeCompany() {
  return S.companies.find((c) => c.id === S.activeId) || null;
}

/* ---------------- model seçici ---------------- */
function renderModelSelect() {
  const sel = $('modelSelect');
  const auto = S.routing?.leader;
  sel.innerHTML =
    `<option value="auto" selected>🧠 Otomatik — müdür seçer</option>` +
    groupOptions();
}

function groupOptions() {
  const byProv = {};
  for (const m of S.models) {
    if (m.ok === false) continue;
    (byProv[m.provider] = byProv[m.provider] || []).push(m);
  }
  return Object.entries(byProv)
    .map(([prov, list]) => {
      const opts = list
        .sort((a, b) => b.power - a.power)
        .map((m) => {
          const marks = [];
          if (m.vision) marks.push('👁');
          marks.push(`güç ${m.power}`);
          if (m.ms) marks.push(`${m.ms}ms`);
          return `<option value="${esc(m.id)}">${esc(m.label)} — ${marks.join(' · ')}</option>`;
        })
        .join('');
      return `<optgroup label="${esc(prov)}">${opts}</optgroup>`;
    })
    .join('');
}

function renderLeaderPill() {
  const r = S.routing || {};
  const el = $('leaderPill');
  if (r.leader) {
    el.textContent = `müdür: ${r.leader.label}`;
    el.title = `Lider model (en güçlü): ${r.leader.id}\nGüç: ${r.leader.power}\n\nOtomatik modda müdür bunu kullanır; uzmanlar işe göre seçilir.`;
  } else {
    el.textContent = 'model yok';
  }
}

async function probeModels() {
  const btn = $('probeBtn');
  btn.disabled = true;
  btn.textContent = 'test ediliyor…';
  try {
    const r = await fetch('/api/models/probe', { method: 'POST' }).then((x) => x.json());
    const b = await fetch('/api/bootstrap').then((x) => x.json());
    S.models = b.models || [];
    S.routing = b.routing || {};
    renderModelSelect();
    renderLeaderPill();
    btn.textContent = `${r.okCount}/${r.total} çalışıyor`;
    setTimeout(() => (btn.textContent = 'Modelleri test et'), 3000);
  } catch (e) {
    btn.textContent = 'hata';
    setTimeout(() => (btn.textContent = 'Modelleri test et'), 2500);
  }
  btn.disabled = false;
}

function renderCompany() {
  const c = activeCompany();
  if (!c) return;
  $('companyEmoji').textContent = c.emoji || '🏢';
  $('companyName').textContent = c.name;
  $('companyDesc').textContent = c.desc || '—';
  renderTeam();
}

function teamAgents() {
  const c = activeCompany();
  if (!c) return [];
  const set = new Set(c.agents || []);
  const list = S.agents.filter((a) => set.has(a.slug));
  return list.length ? list : S.agents;
}

function renderTeam() {
  const q = ($('teamSearch').value || '').toLowerCase();
  const list = teamAgents().filter(
    (a) => !q || a.slug.includes(q) || (a.name || '').toLowerCase().includes(q)
  );
  $('teamList').innerHTML = list
    .map(
      (a) => `<div class="team-item" title="${esc(a.description || '')}">
        ${avatar(a.slug)}
        <div>
          <div class="team-name">${esc(a.name)}</div>
          <div class="team-slug">${esc(a.slug)}</div>
        </div>
      </div>`
    )
    .join('');
}

async function renderRuns() {
  const { runs } = await fetch('/api/runs').then((r) => r.json());
  $('runList').innerHTML = runs.length
    ? runs
        .map(
          (r) => `<div class="run-item" data-id="${esc(r.id)}">
            <div class="rt">${esc(r.request)}</div>
            <div class="rm">${esc(r.companyName)} · ${r.taskCount} görev · ${esc(r.id.slice(4, 6) + '.' + r.id.slice(6, 8) + ' ' + r.id.slice(9, 11) + ':' + r.id.slice(11, 13))}</div>
          </div>`
        )
        .join('')
    : '<div style="font-size:11.5px;color:var(--dim);padding:4px 9px">henüz kayıt yok</div>';

  $('runList').querySelectorAll('.run-item').forEach((el) =>
    el.addEventListener('click', () => loadRun(el.dataset.id))
  );
}

async function loadRun(id) {
  const run = await fetch(`/api/runs/${id}`).then((r) => r.json());
  if (!run || run.error) return;
  clearOutput();
  S.currentRunId = run.id;
  if (run.plan) renderPlan(run.plan);
  for (const t of run.tasks || []) {
    addTaskCard({ agent: t.ajan, agentName: t.ajan, baslik: t.baslik }, false);
    finishTask(S.tasks.length - 1, t.output, t.error, { truncated: t.truncated });
  }
  if (run.request) $('request').value = run.request;
}

function clearOutput() {
  $('output').innerHTML = '';
  S.tasks = [];
  S.currentRunId = null;
  S.previewUrl = null;
}

function renderPlan(plan) {
  const tasks = plan.gorevler || [];
  const badge = plan.fallback ? 'yedek plan' : 'müdür planı';
  const div = document.createElement('div');
  div.className = 'plan-card';
  div.innerHTML = `
    <div class="plan-head">
      <span class="plan-badge">${badge}</span>
      <span style="font-size:11.5px;color:var(--dim)">${tasks.length} görev</span>
    </div>
    <div class="plan-summary">${esc(plan.ozet || '')}</div>
    <div class="plan-tasks">
      ${tasks
        .map(
          (t, i) => `<div class="plan-task">
            <span class="num">${i + 1}</span>
            <div><span class="pa">${esc(t.ajan)}</span> — ${esc(t.baslik)}</div>
          </div>`
        )
        .join('')}
    </div>`;
  $('output').appendChild(div);

  if (plan.fallback && plan.error) {
    const n = document.createElement('div');
    n.className = 'notice warn';
    n.textContent = `Müdür planı üretilemedi, anahtar kelimeyle eşleştirme yapıldı. Sebep: ${plan.error.slice(0, 200)}`;
    $('output').appendChild(n);
  }
}

function addTaskCard(task, running = true) {
  const i = S.tasks.length;
  S.tasks.push({ ...task, output: '', el: null });

  const card = document.createElement('div');
  card.className = 'task-card' + (running ? ' running' : '');
  card.innerHTML = `
    <div class="task-head">
      ${avatar(task.agent)}
      <div>
        <div class="task-title">${esc(task.baslik)}</div>
        <div class="task-agent">${esc(task.agentName || task.agent)}</div>
      </div>
      ${task.modelLabel ? `<span class="model-badge" title="${esc(task.model || '')}">${esc(task.modelLabel)}</span>` : ''}
      <div class="task-status"><span class="dot ${running ? 'run' : 'ok'}"></span><span class="st">${running ? 'çalışıyor' : 'bitti'}</span></div>
      <div class="task-tools">
        <button class="tool copy">kopyala</button>
        <button class="tool dl">.md</button>
      </div>
    </div>
    <div class="task-body md"><span class="caret"></span></div>`;

  const body = card.querySelector('.task-body');
  card.querySelector('.copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(S.tasks[i].output || '');
    const b = card.querySelector('.copy');
    b.textContent = 'kopyalandı';
    setTimeout(() => (b.textContent = 'kopyala'), 1200);
  });
  card.querySelector('.dl').addEventListener('click', () => {
    const blob = new Blob([S.tasks[i].output || ''], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${task.agent}-${task.baslik.replace(/[^\w\sğüşıöçĞÜŞİÖÇ-]/g, '').trim().replace(/\s+/g, '-')}.md`;
    a.click();
  });

  const empty = $('output').querySelector('.empty');
  if (empty) empty.remove();
  $('output').appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return i;
}

function appendDelta(i, text) {
  const t = S.tasks[i];
  if (!t) return;
  t.output += text;
  const card = $('output').querySelectorAll('.task-card')[i];
  if (!card) return;
  const body = card.querySelector('.task-body');
  body.innerHTML = md(t.output) + '<span class="caret"></span>';
}

function finishTask(i, output, error, meta = {}) {
  const t = S.tasks[i];
  if (!t) return;
  const card = $('output').querySelectorAll('.task-card')[i];
  if (!card) return;
  card.classList.remove('running');
  if (error) card.classList.add('error');
  const dot = card.querySelector('.dot');
  dot.className = 'dot ' + (error ? 'err' : 'ok');
  card.querySelector('.st').textContent = error ? 'hata' : 'bitti';
  const body = card.querySelector('.task-body');
  if (output) t.output = output;

  const truncated = Boolean(meta.truncated || meta.repaired);
  t.truncated = truncated;

  const isPage = !error && (meta.previewKind === 'page' || hasHtml(t.output));

  if (error) {
    body.innerHTML = `<div class="notice err" style="margin:0">${esc(error)}</div>`;
  } else if (isPage) {
    // sayfa üretildi: ham HTML gösterme, önizlemeye yönlendir
    const chars = (t.output || '').length;
    body.innerHTML =
      `<div class="notice" style="margin:0;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:20px">🖥️</span>
        <span style="flex:1;min-width:180px">Bu görev bir <strong>sayfa/sunum</strong> üretti.
        Kartta ham kod göstermiyoruz — <strong>▶ Önizle</strong> ile gerçek halini gör.</span>
        <button class="btn primary small pv-inline">▶ Önizle</button>
      </div>` +
      (truncated
        ? `<div class="notice warn" style="margin:10px 0 0">⚠️ Çıktı yarıda kesildi. Önizleme onarıldı ama sayfa eksik olabilir.</div>`
        : '') +
      `<details style="margin-top:10px">
        <summary style="cursor:pointer;font-size:11.5px;color:var(--dim)">ham kodu gör (${chars.toLocaleString('tr-TR')} karakter)</summary>
        <pre class="code" style="max-height:300px;overflow:auto;margin-top:8px">${esc(t.output)}</pre>
      </details>`;

    body.querySelector('.pv-inline')?.addEventListener('click', () => openPreview(S.tasks[i]));
  } else {
    body.innerHTML =
      (truncated
        ? `<div class="notice warn">⚠️ Çıktı yarıda kesildi (uzunluk sınırı). İsteği "daha kısa tut" diye tekrar çalıştır.</div>`
        : '') + md(t.output);
  }

  // önizleme butonu
  if (isPage) {
    t.hasPreview = true;
    if (!card.querySelector('.preview-btn')) {
      const btn = document.createElement('button');
      btn.className = 'tool preview-btn';
      btn.style.color = 'var(--ok)';
      btn.style.fontWeight = '600';
      btn.textContent = '▶ Önizle';
      btn.addEventListener('click', () => openPreview(S.tasks[i]));
      card.querySelector('.task-tools').prepend(btn);

      const badge = document.createElement('span');
      badge.className = 'badge-preview';
      badge.textContent = 'önizlenebilir';
      badge.style.marginLeft = '4px';
      card.querySelector('.task-status').before(badge);
    }
  }
}

/* çıktıda gösterilebilir HTML var mı */
function hasHtml(text) {
  if (!text) return false;
  if (/```(html|htm)\b/i.test(text)) return true;
  if (/```(css)\b/i.test(text) && /<(html|body|section|div)\b/i.test(text)) return true;
  return /<!doctype html|<html[\s>]/i.test(text);
}

/* ============ ekler: dosya / görsel ============ */
function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

const fileIcon = (name, kind) => {
  if (kind === 'image') return '🖼️';
  const e = (name.split('.').pop() || '').toLowerCase();
  if (e === 'csv') return '📊';
  if (e === 'json') return '🧾';
  if (e === 'md' || e === 'txt') return '📄';
  if (e === 'html' || e === 'css' || e === 'js') return '💻';
  return '📎';
};

function renderAttachments() {
  const box = $('attachments');
  if (!S.attachments.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = S.attachments
    .map(
      (a, i) => `<div class="att-chip${a.uploading ? ' uploading' : ''}" data-i="${i}" title="${esc(a.name)}">
        ${
          a.kind === 'image'
            ? `<img src="${esc(a.url)}" alt="" />`
            : `<div class="att-ico">${fileIcon(a.name, a.kind)}</div>`
        }
        <div class="att-meta">
          <div class="att-name">${esc(a.name)}</div>
          <div class="att-size">${a.uploading ? 'yükleniyor…' : fmtSize(a.size)}</div>
        </div>
        <button class="att-x" data-i="${i}" title="kaldır">✕</button>
      </div>`
    )
    .join('');

  box.querySelectorAll('.att-x').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      S.attachments.splice(Number(b.dataset.i), 1);
      renderAttachments();
      syncModelForImages();
    })
  );
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

async function addFiles(files) {
  const list = [...files];
  if (!list.length) return;

  for (const f of list) {
    if (f.size > 12 * 1024 * 1024) {
      alert(`"${f.name}" 12 MB'tan büyük, eklenemedi.`);
      continue;
    }
    const isImage = (f.type || '').startsWith('image/');
    const placeholder = {
      id: 'tmp-' + Math.random().toString(36).slice(2),
      name: f.name,
      kind: isImage ? 'image' : 'text',
      size: f.size,
      url: '',
      uploading: true,
    };
    S.attachments.push(placeholder);
    renderAttachments();

    try {
      const data = await readAsDataURL(f);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name, mime: f.type, data }),
      }).then((r) => r.json());

      if (res.error) throw new Error(res.error);

      Object.assign(placeholder, {
        id: res.id,
        kind: res.kind,
        size: res.size,
        url: res.url,
        uploading: false,
      });
    } catch (e) {
      S.attachments = S.attachments.filter((x) => x !== placeholder);
      alert(`"${f.name}" yüklenemedi: ${e.message}`);
    }
    renderAttachments();
    syncModelForImages();
  }
}

/* görsel eklendiyse otomatik moda geç (görsel görebilen modeli müdür seçer) */
function syncModelForImages() {
  document.getElementById('visionNotice')?.remove();
  const hasImage = S.attachments.some((a) => a.kind === 'image' && !a.uploading);
  if (!hasImage) return;

  const sel = $('modelSelect');
  const cur = S.models.find((m) => m.id === sel.value);
  if (sel.value === 'auto' || (cur && cur.vision)) return;

  sel.value = 'auto';
  const n = document.createElement('div');
  n.className = 'notice warn';
  n.id = 'visionNotice';
  const vl = S.routing?.vision?.label || 'görsel destekli model';
  n.textContent = `Görsel ekledin. Seçili model resim göremiyor; otomatik moda geçildi (görsel işler için ${vl} kullanılır).`;
  $('attachments').after(n);
}

/* ============ önizleme ============ */
function openPreview(task) {
  const idx = S.tasks.findIndex((x) => x === task);
  const runId = S.currentRunId;

  // kaydedilmişse sunucudan (onarılmış + bandırılmış) al
  if (runId && idx >= 0) {
    S.previewUrl = `/api/preview/${runId}/${idx}`;
    $('previewTitle').textContent = task.baslik;
    $('previewFrame').removeAttribute('srcdoc');
    $('previewFrame').src = S.previewUrl;
    $('previewBackdrop').classList.remove('hidden');
    return;
  }

  // kaydedilmemişse tarayıcıda onar
  const doc = extractDoc(task.output || '');
  if (!doc) return;
  S.previewUrl = null;
  showPreviewFrame(doc, task.baslik);
}

function showPreviewFrame(html, title) {
  $('previewTitle').textContent = title || 'Önizleme';
  $('previewFrame').removeAttribute('src');
  $('previewFrame').srcdoc = html;
  $('previewBackdrop').classList.remove('hidden');
}

/* tarayıcıda yedek çözüm: çıktıdan html çıkar + onar */
function repairClient(doc) {
  let s = String(doc || '');
  const start = s.search(/<!doctype\s+html|<html[\s>]/i);
  if (start > 0) s = s.slice(start);
  s = s.replace(/^```[a-zA-Z0-9]*\s*\n?/, '');

  const os = (s.match(/<style[\s>]/gi) || []).length;
  const cs = (s.match(/<\/style>/gi) || []).length;
  const oj = (s.match(/<script[\s>]/gi) || []).length;
  const cj = (s.match(/<\/script>/gi) || []).length;

  if (os > cs) { s = s.replace(/[^\n{}]*$/, ''); s += '\n</style>'; }
  if (oj > cj) s += '\n</script>';
  if (/<body[\s>]/i.test(s) && !/<\/body>/i.test(s)) s += '\n</body>';
  if (/<html[\s>]/i.test(s) && !/<\/html>/i.test(s)) s += '\n</html>';
  return s;
}

function extractDoc(output) {
  const blocks = [...output.matchAll(/```([a-zA-Z0-9]*)[^\n]*\n([\s\S]*?)```/g)].map((m) => ({
    lang: (m[1] || '').toLowerCase(),
    code: m[2],
  }));
  const pick = (l) => blocks.filter((b) => l.includes(b.lang)).map((b) => b.code).join('\n');
  let html = pick(['html', 'htm']).trim();
  const css = pick(['css']).trim();
  const js = pick(['js', 'javascript']).trim();

  // kapanmamış kod bloğunu kurtar
  if (!html) {
    const fenceCount = (output.match(/```/g) || []).length;
    const lastOpen = output.lastIndexOf('```');
    if (fenceCount % 2 === 1 && lastOpen !== -1) {
      const tail = output.slice(lastOpen + 3);
      const lm = tail.match(/^([a-zA-Z0-9]*)/);
      const lang = (lm?.[1] || '').toLowerCase();
      const code = tail.slice(lang.length).replace(/^\n/, '');
      if (['html', 'htm'].includes(lang) || /<html[\s>]|<!doctype/i.test(code)) html = code.trim();
    }
  }
  if (!html) {
    const m = output.match(/<!doctype\s+html[\s\S]*$/i) || output.match(/<html[\s>][\s\S]*$/i);
    if (m) html = m[0].trim();
  }
  if (!html && !css) return null;

  if (html && css && !/<style[\s>]/i.test(html)) html = `<style>\n${css}\n</style>\n${html}`;
  if (html && js && !/<script[\s>]/i.test(html)) html = `${html}\n<script>\n${js}\n</script>`;

  if (/<!doctype|<html[\s>]/i.test(html)) return repairClient(html);

  return repairClient(`<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:-apple-system,"Segoe UI",sans-serif;color:#1a1d23}img{max-width:100%}${css}</style></head><body>${html || ''}<script>${js}</script></body></html>`);
}

function closePreview() {
  $('previewBackdrop').classList.add('hidden');
  $('previewFrame').removeAttribute('src');
  $('previewFrame').srcdoc = '';
  $('previewFrameWrap').classList.remove('mobile');
  $('pvDevice').textContent = '📱 Mobil';
}

/* ============ çalıştırma ============ */
function setRunning(on) {
  S.running = on;
  $('runBtn').disabled = on;
  $('planBtn').disabled = on;
  $('stopBtn').classList.toggle('hidden', !on);
  $('statusLine').classList.toggle('hidden', !on);
}

async function start(planOnly) {
  const company = activeCompany();
  const request = $('request').value.trim();
  const ready = S.attachments.filter((a) => !a.uploading);
  if (!company) return alert('Önce bir şirket seç.');
  if (!request && !ready.length) return $('request').focus();

  clearOutput();
  setRunning(true);
  $('statusText').textContent = 'Müdür isteği değerlendiriyor…';

  S.controller = new AbortController();

  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: company.id,
        request,
        model: $('modelSelect').value,
        planOnly: planOnly || $('planOnly').checked,
        attachments: ready.map((a) => ({ id: a.id, name: a.name })),
      }),
      signal: S.controller.signal,
    });

    if (!res.ok) throw new Error((await res.json()).error || 'sunucu hatası');

    const reader = res.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const evLine = chunk.split('\n').find((l) => l.startsWith('event:'));
        const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!evLine || !dataLine) continue;
        const ev = evLine.slice(6).trim();
        let data = {};
        try { data = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
        handle(ev, data);
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      const n = document.createElement('div');
      n.className = 'notice err';
      n.textContent = 'Hata: ' + e.message;
      $('output').appendChild(n);
    }
  } finally {
    setRunning(false);
    renderRuns();
  }
}

function handle(ev, d) {
  switch (ev) {
    case 'status':
      $('statusText').textContent = d.message;
      break;
    case 'leader':
      $('statusText').textContent = `Müdür: ${d.label}${d.auto ? ' (otomatik seçildi)' : ''}`;
      if (d.auto) {
        const el = $('leaderPill');
        el.textContent = `müdür: ${d.label}`;
      }
      break;
    case 'plan':
      if (d.runId) S.currentRunId = d.runId;
      renderPlan(d);
      $('statusText').textContent = 'plan hazır, uzmanlar çalışıyor…';
      break;
    case 'task_start':
      $('statusText').textContent = `${d.agentName} çalışıyor${d.modelLabel ? ` · ${d.modelLabel}` : ''}…`;
      addTaskCard(d);
      break;
    case 'delta':
      appendDelta(d.index, d.text);
      break;
    case 'run':
      S.currentRunId = d.runId;
      break;
    case 'task_done':
      finishTask(d.index, d.output, null, d);
      break;
    case 'task_error':
      finishTask(d.index, '', d.message);
      break;
    case 'done':
      S.currentRunId = d.runId || S.currentRunId;
      $('statusText').textContent = 'tamamlandı';
      break;
    case 'fatal':
      $('output').insertAdjacentHTML('beforeend', `<div class="notice err">Kritik hata: ${esc(d.message)}</div>`);
      break;
    case 'aborted':
      $('output').insertAdjacentHTML('beforeend', `<div class="notice warn">Kullanıcı durdurdu.</div>`);
      break;
  }
}

/* ============ şirket modalı ============ */
function openModal(company) {
  S.editing = company || null;
  $('modalTitle').textContent = company ? 'Şirketi düzenle' : 'Yeni şirket';
  $('fName').value = company?.name || '';
  $('fEmoji').value = company?.emoji || '';
  $('fDesc').value = company?.desc || '';
  $('fContext').value = company?.context || '';

  S.picked = new Set(company?.agents || []);
  $('pickSearch').value = '';
  renderPick();
  $('modalBackdrop').classList.remove('hidden');
  $('fName').focus();
}

function renderPick() {
  const q = ($('pickSearch').value || '').toLowerCase();
  const list = S.agents.filter((a) => !q || a.slug.includes(q) || (a.name || '').toLowerCase().includes(q));

  $('pickList').innerHTML = list
    .map(
      (a) => `<label class="pick-item">
        <input type="checkbox" value="${esc(a.slug)}" ${S.picked.has(a.slug) ? 'checked' : ''} />
        <span>${esc(a.name)}</span>
        <span class="ps">${esc(a.slug)}</span>
      </label>`
    )
    .join('');

  $('pickCount').textContent = `(${S.picked.size} seçili)`;

  $('pickList').querySelectorAll('input').forEach((el) =>
    el.addEventListener('change', () => {
      if (el.checked) S.picked.add(el.value);
      else S.picked.delete(el.value);
      $('pickCount').textContent = `(${S.picked.size} seçili)`;
    })
  );
}

async function saveModal() {
  const name = $('fName').value.trim();
  if (!name) return $('fName').focus();

  // sayfadaki tüm seçimler S.picked içinde tutuluyor (arama filtresi etkilemez)
  const payload = {
    id: S.editing?.id,
    name,
    emoji: $('fEmoji').value.trim() || '🏢',
    desc: $('fDesc').value.trim(),
    context: $('fContext').value,
    agents: [...S.picked],
  };

  const { company } = await fetch('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json());

  const { companies } = await fetch('/api/bootstrap').then((r) => r.json());
  S.companies = companies;
  S.activeId = company.id;

  $('companySelect').innerHTML = companies
    .map((c) => `<option value="${esc(c.id)}"${c.id === S.activeId ? ' selected' : ''}>${esc(c.emoji || '🏢')} ${esc(c.name)}</option>`)
    .join('');

  $('modalBackdrop').classList.add('hidden');
  renderCompany();
  clearOutput();
}

/* ============ olaylar ============ */
$('attachBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => {
  addFiles(e.target.files);
  e.target.value = '';
});

/* sürükle-bırak */
const composer = document.querySelector('.composer');
let dragDepth = 0;
composer.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  $('dropHint').classList.remove('hidden');
});
composer.addEventListener('dragover', (e) => e.preventDefault());
composer.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('dropHint').classList.add('hidden');
});
composer.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('dropHint').classList.add('hidden');
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

/* panodan görsel yapıştırma */
$('request').addEventListener('paste', (e) => {
  const items = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith('image/'));
  if (!items.length) return;
  const files = items.map((i) => i.getAsFile()).filter(Boolean);
  if (files.length) {
    e.preventDefault();
    addFiles(files);
  }
});

/* önizleme */
$('probeBtn').addEventListener('click', probeModels);
$('pvClose').addEventListener('click', closePreview);
$('previewBackdrop').addEventListener('click', (e) => {
  if (e.target === $('previewBackdrop')) closePreview();
});
$('pvDevice').addEventListener('click', () => {
  const wrap = $('previewFrameWrap');
  wrap.classList.toggle('mobile');
  $('pvDevice').textContent = wrap.classList.contains('mobile') ? '🖥️ Masaüstü' : '📱 Mobil';
});
$('pvOpen').addEventListener('click', () => {
  if (S.previewUrl) return window.open(S.previewUrl, '_blank');
  const blob = new Blob([$('previewFrame').srcdoc || ''], { type: 'text/html;charset=utf-8' });
  window.open(URL.createObjectURL(blob), '_blank');
});

$('companySelect').addEventListener('change', (e) => {  S.activeId = e.target.value;
  renderCompany();
  clearOutput();
});
$('teamSearch').addEventListener('input', renderTeam);
$('runBtn').addEventListener('click', () => start(false));
$('planBtn').addEventListener('click', () => start(true));
$('stopBtn').addEventListener('click', () => S.controller?.abort());
$('request').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') start(false);
});
$('newCompanyBtn').addEventListener('click', () => openModal(null));
$('editCompanyBtn').addEventListener('click', () => {
  const c = activeCompany();
  if (c) openModal(c);
});
$('modalClose').addEventListener('click', () => $('modalBackdrop').classList.add('hidden'));
$('modalCancel').addEventListener('click', () => $('modalBackdrop').classList.add('hidden'));
$('modalSave').addEventListener('click', saveModal);
$('pickSearch').addEventListener('input', renderPick);

boot();
