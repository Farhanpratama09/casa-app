/**
 * Supabase Edge Function: telegram-webhook
 * - Fail-closed verification via constant-time `X-Telegram-Bot-Api-Secret-Token` check
 * - Validates BOTH `from.id` and `chat.id` match `TELEGRAM_ADMIN_CHAT_ID`
 * - Supports 1-click Approve / Soft-Reject (`status = 'rejected'`) & Creator Quick Reply via reply_to_message
 */

import {
  type CasaReviewRow,
  callTelegramApi,
  createSupabaseServiceClient,
  escapeTelegramHtml,
  formatTelegramReviewCard,
  jsonResponse,
  timingSafeEqual,
} from '../_shared/helpers.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TelegramCallbackQuery {
  id: string;
  from?: { id?: number | string };
  data?: string;
  message?: {
    message_id?: number;
    chat?: { id?: number | string };
  };
}

interface TelegramMessage {
  message_id: number;
  text?: string;
  from?: { id?: number | string };
  chat?: { id?: number | string };
  reply_to_message?: {
    message_id?: number;
  };
}

interface TelegramUpdate {
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || '';
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() || '';
  const adminChatId = Deno.env.get('TELEGRAM_ADMIN_CHAT_ID')?.trim() || '';
  const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')?.trim() || '';

  // Fail closed when required runtime secrets are missing
  if (!supabaseUrl || !serviceRoleKey || !botToken || !adminChatId || webhookSecret.length < 12) {
    return jsonResponse({ error: 'Webhook not configured' }, 500);
  }

  const providedSecret = req.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!providedSecret || !timingSafeEqual(providedSecret, webhookSecret)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const db = createSupabaseServiceClient(supabaseUrl, serviceRoleKey);

  // 1. Handle Inline Keyboard Moderation Callbacks (`approve:<uuid>` | `delete:<uuid>`)
  if (update.callback_query) {
    const cq = update.callback_query;
    const fromId = String(cq.from?.id ?? '');
    const chatId = String(cq.message?.chat?.id ?? '');

    if (fromId !== adminChatId || chatId !== adminChatId) {
      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Akses moderasi ditolak.',
        show_alert: true,
      });
      return jsonResponse({ ok: true });
    }

    const rawData = typeof cq.data === 'string' ? cq.data : '';
    const sepIdx = rawData.indexOf(':');
    const action = sepIdx > 0 ? rawData.slice(0, sepIdx) : '';
    const reviewId = sepIdx > 0 ? rawData.slice(sepIdx + 1).trim() : '';

    if (!UUID_RE.test(reviewId) || (action !== 'approve' && action !== 'delete' && action !== 'reject')) {
      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Format aksi moderasi tidak valid.',
      });
      return jsonResponse({ ok: true });
    }

    const fetchResp = await db.request(
      `casa_reviews?id=eq.${encodeURIComponent(reviewId)}&select=id,author_name,rating,comment,app_version,status,creator_reply,replied_at,telegram_message_id,created_at`
    );
    const rows = fetchResp.ok ? ((await fetchResp.json()) as CasaReviewRow[]) : [];
    const existing = rows[0];

    if (!existing) {
      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Ulasan tidak ditemukan di database.',
      });
      return jsonResponse({ ok: true });
    }

    const messageId = cq.message?.message_id;

    if (action === 'approve') {
      if (existing.status === 'approved') {
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: 'Ulasan sudah berstatus APPROVED.',
        });
        return jsonResponse({ ok: true });
      }

      const patchResp = await db.request(`casa_reviews?id=eq.${encodeURIComponent(reviewId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'approved' }),
      });

      if (!patchResp.ok) {
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: 'Gagal menyetujui ulasan.',
        });
        return jsonResponse({ ok: true });
      }

      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '✅ Disetujui & live di web!',
      });

      if (messageId) {
        await callTelegramApi(botToken, 'editMessageText', {
          chat_id: adminChatId,
          message_id: messageId,
          text: formatTelegramReviewCard(existing, '<b>✅ APPROVED (Live di Web)</b>'),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[{ text: '🗑️ Hapus dari Web', callback_data: `delete:${existing.id}` }]],
          },
        });
      }
      return jsonResponse({ ok: true });
    }

    // Soft-reject (`delete:` / `reject:`): preserves row for rate-limit integrity & hides publicly
    if (existing.status === 'rejected') {
      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Ulasan sudah ditolak sebelumnya.',
      });
      return jsonResponse({ ok: true });
    }

    const rejectResp = await db.request(`casa_reviews?id=eq.${encodeURIComponent(reviewId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'rejected' }),
    });

    if (!rejectResp.ok) {
      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Gagal menolak ulasan.',
      });
      return jsonResponse({ ok: true });
    }

    await callTelegramApi(botToken, 'answerCallbackQuery', {
      callback_query_id: cq.id,
      text: '🗑️ Ditolak & disembunyikan dari web.',
    });

    if (messageId) {
      await callTelegramApi(botToken, 'editMessageText', {
        chat_id: adminChatId,
        message_id: messageId,
        text: formatTelegramReviewCard(existing, '<b>🚫 REJECTED (Disembunyikan)</b>'),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: '✅ Pulihkan & Approve', callback_data: `approve:${existing.id}` }]],
        },
      });
    }

    return jsonResponse({ ok: true });
  }

  // 2. Handle Creator Quick Reply via Telegram `reply_to_message`
  const msg = update.message;
  if (msg && msg.reply_to_message?.message_id) {
    const fromId = String(msg.from?.id ?? '');
    const chatId = String(msg.chat?.id ?? '');

    if (fromId !== adminChatId || chatId !== adminChatId) {
      return jsonResponse({ ok: true });
    }

    const replyText = (msg.text || '').trim();
    if (!replyText || replyText.length > 1000) {
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: adminChatId,
        reply_to_message_id: msg.message_id,
        text: 'Balasan harus berupa teks 1–1000 karakter.',
      });
      return jsonResponse({ ok: true });
    }

    const origMsgId = msg.reply_to_message.message_id;
    const findResp = await db.request(
      `casa_reviews?telegram_message_id=eq.${origMsgId}&select=id,author_name,rating,comment,app_version,status,creator_reply,replied_at,telegram_message_id,created_at`
    );
    const found = findResp.ok ? ((await findResp.json()) as CasaReviewRow[]) : [];
    const target = found[0];

    if (!target) {
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: adminChatId,
        reply_to_message_id: msg.message_id,
        text: 'Pesan tersebut tidak terhubung ke ulasan CASA mana pun.',
      });
      return jsonResponse({ ok: true });
    }

    const nowIso = new Date().toISOString();
    const updateResp = await db.request(`casa_reviews?id=eq.${encodeURIComponent(target.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        creator_reply: replyText,
        replied_at: nowIso,
        status: 'approved',
      }),
    });

    if (!updateResp.ok) {
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: adminChatId,
        reply_to_message_id: msg.message_id,
        text: 'Gagal menyimpan balasan Creator ke database.',
      });
      return jsonResponse({ ok: true });
    }

    const updatedReview: CasaReviewRow = {
      ...target,
      creator_reply: replyText,
      replied_at: nowIso,
      status: 'approved',
    };

    await callTelegramApi(botToken, 'editMessageText', {
      chat_id: adminChatId,
      message_id: origMsgId,
      text: formatTelegramReviewCard(
        updatedReview,
        '<b>✅ APPROVED + Creator Replied (Live di Web)</b>'
      ),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: '🗑️ Hapus dari Web', callback_data: `delete:${target.id}` }]],
      },
    });

    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: adminChatId,
      reply_to_message_id: msg.message_id,
      parse_mode: 'HTML',
      text: `✅ Balasan Creator untuk <b>${escapeTelegramHtml(target.author_name)}</b> tersimpan &amp; ulasan live di web.`,
    });

    return jsonResponse({ ok: true });
  }

  return jsonResponse({ ok: true });
});
