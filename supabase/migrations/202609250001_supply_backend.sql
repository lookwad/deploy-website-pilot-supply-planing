create table public.supply_members (
  email text primary key check (email = lower(email)),
  display_name text not null,
  role text not null default 'planner' check (role in ('admin','central','planner')),
  factory text,
  created_at timestamptz not null default now()
);
alter table public.supply_members enable row level security;
revoke all on public.supply_members from anon, authenticated;
grant select on public.supply_members to authenticated;
create policy own_membership on public.supply_members for select to authenticated
using (email = lower(auth.jwt()->>'email'));

create table public.supply_datasets (
  id text primary key,
  name text not null,
  payload_gzip text not null,
  updated_at timestamptz not null default now()
);
alter table public.supply_datasets enable row level security;
revoke all on public.supply_datasets from anon, authenticated;
grant select on public.supply_datasets to authenticated;
create policy members_read_dataset on public.supply_datasets for select to authenticated
using (exists (select 1 from public.supply_members where email=lower(auth.jwt()->>'email')));

create table public.supply_plans (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload_gzip text not null check (length(payload_gzip) <= 16000000),
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.supply_plans enable row level security;
revoke all on public.supply_plans from anon, authenticated;
grant select on public.supply_plans to authenticated;
create policy own_plan on public.supply_plans for select to authenticated
using (owner_id=auth.uid() and exists (select 1 from public.supply_members where email=lower(auth.jwt()->>'email')));

create function public.save_supply_plan(payload text, expected_revision integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare new_revision integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.supply_members where email=lower(auth.jwt()->>'email')
  ) then raise exception 'Access denied' using errcode='42501'; end if;
  if expected_revision = 0 then
    insert into public.supply_plans(owner_id,payload_gzip) values(auth.uid(),payload)
    on conflict do nothing returning revision into new_revision;
  else
    update public.supply_plans set payload_gzip=payload, revision=revision+1, updated_at=now()
    where owner_id=auth.uid() and revision=expected_revision returning revision into new_revision;
  end if;
  if new_revision is null then raise exception 'PLAN_CONFLICT: reload before saving' using errcode='40001'; end if;
  return new_revision;
end;
$$;
revoke all on function public.save_supply_plan(text,integer) from public;
grant execute on function public.save_supply_plan(text,integer) to authenticated;
