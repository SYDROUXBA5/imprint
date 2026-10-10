import { useEffect, useState } from 'react';

/**
 * The current time in ms, re-read every `intervalMs`. Pass `null` to stop ticking
 * (nothing is running, so there is nothing to keep live); it catches up the moment it resumes.
 */
export function useNow(intervalMs: number | null = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
