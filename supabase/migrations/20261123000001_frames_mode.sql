-- New timer mode: billed per frame (snooker, pool). Its own file, because Postgres only lets a new
-- enum value be used after the transaction that adds it has committed.
alter type public.session_mode add value if not exists 'frames';
