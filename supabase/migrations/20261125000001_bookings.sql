-- Bookings. Players ask for a time on the venue's public page (no login, no payment); staff confirm,
-- assign a station if they like, and mark arrived / no-show. Staff can also add phone bookings.
-- Free slots come from the number of active stations of that type minus overlapping bookings.
-- Opening hours are the branch's (Settings › Venue); 10:00 to 23:00 when not set.

alter table public.branch_settings
  add column booking_enabled boolean not null default false,
  -- Public address: /book/<slug>. Unique across QueSys.
  add column booking_slug text
    constraint branch_settings_booking_slug_check check (booking_slug is null or booking_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  add column booking_days int not null default 7 check (booking_days between 1 and 30),
  add column booking_note text check (booking_note is null or char_length(booking_note) <= 300);
create unique index branch_settings_booking_slug_idx on public.branch_settings (booking_slug);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  branch_id uuid not null,
  station_type public.station_type not null,
  station_id uuid references public.stations (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  name text not null check (char_length(name) between 2 and 80),
  phone text not null check (phone ~ '^[6-9][0-9]{9}$'),
  starts_at timestamptz not null,
  minutes int not null check (minutes between 30 and 480),
  players int not null default 1 check (players between 1 and 16),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'requested'
    check (status in ('requested', 'confirmed', 'arrived', 'cancelled', 'no_show')),
  source text not null default 'online' check (source in ('online', 'staff')),
  created_by uuid references auth.users (id) on delete set null,
  handled_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);
create index bookings_branch_starts_idx on public.bookings (branch_id, starts_at);
create index bookings_phone_idx on public.bookings (branch_id, phone);

create trigger bookings_updated_at before update on public.bookings
  for each row execute function private.set_updated_at();

alter table public.bookings enable row level security;
create policy bookings_select on public.bookings for select to authenticated
  using (private.has_org_role(org_id));
-- Writes only through the functions below.
revoke all on public.bookings from anon;
revoke insert, update, delete on public.bookings from authenticated;

alter publication supabase_realtime add table public.bookings;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Opening window of a business day (closing before opening = open past midnight).
create function private.booking_window(p_branch_id uuid, p_date date, out opens timestamptz, out closes timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  b public.branches;
  v_open time;
  v_close time;
begin
  select * into b from public.branches where id = p_branch_id;
  v_open := coalesce(b.opening_time, '10:00');
  v_close := coalesce(b.closing_time, '23:00');
  opens := (p_date + v_open) at time zone b.timezone;
  closes := (p_date + v_close) at time zone b.timezone;
  if v_close <= v_open then
    closes := closes + interval '1 day';
  end if;
end $$;

-- Stations of a type still free for [p_start, p_end): active stations minus overlapping bookings.
create function private.booking_free(p_branch_id uuid, p_type public.station_type, p_start timestamptz,
  p_end timestamptz, p_exclude uuid default null) returns int
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.stations
           where branch_id = p_branch_id and type = p_type and status = 'active')::int
       - (select count(*) from public.bookings
           where branch_id = p_branch_id and station_type = p_type
             and status in ('requested', 'confirmed')
             and id is distinct from p_exclude
             and starts_at < p_end and starts_at + make_interval(mins => minutes) > p_start)::int;
$$;

-- A station given to a booking can't be double-booked.
create function private.assert_station_free(p_station_id uuid, p_branch_id uuid, p_type public.station_type,
  p_start timestamptz, p_minutes int, p_exclude uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_other text;
begin
  if p_station_id is null then
    return;
  end if;
  if not exists (select 1 from public.stations where id = p_station_id and branch_id = p_branch_id and type = p_type) then
    raise exception 'Pick a station of the booked type.' using errcode = '22023';
  end if;
  select name into v_other from public.bookings
   where station_id = p_station_id and status in ('confirmed', 'arrived') and id is distinct from p_exclude
     and starts_at < p_start + make_interval(mins => p_minutes)
     and starts_at + make_interval(mins => minutes) > p_start
   limit 1;
  if v_other is not null then
    raise exception 'That station is already booked then (for %).', v_other using errcode = '22023';
  end if;
end $$;

create function private.booking_branch(p_slug text) returns public.branch_settings
language sql stable security definer set search_path = '' as $$
  select * from public.branch_settings
   where booking_slug = lower(trim(coalesce(p_slug, ''))) and booking_enabled;
$$;

-- ---------------------------------------------------------------------------
-- Public booking page (no login)
-- ---------------------------------------------------------------------------
create function public.public_booking_info(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  bs public.branch_settings;
  b public.branches;
begin
  bs := private.booking_branch(p_slug);
  if bs.branch_id is null then
    return jsonb_build_object('ok', false, 'error', 'This booking page isn''t available.');
  end if;
  select * into b from public.branches where id = bs.branch_id;
  return jsonb_build_object(
    'ok', true,
    'venue', (select name from public.orgs where id = b.org_id),
    'branch', b.name,
    'address', b.address,
    'phone', b.phone,
    'timezone', b.timezone,
    'opens', to_char(coalesce(b.opening_time, '10:00'), 'HH24:MI'),
    'closes', to_char(coalesce(b.closing_time, '23:00'), 'HH24:MI'),
    'days', bs.booking_days,
    'note', bs.booking_note,
    'today', (now() at time zone b.timezone)::date,
    'types', coalesce((
      select jsonb_agg(jsonb_build_object('type', type, 'count', n) order by array_position(
               array['pc', 'ps5', 'xbox', 'snooker', 'pool', 'other']::text[], type::text))
        from (select type, count(*) as n from public.stations
               where branch_id = b.id and status = 'active' and type = any (bs.station_types)
               group by type) t), '[]'));
end $$;

create function public.public_booking_slots(p_slug text, p_type public.station_type, p_date date, p_minutes int)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  bs public.branch_settings;
  v_tz text;
  v_today date;
  w record;
begin
  bs := private.booking_branch(p_slug);
  if bs.branch_id is null then
    raise exception 'This booking page isn''t available.' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes not between 30 and 480 or p_minutes % 30 <> 0 then
    raise exception 'Pick how long you want to play.' using errcode = '22023';
  end if;
  select timezone into v_tz from public.branches where id = bs.branch_id;
  v_today := (now() at time zone v_tz)::date;
  if p_date is null or p_date < v_today or p_date > v_today + bs.booking_days then
    return '[]'::jsonb;
  end if;
  select * into w from private.booking_window(bs.branch_id, p_date);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'time', to_char(t at time zone v_tz, 'HH24:MI'),
             'starts_at', t,
             'free', greatest(private.booking_free(bs.branch_id, p_type, t, t + make_interval(mins => p_minutes)), 0))
           order by t)
      from generate_series(w.opens, w.closes - make_interval(mins => p_minutes), interval '30 minutes') t
     where t >= now() + interval '30 minutes'), '[]'::jsonb);
end $$;

create function public.public_create_booking(
  p_slug text,
  p_type public.station_type,
  p_starts_at timestamptz,
  p_minutes int,
  p_players int,
  p_name text,
  p_phone text,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  bs public.branch_settings;
  v_tz text;
  v_phone text;
  v_local timestamp;
  w record;
  v_ok boolean := false;
  v_id uuid;
begin
  bs := private.booking_branch(p_slug);
  if bs.branch_id is null then
    raise exception 'This booking page isn''t available.' using errcode = '22023';
  end if;
  select timezone into v_tz from public.branches where id = bs.branch_id;

  if char_length(trim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'Enter your name.' using errcode = '22023';
  end if;
  v_phone := private.normalize_phone(p_phone);
  if p_minutes is null or p_minutes not between 30 and 480 or p_minutes % 30 <> 0 then
    raise exception 'Pick how long you want to play.' using errcode = '22023';
  end if;
  if coalesce(p_players, 0) not between 1 and 16 then
    raise exception 'Players must be between 1 and 16.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 300 then
    raise exception 'Keep the note under 300 characters.' using errcode = '22023';
  end if;
  if not (p_type = any (bs.station_types)) then
    raise exception 'Pick something this venue offers.' using errcode = '22023';
  end if;

  -- On a :00 or :30 slot, at least 30 minutes ahead, inside the booking window and opening hours.
  v_local := p_starts_at at time zone v_tz;
  if p_starts_at is null or extract(second from v_local) <> 0 or extract(minute from v_local) not in (0, 30)
     or p_starts_at < now() + interval '29 minutes'
     or v_local::date > (now() at time zone v_tz)::date + bs.booking_days then
    raise exception 'Pick one of the times shown.' using errcode = '22023';
  end if;
  for w in select * from private.booking_window(bs.branch_id, v_local::date)
           union all select * from private.booking_window(bs.branch_id, v_local::date - 1) loop
    if p_starts_at >= w.opens and p_starts_at + make_interval(mins => p_minutes) <= w.closes then
      v_ok := true;
    end if;
  end loop;
  if not v_ok then
    raise exception 'That time is outside opening hours.' using errcode = '22023';
  end if;

  -- One booking at a time per branch, so two people can't take the last free table together.
  perform pg_advisory_xact_lock(hashtext('booking:' || bs.branch_id::text));

  if (select count(*) from public.bookings
       where branch_id = bs.branch_id and phone = v_phone and status in ('requested', 'confirmed')
         and starts_at > now()) >= 2 then
    raise exception 'You already have 2 upcoming bookings here. Call the venue to book more.' using errcode = '22023';
  end if;
  if (select count(*) from public.bookings where branch_id = bs.branch_id and status = 'requested') >= 40 then
    raise exception 'The venue has many booking requests right now. Please call them.' using errcode = '22023';
  end if;
  if private.booking_free(bs.branch_id, p_type, p_starts_at, p_starts_at + make_interval(mins => p_minutes)) <= 0 then
    raise exception 'That time just filled up. Pick another time.' using errcode = '22023';
  end if;

  insert into public.bookings (org_id, branch_id, station_type, customer_id, name, phone, starts_at, minutes, players, note)
  values (bs.org_id, bs.branch_id, p_type,
          (select id from public.customers where org_id = bs.org_id and phone = v_phone),
          trim(p_name), v_phone, p_starts_at, p_minutes, p_players, nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.public_booking_info(text) from public;
revoke execute on function public.public_booking_slots(text, public.station_type, date, int) from public;
revoke execute on function public.public_create_booking(text, public.station_type, timestamptz, int, int, text, text, text) from public;
grant execute on function public.public_booking_info(text) to anon, authenticated;
grant execute on function public.public_booking_slots(text, public.station_type, date, int) to anon, authenticated;
grant execute on function public.public_create_booking(text, public.station_type, timestamptz, int, int, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
-- Add a booking taken by phone (confirmed straight away), or edit an open one.
create function public.save_booking(
  p_booking_id uuid,
  p_branch_id uuid,
  p_type public.station_type,
  p_starts_at timestamptz,
  p_minutes int,
  p_players int,
  p_phone text,
  p_name text default null,
  p_note text default null,
  p_station_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b public.branches;
  bk public.bookings;
  cu public.customers;
  v_id uuid;
begin
  select * into b from public.branches where id = p_branch_id;
  perform private.assert_member(b.org_id);
  if p_booking_id is not null then
    select * into bk from public.bookings where id = p_booking_id and branch_id = p_branch_id for update;
    if not found or bk.status not in ('requested', 'confirmed') then
      raise exception 'Only upcoming bookings can be changed.' using errcode = '22023';
    end if;
  end if;
  if p_starts_at is null or p_minutes is null or p_minutes not between 30 and 480 then
    raise exception 'Pick a time and a length of 30 minutes to 8 hours.' using errcode = '22023';
  end if;
  if coalesce(p_players, 0) not between 1 and 16 then
    raise exception 'Players must be between 1 and 16.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 300 then
    raise exception 'Keep the note under 300 characters.' using errcode = '22023';
  end if;

  cu := private.get_or_create_customer(b.org_id, p_phone, p_name);
  perform pg_advisory_xact_lock(hashtext('booking:' || b.id::text));
  perform private.assert_station_free(p_station_id, b.id, p_type, p_starts_at, p_minutes, p_booking_id);

  if p_booking_id is null then
    insert into public.bookings (org_id, branch_id, station_type, station_id, customer_id, name, phone, starts_at,
                                 minutes, players, note, status, source, created_by, handled_by)
    values (b.org_id, b.id, p_type, p_station_id, cu.id, cu.name, cu.phone, p_starts_at, p_minutes, p_players,
            nullif(trim(coalesce(p_note, '')), ''), 'confirmed', 'staff', auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.bookings
       set station_type = p_type, station_id = p_station_id, customer_id = cu.id, name = cu.name, phone = cu.phone,
           starts_at = p_starts_at, minutes = p_minutes, players = p_players,
           note = nullif(trim(coalesce(p_note, '')), ''), handled_by = auth.uid()
     where id = p_booking_id
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- confirmed (optionally with a station) · arrived · cancelled · no_show
create function public.set_booking_status(p_booking_id uuid, p_status text, p_station_id uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  bk public.bookings;
  cu public.customers;
begin
  select * into bk from public.bookings where id = p_booking_id for update;
  perform private.assert_member(bk.org_id);

  if not (
    (bk.status = 'requested' and p_status in ('confirmed', 'cancelled'))
    or (bk.status = 'confirmed' and p_status in ('confirmed', 'arrived', 'cancelled', 'no_show'))
  ) then
    raise exception 'This booking is already %.', replace(bk.status, '_', '-') using errcode = '22023';
  end if;

  if p_status = 'confirmed' then
    perform pg_advisory_xact_lock(hashtext('booking:' || bk.branch_id::text));
    perform private.assert_station_free(p_station_id, bk.branch_id, bk.station_type, bk.starts_at, bk.minutes, bk.id);
    -- Confirmed players join the venue's player list (one account per mobile).
    cu := private.get_or_create_customer(bk.org_id, bk.phone, bk.name);
    update public.bookings
       set status = 'confirmed', station_id = p_station_id, customer_id = cu.id, handled_by = auth.uid()
     where id = bk.id;
  else
    update public.bookings set status = p_status, handled_by = auth.uid() where id = bk.id;
  end if;
end $$;

revoke execute on function public.save_booking(uuid, uuid, public.station_type, timestamptz, int, int, text, text, text, uuid) from public, anon;
revoke execute on function public.set_booking_status(uuid, text, uuid) from public, anon;
grant execute on function public.save_booking(uuid, uuid, public.station_type, timestamptz, int, int, text, text, text, uuid) to authenticated;
grant execute on function public.set_booking_status(uuid, text, uuid) to authenticated;
