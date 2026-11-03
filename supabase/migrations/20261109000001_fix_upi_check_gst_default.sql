-- Fix: the UPI ID check used {2,256}, but Postgres regexes allow repeat counts up to 255 only,
-- so every save with a UPI ID failed ("invalid repetition count(s)"). Real UPI handles are short.
alter table public.branch_settings drop constraint if exists branch_settings_upi_vpa_check;
alter table public.branch_settings
  add constraint branch_settings_upi_vpa_check
  check (upi_vpa is null or upi_vpa ~ '^[a-z0-9._-]{2,64}@[a-z0-9]{2,64}$');

-- New branches: prices are entered without GST unless the owner says otherwise.
alter table public.branch_settings alter column prices_include_tax set default false;
