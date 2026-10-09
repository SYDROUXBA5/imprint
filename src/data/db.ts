import Dexie, { type Table } from 'dexie';
import type { Correction, Dog, Member, Session, Unit } from '../domain/types';

export type SyncedTable = 'dogs' | 'sessions' | 'corrections';

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
  }
}

export const db = new ImprintDB();
