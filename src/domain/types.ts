export type Role = 'trainer' | 'handler';
export type SessionKind = 'timed' | 'manual';

export interface Unit {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  updated_at?: string;
}

export interface Member {
  id: string;
  unit_id: string;
  user_id: string;
  name: string;
  role: Role;
  joined_at: string;
  removed_at: string | null;
  updated_at?: string;
}

export interface Dog {
  id: string;
  unit_id: string;
  name: string;
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
