-- Let the next scheduler tick retry a rule only when it failed before delivery began.
-- A failed external send may have reached its recipient, so its claim stays in place.
create or replace function automation_release_unstarted(p_rule uuid, p_date date) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  update automation_rules set last_fired_on = null
   where id = p_rule and last_fired_on = p_date;
  return found;
end $$;

-- Turn on the four useful web notifications for an existing shop in one click.
-- Locking the shop keeps concurrent clicks from inserting duplicate defaults.
create or replace function automation_seed_defaults(p_shop uuid) returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  perform 1 from shops where id = p_shop for update;
  if not found then raise exception 'ไม่พบร้าน'; end if;
  insert into automation_rules (shop_id, kind, run_at, days, channel, threshold)
  select p_shop, v.kind, v.run_at::time, v.days, 'web', v.threshold
  from (values
    ('morning_summary', '08:00', array[1,2,3,4,5,6], null::numeric),
    ('missing_entry', '21:00', array[1,2,3,4,5,6], null::numeric),
    ('money_gap', '22:00', array[1,2,3,4,5,6,7], 100::numeric),
    ('weekly_summary', '08:30', array[1], null::numeric)
  ) as v(kind, run_at, days, threshold)
  where not exists (select 1 from automation_rules r where r.shop_id = p_shop and r.kind = v.kind);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function automation_release_unstarted(uuid,date) from public;
revoke all on function automation_seed_defaults(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function automation_release_unstarted(uuid,date) from anon, authenticated;
    revoke all on function automation_seed_defaults(uuid) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function automation_release_unstarted(uuid,date) to service_role;
    grant execute on function automation_seed_defaults(uuid) to service_role;
  end if;
end $$;
