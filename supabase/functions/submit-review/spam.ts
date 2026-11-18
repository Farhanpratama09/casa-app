/**
 * Pure anti-spam & content validation module shared between Edge Function and Node unit tests.
 * Zero runtime-specific dependencies (runs identically on Deno & Node >= 22).
 */

export interface SpamEvaluationInput {
  author_name: string;
  rating: number;
  comment: string;
  website_hp?: unknown;
  elapsed_ms?: unknown;
}

export type SpamEvaluationAction = 'allow' | 'silent_drop' | 'reject_url';

export interface SpamEvaluationResult {
  action: SpamEvaluationAction;
  reason?: string;
}

const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

// Explicit URLs, www domains, shortlinks (t.me, wa.me), and domain extensions without catching normal prose/versions
const EXPLICIT_URL_RE = /(?:https?:\/\/|www\.|\bt\.me\/?|\bwa\.me\/?)/i;
const DOMAIN_EXT_RE =
  /(?:^|[\s(])[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.(?:com|xyz|id|net|io|org|gg|site|online|vip|club)(?=$|[\s/),!?;:])/i;

// Legitimate phrases containing "slot" that must never trigger gambling false positives
const BENIGN_SLOT_PHRASES_RE =
  /\b(?:time[\s_-]+slots?|skill[\s_-]+slots?|pill[\s_-]+slots?|widget[\s_-]+slots?|memory[\s_-]+slots?|ram[\s_-]+slots?|card[\s_-]+slots?|expansion[\s_-]+slots?|usb[\s_-]+slots?)\b/gi;

// Word-boundary gambling/spam keywords checked against NFKC + leet-normalized text
const SPAM_WORD_PATTERNS: RegExp[] = [
  /\bslots?\b/i,
  /\bgacor\b/i,
  /\bmaxwin\b/i,
  /\bzeus\b/i,
  /\bdepo\b/i,
  /\bwd\b/i,
  /\btogel\b/i,
  /\bcasino\b/i,
  /\bjud[io]l?\b/i,
];

export function normalizeReviewText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(ZERO_WIDTH_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForKeywordScan(normalized: string): string {
  // Neutralize harmless phrases ("time slot", "skill slot") before scanning standalone "slot"
  const safeMasked = normalized.replace(BENIGN_SLOT_PHRASES_RE, ' ');
  // Normalize common leetspeak characters inside alphabetical words (e.g. g4c0r -> gacor, sl0t -> slot)
  // only when flanked by letters or adjacent to letters so numbers like "v2.0.3" remain untouched.
  return safeMasked
    .toLowerCase()
    .replace(/(?<=[a-z])0|0(?=[a-z])/g, 'o')
    .replace(/(?<=[a-z])1|1(?=[a-z])/g, 'i')
    .replace(/(?<=[a-z])3|3(?=[a-z])/g, 'e')
    .replace(/(?<=[a-z])4|4(?=[a-z])/g, 'a')
    .replace(/(?<=[a-z])5|5(?=[a-z])/g, 's')
    .replace(/(?<=[a-z])7|7(?=[a-z])/g, 't');
}

export function containsDisallowedUrl(text: string): boolean {
  const normalized = normalizeReviewText(text);
  return EXPLICIT_URL_RE.test(normalized) || DOMAIN_EXT_RE.test(normalized);
}

export function containsSpamKeyword(text: string): boolean {
  const normalized = normalizeReviewText(text);
  const folded = normalizeForKeywordScan(normalized);
  return SPAM_WORD_PATTERNS.some((pattern) => pattern.test(folded));
}

export function evaluateReviewSubmission(input: SpamEvaluationInput): SpamEvaluationResult {
  // 1. Silent drop: honeypot populated
  if (typeof input.website_hp === 'string' && input.website_hp.trim().length > 0) {
    return { action: 'silent_drop', reason: 'honeypot' };
  }
  if (input.website_hp !== undefined && input.website_hp !== null && input.website_hp !== '') {
    return { action: 'silent_drop', reason: 'honeypot' };
  }

  // 2. Silent drop: inhuman instant submission via client monotonic `elapsed_ms`
  if (
    typeof input.elapsed_ms !== 'number' ||
    !Number.isFinite(input.elapsed_ms) ||
    input.elapsed_ms < 2500
  ) {
    return { action: 'silent_drop', reason: 'elapsed_too_fast' };
  }

  const combinedText = `${input.author_name} ${input.comment}`;

  // 3. Silent drop: gambling / spam keywords (after NFKC + zero-width strip + word boundaries)
  if (containsSpamKeyword(combinedText)) {
    return { action: 'silent_drop', reason: 'spam_keyword' };
  }

  // 4. Polite validation rejection: URL/links detected -> guide genuine bug reporters to GitHub Discussions
  if (containsDisallowedUrl(combinedText)) {
    return { action: 'reject_url', reason: 'contains_url' };
  }

  return { action: 'allow' };
}
