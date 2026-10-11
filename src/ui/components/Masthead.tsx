import { DogDrawing } from './DogDrawing';

/**
 * The "Imprint" masthead: the Malinois face, the name in serif and a typed line under it. It opens the
 * Teams screen and every entry screen. `as="h1"` makes the name the page's heading (the entry screens);
 * on the Teams screen the heading is "Teams", so the name is plain text.
 */
export function Masthead({ as = 'p' }: { as?: 'h1' | 'p' }) {
  const Name = as;
  return (
    <div className="masthead">
      <span className="masthead-face"><DogDrawing size={76} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Name className="masthead-name">Imprint</Name>
        <div className="masthead-sub">K9 unit &middot; training log</div>
      </div>
    </div>
  );
}
