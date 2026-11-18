-- CASA Showcase Ratings & Reviews Schema (v2.0.3+)
-- Strict RLS: public `anon` reads ONLY via `casa_reviews_public` and `casa_review_stats` views.
-- Base table `casa_reviews` and `review_rate_limits` deny all direct `anon`/`authenticated` access.

create extension if not exists pgcrypto;

create table if not exists public.casa_reviews (
  id uuid primary key default gen_random_uuid(),
  author_name text not null
    check (char_length(trim(author_name)) between 1 and 40),
  rating smallint not null
    check (rating between 1 and 5),
  comment text not null
    check (char_length(trim(comment)) between 1 and 500),
  app_version text not null default 'v2.0.3'
    check (app_version ~ '^v[0-9]+\.[0-9]+\.[0-9]+$'),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  creator_reply text
    check (creator_reply is null or char_length(trim(creator_reply)) between 1 and 1000),
  replied_at timestamptz,
  telegram_message_id bigint unique,
  ip_hash text not null
    check (char_length(ip_hash) between 16 and 128),
  created_at timestamptz not null default now()
);

create index if not exists idx_casa_reviews_status_created
  on public.casa_reviews (status, created_at desc);

create index if not exists idx_casa_reviews_telegram_msg
  on public.casa_reviews (telegram_message_id)
  where telegram_message_id is not null;

-- Dedicated rate-limit ledger so rejected reviews still count toward abuse throttling
-- and IP hashes can be purged on a short 48-hour retention window independently of reviews.
create table if not exists public.review_rate_limits (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null
    check (char_length(ip_hash) between 16 and 128),
  created_at timestamptz not null default now()
);

create index if not exists idx_review_rate_limits_ip_created
  on public.review_rate_limits (ip_hash, created_at desc);

create index if not exists idx_review_rate_limits_created
  on public.review_rate_limits (created_at);

-- Enable strict Row Level Security and lock down base tables completely for non-service roles
alter table public.casa_reviews enable row level security;
alter table public.review_rate_limits enable row level security;

revoke all on table public.casa_reviews from anon, authenticated, public;
revoke all on table public.review_rate_limits from anon, authenticated, public;

-- Allow only service_role (Edge Functions) or table owner to access base tables.
-- Note: Views below intentionally run with view owner privileges (`security_invoker = false`)
-- so public visitors cannot inspect `ip_hash`, `telegram_message_id`, or unapproved rows.

create or replace view public.casa_reviews_public
  with (security_invoker = false)
as
  select
    id,
    author_name,
    rating,
    comment,
    app_version,
    creator_reply,
    replied_at,
    created_at
  from public.casa_reviews
  where status = 'approved';

create or replace view public.casa_review_stats
  with (security_invoker = false)
as
  select
    count(*)::bigint as total_reviews,
    coalesce(round(avg(rating)::numeric, 1), 0.0)::double precision as avg_rating,
    count(*) filter (where rating = 5)::bigint as count_5,
    count(*) filter (where rating = 4)::bigint as count_4,
    count(*) filter (where rating = 3)::bigint as count_3,
    count(*) filter (where rating = 2)::bigint as count_2,
    count(*) filter (where rating = 1)::bigint as count_1
  from public.casa_reviews
  where status = 'approved';

grant select on public.casa_reviews_public to anon, authenticated;
grant select on public.casa_review_stats to anon, authenticated;

-- Housekeeping helper: remove expired rate-limit IP hashes (> 48 hours) & stale pending spam (> 30 days)
create or replace function public.cleanup_casa_reviews_retention()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.review_rate_limits
  where created_at < now() - interval '48 hours';

  delete from public.casa_reviews
  where status = 'pending'
    and created_at < now() - interval '30 days';
end;
$$;

revoke all on function public.cleanup_casa_reviews_retention() from anon, authenticated, public;
