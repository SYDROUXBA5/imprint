/** The red rubber stamp IMPRINTED, typed and a little crooked. `hero` is the big one of the celebration. */
export function ImprintedStamp({ size = 'row' }: { size?: 'row' | 'hero' }) {
  return (
    <span role="img" aria-label="Imprinted" className={`stamp${size === 'hero' ? ' stamp-hero' : ''}`}>
      <span aria-hidden="true">Imprinted</span>
    </span>
  );
}
