-- Supabase / Postgres schema for the certificate site.
--
-- Paste this into Supabase → SQL Editor → New query → Run. It is the whole
-- schema: the site keeps its entire document (registrations, task receipts,
-- certificate serials, artwork calibration) in one row.
--
-- Why one row and not a table per student: the app was written around a single
-- document, and one row means a save is a single atomic statement. Writes are
-- conditional on `version`, so two serverless instances can never overwrite
-- each other — the loser notices, reloads and retries.

create table if not exists state (
  id      int   primary key,
  doc     jsonb not null,
  version int   not null default 0
);

-- The document holds student names and the admin key. Row-level security with
-- no policies means the public anon key can read nothing at all; the server
-- uses the service_role key, which bypasses RLS.
alter table state enable row level security;

-- Grants. A table created in the SQL editor belongs to the postgres role, and in
-- some projects that leaves service_role with no privileges on it — every request
-- then fails with "permission denied for table state" (code 42501). The first
-- deployment caught exactly this, so these lines are part of the schema now.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.state to service_role;

-- The app creates the row itself on first boot (id = 1), so there is no insert
-- to run here.
--
-- Safe to run again: every statement here is idempotent, so if you already ran an
-- earlier version of this file, re-running it after an edit does no harm.
