-- Historical day snapshots remain distinct from individually logged meals.
-- One ALTER statement replaces the constraint atomically; existing records,
-- source identities, revision history and owner policies are unchanged.
alter table public.remy_records
  drop constraint remy_records_kind_check,
  add constraint remy_records_kind_check check (
    kind in (
      'profile','meal','workout','plan','recovery','day','connection','import',
      'message','proposal','savedMeal','dailySummary'
    )
  );
