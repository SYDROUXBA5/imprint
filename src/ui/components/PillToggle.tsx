export interface PillOption { value: string; label: string }

/**
 * Toggle buttons (not tabs), one per option: each reports whether it is the selected one with aria-pressed.
 * Up to three share the width; with more they keep a readable size and the row scrolls sideways (spec §13.4).
 */
export function PillToggle({ value, options, onChange, label = 'Odour category' }: {
  value: string;
  options: PillOption[];
  onChange: (value: string) => void;
  label?: string;
}) {
  const scrolls = options.length > 3;
  return (
    <div role="group" aria-label={label} style={{
      display: 'grid',
      gridAutoFlow: 'column',
      gridAutoColumns: scrolls ? 'minmax(120px, max-content)' : '1fr',
      border: '1.5px solid var(--ink)', borderRadius: 999, background: 'var(--paper)',
      overflowX: scrolls ? 'auto' : 'hidden',
    }}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button key={o.value} type="button" aria-pressed={selected} onClick={() => onChange(o.value)}
            style={{
              border: 0, borderRadius: 0, fontSize: 18, fontWeight: 800, padding: scrolls ? '0 16px' : undefined,
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
