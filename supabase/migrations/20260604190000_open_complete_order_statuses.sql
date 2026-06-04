alter table public.order_items
  drop constraint if exists order_items_status_check;

update public.order_items
set status = case
  when status in ('complete', 'produced', 'shipped') then 'complete'
  else 'open'
end;

alter table public.order_items
  alter column status set default 'open';

alter table public.order_items
  add constraint order_items_status_check
  check (status in ('open', 'complete'));
