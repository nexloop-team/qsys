-- Venues take cash and UPI only. New card payments are rejected; old card rows stay
-- (NOT VALID skips existing rows) so past bills and exports still add up.
-- The enum keeps 'card' because Postgres can't drop enum values.
alter table public.payments
  add constraint payments_cash_or_upi check (method in ('cash', 'upi')) not valid;
