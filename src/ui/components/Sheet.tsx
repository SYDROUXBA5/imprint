import { useEffect, useId, useRef, type ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  role?: 'dialog' | 'alertdialog';
}

/** Bottom sheet. Escape, the Close button and the backdrop all call onClose. */
export function Sheet({ open, onClose, title, children, role = 'dialog' }: SheetProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>('input, textarea, select');
    (first ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50 }}>
      <div data-testid="sheet-backdrop" onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(30, 26, 20, 0.45)' }} />
      <div ref={panel} role={role} aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, margin: '0 auto', maxWidth: 480,
          maxHeight: '88dvh', overflowY: 'auto', background: 'var(--paper)',
          borderTop: '3px solid var(--ink)', borderRadius: '20px 20px 0 0',
          padding: '12px 16px calc(20px + env(safe-area-inset-bottom))',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h2 id={titleId} style={{ fontSize: 22 }}>{title}</h2>
          <button type="button" onClick={onClose} className="btn" style={{ padding: '0 14px' }}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
