-- Floor map: stations can face any of four ways (a PC's monitor against the north, east,
-- south or west wall), not just upright or sideways.

alter table public.stations drop constraint if exists stations_layout_rot_check;
alter table public.stations
  add constraint stations_layout_rot_check check (layout_rot in (0, 90, 180, 270));
