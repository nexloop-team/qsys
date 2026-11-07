-- Contact form on the public website. Visitors (signed in or not) send a message; it is stored
-- here and read by the QueSys team in the Supabase dashboard (Table Editor › contact_messages).
-- Nobody can read messages through the app's API.

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  email text check (email is null or (char_length(email) <= 120 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone text check (phone is null or phone ~ '^[0-9]{10}$'),
  venue text check (venue is null or char_length(venue) <= 80),
  topic text not null check (topic in ('setup', 'pricing', 'pc_app', 'support', 'other')),
  message text not null check (char_length(message) between 10 and 2000),
  -- A one-way hash of the sender's network address, only to limit floods. Never the address itself.
  sender_hash text,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (email is not null or phone is not null)
);
create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);
create index if not exists contact_messages_sender_idx on public.contact_messages (sender_hash, created_at);

alter table public.contact_messages enable row level security;
-- No policies: the table can't be read or written through the API, only by the function below.
revoke all on public.contact_messages from public, anon, authenticated;

create or replace function public.submit_contact_message(
  p_name text,
  p_email text,
  p_phone text,
  p_venue text,
  p_topic text,
  p_message text,
  p_sender_hash text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
begin
  if v_phone is not null and length(v_phone) = 12 and left(v_phone, 2) = '91' then
    v_phone := substr(v_phone, 3);
  end if;
  if nullif(trim(coalesce(p_email, '')), '') is null and v_phone is null then
    raise exception 'Give an email or a mobile number so we can reply.' using errcode = '22023';
  end if;

  -- Flood limits: 5 an hour from one sender, 300 a day in total.
  if p_sender_hash is not null and (
    select count(*) from public.contact_messages
     where sender_hash = p_sender_hash and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many messages for now. Please try again in an hour.' using errcode = '22023';
  end if;
  if (select count(*) from public.contact_messages where created_at > now() - interval '1 day') >= 300 then
    raise exception 'We''re getting a lot of messages right now. Please try again later.' using errcode = '22023';
  end if;

  insert into public.contact_messages (name, email, phone, venue, topic, message, sender_hash, user_id)
  values (
    trim(p_name),
    nullif(lower(trim(coalesce(p_email, ''))), ''),
    v_phone,
    nullif(trim(coalesce(p_venue, '')), ''),
    p_topic,
    trim(p_message),
    left(p_sender_hash, 64),
    auth.uid()
  );
end $$;

revoke execute on function public.submit_contact_message(text, text, text, text, text, text, text) from public;
grant execute on function public.submit_contact_message(text, text, text, text, text, text, text) to anon, authenticated;
