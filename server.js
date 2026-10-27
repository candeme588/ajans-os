const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadAgents, getAgent } = require('./lib/agents');
const store = require('./lib/store');
const { planTasks, agentSystem } = require('./lib/manager');
const { streamChat } = require('./lib/llm');
const { buildPreview } = require('./lib/preview');
const { catalog } = require('./lib/providers');
const router = require('./lib/router');
const auth = require('./lib/auth');

const PORT = Number(process.env.PORT || 7777);
const PUBLIC = path.join(__dirname, 'public');
const UPLOADS = path.join(__dirname, 'uploads');

fs.mkdirSync(UPLOADS, { recursive: true });
store.seed();

/* ---------------- yardımcılar ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function serveFile(res, base, rel) {
  const full = path.resolve(base, rel);
  if (!full.startsWith(path.resolve(base))) return send(res, 403, { error: 'yasak' });
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    return send(res, 404, 'Bulunamadı', 'text/plain; charset=utf-8');
  }
  send(res, 200, fs.readFileSync(full), MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
}

function readBody(req, limit = 40 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) reject(new Error('istek çok büyük (max 40MB)'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('geçersiz JSON')); }
    });
    req.on('error', reject);
  });
}

/* ---------------- yüklenen dosyalar ---------------- */
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp'];
const TEXT_EXT = ['.txt', '.md', '.csv', '.json', '.html', '.css', '.js', '.xml', '.yml', '.yaml', '.tsv'];

function classify(name, mime) {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXT.includes(ext) || (mime || '').startsWith('image/')) return 'image';
  if (TEXT_EXT.includes(ext) || (mime || '').startsWith('text/')) return 'text';
  return 'other';
}

/* dosya tipini uzantıya değil içeriğe göre belirle */
function sniffExt(buf, name, mime) {
  if (buf.length > 8) {
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: '.png', mime: 'image/png' };
    if (buf.slice(0, 4).toString('ascii') === 'GIF8') return { ext: '.gif', mime: 'image/gif' };
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
    if (buf[0] === 0x42 && buf[1] === 0x4d) return { ext: '.bmp', mime: 'image/bmp' };
  }
  const head = buf.slice(0, 400).toString('utf8').toLowerCase();
  if (head.includes('<svg')) return { ext: '.svg', mime: 'image/svg+xml' };

  let ext = path.extname(name).toLowerCase();
  if (!ext) {
    if ((mime || '').startsWith('image/jpeg')) ext = '.jpg';
    else if ((mime || '').startsWith('image/png')) ext = '.png';
    else if ((mime || '').startsWith('image/webp')) ext = '.webp';
    else ext = '.bin';
  }
  return { ext, mime: mime || MIME[ext] || 'application/octet-stream' };
}

function handleUpload(body) {
  const name = String(body.name || 'dosya');
  const b64 = String(body.data || '').replace(/^data:[^;]+;base64,/, '');
  if (!b64) throw new Error('dosya verisi yok');

  const buf = Buffer.from(b64, 'base64');
  if (buf.length > 12 * 1024 * 1024) throw new Error('dosya 12MB üstü');

  // gerçek tipe göre uzantı ve mime
  const sniffed = sniffExt(buf, name, String(body.mime || ''));
  const id = crypto.randomBytes(8).toString('hex');
  const saved = path.join(UPLOADS, id + sniffed.ext);
  fs.writeFileSync(saved, buf);

  const kind = classify(name, sniffed.mime);

  let text = null;
  if (kind === 'text') {
    try { text = buf.toString('utf8').slice(0, 60000); } catch { text = null; }
  }

  return {
    id,
    name,
    mime: sniffed.mime,
    kind,
    size: buf.length,
    ext: sniffed.ext,
    url: `/uploads/${id}${sniffed.ext}`,
    text,
  };
}

function loadUpload(id) {
  if (!id) return null;
  const files = fs.readdirSync(UPLOADS).filter((f) => f.startsWith(id + '.'));
  if (!files.length) return null;
  const f = files[0];
  const full = path.join(UPLOADS, f);
  const buf = fs.readFileSync(full);
  const ext = path.extname(f).toLowerCase();
  const kind = IMAGE_EXT.includes(ext) ? 'image' : TEXT_EXT.includes(ext) ? 'text' : 'other';

  // mime'ı uzantıdan değil içerikten al (yanlış uzantı görseli bozar)
  const sniffed = sniffExt(buf, f, '');
  const mime = sniffed.ext === ext ? sniffed.mime : (MIME[ext] || sniffed.mime);

  return {
    id,
    name: f,
    mime: IMAGE_EXT.includes(ext) ? sniffed.mime : mime,
    kind,
    size: buf.length,
    ext,
    url: `/uploads/${f}`,
    text: kind === 'text' ? buf.toString('utf8').slice(0, 60000) : null,
    base64: buf.toString('base64'),
  };
}

/* ---------------- SSE ---------------- */
function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': bağlandı\n\n');
  return (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

/* ---------------- mesaj kurucu ---------------- */
function buildUserContent(text, attachments) {
  const parts = [];
  const files = [];

  for (const a of attachments || []) {
    const up = loadUpload(a.id);
    if (!up) continue;
    if (up.kind === 'image') {
      parts.push({ type: 'image_url', image_url: { url: `data:${up.mime};base64,${up.base64}` } });
    } else if (up.text) {
      files.push(`### Dosya: ${a.name || up.name}\n\`\`\`\n${up.text}\n\`\`\``);
    } else {
      files.push(`### Dosya: ${a.name || up.name}\n(İçeriği okunamadı — ${up.mime}.)`);
    }
  }

  const content = [];
  if (files.length) content.push({ type: 'text', text: `EKTEKİ DOSYALAR:\n\n${files.join('\n\n')}` });
  content.push({ type: 'text', text });
  parts.push(...content);

  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
  return parts;
}

function modelSupportsImages(provider, model) {
  const label = (provider.labels?.[model] || '').toLowerCase();
  if (label.includes('görsel')) return true;
  const visionHints = ['vl', 'vision', 'gemma', 'mimo'];
  return visionHints.some((h) => model.toLowerCase().includes(h));
}

function firstVisionModel(provider) {
  return provider.models.find((m) => modelSupportsImages(provider, m)) || null;
}

/* web işi mi (uzun çıktı gerekir) */
function isWebTask(text) {
  return /(web ?sitesi|site|sayfa|landing|html|css|tasar|arayüz|önizleme|şablon)/i.test(text || '');
}

/* ---------------- rotalar ---------------- */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);
  const m = req.method;

  try {
    /* --- giriş / çıkış (şifre tanımlıysa çalışır) --- */
    if (p === '/api/giris' || p === '/api/auth-durum' || p === '/api/cikis') {
      if (m === 'GET' && p === '/api/auth-durum') {
        return send(res, 200, { korumali: auth.aktif(), girisli: auth.girisYapmis(req) });
      }
      if (m === 'POST' && p === '/api/giris') {
        const govde = await readBody(req);
        const ip = auth.ipAl(req);
        if (auth.kilitliMi(ip)) {
          return send(res, 429, { error: 'Çok fazla hatalı deneme. 15 dakika sonra tekrar dene.' });
        }
        if (!auth.sifreDogru(govde.sifre)) {
          auth.hataliDeneme(ip);
          return send(res, 401, { error: 'Şifre yanlış' });
        }
        auth.sifirla(ip);
        auth.cerezAyarla(res, auth.jetonUret());
        return send(res, 200, { ok: true });
      }
      if (m === 'POST' && p === '/api/cikis') {
        auth.cerezSil(res);
        return send(res, 200, { ok: true });
      }
    }

    /* --- oturum kontrolü --- */
    if (!auth.girisYapmis(req)) {
      // sağlık kontrolü şifresiz olsun (izleme için, hassas veri içermez)
      if (p === '/api/health') {
        return send(res, 200, { ok: true, korumali: true, uptime: process.uptime() });
      }
      if (p.startsWith('/api/')) return send(res, 401, { error: 'giriş gerekli', giris: true });
      return serveFile(res, PUBLIC, 'giris.html');
    }

    /* --- statik --- */
    if (m === 'GET' && p.startsWith('/uploads/')) return serveFile(res, UPLOADS, p.slice('/uploads/'.length));
    if (m === 'GET' && !p.startsWith('/api/')) {
      return serveFile(res, PUBLIC, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
    }

    /* --- başlangıç --- */
    if (m === 'GET' && p === '/api/bootstrap') {
      const { providers, models } = catalog();
      const all = loadAgents(true);
      return send(res, 200, {
        companies: store.listCompanies(),
        models: models.map((x) => ({
          id: x.id,
          label: x.label,
          provider: x.providerName,
          vision: x.vision,
          power: x.power,
          speed: x.speed,
          ok: x.ok,
          ms: x.ms,
          note: x.note,
        })),
        routing: router.summary(),
        agentCount: all.length,
        hasKey: Object.values(providers).some((x) => x.apiKey),
      });
    }

    /* --- modelleri yeniden test et --- */
    if (m === 'POST' && p === '/api/models/probe') {
      const r = await router.probeAll();
      return send(res, 200, { ...r, routing: router.summary() });
    }

    /* --- model havuzu --- */
    if (m === 'GET' && p === '/api/models') {
      const { models } = catalog();
      return send(res, 200, { models, routing: router.summary() });
    }

    if (m === 'GET' && p === '/api/agents') {
      const all = loadAgents().map(({ body, ...rest }) => ({ ...rest, bodyLength: body.length }));
      return send(res, 200, { agents: all });
    }

    /* --- dosya yükle --- */
    if (m === 'POST' && p === '/api/upload') {
      const body = await readBody(req);
      const up = handleUpload(body);
      return send(res, 200, {
        id: up.id,
        name: up.name,
        mime: up.mime,
        kind: up.kind,
        size: up.size,
        url: up.url,
        preview: up.kind === 'text' ? up.text.slice(0, 300) : null,
      });
    }

    /* --- şirket --- */
    if (m === 'POST' && p === '/api/companies') {
      const c = await readBody(req);
      if (!c.name) return send(res, 400, { error: 'İsim zorunlu' });
      const id = (c.id || c.name)
        .toLowerCase()
        .replace(/[çğıöşü]/g, (x) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }[x]))
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
      const existing = store.getCompany(id);
      const saved = store.saveCompany({
        id,
        name: c.name,
        emoji: c.emoji || '🏢',
        desc: c.desc || '',
        context: c.context || '',
        agents: Array.isArray(c.agents) ? c.agents : [],
        createdAt: existing?.createdAt || new Date().toISOString(),
      });
      return send(res, 200, { company: saved });
    }

    if (m === 'DELETE' && p.startsWith('/api/companies/')) {
      store.deleteCompany(p.split('/').pop());
      return send(res, 200, { ok: true });
    }

    /* --- geçmiş --- */
    if (m === 'GET' && p === '/api/runs') return send(res, 200, { runs: store.listRuns() });

    if (m === 'GET' && p.startsWith('/api/runs/')) {
      const r = store.getRun(p.split('/').pop());
      return r ? send(res, 200, r) : send(res, 404, { error: 'bulunamadı' });
    }

    /* --- önizleme --- */
    if (m === 'GET' && p.startsWith('/api/preview/')) {
      const parts = p.split('/').filter(Boolean); // api preview <id> <index>
      const run = store.getRun(parts[2]);
      if (!run) return send(res, 404, 'Kayıt bulunamadı', 'text/plain; charset=utf-8');
      const idx = Number(parts[3] ?? 0);
      const task = run.tasks?.[idx];
      if (!task) return send(res, 404, 'Görev bulunamadı', 'text/plain; charset=utf-8');

      const { html } = buildPreview(task.output);
      if (!html) {
        return send(res, 404,
          '<html><body style="font-family:sans-serif;padding:40px;color:#888"><h3>Bu çıktıda önizlenecek bir şey yok.</h3></body></html>',
          'text/html; charset=utf-8');
      }
      return send(res, 200, html, 'text/html; charset=utf-8');
    }

    /* --- plan + çalıştır --- */
    if (m === 'POST' && p === '/api/run') {
      const body = await readBody(req);
      const company = store.getCompany(body.companyId);
      if (!company) return send(res, 400, { error: 'Şirket bulunamadı' });

      const request = String(body.request || '').trim();
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];
      if (!request && !attachments.length) return send(res, 400, { error: 'İstek boş' });

      const { providers, models: pool } = catalog();
      const hasImage = attachments.some((a) => loadUpload(a.id)?.kind === 'image');
      const wantAuto = !body.model || body.model === 'auto';

      // seçili model (elle seçildiyse) veya otomatik
      const byId = (id) => pool.find((x) => x.id === id) || null;
      const chosen = wantAuto ? null : byId(body.model);

      let leader = chosen || router.pickLeader(pool, { needsVision: hasImage });
      if (wantAuto) leader = router.pickLeader(pool, { needsVision: hasImage });
      if (!leader) return send(res, 400, { error: 'Kullanılabilir model bulunamadı. Ayarları kontrol et.' });

      const leaderProv = providers[leader.provider];
      if (!leaderProv) return send(res, 400, { error: `Sağlayıcı bulunamadı: ${leader.provider}` });

      const all = loadAgents();
      const slugs = new Set(company.agents || []);
      let team = all.filter((a) => slugs.has(a.slug));
      if (!team.length) team = all;

      const emit = sseInit(res);
      const controller = new AbortController();
      req.on('close', () => controller.abort());

      const run = {
        id: store.newRunId(),
        companyId: company.id,
        companyName: company.name,
        request,
        model: leader.id,
        leader: leader.id,
        auto: wantAuto,
        attachments: attachments.map((a) => ({ id: a.id, name: a.name, kind: loadUpload(a.id)?.kind })),
        createdAt: new Date().toISOString(),
        plan: null,
        tasks: [],
      };

      emit('run', { runId: run.id });
      emit('leader', { id: leader.id, label: leader.label, note: leader.note, power: leader.power, auto: wantAuto });

      try {
        emit('status', { message: `${leader.label} isteği değerlendiriyor…` });
        const plan = await planTasks({
          company, agents: team, request: request || '(ekteki dosyalara göre ilerle)',
          provider: { baseURL: leaderProv.baseURL, apiKey: leaderProv.apiKey },
          model: leader.model, signal: controller.signal,
          attachments: run.attachments,
        });

        run.plan = { ozet: plan.ozet, gorevler: plan.gorevler, fallback: !!plan._fallback, error: plan._error || null };
        emit('plan', { ...run.plan, runId: run.id });

        if (body.planOnly) {
          emit('done', { runId: run.id, planOnly: true });
          return res.end();
        }

        for (let i = 0; i < plan.gorevler.length; i++) {
          const g = plan.gorevler[i];
          const agent = getAgent(g.ajan);
          if (!agent) {
            emit('task_error', { index: i, message: `Ajan bulunamadı: ${g.ajan}` });
            continue;
          }

          // ---- bu görev için model seçimi ----
          const prof = router.taskProfile(`${g.talimat} ${g.baslik}`);
          const needVision = hasImage && (i === 0);
          const longOutput = prof.web;

          let taskModel = chosen;
          if (!taskModel) {
            // ajan kendi modelini bildirmişse onu kullan (frontmatter: model: vision|leader|fast|long)
            taskModel = router.pickForAgent(pool, agent, leader.id);
          }
          if (!taskModel) {
            taskModel = router.pickWorker(pool, {
              needsVision: needVision,
              longOutput,
              heavy: prof.heavy && !prof.web,
              leaderId: leader.id,
            }) || leader;
          }
          // görsel gerekliyse ve seçilen model göremiyorsa düzelt
          if (needVision && !taskModel.vision) {
            taskModel = router.pickWorker(pool, { needsVision: true }) || taskModel;
          }
          const tmProv = providers[taskModel.provider] || leaderProv;

          emit('task_start', {
            index: i, agent: agent.slug, agentName: agent.name, baslik: g.baslik,
            model: taskModel.id, modelLabel: taskModel.label, modelNote: taskModel.note,
          });

          const systemMsg = agentSystem(agent, company, g, run.tasks.filter((t) => t.output));
          const messages = [
            { role: 'system', content: systemMsg },
            { role: 'user', content: i === 0 ? buildUserContent(g.talimat, attachments) : g.talimat },
          ];

          const maxTokens = longOutput ? Math.min(24000, taskModel.maxOut || 16000) : 8000;

          let text = '';
          let lastEmit = 0;
          try {
            const out = await streamChat({
              baseURL: tmProv.baseURL,
              apiKey: tmProv.apiKey,
              model: taskModel.model,
              messages,
              maxTokens,
              temperature: longOutput ? 0.4 : 0.6,
              signal: controller.signal,
              onDelta: (d) => {
                text += d;
                const now = Date.now();
                if (now - lastEmit > 60) {
                  lastEmit = now;
                  emit('delta', { index: i, text: d });
                }
              },
            });

            const finalText = out.text || text;
            const prev = buildPreview(finalText);
            run.tasks.push({
              ajan: g.ajan, baslik: g.baslik, talimat: g.talimat,
              output: finalText, truncated: Boolean(out.truncated),
              model: taskModel.id, modelLabel: taskModel.label,
            });
            emit('task_done', {
              index: i,
              output: finalText,
              chars: finalText.length,
              hasPreview: prev.kind === 'page',
              previewKind: prev.kind,
              repaired: Boolean(prev.truncated),
              truncated: Boolean(out.truncated),
              model: taskModel.id, modelLabel: taskModel.label,
            });
          } catch (e) {
            if (e.name === 'AbortError') {
              if (text) run.tasks.push({ ajan: g.ajan, baslik: g.baslik, talimat: g.talimat, output: text });
              try { store.saveRun(run); } catch {}
              emit('aborted', { runId: run.id });
              return res.end();
            }
            run.tasks.push({ ajan: g.ajan, baslik: g.baslik, talimat: g.talimat, output: '', error: String(e.message || e) });
            emit('task_error', { index: i, message: String(e.message || e) });
          }
        }

        const dir = store.saveRun(run);
        emit('done', { runId: run.id, dir, tasks: run.tasks.length });
      } catch (e) {
        emit('fatal', { message: String(e.message || e) });
      }
      return res.end();
    }

    if (m === 'GET' && p === '/api/health') {
      return send(res, 200, { ok: true, agents: loadAgents().length, uptime: process.uptime() });
    }

    return send(res, 404, { error: 'bulunamadı' });
  } catch (e) {
    if (!res.headersSent) return send(res, 500, { error: String(e.message || e) });
    try { res.end(); } catch {}
  }
}

/* ---------------------------------------------------------------
   DİNLENECEK ADRESLER

   Yerel (varsayılan): sadece 127.0.0.1 ve ::1 — internetten erişilemez.
   Sunucu modu: SUNUCU_MODU=1 verilirse 0.0.0.0 dinlenir (dışarıdan erişim).
---------------------------------------------------------------- */
const SUNUCU_MODU = process.env.SUNUCU_MODU === '1' || process.env.SUNUCU_MODU === 'true';
const HOSTS = SUNUCU_MODU ? ['0.0.0.0'] : ['127.0.0.1', '::1'];
const open = [];

function printBanner() {
  const all = loadAgents(true);
  const comps = store.listCompanies();
  const line = '='.repeat(47);
  console.log('');
  console.log('  ' + line);
  console.log('    AJANS OS   ·   tek kişilik şirket paneli');
  console.log('  ' + line);
  console.log('');
  if (SUNUCU_MODU) {
    console.log(`   Mod      :  SUNUCU (dışarıdan erişilebilir)`);
    console.log(`   Adres    :  http://<sunucu-ip>:${PORT}`);
    console.log(`   Giriş    :  ${auth.aktif() ? 'şifre korumalı ✓' : 'ŞİFRESİZ ⚠'}`);
  } else {
    console.log(`   Mod      :  YEREL (sadece bu bilgisayar)`);
    console.log(`   Adres    :  http://localhost:${PORT}`);
    console.log(`   Yedek    :  http://127.0.0.1:${PORT}`);
  }
  console.log(`   Ajan     :  ${all.length} kayıtlı uzman`);
  console.log(`   Şirket   :  ${comps.map((c) => c.name).join(', ') || '(yok)'}`);
  console.log('');
  if (SUNUCU_MODU && !auth.aktif()) {
    console.log('   ⚠  UYARI: ADMIN_PASSWORD tanımlı değil.');
    console.log('      Panel internete açık ve şifresiz. API anahtarların risk altında.');
    console.log('      Kapatmak için: ADMIN_PASSWORD=guclu-bir-sifre ile yeniden başlat.');
    console.log('');
  }
  console.log('   Kapatmak için Ctrl+C.');
  console.log('');
}

for (const host of HOSTS) {
  const srv = http.createServer(handleRequest);
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n  HATA: ${host}:${PORT} portu kullanımda.`);
      console.error(`  Başka bir AJANS OS açık olabilir. Bu pencereyi kapat.`);
      console.error(`  Ya da farklı port: set PORT=7788 && node server.js\n`);
      process.exit(1);
    }
    // IPv6 desteklenmiyorsa sessizce atla, IPv4 yeter
    if (e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT') {
      return;
    }
    console.error(`  ${host} dinlenemedi: ${e.message}`);
  });
  srv.listen(PORT, host, () => {
    open.push(host);
    if (open.length === 1) printBanner();
  });
}
