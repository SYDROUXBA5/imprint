import Dexie, { type Table } from 'dexie';
import type {
  Correction, Dog, Member, Odour, OdourCategory, Session, Team, TeamOdour, Unit,
} from '../domain/types';

export type SyncedTable =
  | 'dogs' | 'sessions' | 'corrections' | 'teams' | 'odour_categories' | 'odours' | 'team_odours';

export interface OutboxItem {
  seq?: number;
  table: SyncedTable;
  op: 'insert' | 'update';
  row: Record<string, unknown> & { id: string };
  created_at: string;
  status: 'pending' | 'rejected';
  error?: string;
}

export interface MetaRow { key: string; value: unknown }

/** Meta key holding the signed-in member, so the app works offline. */
export const ME_KEY = 'me';

export class ImprintDB extends Dexie {
  units!: Table<Unit, string>;
  members!: Table<Member, string>;
  teams!: Table<Team, string>;
  odour_categories!: Table<OdourCategory, string>;
  odours!: Table<Odour, string>;
  team_odours!: Table<TeamOdour, string>;
  dogs!: Table<Dog, string>;
  sessions!: Table<Session, string>;
  corrections!: Table<Correction, string>;
  outbox!: Table<OutboxItem, number>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'imprint') {
    super(name);
    this.version(1).stores({
      units: 'id',
      members: 'id, unit_id, user_id',
      dogs: 'id, unit_id',
      sessions: 'id, dog_id, [dog_id+odour_id], handler_id',
      corrections: 'id, session_id',
      outbox: '++seq, status',
      meta: 'key',
    });
    // Spec §13: teams, the odour catalogue, and a team on every dog. No data migration: the server's
    // migration 0005 touches every dog and session, so the next pull replaces the old copies.
    this.version(2).stores({
      dogs: 'id, unit_id, team_id',
      teams: 'id, unit_id',
      odour_categories: 'id, unit_id',
      odours: 'id, unit_id, category_id',
      team_odours: 'id, team_id, odour_id, unit_id',
    });
  }
}

export const db = new ImprintDB();
