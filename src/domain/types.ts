export type Role = 'trainer' | 'handler';
export type SessionKind = 'timed' | 'manual';

/** The nine breed ids of spec §13.3. */
export type BreedId =
  | 'malinois' | 'german-shepherd' | 'dutch-shepherd' | 'labrador' | 'golden-retriever'
  | 'bloodhound' | 'hound' | 'springer-spaniel' | 'other';
/** A label only; it changes no behaviour. */
export type Purpose = 'single' | 'dual';

export interface Unit {
  id: string;
  name: string;
  created_at: string;
  updated_at?: string;
}

/** A name on one of the two lists ("Who are you?"). `role` says which list; it is not what anyone may do. */
export interface Member {
  id: string;
  unit_id: string;
  user_id?: string | null;
  name: string;
  role: Role;
  joined_at: string;
  removed_at: string | null;
  updated_at?: string;
}

/**
 * Who this phone is right now. `role` is the scope of the link the phone entered by: the one thing that
 * decides what it may do. `id` and `name` are the name it picked.
 */
export interface Me {
  id: string;
  unit_id: string;
  role: Role;
  name: string;
}

/** A named group of dogs inside the unit (spec §13.1). */
export interface Team {
  id: string;
  unit_id: string;
  name: string;
  created_by: string;
  created_at: string;
  archived_at: string | null;
  /**
   * How many dogs the team is planned to hold ("2 of 6 dogs"); a plan only, it creates no dogs. Null for a
   * team made before the number was asked for. A row stored before the field existed has no such key at all,
   * so read it with `== null`, never `=== null`.
   */
  planned_dogs: number | null;
  updated_at?: string;
}

export interface OdourCategory {
  id: string;
  unit_id: string;
  name: string;
  sort: number;
  created_at: string;
  archived_at: string | null;
  updated_at?: string;
}

/** One odour of the unit's catalogue (spec §13.4). Sessions point at it by `id`. */
export interface Odour {
  id: string;
  unit_id: string;
  category_id: string;
  name: string;
  created_at: string;
  archived_at: string | null;
  updated_at?: string;
}

/**
 * Whether a team trains on an odour. The server row is keyed (team_id, odour_id); here `id` is
 * `teamOdourId(team_id, odour_id)` so the outbox and the local table can key it like the rest.
 * Rows are never deleted: unticking sets `selected` to false.
 */
export interface TeamOdour {
  id: string;
  team_id: string;
  odour_id: string;
  unit_id: string;
  selected: boolean;
  updated_at?: string;
}

/** Everything the dog screen, timer, log and reports need to name and group odours. */
export interface Catalogue {
  categories: OdourCategory[];
  odours: Odour[];
  teamOdours: TeamOdour[];
}

export interface Dog {
  id: string;
  unit_id: string;
  team_id: string;
  name: string;
  breed: BreedId;
  purpose: Purpose;
  created_by: string;
  created_at: string;
  archived_at: string | null;
  updated_at?: string;
}

export interface Session {
  id: string;
  unit_id: string;
  dog_id: string;
  odour_id: string;
  handler_id: string;
  kind: SessionKind;
  /** Local calendar date, YYYY-MM-DD. */
  session_date: string;
  started_at: string | null;
  ended_at: string | null;
  duration_s: number | null;
  client_clock_offset_s: number | null;
  server_received_at: string | null;
  updated_at?: string;
}

export interface Correction {
  id: string;
  session_id: string;
  unit_id: string;
  trainer_id: string;
  void: boolean;
  new_duration_s: number | null;
  reason: string;
  created_at: string;
  updated_at?: string;
}
