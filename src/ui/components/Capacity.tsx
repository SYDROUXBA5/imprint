import { capacityDots, dogCountText } from '../shared';

/**
 * How full a team is: a dot per dog (filled) and per planned place still free (outlined), then typed
 * "3 of 6 dogs". Dots only when the plan is 12 dogs or fewer; a team with no plan is just "2 dogs".
 */
export function Capacity({ count, planned }: { count: number; planned: number | null | undefined }) {
  const dots = capacityDots(count, planned);
  return (
    <span className="capacity">
      {dots && (dots.filled > 0 || dots.empty > 0) && (
        <span className="dots" aria-hidden="true" data-testid="capacity-dots">
          {Array.from({ length: dots.filled }, (_, i) => <span key={`f${i}`} className="dot dot-filled" />)}
          {Array.from({ length: dots.empty }, (_, i) => <span key={`e${i}`} className="dot" />)}
        </span>
      )}
      <span className="num" style={{ fontSize: 15 }}>{dogCountText(count, planned)}</span>
    </span>
  );
}
