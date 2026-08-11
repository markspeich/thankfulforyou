update public.order_items
set source_json = source_json - 'customizationNeeded'
where source_json -> 'customizationNeeded' = 'true'::jsonb
  and lower(coalesce(source_json ->> 'marketplace', '')) <> 'amazon';
