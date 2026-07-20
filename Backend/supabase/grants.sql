-- Run this in the Supabase SQL editor if backend gallery/project requests
-- fail with permission denied for tables used through the REST API.

alter table public.gallery_items
add column if not exists submitter_name text;

alter table public.gallery_items
add column if not exists palette jsonb;

alter table public.gallery_items
add column if not exists has_outline boolean default false;

alter table public.projects
add column if not exists simplify_colors boolean,
add column if not exists strengthen_dark_detail boolean,
add column if not exists preserve_accents boolean;

create table if not exists public.creator_earnings (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  stripe_session_id text unique not null,
  creator_user_id text not null,
  gallery_item_id text not null,
  order_type text not null,
  amount_cents integer not null default 450,
  paid_out boolean not null default false,
  paid_out_at timestamptz
);

create table if not exists public.creator_signatures (
  user_id text primary key,
  image_url text not null,
  updated_at timestamptz default now()
);

create table if not exists public.print_orders (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  stripe_session_id text not null,
  order_type text not null,
  project_id text,
  gallery_item_id text,
  buyer_user_id text,
  title text,
  width_inches numeric,
  height_inches numeric,
  status text not null default 'pending',
  printed_at timestamptz
);

grant usage on schema public to service_role;

grant select, insert, update, delete on table public.projects to service_role;
grant select, insert, update, delete on table public.gallery_items to service_role;
grant select, insert, update, delete on table public.gallery_likes to service_role;
grant select, insert, update on table public.creator_earnings to service_role;
grant select, insert, update, delete on table public.creator_signatures to service_role;
grant select, insert, update, delete on table public.print_orders to service_role;

grant usage, select on all sequences in schema public to service_role;
