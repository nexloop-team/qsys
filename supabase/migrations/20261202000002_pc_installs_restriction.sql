-- A new PC restriction (Settings › PC app): players can't install or remove games and apps.
-- The PC app closes installers and uninstallers it recognises and hides Programs and Features;
-- see pc-agent/src-tauri/src/restrict.rs.
-- Apply after 20261202000001_station_page_live.sql.

-- The list of allowed restrictions is a check on the column: swap it for one with 'installs'.
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.branch_settings'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%pc_restrictions%'
  loop
    execute format('alter table public.branch_settings drop constraint %I', c);
  end loop;
end $$;

alter table public.branch_settings
  add constraint branch_settings_pc_restrictions_check
  check (pc_restrictions <@ array['task_manager', 'control_panel', 'command_line', 'usb_drives', 'installs']::text[]);
