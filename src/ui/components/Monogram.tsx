export function Monogram({ name }: { name: string }) {
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <div aria-hidden="true" style={{
      width: 52, height: 52, flex: 'none', borderRadius: '50%', border: '4px double var(--ink)',
      display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 800, lineHeight: 1,
      transform: 'rotate(-4deg)',
    }}>
      {letter}
    </div>
  );
}
