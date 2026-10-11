-- Imprint: the number of dogs a team is planned to hold ("2 of 6 dogs"). It is a planned size only; it
-- does not create dogs. Nullable on purpose: teams created before this migration have none, and an app
-- version that does not know the column yet must keep inserting teams. "Required when a team is created"
-- is enforced by the app, not here.
--
-- Nothing else changes. teams_before_update() only freezes id, unit_id and created_by, and the
-- teams_insert / teams_update policies already say who writes (active trainers of the unit), so the new
-- column is covered. teams is already in the supabase_realtime publication (0006), with every column.

alter table public.teams
  add column planned_dogs integer,
  add constraint teams_planned_dogs_positive check (planned_dogs is null or planned_dogs >= 1);
