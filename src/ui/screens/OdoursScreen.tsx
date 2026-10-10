import { useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addCategory, addOdour, archiveCategory, archiveOdour, renameCategory, renameOdour, restoreCategory, restoreOdour,
} from '../../data/catalogue';
import { db } from '../../data/db';
import { NOT_IN_CURRENT_LIST, sortCategories, sortOdours } from '../../domain/odours';
import type { Odour, OdourCategory } from '../../domain/types';
import { useMe } from '../../hooks/useMe';
import { useUnitData } from '../../hooks/useUnitData';
import { HeaderBar } from '../components/HeaderBar';
import { Sheet } from '../components/Sheet';

const card: CSSProperties = { marginTop: 16, padding: '8px 14px 14px', border: '1.5px solid var(--ink)', borderRadius: 'var(--radius)', background: 'var(--paper)' };
const row: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minHeight: 56, borderTop: '1px solid var(--rule)' };
const small: CSSProperties = { fontSize: 14, padding: '0 8px' };

type Dialog =
  | { kind: 'addCategory' }
  | { kind: 'addOdour'; category: OdourCategory }
  | { kind: 'renameCategory'; category: OdourCategory }
  | { kind: 'renameOdour'; odour: Odour }
  | { kind: 'archiveCategory'; category: OdourCategory }
  | { kind: 'archiveOdour'; odour: Odour }
  | null;

/**
 * The unit's odour catalogue (spec §13.4): categories and their odours. Trainer-only (the route sends handlers
 * home). "Remove" is archive: it hides the category or odour from the pickers, keeps its history and can be
 * undone from the Archived section. Names must be unique; a clash is explained in the sheet.
 */
export function OdoursScreen() {
  const me = useMe();
  const { categories, odours, loading } = useUnitData();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState('');

  if (loading || !me) return null;
  const ctx = { db, me };
  const active = sortCategories(categories.filter((c) => c.archived_at === null));
  const archivedCategories = sortCategories(categories.filter((c) => c.archived_at !== null));
  const categoryOf = (id: string) => categories.find((c) => c.id === id);
  const archivedOdours = sortOdours(odours.filter((o) => o.archived_at !== null));
  const close = () => setDialog(null);

  async function restore(what: () => Promise<void>) {
    setError('');
    try {
      await what();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore it.');
    }
  }

  return (
    <div className="screen">
      <HeaderBar title="Odours" onBack={() => navigate('/')} />
      <main className="pad">
        <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={() => setDialog({ kind: 'addCategory' })}>
          + Add category
        </button>
        {error && <p role="alert" className="error">{error}</p>}

        {active.map((category) => {
          const items = sortOdours(odours.filter((o) => o.category_id === category.id && o.archived_at === null));
          return (
            <section key={category.id} aria-label={category.name} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 56 }}>
                <h2 style={{ flex: 1, minWidth: 0, fontSize: 22, overflowWrap: 'break-word' }}>{category.name}</h2>
                <span style={{ display: 'flex', gap: 6, flex: 'none' }}>
                  <button type="button" className="btn" style={small} aria-label={`Rename ${category.name}`}
                    onClick={() => setDialog({ kind: 'renameCategory', category })}>Rename</button>
                  <button type="button" className="btn" style={small} aria-label={`Archive ${category.name}`}
                    onClick={() => setDialog({ kind: 'archiveCategory', category })}>Archive</button>
                </span>
              </div>
              {items.length === 0 && <p className="muted" style={{ margin: '4px 0 8px' }}>No odours yet</p>}
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {items.map((o) => (
                  <li key={o.id} style={row}>
                    <span data-odour-name style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: 700, overflowWrap: 'break-word' }}>{o.name}</span>
                    <span style={{ display: 'flex', gap: 6, flex: 'none' }}>
                      <button type="button" className="btn" style={small} aria-label={`Rename ${o.name}`}
                        onClick={() => setDialog({ kind: 'renameOdour', odour: o })}>Rename</button>
                      <button type="button" className="btn" style={small} aria-label={`Archive ${o.name}`}
                        onClick={() => setDialog({ kind: 'archiveOdour', odour: o })}>Archive</button>
                    </span>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn" style={{ width: '100%', marginTop: 10 }}
                aria-label={`Add odour to ${category.name}`} onClick={() => setDialog({ kind: 'addOdour', category })}>
                + Add odour
              </button>
            </section>
          );
        })}

        {(archivedCategories.length > 0 || archivedOdours.length > 0) && (
          <section aria-label="Archived" style={{ ...card, marginTop: 24 }}>
            <h2 style={{ fontSize: 22, minHeight: 48, display: 'flex', alignItems: 'center' }}>Archived</h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {archivedCategories.map((c) => (
                <li key={c.id} style={row}>
                  <span style={{ fontSize: 18, fontWeight: 700, overflowWrap: 'anywhere' }}>{c.name}</span>
                  <button type="button" className="btn btn-primary" style={small} aria-label={`Restore ${c.name}`}
                    onClick={() => restore(() => restoreCategory(ctx, c.id))}>Restore</button>
                </li>
              ))}
              {archivedOdours.map((o) => {
                const parent = categoryOf(o.category_id);
                const parentArchived = parent?.archived_at != null;
                return (
                  <li key={o.id} style={row}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 18, fontWeight: 700, overflowWrap: 'anywhere' }}>{o.name}</span>
                      <span className="muted" style={{ display: 'block' }}>{parent?.name ?? ''}</span>
                    </span>
                    {parentArchived ? (
                      <span className="muted" style={{ fontWeight: 700, textAlign: 'right' }}>Restore the category first</span>
                    ) : (
                      <button type="button" className="btn btn-primary" style={small} aria-label={`Restore ${o.name}`}
                        onClick={() => restore(() => restoreOdour(ctx, o.id))}>Restore</button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>

      {dialog?.kind === 'addCategory' && (
        <NameSheet title="New category" label="Category name" submitLabel="Add category" onClose={close}
          onSubmit={(name) => addCategory(ctx, name).then(() => undefined)} />
      )}
      {dialog?.kind === 'addOdour' && (
        <NameSheet title={`New odour in ${dialog.category.name}`} label="Odour name" submitLabel="Add odour" onClose={close}
          onSubmit={(name) => addOdour(ctx, dialog.category.id, name).then(() => undefined)} />
      )}
      {dialog?.kind === 'renameCategory' && (
        <NameSheet title="Rename category" label="Category name" submitLabel="Save name" initial={dialog.category.name} onClose={close}
          onSubmit={(name) => renameCategory(ctx, dialog.category.id, name)} />
      )}
      {dialog?.kind === 'renameOdour' && (
        <NameSheet title="Rename odour" label="Odour name" submitLabel="Save name" initial={dialog.odour.name} onClose={close}
          onSubmit={(name) => renameOdour(ctx, dialog.odour.id, name)} />
      )}
      {dialog?.kind === 'archiveCategory' && (
        <ConfirmSheet title="Archive category" confirmLabel={`Archive ${dialog.category.name}`} onClose={close}
          text={`Archive ${dialog.category.name}? It and its odours disappear from the team pickers. Time already logged stays in the log, marked ${NOT_IN_CURRENT_LIST}. You can restore it from Archived.`}
          onConfirm={() => archiveCategory(ctx, dialog.category.id)} />
      )}
      {dialog?.kind === 'archiveOdour' && (
        <ConfirmSheet title="Archive odour" confirmLabel={`Archive ${dialog.odour.name}`} onClose={close}
          text={`Archive ${dialog.odour.name}? It disappears from the team pickers. Time already logged stays in the log, marked ${NOT_IN_CURRENT_LIST}. You can restore it from Archived.`}
          onConfirm={() => archiveOdour(ctx, dialog.odour.id)} />
      )}
    </div>
  );
}

interface NameSheetProps {
  title: string;
  label: string;
  submitLabel: string;
  initial?: string;
  onClose: () => void;
  /** Throws (a DuplicateNameError, say) to keep the sheet open with the reason shown under the field. */
  onSubmit: (name: string) => Promise<void>;
}

function NameSheet({ title, label, submitLabel, initial = '', onClose, onSubmit }: NameSheetProps) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Try again.');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={title}>
      <form onSubmit={submit}>
        <label className="label" htmlFor="catalogue-name">{label}</label>
        <input id="catalogue-name" className="field" value={name} autoComplete="off"
          aria-invalid={error ? true : undefined} aria-describedby={error ? 'catalogue-error' : undefined}
          onChange={(e) => { setName(e.target.value); setError(''); }} />
        {error && <p id="catalogue-error" role="alert" className="error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()} style={{ width: '100%', marginTop: 16 }}>
          {submitLabel}
        </button>
      </form>
    </Sheet>
  );
}

function ConfirmSheet({ title, text, confirmLabel, onClose, onConfirm }: {
  title: string; text: string; confirmLabel: string; onClose: () => void; onConfirm: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Try again.');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={title}>
      <p style={{ fontSize: 18, overflowWrap: 'anywhere' }}>{text}</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button type="button" className="btn" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={confirm}>{confirmLabel}</button>
      </div>
    </Sheet>
  );
}
