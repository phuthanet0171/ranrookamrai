-- A LINE correction is previewed, confirmed once, and applied as an auditable replacement.
-- Install after 009_line.sql. Safe to re-run.
create or replace function line_correction_preview(p_user text, p_date date, p_menu uuid, p_quantity numeric)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if p_quantity <= 0 or p_quantity > 9999 then return null; end if;
  select jsonb_build_object('entry_id', e.id, 'quantity', s.quantity, 'remaining', s.quantity - p_quantity,
                            'amount_before', s.amount, 'amount_after', round(s.amount * (s.quantity - p_quantity) / s.quantity, 2))
    into result
  from line_links l
  join day_entries e on e.shop_id = l.shop_id and e.entry_date = p_date and e.voided_at is null
  join entry_sales s on s.entry_id = e.id and s.menu_item_id = p_menu
  where l.line_user_id = p_user and s.quantity >= p_quantity
  order by e.created_at desc, e.id desc limit 1;
  return result;
end $$;

create or replace function line_draft_confirm(p_draft uuid, p_user text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  d entry_drafts;
  original_entry day_entries;
  original_sale entry_sales;
  eid uuid;
  target_entry uuid;
  target_menu uuid;
  decrement numeric;
  expected_quantity numeric;
begin
  update entry_drafts set status = 'confirmed', resolved_at = now()
   where id = p_draft and line_user_id = p_user and status = 'pending' and created_at > now() - interval '1 day'
     and exists (select 1 from line_links where line_user_id = p_user and shop_id = entry_drafts.shop_id)
  returning * into d;
  if d.id is null then return null; end if;

  if d.parsed->>'kind' is distinct from 'decrement' then
    eid := shop_record_day(d.shop_id, coalesce(d.entry_date, current_date), d.parsed, 'line', d.author);
  else
    target_entry := (d.parsed->>'entry_id')::uuid;
    target_menu := (d.parsed->>'menu_item_id')::uuid;
    decrement := (d.parsed->>'quantity')::numeric;
    expected_quantity := (d.parsed->>'expected_quantity')::numeric;
    if decrement <= 0 or decrement > 9999 then raise exception 'จำนวนแก้ไขไม่ถูกต้อง'; end if;
    select * into original_entry from day_entries
      where id = target_entry and shop_id = d.shop_id and entry_date = d.entry_date and voided_at is null for update;
    if original_entry.id is null then raise exception 'รายการเดิมเปลี่ยนไปแล้ว กรุณาพิมพ์คำสั่งใหม่'; end if;
    select * into original_sale from entry_sales where entry_id = target_entry and menu_item_id = target_menu;
    if original_sale.entry_id is null or original_sale.quantity <> expected_quantity or original_sale.quantity < decrement
      then raise exception 'ยอดเดิมเปลี่ยนไปแล้ว กรุณาพิมพ์คำสั่งใหม่'; end if;

    insert into day_entries (shop_id, entry_date, source, author, note)
    values (d.shop_id, d.entry_date, 'line', d.author, left('แก้ยอดจาก ' || target_entry::text || ': ' || d.raw_text, 300))
    returning id into eid;
    insert into entry_sales (entry_id, menu_item_id, quantity, amount, unit_cost)
      select eid, menu_item_id,
             case when menu_item_id = target_menu then quantity - decrement else quantity end,
             case when menu_item_id = target_menu then round(amount * (quantity - decrement) / quantity, 2) else amount end,
             unit_cost
      from entry_sales where entry_id = target_entry
        and (menu_item_id <> target_menu or quantity > decrement);
    insert into entry_payments (entry_id, cash, transfer)
      select eid, cash, transfer from entry_payments where entry_id = target_entry;
    insert into entry_expenses (entry_id, category, description, amount)
      select eid, category, description, amount from entry_expenses where entry_id = target_entry;
    update day_entries set voided_at = now() where id = target_entry and shop_id = d.shop_id and voided_at is null;
  end if;
  update entry_drafts set entry_id = eid where id = d.id;
  return eid;
end $$;

revoke all on function line_correction_preview(text,date,uuid,numeric) from public;
revoke all on function line_draft_confirm(uuid,text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function line_correction_preview(text,date,uuid,numeric) from anon, authenticated;
    revoke all on function line_draft_confirm(uuid,text) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function line_correction_preview(text,date,uuid,numeric) to service_role;
    grant execute on function line_draft_confirm(uuid,text) to service_role;
  end if;
end $$;
