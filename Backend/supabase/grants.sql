-- Run this in the Supabase SQL editor if backend gallery/project requests
-- fail with permission denied for tables used through the REST API.

alter table public.gallery_items
add column if not exists submitter_name text;

alter table public.projects
add column if not exists simplify_colors boolean,
add column if not exists strengthen_dark_detail boolean,
add column if not exists preserve_accents boolean;

grant usage on schema public to service_role;

grant select, insert, update, delete on table public.projects to service_role;
grant select, insert, update, delete on table public.gallery_items to service_role;
grant select, insert, update, delete on table public.gallery_likes to service_role;

grant usage, select on all sequences in schema public to service_role;
