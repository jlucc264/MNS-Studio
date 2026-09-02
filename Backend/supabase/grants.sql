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

alter table public.creator_signatures
add column if not exists grid_json jsonb;

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

-- Generating the PDF is not the same event as the canvas coming off the roll
-- intact. We stamp this when the PDF is built, and leave the order in the
-- queue until the operator confirms the print actually worked.
alter table public.print_orders
add column if not exists pdf_generated_at timestamptz;

-- One row per roll-print run. page_length_inches is stored alongside the
-- calibration values because each of them is relative to it — a 0.3" skew
-- means nothing without knowing it spanned 18".
create table if not exists public.print_runs (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  roll_width_inches numeric,
  copies integer,
  y_scale numeric,
  x_offset_inches numeric,
  skew_correction_inches numeric,
  side_margin_inches numeric,
  gap_inches numeric,
  logo_x_offset_inches numeric,
  logo_y_offset_inches numeric,
  include_alignment_test boolean,
  page_length_inches numeric,
  project_ids jsonb,
  print_order_ids jsonb,
  designs jsonb
);

-- It usually takes a few PDFs before one prints correctly, so the log needs to
-- say which attempt actually worked. Without this every run looks equally
-- authoritative and "reuse settings" is a coin flip.
alter table public.print_runs
add column if not exists outcome text;

alter table public.print_runs
add column if not exists outcome_note text;

alter table public.print_runs
add column if not exists outcome_at timestamptz;

-- Shear across the roll's width (one side printing "ahead" of the other),
-- distinct from skew_correction_inches which corrects drift along the feed.
alter table public.print_runs
add column if not exists skew_correction_y_inches numeric;

-- One row per like/sale notification surfaced to a creator in the bell
-- dropdown. gallery_item_title is denormalized so the dropdown never needs
-- a join back to gallery_items (which may itself get deleted later).
create table if not exists public.notifications (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  user_id text not null,
  type text not null,
  gallery_item_id text,
  gallery_item_title text,
  actor_user_id text,
  read boolean not null default false
);

-- Sale price wasn't persisted historically — it only lived in the Stripe
-- session, used once for the confirmation email. Needed so orders can be
-- read back as revenue instead of re-querying Stripe every time.
alter table public.print_orders
add column if not exists amount_total_cents integer;

-- The margin this order was PRICED at, and whether that was the buyer choosing
-- to drop a roll tier for a slightly narrower border. Stored rather than
-- re-derived from width/height: a downgraded order recomputes to the standard
-- margin and a wider canvas, which would then be printed onto stock it does
-- not fit. NULL margin means the default, i.e. every order placed before the
-- option existed.
alter table public.print_orders
add column if not exists canvas_margin_inches numeric;

alter table public.print_orders
add column if not exists tier_downgrade boolean not null default false;

-- How the design was actually created ('blank' or 'import'), so the gallery
-- publish flow can tag it correctly even if the studio session that created
-- it ended and the draft was resumed later. Distinct from source_type, which
-- is a stitching-algorithm hint that defaults to 'photo' regardless of origin
-- and was previously (wrongly) read as an origin signal, mislabeling every
-- from-scratch canvas as "from photo".
alter table public.projects
add column if not exists design_origin text;

-- A reusable starting point for expenses that recur but vary in amount each
-- time (e.g. a canvas roll purchase) — default_amount_cents just prefills the
-- log form, it is never treated as authoritative.
create table if not exists public.expense_templates (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  name text not null,
  category text,
  default_amount_cents integer,
  notes text,
  archived boolean not null default false
);

-- One row per actual expense. name/category/amount are copied from the
-- template at log time (denormalized, same pattern as gallery_item_title in
-- notifications) so editing or archiving a template never rewrites history.
-- template_id is kept only to group/trace occurrences back to their template.
create table if not exists public.expenses (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  template_id uuid references public.expense_templates(id) on delete set null,
  name text not null,
  category text,
  amount_cents integer not null,
  incurred_on date not null,
  notes text
);

grant usage on schema public to service_role;

grant select, insert, update, delete on table public.projects to service_role;
grant select, insert, update, delete on table public.gallery_items to service_role;
grant select, insert, update, delete on table public.gallery_likes to service_role;
grant select, insert, update on table public.creator_earnings to service_role;
grant select, insert, update, delete on table public.creator_signatures to service_role;
grant select, insert, update, delete on table public.print_orders to service_role;
grant select, insert, update on table public.print_runs to service_role;
grant select, insert, update on table public.notifications to service_role;
grant select, insert, update, delete on table public.expense_templates to service_role;
grant select, insert, update, delete on table public.expenses to service_role;

grant usage, select on all sequences in schema public to service_role;
