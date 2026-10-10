import { Sheet } from '../components/Sheet';

/** Placeholder until Task 18 builds the real form. */
export function ManualEntrySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Add a session I forgot to time">
      <p>Manual entry is built in a later step.</p>
    </Sheet>
  );
}
