import type { OdourGroup } from '../../domain/odours';

const OPTIONS: { value: OdourGroup; label: string }[] = [
  { value: 'narcotics', label: 'Narcotics' },
  { value: 'explosives', label: 'Explosives' },
];

/** Two toggle buttons (not tabs): each reports whether it is the selected one with aria-pressed. */
export function PillToggle({ value, onChange }: { value: OdourGroup; onChange: (g: OdourGroup) => void }) {
  return (
    <div role="group" aria-label="Odour group" style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1.5px solid var(--ink)',
      borderRadius: 999, overflow: 'hidden', background: 'var(--paper)',
    }}>
      {OPTIONS.map((o) => {
        const selected = o.value === value;
        return (
          <button key={o.value} type="button" aria-pressed={selected} onClick={() => onChange(o.value)}
            style={{
              border: 0, borderRadius: 0, fontSize: 18, fontWeight: 800,
              background: selected ? 'var(--ink)' : 'transparent',
              color: selected ? 'var(--paper)' : 'var(--ink)',
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
