import { sortCategories, sortOdours } from '../../domain/odours';
import type { Odour, OdourCategory } from '../../domain/types';
import { plural } from '../shared';

interface OdourPickerProps {
  categories: readonly OdourCategory[];
  odours: readonly Odour[];
  /** Ids of the ticked odours. */
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}

/**
 * Which odours a team trains on (spec §13.4): the catalogue's categories, each with a check box per odour
 * and a "Select all" for the category. Archived categories and odours are not offered. An id in `selected`
 * that is not on offer (an archived odour) is neither shown nor counted, but is kept in what is reported.
 */
export function OdourPicker({ categories, odours, selected, onChange }: OdourPickerProps) {
  const groups = sortCategories(categories.filter((c) => c.archived_at === null)).map((category) => ({
    category,
    odours: sortOdours(odours.filter((o) => o.category_id === category.id && o.archived_at === null)),
  }));
  const offered = new Set(groups.flatMap((g) => g.odours.map((o) => o.id)));
  const count = [...selected].filter((id) => offered.has(id)).length;

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id); else next.delete(id);
    onChange(next);
  };
  const toggleAll = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    onChange(next);
  };

  return (
    <div>
      <p role="status" className="num" style={{ margin: '0 0 8px', fontWeight: 800 }}>
        {count === 0 ? 'No odours selected' : `${plural(count, 'odour')} selected`}
      </p>
      {groups.map(({ category, odours: items }) => {
        const ids = items.map((o) => o.id);
        const all = ids.length > 0 && ids.every((id) => selected.has(id));
        return (
          <div key={category.id} role="group" aria-label={category.name} style={{
            marginBottom: 12, padding: '4px 12px 8px', border: '1.5px solid var(--ink)', borderRadius: 'var(--radius)',
            background: 'var(--paper)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <h3 style={{ fontSize: 20, overflowWrap: 'anywhere' }}>{category.name}</h3>
              {items.length > 0 && (
                <button type="button" className="btn" aria-pressed={all} aria-label={`Select all ${category.name}`}
                  onClick={() => toggleAll(ids, !all)}
                  style={{ fontSize: 15, padding: '0 14px', background: all ? 'var(--ink)' : 'var(--paper)', color: all ? 'var(--paper)' : 'var(--ink)' }}>
                  Select all
                </button>
              )}
            </div>
            {items.length === 0 && <p className="muted" style={{ margin: '4px 0 8px' }}>No odours yet</p>}
            {items.map((o) => (
              <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 'var(--tap)', fontSize: 18, fontWeight: 700 }}>
                <input type="checkbox" checked={selected.has(o.id)} onChange={(e) => toggle(o.id, e.target.checked)}
                  style={{ width: 24, height: 24, flex: 'none', accentColor: 'var(--olive)' }} />
                <span style={{ overflowWrap: 'anywhere' }}>{o.name}</span>
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}
