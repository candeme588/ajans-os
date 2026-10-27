const { TextDecoder } = require('util');

async function streamChat({
  baseURL, apiKey, model, messages,
  maxTokens = 8000, temperature = 0.6,
  onDelta, onReasoning, signal,
}) {
  if (!apiKey) throw new Error('API anahtarı bulunamadı (opencode.json içindeki providers.evren.settings.apiKey)');

  const url = baseURL.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, stream: true }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API hatası ${res.status}: ${body.slice(0, 400)}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '';
  let full = '';
  let reasoning = '';
  let finishReason = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });

    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      const choice = j.choices?.[0] || {};
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || {};
      const reasoningChunk = delta.reasoning || delta.reasoning_content;
      if (reasoningChunk) {
        reasoning += reasoningChunk;
        if (onReasoning) onReasoning(reasoningChunk);
      }
      // bazı modeller (Nemotron) cevabı reasoning alanına yazıp content'i boş bırakır
      if (delta.content) {
        full += delta.content;
        if (onDelta) onDelta(delta.content);
      }
    }
  }

  // içerik boş kaldıysa reasoning'i cevap say (Nemotron davranışı)
  if (!full && reasoning) full = reasoning;

  return { text: full, reasoning, finishReason, truncated: finishReason === 'length' };
}

async function chat(opts) {
  const { text } = await streamChat(opts);
  return text;
}

/* JSON'u metin içinden güvenli çıkar */
function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  const slice = t.slice(start, end + 1);
  try { return JSON.parse(slice); } catch { return null; }
}

module.exports = { streamChat, chat, extractJson };
