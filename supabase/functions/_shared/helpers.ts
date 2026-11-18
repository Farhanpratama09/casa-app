/**
 * Shared pure utilities for CASA Supabase Edge Functions (Deno Web Standards).
 * Avoids logic duplication between `submit-review` and `telegram-webhook`.
 */

export interface CasaReviewRow {
  id: string;
  author_name: string;
  rating: number;
  comment: string;
  app_version: string;
  status: 'pending' | 'approved' | 'rejected';
  creator_reply: string | null;
  replied_at: string | null;
  telegram_message_id: number | null;
  created_at: string;
}

export const ALLOWED_ORIGIN = 'https://farhanpratama09.github.io';

export function buildCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

/**
 * Constant-time UTF-8 string comparison to prevent timing side-channels on webhook secrets.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const maxLen = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatStars(rating: number): string {
  const n = Math.max(1, Math.min(5, Math.round(rating)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

/**
 * Normalizes IPv6 addresses to `/64` network prefix so rotating SLAAC interface IDs
 * share one bucket cleanly, while keeping IPv4 addresses intact.
 */
export function normalizeIpPrefix(rawIp: string): string {
  const cleaned = rawIp.trim().split('%')[0].toLowerCase();
  if (!cleaned) return '0.0.0.0';
  if (!cleaned.includes(':')) {
    return cleaned;
  }

  // Handle IPv4-mapped IPv6 e.g. ::ffff:192.0.2.1
  if (cleaned.startsWith('::ffff:') && cleaned.includes('.')) {
    return cleaned.slice('::ffff:'.length);
  }

  const parts = cleaned.split('::');
  if (parts.length > 2) return cleaned;

  const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const right = parts[1] ? parts[1].split(':').filter(Boolean) : [];
  const missing = 8 - (left.length + right.length);
  if (missing < 0) return cleaned;

  const full = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ].map((g) => g.padStart(4, '0'));

  return `${full.slice(0, 4).join(':')}::/64`;
}

export async function hmacHashIp(ip: string, salt: string): Promise<string> {
  const prefix = normalizeIpPrefix(ip);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(prefix));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function formatTelegramReviewCard(
  review: Pick<CasaReviewRow, 'id' | 'author_name' | 'rating' | 'comment' | 'app_version' | 'creator_reply'>,
  statusLine?: string
): string {
  const lines = [
    `<b>CASA Showcase · Review Baru</b>`,
    `${formatStars(review.rating)} (${review.rating}/5)`,
    `<b>Pengirim:</b> ${escapeTelegramHtml(review.author_name)} · <code>${escapeTelegramHtml(review.app_version)}</code>`,
    '',
    `<blockquote>${escapeTelegramHtml(review.comment)}</blockquote>`,
  ];

  if (review.creator_reply) {
    lines.push('', `<b>Balasan Creator:</b> ${escapeTelegramHtml(review.creator_reply)}`);
  }

  lines.push('', `<i>ID:</i> <code>${escapeTelegramHtml(review.id)}</code>`);

  if (statusLine) {
    lines.push('', statusLine);
  } else {
    lines.push('', '<i>Reply pesan ini di Telegram untuk membalas atas nama Creator &amp; otomatis approve.</i>');
  }

  return lines.join('\n');
}

export async function callTelegramApi<T = unknown>(
  botToken: string,
  method: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; result?: T; status: number }> {
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let data: { ok?: boolean; result?: T } = {};
  try {
    data = await resp.json();
  } catch {
    // Non-JSON error body; keep status only without echoing token
  }
  return {
    ok: resp.ok && Boolean(data.ok),
    result: data.result,
    status: resp.status,
  };
}

export function createSupabaseServiceClient(supabaseUrl: string, serviceRoleKey: string) {
  const baseUrl = supabaseUrl.replace(/\/+$/, '');
  const baseHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  return {
    async request(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
      return await fetch(`${baseUrl}/rest/v1/${pathAndQuery}`, {
        ...init,
        headers: {
          ...baseHeaders,
          ...(init.headers || {}),
        },
      });
    },
  };
}
