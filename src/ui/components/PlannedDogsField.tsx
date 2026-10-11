import type { RefObject } from 'react';
import { PLANNED_DOGS_MESSAGE } from '../../domain/plannedDogs';

interface PlannedDogsFieldProps {
  id: string;
  text: string;
  onChange: (text: string) => void;
  showError: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * "Number of dogs": how many dogs a team will hold. It is text, not type="number", so that a pasted word or a
 * decimal is still there to be reported (a number input silently drops it); `inputMode` gives phones the digit pad.
 */
export function PlannedDogsField({ id, text, onChange, showError, inputRef }: PlannedDogsFieldProps) {
  return (
    <>
      <label className="label" htmlFor={id}>Number of dogs</label>
      <input id={id} ref={inputRef} className="field" type="text" inputMode="numeric" enterKeyHint="done" autoComplete="off"
        required value={text} onChange={(e) => onChange(e.target.value)}
        aria-invalid={showError} aria-describedby={showError ? `${id}-help ${id}-error` : `${id}-help`} />
      <p id={`${id}-help`} className="hint">
        How many dogs this team will hold. It does not add dogs.
      </p>
      {showError && <p id={`${id}-error`} role="alert" className="error">{PLANNED_DOGS_MESSAGE}</p>}
    </>
  );
}
