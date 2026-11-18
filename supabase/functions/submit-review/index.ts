/**
 * Supabase Edge Function: submit-review
 * - Validates input length/range & applies anti-spam rules (`spam.ts`)
 * - Computes salted HMAC-SHA256 IP hash (/64 normalized for IPv6)
 * - Enforces per-IP (2/hour) & global flood (default 25/hour) rate limits
 * - Stores pending review with `SUPABASE_SERVICE_ROLE_KEY` & sends Telegram inline moderation card
 */

import {
  buildCorsHeaders,
  callTelegramApi,
  createSupabaseServiceClient,
  formatTelegramReviewCard,
  hmacHashIp,
  jsonResponse,
} from '../_shared/helpers.ts';
import { evaluateReviewSubmission, normalizeReviewText } from './spam.ts';

const MAX_BODY_BYTES = 8192;
const PER_IP_MAX_PER_HOUR = 2;

function extractClientIp(req: Request): string {
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp && cfIp.trim()) return cfIp.trim();

  const xff = req.headers.get('x-forwarded-for');
  if (xff && xff.trim()) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim()) return realIp.trim();

  return '0.0.0.0';
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders();

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, corsHeaders);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || '';
  const ipHashSalt = Deno.env.get('IP_HASH_SALT')?.trim() || '';
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() || '';
  const adminChatId = Deno.env.get('TELEGRAM_ADMIN_CHAT_ID')?.trim() || '';
  const maxGlobalPerHour = Math.max(
    5,
    Number.parseInt(Deno.env.get('MAX_REVIEWS_PER_HOUR') || '25', 10) || 25
  );

  // Fail closed if core DB credentials or HMAC salt are not configured
  if (!supabaseUrl || !serviceRoleKey || ipHashSalt.length < 16) {
    return jsonResponse(
      { ok: false, error: 'Layanan ulasan belum dikonfigurasi dengan lengkap.' },
      500,
      corsHeaders
    );
  }

  let rawBody = '';
  try {
    rawBody = await req.text();
  } catch {
    return jsonResponse({ ok: false, error: 'Gagal membaca payload request.' }, 400, corsHeaders);
  }

  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: 'Ukuran payload melebihi batas.' }, 413, corsHeaders);
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonResponse({ ok: false, error: 'Format JSON tidak valid.' }, 400, corsHeaders);
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, error: 'JSON tidak valid.' }, 400, corsHeaders);
  }

  const authorName = normalizeReviewText(
    typeof payload.author_name === 'string' ? payload.author_name : ''
  );
  const comment = normalizeReviewText(typeof payload.comment === 'string' ? payload.comment : '');
  const rating = Number(payload.rating);
  const rawVersion = typeof payload.app_version === 'string' ? payload.app_version.trim() : '';
  const appVersion = /^v\d+\.\d+\.\d+$/.test(rawVersion) ? rawVersion : 'v2.0.3';

  if (authorName.length < 1 || authorName.length > 40) {
    return jsonResponse(
      { ok: false, error: 'Nama wajib diisi (1–40 karakter).' },
      400,
      corsHeaders
    );
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return jsonResponse({ ok: false, error: 'Rating harus berupa angka 1 sampai 5.' }, 400, corsHeaders);
  }

  if (comment.length < 3 || comment.length > 500) {
    return jsonResponse(
      { ok: false, error: 'Ulasan wajib diisi (3–500 karakter).' },
      400,
      corsHeaders
    );
  }

  const spamCheck = evaluateReviewSubmission({
    author_name: authorName,
    rating,
    comment,
    website_hp: payload.website_hp,
    elapsed_ms: payload.elapsed_ms,
  });

  if (spamCheck.action === 'silent_drop') {
    console.info(`[submit-review] silent_drop reason=${spamCheck.reason || 'unknown'}`);
    // Return fake 200 without storing to DB or notifying Telegram
    return jsonResponse({ ok: true }, 200, corsHeaders);
  }

  if (spamCheck.action === 'reject_url') {
    return jsonResponse(
      {
        ok: false,
        error:
          'Tautan tidak diizinkan pada ulasan. Untuk melampirkan tautan bug atau log, silakan buka GitHub Discussions.',
      },
      400,
      corsHeaders
    );
  }

  const clientIp = extractClientIp(req);
  const ipHash = await hmacHashIp(clientIp, ipHashSalt);
  const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const db = createSupabaseServiceClient(supabaseUrl, serviceRoleKey);

  // Rate limit 1: per-IP cap (2 / hour) including rejected entries
  const ipCountResp = await db.request(
    `review_rate_limits?select=id&ip_hash=eq.${encodeURIComponent(ipHash)}&created_at=gte.${encodeURIComponent(oneHourAgoIso)}`,
    {
      method: 'HEAD',
      headers: { Prefer: 'count=exact' },
    }
  );
  if (!ipCountResp.ok) {
    console.error(`[submit-review] rate-limit check failed status=${ipCountResp.status}`);
    return jsonResponse(
      { ok: false, error: 'Gagal memeriksa batas pengiriman sementara.' },
      503,
      corsHeaders
    );
  }
  const ipRange = ipCountResp.headers.get('content-range') || '0/0';
  const ipCount = Number.parseInt(ipRange.split('/')[1] || '0', 10) || 0;
  if (ipCount >= PER_IP_MAX_PER_HOUR) {
    return jsonResponse(
      {
        ok: false,
        error: 'Batas pengiriman tercapai (maksimal 2 ulasan per jam). Silakan coba lagi nanti.',
      },
      429,
      corsHeaders
    );
  }

  // Rate limit 2: global ceiling per hour to protect admin Telegram & DB
  const globalCountResp = await db.request(
    `review_rate_limits?select=id&created_at=gte.${encodeURIComponent(oneHourAgoIso)}`,
    {
      method: 'HEAD',
      headers: { Prefer: 'count=exact' },
    }
  );
  if (globalCountResp.ok) {
    const globalRange = globalCountResp.headers.get('content-range') || '0/0';
    const globalCount = Number.parseInt(globalRange.split('/')[1] || '0', 10) || 0;
    if (globalCount >= maxGlobalPerHour) {
      return jsonResponse(
        {
          ok: false,
          error:
            'Antrean moderasi ulasan sedang padat. Silakan coba beberapa saat lagi atau gunakan GitHub Discussions.',
        },
        429,
        corsHeaders
      );
    }
  }

  // Record rate-limit hit before inserting review
  const rateInsert = await db.request('review_rate_limits', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ip_hash: ipHash }),
  });
  if (!rateInsert.ok) {
    console.error(`[submit-review] rate-limit insert failed status=${rateInsert.status}`);
    return jsonResponse(
      { ok: false, error: 'Layanan ulasan sedang sibuk. Coba lagi sebentar.' },
      503,
      corsHeaders
    );
  }

  // Insert review row as pending
  const insertResp = await db.request('casa_reviews', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      author_name: authorName,
      rating,
      comment,
      app_version: appVersion,
      status: 'pending',
      ip_hash: ipHash,
    }),
  });

  if (!insertResp.ok) {
    console.error(`[submit-review] casa_reviews insert failed status=${insertResp.status}`);
    return jsonResponse(
      { ok: false, error: 'Gagal menyimpan ulasan. Silakan coba lagi.' },
      500,
      corsHeaders
    );
  }

  const insertedRows = await insertResp.json();
  const review = Array.isArray(insertedRows) ? insertedRows[0] : null;
  if (!review || !review.id) {
    return jsonResponse({ ok: false, error: 'Gagal memproses ID ulasan.' }, 500, corsHeaders);
  }

  // Trigger opportunistic retention cleanup without blocking response on error
  try {
    await db.request('rpc/cleanup_casa_reviews_retention', {
      method: 'POST',
      body: '{}',
    });
  } catch {
    // Non-fatal
  }

  // Notify Telegram moderator with 1-click inline buttons
  if (botToken && adminChatId) {
    try {
      const tgResp = await callTelegramApi<{ message_id?: number }>(botToken, 'sendMessage', {
        chat_id: adminChatId,
        text: formatTelegramReviewCard(review),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve', callback_data: `approve:${review.id}` },
              { text: '🗑️ Tolak', callback_data: `delete:${review.id}` },
            ],
          ],
        },
      });

      if (tgResp.ok && tgResp.result?.message_id) {
        await db.request(`casa_reviews?id=eq.${encodeURIComponent(review.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ telegram_message_id: tgResp.result.message_id }),
        });
      } else {
        console.error(`[submit-review] Telegram sendMessage status=${tgResp.status}`);
      }
    } catch (err) {
      console.error('[submit-review] Telegram dispatch error:', String(err));
    }
  }

  return jsonResponse({ ok: true, id: review.id, status: 'pending' }, 201, corsHeaders);
});
