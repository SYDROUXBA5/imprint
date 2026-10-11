export interface PillOption { value: string; label: string }

/**
 * Toggle buttons (not tabs), one per option: each reports whether it is the selected one with aria-pressed.
 * `tabs` (the default) are typed capitals with an ink underline on the chosen one; `choice` is a row of
 * secondary buttons with the chosen one filled in ink. Up to three share the width; with more they keep a
 * readable size and the row scrolls sideways (spec §13.4).
 */
export function PillToggle({ value, options, onChange, label = 'Odour category', variant = 'tabs' }: {
  value: string;
  options: PillOption[];
  onChange: (value: string) => void;
  label?: string;
  variant?: 'tabs' | 'choice';
}) {
  const scrolls = options.length > 3;
  const choice = variant === 'choice';
  return (
    <div role="group" aria-label={label} className={choice ? 'choices' : 'tabs'}
      style={{
        overflowX: scrolls ? 'auto' : 'hidden',
        ...(choice && { gridAutoFlow: 'column', gridAutoColumns: scrolls ? 'minmax(120px, max-content)' : '1fr' }),
      }}>
      {options.map((o) => (
        <button key={o.value} type="button" className={choice ? 'choice' : 'tab'}
          aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
