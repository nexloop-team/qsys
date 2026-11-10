-- Frames sessions have no planned end, but the original rule on sessions said every
-- non-open session needs one (`mode = 'open' or planned_end_at is not null`), so starting
-- a frames game always failed. Only fixed time ('prepaid') counts down to an end.
alter table public.sessions drop constraint if exists sessions_check;
alter table public.sessions
  add constraint sessions_planned_end_check check (mode <> 'prepaid' or planned_end_at is not null);
