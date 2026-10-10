import { useCallback, useEffect, useRef, useState } from 'react';
import { crossedTarget } from '../domain/celebration';

/**
 * True once `total` passes 75:00 while the screen is open. The first total seen after `ready`
 * is only a baseline, so opening an odour that is already imprinted (or whose data is still
 * loading as 0) never fires it.
 */
export function useCrossedTarget(total: number, ready: boolean): [boolean, () => void, () => void] {
  const prev = useRef<number | null>(null);
  const [crossed, setCrossed] = useState(false);
  useEffect(() => {
    if (!ready) return;
    if (prev.current !== null && crossedTarget(prev.current, total)) setCrossed(true);
    prev.current = total;
  }, [total, ready]);
  const dismiss = useCallback(() => setCrossed(false), []);
  /** For a crossing the caller knows about before the live total catches up (a saved manual entry). */
  const fire = useCallback(() => setCrossed(true), []);
  return [crossed, dismiss, fire];
}
