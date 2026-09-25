-- College Timetable Generator: Supabase schema.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create extension if not exists "pgcrypto";

-- One row per saved timetable. The full input and result are kept as JSON so
-- a timetable can be reopened exactly as it was generated.
create table if not exists public.timetables (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    status      text not null check (status in ('ok', 'infeasible', 'invalid')),
    input       jsonb not null,
    result      jsonb not null,
    created_at  timestamptz not null default now()
);

-- One row per (division, day, period). Stored as plain rows as well, so you can
-- query "what is Prof. Joshi teaching on Monday?" with SQL.
create table if not exists public.timetable_entries (
    id            bigint generated always as identity primary key,
    timetable_id  uuid not null references public.timetables(id) on delete cascade,
    division      text not null,
    day           text not null,
    period        int  not null check (period >= 1),
    subject       text not null,
    subject_type  text not null check (subject_type in ('THEORY', 'LAB')),
    teacher       text not null,
    room          text not null,
    block_id      int  not null,
    -- The database refuses clashes too, as a last line of defence.
    unique (timetable_id, division, day, period),
    unique (timetable_id, teacher,  day, period),
    unique (timetable_id, room,     day, period)
);

create index if not exists timetables_created_at_idx on public.timetables (created_at desc);
create index if not exists timetable_entries_tt_idx  on public.timetable_entries (timetable_id);

-- Row Level Security on, with no public policies: the browser can't read or
-- write these tables directly. Only the FastAPI backend, using the
-- service-role key, can (the service role bypasses RLS).
alter table public.timetables        enable row level security;
alter table public.timetable_entries enable row level security;
