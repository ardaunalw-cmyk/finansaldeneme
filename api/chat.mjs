// Vercel serverless function: POST /api/chat -> Claude Haiku 5.5
//
// The Anthropic API key is read only from the ANTHROPIC_API_KEY environment
// variable on the server. It is never sent to the browser, never logged and
// never included in error responses. The browser only talks to this endpoint.
import Anthropic from '@anthropic-ai/sdk';
import { TOOLS, runTool } from './_chat-tools.mjs';

const MODEL = 'claude-haiku-5-5';
const MAX_TOOL_ROUNDS = 4;      // model calls per user message, so a loop can't run up costs
const MAX_TURNS = 20;           // history the client may send
const MAX_CHARS_PER_MESSAGE = 2000;
const MAX_TOTAL_CHARS = 16000;

// Requests are only accepted from these sites (plus same-origin requests)
const ALLOWED_ORIGINS = [
  'https://finansaldeneme.vercel.app',
  'http://localhost:8080',
  'http://localhost:8091'
];

const SYSTEM_PROMPT = `Sen "Verity Asistan"sın: Verity adlı Borsa İstanbul (BIST) finansal analiz sitesinin sohbet asistanısın.

- Kullanıcıya Türkçe, kısa ve net cevap ver (genelde 2-6 cümle). Gerekirse kısa madde işaretleri kullan.
- Konuların: BIST hisseleri, bilanço okuma, finansal rasyolar (F/K, PD/DD, FD/FAVÖK, ROE vb.), temel ve teknik analiz kavramları, sitenin nasıl kullanılacağı.
- Sitedeki veriler gerçek kaynaklardan gelir: fiyatlar Yahoo Finance'ten gecikmeli, bilançolar KAP raporlarından, temettüler Yahoo Finance'ten. Bir hissenin fiyatı, rasyoları, bilançosu, temettüsü veya sektör karşılaştırması sorulduğunda araçlarla bu veriyi al ve sayıları oradan ver; şirket adıyla anıldıysa önce hisse_ara ile kodunu bul. Bilanço döneminin ve fiyatın gecikmeli olduğunu belirt. Bir değer araçtan null geldiyse hesaplanamadığını söyle, asla tahmin etme veya sayı uydurma.
- Haber ve KAP bildirimlerine erişimin yok; bunlar sorulursa kullanıcıyı sitedeki ilgili bölüme yönlendir.
- Kişiye özel yatırım tavsiyesi verme ("al", "sat", "tut" önerisi yok). SPK mevzuatı gereği yanıtların genel bilgilendirme amaçlıdır; gerektiğinde bunu kısaca hatırlat.
- Finans dışı isteklere kibarca, sitenin konusuna dönerek yanıt ver.`;

class BadRequest extends Error {}

async function readJsonBody(req) {
  // Vercel pre-parses JSON bodies; the local dev server passes the raw stream
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_TOTAL_CHARS * 2) throw new BadRequest('Request too large');
  }
  return raw ? JSON.parse(raw) : {};
}

function sanitizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0) throw new BadRequest('messages required');
  const messages = input.slice(-MAX_TURNS).map((m) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      throw new BadRequest('invalid message');
    }
    return { role: m.role, content: m.content.slice(0, MAX_CHARS_PER_MESSAGE) };
  });
  // The API requires the conversation to start with a user turn
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== 'user') throw new BadRequest('last message must be from the user');
  const total = messages.reduce((n, m) => n + m.content.length, 0);
  if (total > MAX_TOTAL_CHARS) throw new BadRequest('conversation too long');
  return messages;
}

export function contextNote(context) {
  if (!context || typeof context !== 'object') return null;
  const view = typeof context.view === 'string' ? context.view.slice(0, 40) : null;
  const stock = typeof context.stock === 'string' ? context.stock.replace(/[^A-Z0-9.]/gi, '').slice(0, 12) : null;
  // The profile's holdings: codes and cost weights only (no amounts), at most 15
  const holdings = Array.isArray(context.portfolio)
    ? context.portfolio.slice(0, 15)
      .filter((h) => h && typeof h.c === 'string' && /^[A-Z0-9]{3,6}$/.test(h.c))
      .map((h) => (Number.isFinite(h.w) && h.w >= 0 && h.w <= 100 ? `${h.c} %${h.w}` : h.c))
    : [];
  if (!view && !stock && !holdings.length) return null;
  let note = `Kullanıcının o an sitede baktığı yer: sayfa=${view || 'bilinmiyor'}${stock ? `, seçili hisse=${stock}` : ''}.`;
  if (holdings.length) note += ` Kullanıcının Profilim sayfasına girdiği portföy (maliyete göre ağırlık): ${holdings.join(', ')}. Portföy sorularında bunu kullan; al/sat önerisi verme.`;
  return note;
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

// Per-IP limit, kept in memory per serverless instance: not airtight across instances,
// but enough to stop a single client from burning API credits in a loop.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 12;
const hits = new Map();

function rateLimited(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) if (now - times[times.length - 1] >= RATE_WINDOW_MS) hits.delete(key);
  }
  return recent.length > RATE_MAX_REQUESTS;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Method not allowed' });
  }

  // Browsers always send Origin on POST; rejecting missing/foreign origins keeps
  // other sites (and casual scripts) from spending this project's API credits
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return send(res, 403, { error: 'Forbidden' });
  }

  if (rateLimited(req)) {
    res.setHeader('Retry-After', '60');
    return send(res, 429, { error: 'rate_limited', reply: 'Çok fazla istek gönderdin. Lütfen bir dakika sonra tekrar dene.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return send(res, 503, { error: 'not_configured', reply: 'Asistan henüz yapılandırılmadı. Lütfen daha sonra tekrar deneyin.' });
  }

  let messages;
  let note;
  try {
    const body = await readJsonBody(req);
    messages = sanitizeMessages(body.messages);
    note = contextNote(body.context);
  } catch (err) {
    return send(res, 400, { error: 'Bad request' });
  }

  // Page context goes in a second system block after the cache breakpoint, so the cached
  // prompt stays stable (the Messages API only accepts user/assistant roles in messages)
  const system = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
  if (note) system.push({ type: 'text', text: note });

  try {
    const client = new Anthropic();
    let response;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        output_config: { effort: 'low' },
        system,
        tools: TOOLS,
        messages
      });
      if (response.stop_reason !== 'tool_use') break;

      // Full content goes back unchanged (thinking blocks included); all results in one user turn
      messages.push({ role: 'assistant', content: response.content });
      const calls = response.content.filter((block) => block.type === 'tool_use');
      const results = await Promise.all(calls.map(async (call) => {
        try {
          return { type: 'tool_result', tool_use_id: call.id, content: await runTool(call.name, call.input) };
        } catch (err) {
          console.error('[api/chat] tool failed', call.name, err && err.name);
          return { type: 'tool_result', tool_use_id: call.id, content: 'Veri okunamadı.', is_error: true };
        }
      }));
      messages.push({ role: 'user', content: results });
    }

    if (response.stop_reason === 'refusal') {
      return send(res, 200, { reply: 'Bu soruya yanıt veremiyorum. Başka bir finans sorusu sormak ister misin?' });
    }

    const reply = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    return send(res, 200, { reply: reply || 'Şu anda bir yanıt oluşturamadım, lütfen tekrar dene.' });
  } catch (err) {
    // Log only the status/type, never request headers or the key
    if (err instanceof Anthropic.RateLimitError) {
      console.error('[api/chat] rate limited');
      return send(res, 429, { reply: 'Şu an çok yoğunum, birkaç saniye sonra tekrar dene.' });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('[api/chat] authentication failed - check ANTHROPIC_API_KEY');
      return send(res, 503, { error: 'not_configured', reply: 'Asistan şu anda kullanılamıyor.' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`[api/chat] Anthropic API error ${err.status}`);
    } else {
      console.error('[api/chat] unexpected error', err && err.name);
    }
    return send(res, 502, { reply: 'Şu anda yanıt veremiyorum, lütfen biraz sonra tekrar dene.' });
  }
}
