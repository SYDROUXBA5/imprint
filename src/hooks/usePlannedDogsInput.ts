import { useRef, useState } from 'react';
import { parsePlannedDogs } from '../domain/plannedDogs';

/**
 * The text of a "Number of dogs" field and whether to complain about it. `value` is the number, or null while
 * what was typed is not a whole number of 1 or more. The complaint shows as soon as something wrong is typed,
 * and for an empty field only after a save was tried (nobody gets scolded for a field they have not reached).
 */
export function usePlannedDogsInput(initial = '') {
  const [text, setText] = useState(initial);
  const [tried, setTried] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const value = parsePlannedDogs(text);
  return {
    text, setText, value, input,
    showError: value === null && (tried || text.trim() !== ''),
    /** The save was tried with a bad number: show the complaint and put the cursor in the field. */
    complain: () => { setTried(true); input.current?.focus(); },
  };
}
