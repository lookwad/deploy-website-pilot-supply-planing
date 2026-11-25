-- Who may log in. Run in Supabase SQL Editor; edit the rows first.
-- role: admin | central | planner   (planner can be tied to one factory name)
insert into public.supply_members (email, display_name, role, factory) values
  ('your.name@company.com', 'Your Name', 'admin', null)
  -- ,('planner@company.com', 'Planner A', 'planner', 'โรงชำแหละสุกรแปดริ้ว')
on conflict (email) do update
  set display_name = excluded.display_name, role = excluded.role, factory = excluded.factory;
